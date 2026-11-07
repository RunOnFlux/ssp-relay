/**
 * Post-confirmation spend audit for paymaster-funded Solana transactions.
 *
 * The allowlist, the ATA rent floor and the pre-send simulation all judge a
 * bundle against the chain state at check time. A bundle can still land and
 * cost the paymaster more than its fee when that state changes before
 * execution — e.g. the recipient closes its own (empty) token account after
 * the simulation, so the bundle's idempotent ATA create pays ~2.04M lamports
 * of rent that the reimbursement was not sized for. The transaction succeeds,
 * so the failure breaker never saw it.
 *
 * So after every confirmed sponsored bundle (and every vault setup) the
 * paymaster's real balance change for THAT transaction is measured, from the
 * confirmed transaction's `meta.preBalances` / `meta.postBalances` / `meta.fee`
 * (getTransaction at `confirmed`, the lowest commitment getTransaction serves;
 * the send path has already waited for `confirmed`). Per-transaction metadata
 * is used rather than getBalance deltas because the paymaster is the fee payer
 * of many concurrent transactions (other sends, setups, enterprise split txs,
 * pool nonces): a getBalance before/after would mix all of them, while the
 * bank records each transaction's own pre/post balances as it executes them
 * in order.
 *
 *   netCost = pre − post          (positive = the paymaster ended poorer)
 *   loss    = netCost − fee       (bundles; anything beyond the network fee
 *                                  that the vault's reimbursement — already
 *                                  inside post — did not cover)
 *
 * An honest bundle nets reimbursement − fee ≥ 0 (validateBundledPaymasterTx
 * makes the reimbursement cover the fee, and the ATA rent when the account is
 * missing at broadcast time), so any loss > 0 is a real outlay. Losses are fed
 * to the failure breaker per multisig and per client IP key, so repeated ATA
 * rent races stop being sponsored, and logged as `[solPaymaster] LOSS ...`.
 * A setup's cost settles its reservation in the setup budget.
 *
 * Everything here runs after the HTTP response is decided: callers schedule
 * an audit and return; an audit never throws (RPC failures are logged and the
 * loss is reported as unmeasured).
 */
import type { Connection, PublicKey } from '@solana/web3.js';
import log from '../lib/log';
import {
  recordSponsoredFailure,
  recordSponsoredLoss,
  type BreakerKeys,
} from './solPaymasterBreaker';
import type { SetupReservation } from './solPaymasterSetupGuard';

export interface PaymasterTxCost {
  preLamports: number;
  postLamports: number;
  /** Network fee charged to the paymaster (0 when it was not the fee payer). */
  feeLamports: number;
  /** pre − post: negative when the paymaster gained (reimbursement). */
  netCostLamports: number;
  /** The transaction failed in execution (only the fee was charged). */
  failed: boolean;
}

/** The parts of a getTransaction response the audit reads. */
export interface ConfirmedTxLike {
  meta: {
    fee: number;
    preBalances: number[];
    postBalances: number[];
    err: unknown;
  } | null;
  transaction: { message: { staticAccountKeys: PublicKey[] } };
}

/**
 * The paymaster's balance change in one confirmed transaction. Throws when
 * the response lacks the data (no meta, paymaster not an account, missing
 * balances) — never guesses.
 */
export function paymasterCostFromTransaction(
  tx: ConfirmedTxLike,
  paymaster: PublicKey,
): PaymasterTxCost {
  const meta = tx.meta;
  if (!meta) throw new Error('confirmed transaction has no status meta');
  const keys = tx.transaction?.message?.staticAccountKeys ?? [];
  const idx = keys.findIndex((k) => k.equals(paymaster));
  if (idx === -1) {
    throw new Error('paymaster is not an account of the transaction');
  }
  const pre = meta.preBalances?.[idx];
  const post = meta.postBalances?.[idx];
  // The fee payer is always account 0 and pays the whole fee.
  const fee = idx === 0 ? meta.fee : 0;
  if (
    typeof pre !== 'number' ||
    typeof post !== 'number' ||
    typeof fee !== 'number' ||
    !Number.isFinite(pre) ||
    !Number.isFinite(post) ||
    !Number.isFinite(fee)
  ) {
    throw new Error('transaction meta has no balances for the paymaster');
  }
  return {
    preLamports: pre,
    postLamports: post,
    feeLamports: fee,
    netCostLamports: pre - post,
    failed: meta.err != null,
  };
}

/**
 * Lamports a sponsored bundle cost the paymaster beyond its network fee, net
 * of the vault's reimbursement (0 for an honest bundle).
 */
export function sponsoredBundleLoss(cost: PaymasterTxCost): number {
  return Math.max(0, cost.netCostLamports - cost.feeLamports);
}

export interface AuditRetryPolicy {
  attempts: number;
  delayMs: number;
}

// getTransaction can briefly return null right after confirmation when the
// RPC is load-balanced over nodes at slightly different slots.
const DEFAULT_RETRY_POLICY: AuditRetryPolicy = { attempts: 6, delayMs: 2_000 };
let retryPolicy: AuditRetryPolicy = { ...DEFAULT_RETRY_POLICY };

/** Test hook: override (or with null, restore) the lookup retry policy. */
export function setPaymasterAuditRetryPolicy(
  policy: Partial<AuditRetryPolicy> | null,
): void {
  retryPolicy = policy
    ? { ...DEFAULT_RETRY_POLICY, ...policy }
    : { ...DEFAULT_RETRY_POLICY };
}

/** Load a confirmed transaction and measure the paymaster's cost in it. */
export async function fetchPaymasterTxCost(
  connection: Connection,
  signature: string,
  paymaster: PublicKey,
  policy: AuditRetryPolicy = retryPolicy,
): Promise<PaymasterTxCost> {
  const attempts = Math.max(1, Math.floor(policy.attempts));
  let lastError = 'transaction not found';
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0 && policy.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, policy.delayMs));
    }
    let tx: ConfirmedTxLike | null;
    try {
      tx = (await connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      })) as ConfirmedTxLike | null;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      continue;
    }
    if (tx) return paymasterCostFromTransaction(tx, paymaster);
    lastError = 'transaction not found';
  }
  throw new Error(
    `could not load the confirmed transaction after ${attempts} attempts (${lastError})`,
  );
}

// In-flight audits, so tests (and a graceful shutdown) can wait for them.
const pending = new Set<Promise<void>>();

function schedule(run: () => Promise<void>): void {
  let started: Promise<void>;
  try {
    started = run();
  } catch {
    return;
  }
  const tracked: Promise<void> = started
    .catch(() => undefined)
    .finally(() => {
      pending.delete(tracked);
    });
  pending.add(tracked);
}

/** Resolve once every scheduled audit has finished. */
export async function flushPaymasterAudits(): Promise<void> {
  while (pending.size) {
    await Promise.all([...pending]);
  }
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Schedule the loss check for a sponsored bundle. Returns at once; never
 * throws. `outcomeUnknown`: the caller could not confirm the bundle (confirm
 * timed out), so a measured on-chain failure is also counted as one.
 */
export function auditSponsoredBundle(opts: {
  connection: Connection;
  signature: string;
  paymaster: PublicKey;
  chain: string;
  breakerKeys: BreakerKeys;
  outcomeUnknown?: boolean;
}): void {
  schedule(async () => {
    try {
      const cost = await fetchPaymasterTxCost(
        opts.connection,
        opts.signature,
        opts.paymaster,
      );
      if (cost.failed && opts.outcomeUnknown) {
        recordSponsoredFailure(opts.breakerKeys);
      }
      const loss = sponsoredBundleLoss(cost);
      if (loss > 0) {
        recordSponsoredLoss(opts.breakerKeys, loss, {
          signature: opts.signature,
          chain: opts.chain,
          kind: 'bundle',
          preLamports: cost.preLamports,
          postLamports: cost.postLamports,
          feeLamports: cost.feeLamports,
        });
      }
    } catch (e) {
      log.warn(
        `[solPaymaster] post-send balance check failed for ${opts.chain} tx ${opts.signature} (multisig=${opts.breakerKeys.multisig}): ${describeError(e)} — loss not measured`,
      );
    }
  });
}

/**
 * Schedule the cost measurement of a vault setup transaction: settles the
 * setup-budget reservation with the real cost and reports a loss when the
 * setup paid more rent than `maxRentLamports` (the multisig + nonce rent the
 * fee schedule is sized for). Returns at once; never throws.
 */
export function auditSetupTx(opts: {
  connection: Connection;
  signature: string;
  paymaster: PublicKey;
  chain: string;
  breakerKeys: BreakerKeys;
  maxRentLamports: number;
  reservation?: SetupReservation;
}): void {
  schedule(async () => {
    try {
      const cost = await fetchPaymasterTxCost(
        opts.connection,
        opts.signature,
        opts.paymaster,
      );
      opts.reservation?.settle(Math.max(0, cost.netCostLamports));
      const rentPaid = cost.netCostLamports - cost.feeLamports;
      const loss = rentPaid - opts.maxRentLamports;
      if (loss > 0) {
        recordSponsoredLoss(opts.breakerKeys, loss, {
          signature: opts.signature,
          chain: opts.chain,
          kind: 'setup',
          preLamports: cost.preLamports,
          postLamports: cost.postLamports,
          feeLamports: cost.feeLamports,
        });
      }
      log.info(
        `[solPaymaster] setup ${opts.chain} tx ${opts.signature} cost the paymaster ${cost.netCostLamports} lamports (rent ${rentPaid}, fee ${cost.feeLamports}${cost.failed ? ', failed on-chain' : ''}; multisig=${opts.breakerKeys.multisig}${opts.breakerKeys.client ? `, client=${opts.breakerKeys.client}` : ''})`,
      );
    } catch (e) {
      log.warn(
        `[solPaymaster] post-setup balance check failed for ${opts.chain} tx ${opts.signature} (multisig=${opts.breakerKeys.multisig}): ${describeError(e)} — the setup budget keeps the estimate`,
      );
    }
  });
}

export default {
  auditSponsoredBundle,
  auditSetupTx,
  fetchPaymasterTxCost,
  paymasterCostFromTransaction,
  sponsoredBundleLoss,
  flushPaymasterAudits,
  setPaymasterAuditRetryPolicy,
};
