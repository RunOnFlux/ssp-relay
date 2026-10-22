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
 * This breaker counts landed-but-failed sponsored bundles per multisig and per
 * client (IP key) over a rolling 24 hours and refuses further sponsorship once
 * a key reaches its limit. Every multisig the attacker uses costs them at least
 * its on-chain registration, so the loss per multisig is bounded well below
 * that cost.
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

// key → failure timestamps (ms), oldest first.
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
        `Paymaster sponsorship refused: ${count} sponsored transactions for this ${key.split(':')[0]} landed but failed on-chain in the last 24 hours. Try again later.`,
      );
    }
  }
}

/** Record one landed-but-failed sponsored transaction for these keys. */
export function recordSponsoredFailure(
  keys: BreakerKeys,
  now = Date.now(),
): void {
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
  log.warn(
    `[solPaymaster] sponsored bundle failed on-chain (multisig=${keys.multisig}${keys.client ? `, client=${keys.client}` : ''}) — counted towards the sponsorship breaker`,
  );
}

/** Test helper: clear every count. */
export function resetPaymasterBreaker(): void {
  failures.clear();
}

export default {
  assertSponsorshipAllowed,
  recordSponsoredFailure,
  resetPaymasterBreaker,
};
