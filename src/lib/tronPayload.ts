/**
 * The consumer `tx` action payload for TRON (wallet → key through the relay),
 * TRON_SSP_CONTRACT.md §3:
 *   JSON {format:'ssp-tron-op', version:1, network, vault, signers:[T…],
 *         threshold, op:<Op JSON>, walletSignature:'0x…'}
 *
 * The relay only checks the shape (and the Op's canonical form through the
 * SDK). It never trusts `vault`: the key re-derives it from its own keys and
 * the relay sponsor re-derives it from signers/threshold.
 */
import {
  MAX_SIGNERS,
  isValidAddress,
  opFromJson,
  parseOp,
  type Op,
} from '@runonflux/tron-multisig';

export const TRON_OP_PAYLOAD_FORMAT = 'ssp-tron-op';
export const TRON_OP_PAYLOAD_VERSION = 1;

export interface TronOpPayload {
  network: 'mainnet' | 'nile';
  vault: string;
  signers: string[];
  threshold: number;
  op: Op;
  walletSignature: string;
}

export function tronNetworkForChain(chain: string): 'mainnet' | 'nile' {
  if (chain === 'tron') return 'mainnet';
  if (chain === 'tronNile') return 'nile';
  throw new Error(`Unsupported TRON chain: ${chain}`);
}

/** Parse and validate a `ssp-tron-op` payload. Throws with a clear reason. */
export function parseTronOpPayload(
  payload: string,
  chain: string,
): TronOpPayload {
  let p: unknown;
  try {
    p = JSON.parse(payload);
  } catch {
    throw new Error('Invalid TRON payload format: must be valid JSON');
  }
  if (!p || typeof p !== 'object' || Array.isArray(p)) {
    throw new Error('Invalid TRON payload format: must be a JSON object');
  }
  const o = p as Record<string, unknown>;
  if (o.format !== TRON_OP_PAYLOAD_FORMAT) {
    throw new Error(
      `Invalid TRON payload format: format must be ${TRON_OP_PAYLOAD_FORMAT}`,
    );
  }
  if (o.version !== TRON_OP_PAYLOAD_VERSION) {
    throw new Error('Invalid TRON payload format: unsupported version');
  }
  if (o.network !== tronNetworkForChain(chain)) {
    throw new Error(
      'Invalid TRON payload format: network does not match chain',
    );
  }
  if (!isValidAddress(o.vault)) {
    throw new Error('Invalid TRON payload format: invalid vault address');
  }
  const signers = o.signers;
  if (
    !Array.isArray(signers) ||
    signers.length === 0 ||
    signers.length > MAX_SIGNERS ||
    !signers.every((s) => isValidAddress(s))
  ) {
    throw new Error('Invalid TRON payload format: invalid signers');
  }
  const threshold = o.threshold;
  if (
    typeof threshold !== 'number' ||
    !Number.isInteger(threshold) ||
    threshold < 1 ||
    threshold > signers.length
  ) {
    throw new Error('Invalid TRON payload format: invalid threshold');
  }
  let op: Op;
  try {
    op = typeof o.op === 'string' ? parseOp(o.op) : opFromJson(o.op);
  } catch (e) {
    throw new Error(
      `Invalid TRON payload format: invalid op (${(e as Error).message})`,
    );
  }
  if (
    typeof o.walletSignature !== 'string' ||
    !/^0x[0-9a-fA-F]{130}$/.test(o.walletSignature)
  ) {
    throw new Error(
      'Invalid TRON payload format: walletSignature must be 65-byte 0x hex',
    );
  }
  return {
    network: o.network as 'mainnet' | 'nile',
    vault: o.vault,
    signers: signers as string[],
    threshold,
    op,
    walletSignature: o.walletSignature,
  };
}
