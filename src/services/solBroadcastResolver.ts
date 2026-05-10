/**
 * In-memory promise registry that lets `POST /v1/action` for
 * `sol_co_signed` block until the wallet broadcasts and posts back
 * `sol_broadcasted` (or `sol_broadcast_failed`). The blocked request gets
 * the broadcast outcome in its response body, so the SSP Key device
 * doesn't need to poll for the result — the original POST is the
 * round-trip.
 *
 * Single in-flight broadcast per wkIdentity is assumed: a user only sends
 * one Solana tx at a time. If a second `sol_co_signed` arrives while one
 * is pending, the older waiter is rejected to keep the registry honest.
 */
import log from '../lib/log';

export type BroadcastOutcome =
  | { ok: true; signature: string }
  | { ok: false; error: string };

interface PendingWaiter {
  resolve: (outcome: BroadcastOutcome) => void;
  timer: NodeJS.Timeout;
}

const waiters = new Map<string, PendingWaiter>();

/**
 * Block until the wallet has broadcast (or failed to broadcast) the tx
 * for this wkIdentity. Times out with a structured error after
 * `timeoutMs`. Caller is responsible for inlining the result into the
 * HTTP response.
 */
export function waitForBroadcastResult(
  wkIdentity: string,
  timeoutMs: number,
): Promise<BroadcastOutcome> {
  // If a prior waiter is still hanging around, reject it — only one
  // in-flight Solana send per wkIdentity is supported.
  const existing = waiters.get(wkIdentity);
  if (existing) {
    clearTimeout(existing.timer);
    existing.resolve({
      ok: false,
      error: 'superseded by a newer co-sign request',
    });
    waiters.delete(wkIdentity);
  }

  return new Promise<BroadcastOutcome>((resolve) => {
    const timer = setTimeout(() => {
      waiters.delete(wkIdentity);
      log.warn(
        `[solBroadcastResolver] timeout waiting for broadcast result for ${wkIdentity}`,
      );
      resolve({
        ok: false,
        error: 'timeout waiting for wallet to broadcast',
      });
    }, timeoutMs);
    waiters.set(wkIdentity, { resolve, timer });
  });
}

/**
 * Called when the wallet posts `sol_broadcasted` / `sol_broadcast_failed`
 * — wakes up any waiting Key request for that wkIdentity.
 */
export function resolveBroadcastResult(
  wkIdentity: string,
  outcome: BroadcastOutcome,
): void {
  const waiter = waiters.get(wkIdentity);
  if (!waiter) return; // no Key request pending — wallet broadcasted faster than Key registered
  clearTimeout(waiter.timer);
  waiter.resolve(outcome);
  waiters.delete(wkIdentity);
}
