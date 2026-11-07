/**
 * Shared TRON full-node client construction for the relay (sponsor service,
 * token metadata). The SDK's TronHttpClient takes no API keys by design; the
 * branded ssp-backends-proxy Worker (node-tron.sspwallet.io) holds them.
 */
import config from 'config';
import { TronHttpClient, type FetchLike } from '@runonflux/tron-multisig/rpc';
import type { TronChain } from '../types/tron';

export type TronSlot = 'mainnet' | 'nile';

export function tronSlot(chain: TronChain | string): TronSlot {
  if (chain === 'tron') return 'mainnet';
  if (chain === 'tronNile') return 'nile';
  throw new Error(`Unsupported TRON chain: ${String(chain)}`);
}

export interface TronChainConfig {
  node: string;
  api: string;
  factory?: string | null;
  implementation?: string | null;
  sponsor?: string | null;
  feeCollector?: string | null;
}

export function tronChainConfig(chain: TronChain | string): TronChainConfig {
  return config.get<TronChainConfig>(`tron.${tronSlot(chain)}`);
}

/**
 * Relay identification header for the branded proxy. Same key and reason as
 * the Solana path (solPaymasterService.solanaConnectionConfig): the Worker
 * rate-limits unauthenticated callers per IP, and every sponsored TRON call
 * leaves from the relay's single egress IP. A missing key only degrades to the
 * per-IP bucket.
 */
export function relayProxyHeaders(): Record<string, string> {
  const key = process.env.SSP_RELAY_PROXY_KEY;
  return key ? { 'X-SSP-Relay-Key': key } : {};
}

const RPC_TIMEOUT_MS = 15_000;

/** `globalThis.fetch` with a hard timeout, in the shape the SDK expects. */
export const defaultTronFetch: FetchLike = async (url, init) => {
  const res = await fetch(url, {
    method: init.method,
    headers: { ...init.headers },
    body: init.body,
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  return res;
};

export function createTronClient(
  chain: TronChain,
  fetchLike: FetchLike = defaultTronFetch,
): TronHttpClient {
  const { node } = tronChainConfig(chain);
  return new TronHttpClient(node, fetchLike, { headers: relayProxyHeaders() });
}
