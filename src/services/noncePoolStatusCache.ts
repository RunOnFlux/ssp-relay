/**
 * `enterpriseNoncesNeeded` enrichment for GET /v1/action/:id and
 * GET /v1/sync/:id, rate-limited per wkIdentity.
 *
 * Clients poll those reads every second while a pairing or signing flow is
 * open, and computing the flag means an enterprise nonce-pool query. It is
 * therefore computed at most:
 *   - once per AUTHENTICATED_TTL_MS per wkIdentity for authenticated reads
 *     (verified read signature for that resource), and
 *   - once per UNAUTHENTICATED_TTL_MS per wkIdentity for unsigned reads, which
 *     only exist while RELAY_READ_AUTH_MODE=log (released wallets use the flag
 *     from their unsigned sync poll to start nonce replenishment).
 * Concurrent reads for the same identity share one in-flight query. Memory is
 * bounded (oldest entries dropped first).
 */
import enterpriseHooks from './enterpriseHooks';
import log from '../lib/log';

export const AUTHENTICATED_TTL_MS = 10 * 1000;
export const UNAUTHENTICATED_TTL_MS = 60 * 1000;
const MAX_ENTRIES = 20_000;
const MINIMUM_COUNT = 10;

export interface NoncesNeeded {
  wallet: boolean;
  key: boolean;
}

interface Entry {
  at: number;
  value?: NoncesNeeded;
  pending?: Promise<NoncesNeeded | undefined>;
}

const cache = new Map<string, Entry>();

async function compute(wkIdentity: string): Promise<NoncesNeeded | undefined> {
  try {
    const poolStatus = await enterpriseHooks.getNoncePoolStatus(wkIdentity);
    const walletPool = poolStatus.find((p) => p.source === 'wallet');
    const keyPool = poolStatus.find((p) => p.source === 'key');
    return {
      wallet: (walletPool?.available ?? 0) < MINIMUM_COUNT,
      key: (keyPool?.available ?? 0) < MINIMUM_COUNT,
    };
  } catch (error) {
    // Non-critical: the read is still served without the flag.
    log.error(`[NONCES] Nonce pool check failed for ${wkIdentity}: ${error}`);
    return undefined;
  }
}

/**
 * The cached-or-fresh `enterpriseNoncesNeeded` flag for `wkIdentity`, or
 * undefined when the enterprise module is absent or the query failed.
 */
export async function getEnterpriseNoncesNeeded(
  wkIdentity: string,
  authenticated: boolean,
  now = Date.now(),
): Promise<NoncesNeeded | undefined> {
  if (!enterpriseHooks.isLoaded()) return undefined;
  const ttl = authenticated ? AUTHENTICATED_TTL_MS : UNAUTHENTICATED_TTL_MS;
  const entry = cache.get(wkIdentity);
  if (entry) {
    if (entry.pending) return entry.pending;
    if (now - entry.at < ttl) return entry.value;
  }
  const pending = compute(wkIdentity);
  cache.delete(wkIdentity);
  cache.set(wkIdentity, { at: now, pending });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  const value = await pending;
  const current = cache.get(wkIdentity);
  if (current && current.pending === pending) {
    cache.set(wkIdentity, { at: now, value });
  }
  return value;
}

/** Test helper. */
export function resetNoncePoolStatusCache(): void {
  cache.clear();
}

export default { getEnterpriseNoncesNeeded, resetNoncePoolStatusCache };
