// TRON sponsor wire types, shared by the public HTTP routes (/v1/tron/*) and
// the enterprise hook contract (enterpriseHooks InitDeps). They mirror
// TRON_WIRING_BRIEF.md exactly; every integer is a decimal string and every
// address a case-sensitive base58 `T…` string.

export type TronChain = 'tron' | 'tronNile';

export const TRON_CHAINS: readonly TronChain[] = ['tron', 'tronNile'];

export function isTronChain(v: unknown): v is TronChain {
  return v === 'tron' || v === 'tronNile';
}

export interface TronCallJson {
  to: string;
  value: string;
  data: string;
  tokenId: string;
  tokenValue: string;
}

export interface TronOpJson {
  calls: TronCallJson[];
  nonce: string;
  deadline: string;
  fee: { token: string; amount: string; recipient: string };
}

export interface TronSponsorContext {
  enabled: boolean;
  chain: TronChain;
  chainId: string;
  factory: string | null;
  implementation: string | null;
  sponsor: string | null;
  feeCollector: string | null;
  /** Consumer fee ceilings the key enforces: sun / USDT base units. */
  ceilings: { trx: string; usdt: string };
}

export interface TronQuoteRequest {
  chain: TronChain;
  signers: string[];
  threshold: number;
  calls: TronCallJson[];
  /** base58 TRC-20 or TRX_FEE_TOKEN (or 'TRX'). Default: TRX if the vault's TRX covers it, else USDT. */
  feeToken?: string;
  /** Enterprise only (hook). Consumer omits: the relay picks + reserves until the deadline. */
  nonce?: string;
  /** Unix seconds. Enterprise: proposal expiry. Consumer omits: now + 30 min. */
  deadline?: string;
  /** Enterprise only (hook). Default 1.15. */
  markup?: number;
  /**
   * Send-max: the token of the ONE call that should send "everything left".
   * `TRX` / TRX_FEE_TOKEN or a TRC-20 contract. The response then carries
   * `maxSendable` = balance − fee (when the fee is in the same token) and the
   * wallet rebuilds that call with this amount before signing.
   */
  max?: { token: string };
}

export interface TronQuote {
  vault: string;
  deployed: boolean;
  nonce: string;
  deadline: string;
  fee: { token: string; amount: string; recipient: string };
  feeOptions: { token: string; amount: string }[];
  energy: { estimate: string };
  maxSendable?: { token: string; amount: string };
  /**
   * False when the vault cannot pay the fee in any accepted token (or in the
   * requested one). The quote is still returned so the UI can show the
   * amounts; broadcasting such an Op would fail simulation.
   */
  sponsorAvailable: boolean;
  unavailableReason?: string;
}

export interface TronBroadcastRequest {
  chain: TronChain;
  signers: string[];
  threshold: number;
  op: TronOpJson;
  /** 65-byte `0x` hex each, any order. */
  signatures: string[];
}
