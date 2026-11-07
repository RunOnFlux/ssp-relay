/**
 * Budget for paymaster-funded consumer vault setups (POST /v1/sol/setup).
 *
 * A setup makes the paymaster pay the rent of a new multisig PDA and of its
 * durable nonce account (~2.94M lamports, permanent), and the only gate in
 * front of it is a vault balance check against a vault the caller controls.
 * The same ~0.00325 SOL can be moved from one fresh vault to the next, so
 * every new keypair pair costs the paymaster a setup while costing the caller
 * only a transfer fee (SOL-6). Identity is no cost either: unsigned requests
 * are accepted under RELAY_LEGACY_UNAUTH_MODE=log and signed identities are
 * self-made.
 *
 * So setups that actually spend paymaster SOL are counted and capped:
 *
 *   - per client IP key (clientIpKey): SSP_SOLANA_SETUP_PER_IP_HOURLY per
 *     rolling hour and SSP_SOLANA_SETUP_PER_IP_DAILY per rolling 24 hours;
 *   - globally: SSP_SOLANA_SETUP_GLOBAL_HOURLY setups and
 *     SSP_SOLANA_SETUP_GLOBAL_HOURLY_LAMPORTS lamports per rolling hour. When
 *     the global budget is exhausted every new setup is refused and one
 *     ERROR line `[solPaymaster] ALERT ...` is logged per window.
 *
 * Only setups that send a paymaster transaction are counted. The idempotent
 * path (multisig + nonce already exist) and requests refused before sending
 * (bad input, balance gate, RPC failure, preflight refusal) are free for the
 * paymaster and are not charged, so a user who retries after funding an empty
 * vault is never locked out by their own failed attempts. A legitimate wallet
 * calls setup once per vault, on its first send (wallet 2.1.3 posts it only
 * while the multisig or its nonce is missing), so even a shared CGNAT address
 * stays far below the per-IP limits. A reservation is charged with an
 * estimate before sending and corrected to the measured cost once the
 * transaction is confirmed (solPaymasterAudit).
 *
 * Charging happens synchronously at the point of spend (no await between the
 * check and the record), so concurrent requests cannot overshoot the limits,
 * and a client that aborts its HTTP request is still charged — unlike a
 * route-level limiter that discounts "failed" requests.
 *
 * Storage is in-process, like the failure breaker: the relay runs as a single
 * process and a restart (which an attacker cannot trigger) resets the counts.
 */
import log from '../lib/log';

export const SETUP_HOUR_MS = 60 * 60 * 1000;
export const SETUP_DAY_MS = 24 * SETUP_HOUR_MS;
const MAX_TRACKED_CLIENTS = 100_000;

/**
 * Defaults, overridable per env var (non-negative integers; 0 disables
 * paymaster-funded setups for that scope, e.g. as an emergency stop).
 *
 * perIpHourly 3 / perIpDaily 10: one legitimate setup per new vault, plus
 * retries after the rare landed-but-failed or timed-out setup, plus several
 * users behind one shared address. globalHourly 20 / 0.075 SOL: far above the
 * consumer first-send rate, and it caps the worst case (attacker with many
 * addresses) at 20 x ~2.95M ≈ 0.06 SOL per hour. The lamport cap only binds
 * when setups cost more than expected (priority fee, rent change).
 */
export const SETUP_GUARD_DEFAULTS = {
  perIpHourly: 3,
  perIpDaily: 10,
  globalHourly: 20,
  globalHourlyLamports: 75_000_000,
} as const;

export const SETUP_GUARD_ENV = {
  perIpHourly: 'SSP_SOLANA_SETUP_PER_IP_HOURLY',
  perIpDaily: 'SSP_SOLANA_SETUP_PER_IP_DAILY',
  globalHourly: 'SSP_SOLANA_SETUP_GLOBAL_HOURLY',
  globalHourlyLamports: 'SSP_SOLANA_SETUP_GLOBAL_HOURLY_LAMPORTS',
} as const;

export interface SetupGuardLimits {
  perIpHourly: number;
  perIpDaily: number;
  globalHourly: number;
  globalHourlyLamports: number;
}

const warnedInvalidEnv = new Set<string>();

function envLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw.trim());
  if (Number.isSafeInteger(n) && n >= 0) return n;
  if (!warnedInvalidEnv.has(`${name}=${raw}`)) {
    warnedInvalidEnv.add(`${name}=${raw}`);
    log.warn(
      `[solPaymaster] ignoring invalid ${name}=${JSON.stringify(raw)} (expected a non-negative integer) — using ${fallback}`,
    );
  }
  return fallback;
}

/** Current limits (env is read on every call; a restart is not required). */
export function setupGuardLimits(): SetupGuardLimits {
  return {
    perIpHourly: envLimit(
      SETUP_GUARD_ENV.perIpHourly,
      SETUP_GUARD_DEFAULTS.perIpHourly,
    ),
    perIpDaily: envLimit(
      SETUP_GUARD_ENV.perIpDaily,
      SETUP_GUARD_DEFAULTS.perIpDaily,
    ),
    globalHourly: envLimit(
      SETUP_GUARD_ENV.globalHourly,
      SETUP_GUARD_DEFAULTS.globalHourly,
    ),
    globalHourlyLamports: envLimit(
      SETUP_GUARD_ENV.globalHourlyLamports,
      SETUP_GUARD_DEFAULTS.globalHourlyLamports,
    ),
  };
}

interface SetupEntry {
  t: number;
  lamports: number;
  client?: string;
}

/** A charged setup. release() refunds it; settle() records the real cost. */
export interface SetupReservation {
  /** The setup spent nothing (never reached the chain): uncount it. */
  release(): void;
  /** Replace the estimate with the measured paymaster cost (lamports). */
  settle(actualLamports: number): void;
}

// Paid setups of the last hour (global budget), oldest first.
let globalEntries: SetupEntry[] = [];
// client → its paid setups of the last 24 hours, oldest first. The entry
// objects are shared with globalEntries so settle()/release() update both.
const clientEntries = new Map<string, SetupEntry[]>();
let lastGlobalAlertAt = Number.NEGATIVE_INFINITY;

function pruneGlobal(now: number): void {
  const cutoff = now - SETUP_HOUR_MS;
  if (globalEntries.length && globalEntries[0].t <= cutoff) {
    globalEntries = globalEntries.filter((e) => e.t > cutoff);
  }
}

function recentClientEntries(client: string, now: number): SetupEntry[] {
  const list = clientEntries.get(client);
  if (!list) return [];
  const cutoff = now - SETUP_DAY_MS;
  const fresh = list.filter((e) => e.t > cutoff);
  if (fresh.length === 0) {
    clientEntries.delete(client);
  } else if (fresh.length !== list.length) {
    clientEntries.set(client, fresh);
  }
  return fresh;
}

function inMinutes(ms: number): string {
  const n = Math.max(1, Math.ceil(ms / 60_000));
  return `${n} minute${n === 1 ? '' : 's'}`;
}

/**
 * Charge one paymaster-funded setup against the per-client and global
 * budgets, or throw (user-facing message) when either is exhausted. Call it
 * immediately before building + sending the setup transaction, after every
 * free check (idempotency, balance gate) has passed.
 */
export function reserveSetup(opts: {
  clientKey?: string;
  estimateLamports: number;
  now?: number;
}): SetupReservation {
  const now = opts.now ?? Date.now();
  const limits = setupGuardLimits();
  const client = opts.clientKey;

  if (client) {
    const list = recentClientEntries(client, now);
    const lastHour = list.filter((e) => e.t > now - SETUP_HOUR_MS);
    if (lastHour.length >= limits.perIpHourly) {
      log.warn(
        `[solPaymaster] setup refused for client=${client}: ${lastHour.length} paid setups in the last hour (limit ${limits.perIpHourly})`,
      );
      const wait = lastHour.length
        ? lastHour[0].t + SETUP_HOUR_MS - now
        : SETUP_HOUR_MS;
      throw new Error(
        `Too many new Solana vault setups from your network in the last hour. Please try again in ${inMinutes(wait)}.`,
      );
    }
    if (list.length >= limits.perIpDaily) {
      log.warn(
        `[solPaymaster] setup refused for client=${client}: ${list.length} paid setups in the last 24 hours (limit ${limits.perIpDaily})`,
      );
      const wait = list.length ? list[0].t + SETUP_DAY_MS - now : SETUP_DAY_MS;
      throw new Error(
        `Too many new Solana vault setups from your network today. Please try again in ${inMinutes(wait)}.`,
      );
    }
  }

  pruneGlobal(now);
  const count = globalEntries.length;
  const spent = globalEntries.reduce((sum, e) => sum + e.lamports, 0);
  const estimate = Math.max(0, Math.ceil(opts.estimateLamports));
  if (
    count >= limits.globalHourly ||
    spent + estimate > limits.globalHourlyLamports
  ) {
    if (now - lastGlobalAlertAt >= SETUP_HOUR_MS) {
      lastGlobalAlertAt = now;
      log.error(
        `[solPaymaster] ALERT global Solana setup budget exhausted: ${count} paid setups / ${spent} lamports in the last hour (limits ${limits.globalHourly} setups / ${limits.globalHourlyLamports} lamports) — refusing new paymaster-funded vault setups until the window frees up. Possible rent-grind attack (SOL-6); raise ${SETUP_GUARD_ENV.globalHourly} / ${SETUP_GUARD_ENV.globalHourlyLamports} only if this is legitimate demand.`,
      );
    }
    const wait = count ? globalEntries[0].t + SETUP_HOUR_MS - now : 0;
    throw new Error(
      `Solana vault setup is temporarily unavailable (the relay's hourly setup budget is used up). Your funds are safe; please try again in ${inMinutes(wait)}.`,
    );
  }

  const entry: SetupEntry = { t: now, lamports: estimate, client };
  globalEntries.push(entry);
  if (client) {
    const list = recentClientEntries(client, now);
    list.push(entry);
    // Re-insert so Map order tracks recency for the eviction below.
    clientEntries.delete(client);
    clientEntries.set(client, list);
    while (clientEntries.size > MAX_TRACKED_CLIENTS) {
      const oldest = clientEntries.keys().next().value;
      if (oldest === undefined) break;
      clientEntries.delete(oldest);
    }
  }

  let released = false;
  return {
    release(): void {
      if (released) return;
      released = true;
      globalEntries = globalEntries.filter((e) => e !== entry);
      if (client) {
        const list = clientEntries.get(client);
        if (list) {
          const rest = list.filter((e) => e !== entry);
          if (rest.length) clientEntries.set(client, rest);
          else clientEntries.delete(client);
        }
      }
    },
    settle(actualLamports: number): void {
      if (released) return;
      if (Number.isFinite(actualLamports)) {
        entry.lamports = Math.max(0, Math.ceil(actualLamports));
      }
    },
  };
}

/** Snapshot for logs/tests: paid setups and lamports in the current hour. */
export function setupBudgetUsage(now = Date.now()): {
  count: number;
  lamports: number;
} {
  pruneGlobal(now);
  return {
    count: globalEntries.length,
    lamports: globalEntries.reduce((sum, e) => sum + e.lamports, 0),
  };
}

/** Test helper: clear every count and the alert latch. */
export function resetSetupGuard(): void {
  globalEntries = [];
  clientEntries.clear();
  lastGlobalAlertAt = Number.NEGATIVE_INFINITY;
  warnedInvalidEnv.clear();
}

export default {
  reserveSetup,
  setupGuardLimits,
  setupBudgetUsage,
  resetSetupGuard,
};
