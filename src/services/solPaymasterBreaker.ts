/**
 * Failure breaker for paymaster-sponsored Solana bundles.
 *
 * The paymaster is the fee payer, and Solana charges the fee for a landed
 * transaction even when it fails in execution, while the in-proposal
 * reimbursement only runs on success. Simulation and the instruction
 * allowlist rule out bundles that fail deterministically, but a bundle can
 * still pass simulation and then fail on-chain when state changes in between
 * (for example the members front-run their own proposal index, or drain the
 * vault through a self-paid transaction). Each such failure costs the
 * paymaster up to signatures × 5000 + the capped priority fee.
 *
 * A bundle can also land SUCCESSFULLY and still cost the paymaster more than
 * its fee: the recipient closes its own token account between the relay's
 * simulation and execution, so the bundle's idempotent ATA create pays the
 * rent again (~2.04M lamports) although the reimbursement was sized for an
 * existing account. solPaymasterAudit measures every confirmed sponsored
 * transaction's real paymaster balance change and reports such losses here.
 *
 * This breaker counts both events — landed-but-failed sponsored bundles and
 * measured losses — per multisig and per client (IP key) over a rolling 24
 * hours and refuses further sponsorship (sends and new vault setups) once a
 * key reaches its limit. Every multisig the attacker uses needs a
 * paymaster-provisioned durable nonce (for consumer vaults a budgeted
 * /v1/sol/setup), so the loss per multisig and per client is bounded.
 *
 * Storage is in-process. The relay is a single process by design (socket.io
 * rooms and the auth nonce cache are in-process too), so the counts are
 * authoritative; a restart resets them, which an attacker cannot trigger.
 * Memory is bounded: at most MAX_TRACKED_KEYS keys, oldest dropped first.
 */
import log from '../lib/log';

export const PAYMASTER_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_FAILURES_PER_MULTISIG = 3;
export const MAX_FAILURES_PER_CLIENT = 5;
const MAX_TRACKED_KEYS = 100_000;

export interface BreakerKeys {
  /** Base58 multisig PDA of the bundle. */
  multisig: string;
  /** Client key (rate-limit IP key) when the request came over HTTP. */
  client?: string;
}

// key → event (landed failure or measured loss) timestamps (ms), oldest first.
const failures = new Map<string, number[]>();

function recentFailures(key: string, now: number): number[] {
  const list = failures.get(key);
  if (!list) return [];
  const cutoff = now - PAYMASTER_FAILURE_WINDOW_MS;
  const fresh = list.filter((t) => t > cutoff);
  if (fresh.length === 0) {
    failures.delete(key);
  } else if (fresh.length !== list.length) {
    failures.set(key, fresh);
  }
  return fresh;
}

function scopedKeys(keys: BreakerKeys): Array<[string, number]> {
  const out: Array<[string, number]> = [
    [`multisig:${keys.multisig}`, MAX_FAILURES_PER_MULTISIG],
  ];
  if (keys.client) {
    out.push([`client:${keys.client}`, MAX_FAILURES_PER_CLIENT]);
  }
  return out;
}

/**
 * Throws when sponsorship is refused for these keys (a key reached its
 * failure limit within the window). Call before signing.
 */
export function assertSponsorshipAllowed(
  keys: BreakerKeys,
  now = Date.now(),
): void {
  for (const [key, limit] of scopedKeys(keys)) {
    const count = recentFailures(key, now).length;
    if (count >= limit) {
      throw new Error(
        `Paymaster sponsorship refused: ${count} sponsored transactions for this ${key.split(':')[0]} failed on-chain or cost the paymaster more than their fee in the last 24 hours. Try again later.`,
      );
    }
  }
}

function recordEvent(keys: BreakerKeys, now: number): void {
  for (const [key] of scopedKeys(keys)) {
    const list = recentFailures(key, now);
    list.push(now);
    // Re-insert so Map order tracks recency for the eviction below.
    failures.delete(key);
    failures.set(key, list);
  }
  while (failures.size > MAX_TRACKED_KEYS) {
    const oldest = failures.keys().next().value;
    if (oldest === undefined) break;
    failures.delete(oldest);
  }
}

function describeKeys(keys: BreakerKeys): string {
  return `multisig=${keys.multisig}${keys.client ? `, client=${keys.client}` : ''}`;
}

/** Record one landed-but-failed sponsored transaction for these keys. */
export function recordSponsoredFailure(
  keys: BreakerKeys,
  now = Date.now(),
): void {
  recordEvent(keys, now);
  log.warn(
    `[solPaymaster] sponsored bundle failed on-chain (${describeKeys(keys)}) — counted towards the sponsorship breaker`,
  );
}

export interface SponsoredLossDetail {
  /** Transaction signature the loss was measured on. */
  signature: string;
  chain: string;
  /** 'bundle' = a sponsored send, 'setup' = a vault setup. */
  kind: 'bundle' | 'setup';
  /** Paymaster balance before / after the transaction, and the fee charged. */
  preLamports: number;
  postLamports: number;
  feeLamports: number;
}

/**
 * Record one confirmed sponsored transaction that cost the paymaster
 * `lossLamports` beyond what it is allowed to (the network fee, net of the
 * vault's reimbursement). Counts exactly like a landed failure and logs an
 * ERROR `[solPaymaster] LOSS ...` line.
 */
export function recordSponsoredLoss(
  keys: BreakerKeys,
  lossLamports: number,
  detail: SponsoredLossDetail,
  now = Date.now(),
): void {
  recordEvent(keys, now);
  log.error(
    `[solPaymaster] LOSS ${lossLamports} lamports beyond the expected cost of ${detail.chain} ${detail.kind} tx ${detail.signature} (${describeKeys(keys)}; paymaster pre=${detail.preLamports} post=${detail.postLamports} fee=${detail.feeLamports}) — counted towards the sponsorship breaker`,
  );
}

/** Breaker events (failures + losses) in the window for a scoped key. */
export function sponsorshipEventCount(
  keys: BreakerKeys,
  now = Date.now(),
): { multisig: number; client?: number } {
  return {
    multisig: recentFailures(`multisig:${keys.multisig}`, now).length,
    client: keys.client
      ? recentFailures(`client:${keys.client}`, now).length
      : undefined,
  };
}

/** Test helper: clear every count. */
export function resetPaymasterBreaker(): void {
  failures.clear();
}

export default {
  assertSponsorshipAllowed,
  recordSponsoredFailure,
  recordSponsoredLoss,
  sponsorshipEventCount,
  resetPaymasterBreaker,
};
