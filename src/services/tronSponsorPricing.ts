/**
 * TRON sponsor pricing: the documented energy constants and the pure math
 * that turns energy + bandwidth into a fee. No I/O here; tronSponsorService
 * feeds it simulation results.
 *
 * Every constant comes from the spike on a mainnet-aligned java-tron 4.8.2.2
 * chain (~/repos/tron-spike/RESULTS.md, tables T6/T7, receipts with txids).
 * Base costs there reproduce mainnet exactly (14,650 + 49,635 USDT penalty =
 * 64,285). The token frames themselves (USDT and its dynamic-energy penalty)
 * are never a constant: they are simulated per call with
 * `triggerconstantcontract`, which matched real usage exactly (X1).
 */
import {
  TRX_FEE_TOKEN,
  buildExecuteTransaction,
  serializeTransaction,
  type Op,
  type VaultConfig,
} from '@runonflux/tron-multisig';

export const ENERGY = Object.freeze({
  /** T7: sponsor execute 43,208 − direct vault execute 35,652 = 7,556. */
  SPONSOR_WRAPPER: 7_600n,
  /**
   * T6: vault overhead of a 2-of-2 over the same plain call (Tether 35,652 −
   * 14,650; TRX 27,585 − 0 includes the TRX call below). Covers config hash,
   * TIP-712 digest, 2 × ecrecover and the nonce write on a warm word.
   */
  VAULT_BASE_2SIG: 21_000n,
  /** T6: 6-of-10 (54,244) − 2-of-2 (35,632) = 18,612 over 4 extra signatures. */
  PER_EXTRA_SIGNATURE: 4_650n,
  /** T6: first use of a nonce-bitmap word (SSTORE 0 → non-zero), rows 13/23. */
  COLD_NONCE_WORD: 15_000n,
  /** T6 rows 11/12: clone deploy 50,477, independent of the config. */
  DEPLOY: 50_500n,
  /** T6 fee variants: immediate TRX fee +9,354. */
  TRX_FEE: 9_400n,
  /** T6 rows 20/21: vault TRX transfer 27,585 − 21,000 vault overhead. */
  TRX_CALL: 7_000n,
  /** T6 row 22: TRX to an unactivated account +24,980 (NEW_ACCT_CALL 25,000). */
  NEW_ACCOUNT: 25_000n,
  /**
   * Estimate (not measured): TIP-712 hashCall + CALL setup for each call
   * beyond the first, which the single-call spike rows do not show.
   */
  PER_EXTRA_CALL: 2_000n,
  /**
   * A vault self-call (nonce invalidation, Stake 2.0) on a vault that is not
   * deployed yet cannot be simulated. T9 stake ops measured ≈11.7–12.2k.
   */
  SELF_CALL: 30_000n,
  /**
   * SafeTRC20.safeTransferChecked bookkeeping + FeePaid event on top of the
   * simulated token frames (transfer + 2 × balanceOf). Estimate.
   */
  TRC20_FEE_OVERHEAD: 6_000n,
  /**
   * Plan §6.1: a USDT fee on mainnet (hot token, 4.4× penalty) ≈ +84k. Used
   * only when the vault holds no USDT, so the fee transfer can't be simulated.
   */
  USDT_FEE_FALLBACK: 84_000n,
});

/** 1000 sun per byte of bandwidth burned (java-tron TRANSACTION_FEE). */
export const BANDWIDTH_PRICE_SUN = 1_000n;
/** java-tron bills `serializedSize + MAX_RESULT_SIZE_IN_TX (64)` bytes. */
export const BANDWIDTH_RESULT_BYTES = 64n;

/** Quote floors (plan §6.4). */
export const FLOOR_TRX_SUN = 2_000_000n;
export const FLOOR_USDT_UNITS = 1_000_000n;

/** Consumer ceilings the key enforces (contract §5.4): 30 TRX / 8 USDT. */
export const CEILING_TRX_SUN = 30_000_000n;
export const CEILING_USDT_UNITS = 8_000_000n;

export const DEFAULT_MARKUP = 1.15;
export const MIN_MARKUP = 1;
export const MAX_MARKUP = 3;

/** Energy of everything except the individual calls and the fee transfer. */
export function baseEnergy(p: {
  threshold: number;
  deployed: boolean;
  coldNonceWord: boolean;
  callCount: number;
}): bigint {
  const extraSigs = BigInt(Math.max(0, p.threshold - 2));
  const extraCalls = BigInt(Math.max(0, p.callCount - 1));
  return (
    ENERGY.SPONSOR_WRAPPER +
    ENERGY.VAULT_BASE_2SIG +
    extraSigs * ENERGY.PER_EXTRA_SIGNATURE +
    extraCalls * ENERGY.PER_EXTRA_CALL +
    (p.deployed ? 0n : ENERGY.DEPLOY) +
    (p.coldNonceWord ? ENERGY.COLD_NONCE_WORD : 0n)
  );
}

/** What the sponsored transaction costs SSP, in sun, before any markup. */
export function costSun(
  energy: bigint,
  bandwidthBytes: bigint,
  energyPriceSun: bigint,
): bigint {
  if (energy < 0n || bandwidthBytes < 0n || energyPriceSun <= 0n) {
    throw new Error('invalid cost inputs');
  }
  return energy * energyPriceSun + bandwidthBytes * BANDWIDTH_PRICE_SUN;
}

export function validateMarkup(markup: unknown): number {
  if (
    typeof markup !== 'number' ||
    !Number.isFinite(markup) ||
    markup < MIN_MARKUP ||
    markup > MAX_MARKUP
  ) {
    throw new Error(
      `markup must be a number in [${MIN_MARKUP}, ${MAX_MARKUP}]`,
    );
  }
  return markup;
}

/** ceil(amount × markup), with the markup taken to 4 decimal places. */
export function applyMarkup(amount: bigint, markup: number): bigint {
  const bps = BigInt(Math.round(validateMarkup(markup) * 10_000));
  return (amount * bps + 9_999n) / 10_000n;
}

export interface UsdRates {
  /** USD per TRX, or null when unknown (then USDT pricing is unavailable). */
  trxUsd: number | null;
  /** USD per USDT (≈1). */
  usdtUsd: number;
}

/** Sanity bounds so a broken rate feed can never price a fee at 0 or ∞. */
export function isSaneTrxRate(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0.001 && v < 100;
}

/**
 * sun → USDT base units (both 6 decimals), rounded UP. Throws when the TRX
 * rate is unknown: a USDT fee must never be priced from a guess.
 */
export function sunToUsdtUnits(sun: bigint, rates: UsdRates): bigint {
  if (!isSaneTrxRate(rates.trxUsd)) {
    throw new Error('TRX/USD rate unavailable');
  }
  const usdt =
    Number.isFinite(rates.usdtUsd) && rates.usdtUsd > 0.5 && rates.usdtUsd < 2
      ? rates.usdtUsd
      : 1;
  if (sun > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('amount out of range');
  }
  return BigInt(Math.ceil((Number(sun) * rates.trxUsd) / usdt));
}

/** Price one fee option: cost × markup, converted, floored. */
export function priceFee(p: {
  token: 'TRX' | 'USDT';
  energy: bigint;
  bandwidthBytes: bigint;
  energyPriceSun: bigint;
  markup: number;
  rates: UsdRates;
}): bigint {
  const withMarkup = applyMarkup(
    costSun(p.energy, p.bandwidthBytes, p.energyPriceSun),
    p.markup,
  );
  if (p.token === 'TRX') {
    return withMarkup > FLOOR_TRX_SUN ? withMarkup : FLOOR_TRX_SUN;
  }
  const usdt = sunToUsdtUnits(withMarkup, p.rates);
  return usdt > FLOOR_USDT_UNITS ? usdt : FLOOR_USDT_UNITS;
}

/**
 * The minimum a broadcast must pay: today's cost with NO markup, in the fee
 * token (the acceptance rule). No floor: the floor is a quoting rule.
 */
export function minimumFee(p: {
  token: 'TRX' | 'USDT';
  energy: bigint;
  bandwidthBytes: bigint;
  energyPriceSun: bigint;
  rates: UsdRates;
}): bigint {
  const cost = costSun(p.energy, p.bandwidthBytes, p.energyPriceSun);
  return p.token === 'TRX' ? cost : sunToUsdtUnits(cost, p.rates);
}

/**
 * Bandwidth the relayer burns for this Op: the exact serialized size of the
 * sponsor `execute` transaction (with `threshold` placeholder signatures and
 * one relayer signature) + 64. The fee amount is fixed-width in the ABI, so a
 * placeholder amount gives the final size.
 */
export function executeBandwidthBytes(p: {
  owner: string;
  sponsor: string;
  config: VaultConfig;
  op: Op;
  nowMs: bigint;
}): bigint {
  const raw = buildExecuteTransaction({
    owner: p.owner,
    target: p.sponsor,
    config: p.config,
    op: p.op,
    signaturesPacked: new Uint8Array(p.config.threshold * 65),
    feeLimit: 0n,
    ref: { refBlockBytes: new Uint8Array(2), refBlockHash: new Uint8Array(8) },
    expiration: p.nowMs + 60_000n,
    timestamp: p.nowMs,
  });
  const hex = serializeTransaction({
    raw,
    signatures: [new Uint8Array(65)],
  });
  return BigInt(hex.length / 2) + BANDWIDTH_RESULT_BYTES;
}

/** Bytes of a real, signed transaction hex. */
export function signedTxBandwidthBytes(txHex: string): bigint {
  return BigInt(txHex.length / 2) + BANDWIDTH_RESULT_BYTES;
}

export function isTrxToken(token: string): boolean {
  return token === 'TRX' || token === TRX_FEE_TOKEN;
}
