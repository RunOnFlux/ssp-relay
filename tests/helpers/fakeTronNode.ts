// A scriptable java-tron HTTP API (the /wallet + /walletsolidity subset the
// TRON sponsor uses), served through the SDK's real TronHttpClient via an
// injected fetch. Responses mimic the node's JSON exactly where it matters —
// in particular a reverting triggerconstantcontract still answers
// `result.result = true` and only flags the failure in
// `transaction.ret[0].ret = 'FAILED'` / `result.message` (spike X2).
import {
  SELECTORS,
  addressFromBytes20,
  bytesToHex,
  decodeTransaction,
  decodeTrc20Transfer,
  hexToBytes,
  selector,
} from '@runonflux/tron-multisig';
import { TronHttpClient, type FetchLike } from '@runonflux/tron-multisig/rpc';

type Json = Record<string, unknown>;

export interface SimResult {
  ok: boolean;
  energy: number;
  /** hex without 0x (return data, or revert data when !ok) */
  result?: string;
  message?: string;
}

export interface FakeNodeState {
  contracts: Map<
    string,
    {
      runtimecode: string;
      origin?: string;
      percent?: number;
      originEnergyLimit?: number;
    }
  >;
  accounts: Map<string, { balance: bigint }>;
  resources: Map<
    string,
    {
      EnergyLimit?: number;
      EnergyUsed?: number;
      NetLimit?: number;
      NetUsed?: number;
      freeNetLimit?: number;
      freeNetUsed?: number;
    }
  >;
  trc20: Map<string, Map<string, bigint>>;
  nonceBitmaps: Map<string, Map<bigint, bigint>>;
  relayers: Set<string>;
  energy: { transfer: number; balanceOf: number; view: number };
  /** Result of simulating sponsor.execute (and any other unknown call). */
  execute: SimResult;
  block: { number: bigint; timestamp: bigint };
  broadcasts: string[];
  broadcastReply: ((hex: string) => Json) | null;
  /** Solidified receipts (walletsolidity). Anything here is also in a block. */
  txInfo: Map<string, Json>;
  /** Receipts of transactions in a block but not solidified yet (/wallet). */
  blockTxInfo: Map<string, Json>;
  requests: { path: string; body: Json }[];
}

export function word(v: bigint): string {
  return v.toString(16).padStart(64, '0');
}

function wordAddress(dataHex: string, index: number): string {
  const w = dataHex.slice(8 + index * 64, 8 + (index + 1) * 64);
  return addressFromBytes20(hexToBytes(w.slice(24)));
}

function wordUint(dataHex: string, index: number): bigint {
  return BigInt(`0x${dataHex.slice(8 + index * 64, 8 + (index + 1) * 64)}`);
}

export const REVERT_BAD_SIGNATURE = bytesToHex(selector('BadSignature()'));

function simResponse(r: SimResult): Json {
  if (r.ok) {
    return {
      result: { result: true },
      energy_used: r.energy,
      constant_result: [r.result ?? ''],
      transaction: { ret: [{}] },
    };
  }
  return {
    // The trap: result.result is TRUE on a revert.
    result: {
      result: true,
      message: Buffer.from(r.message ?? 'REVERT opcode executed').toString(
        'hex',
      ),
    },
    energy_used: r.energy,
    constant_result: [r.result ?? ''],
    transaction: { ret: [{ ret: 'FAILED' }] },
  };
}

export function createFakeNode(): {
  state: FakeNodeState;
  fetch: FetchLike;
  client: TronHttpClient;
} {
  const state: FakeNodeState = {
    contracts: new Map(),
    accounts: new Map(),
    resources: new Map(),
    trc20: new Map(),
    nonceBitmaps: new Map(),
    relayers: new Set(),
    energy: { transfer: 64_285, balanceOf: 3_000, view: 500 },
    execute: { ok: true, energy: 100_000, result: '' },
    block: { number: 70_000_000n, timestamp: 1_789_999_000_000n },
    broadcasts: [],
    broadcastReply: null,
    txInfo: new Map(),
    blockTxInfo: new Map(),
    requests: [],
  };

  function trigger(body: Json): Json {
    const owner = String(body.owner_address);
    const contract = String(body.contract_address);
    const data = String(body.data);
    const sel = `0x${data.slice(0, 8)}`;
    if (!state.contracts.has(contract)) {
      return {
        result: {
          code: 'CONTRACT_VALIDATE_ERROR',
          message: Buffer.from('Smart contract is not exist.').toString('hex'),
        },
      };
    }
    if (sel === SELECTORS.trc20BalanceOf) {
      const holder = wordAddress(data, 0);
      const bal = state.trc20.get(contract)?.get(holder) ?? 0n;
      return simResponse({
        ok: true,
        energy: state.energy.balanceOf,
        result: word(bal),
      });
    }
    if (sel === SELECTORS.trc20Transfer) {
      const t = decodeTrc20Transfer(hexToBytes(data));
      const bal = state.trc20.get(contract)?.get(owner) ?? 0n;
      if (!t || bal < t.amount) {
        return simResponse({ ok: false, energy: 1_984 });
      }
      return simResponse({
        ok: true,
        energy: state.energy.transfer,
        result: word(0n), // USDT returns false on success
      });
    }
    if (sel === SELECTORS.nonceBitmap) {
      const w = wordUint(data, 0);
      return simResponse({
        ok: true,
        energy: state.energy.view,
        result: word(state.nonceBitmaps.get(contract)?.get(w) ?? 0n),
      });
    }
    if (sel === SELECTORS.isNonceUsed) {
      const n = wordUint(data, 0);
      const w = n >> 8n;
      const bit = n & 255n;
      const bm = state.nonceBitmaps.get(contract)?.get(w) ?? 0n;
      return simResponse({
        ok: true,
        energy: state.energy.view,
        result: word((bm >> bit) & 1n),
      });
    }
    if (sel === SELECTORS.isRelayer) {
      const r = wordAddress(data, 0);
      return simResponse({
        ok: true,
        energy: state.energy.view,
        result: word(state.relayers.has(r) ? 1n : 0n),
      });
    }
    return simResponse(state.execute);
  }

  const fetch: FetchLike = async (url, init) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(init.body) as Json;
    state.requests.push({ path, body });
    let reply: Json;
    switch (path) {
      case '/wallet/getcontractinfo': {
        const c = state.contracts.get(String(body.value));
        reply = c ? { runtimecode: c.runtimecode } : {};
        break;
      }
      case '/wallet/getcontract': {
        const c = state.contracts.get(String(body.value));
        reply = c
          ? {
              origin_address: c.origin,
              consume_user_resource_percent: c.percent ?? 0,
              origin_energy_limit: c.originEnergyLimit ?? 0,
              bytecode: '',
            }
          : {};
        break;
      }
      case '/wallet/getaccount': {
        const a = state.accounts.get(String(body.address));
        reply = a ? { balance: Number(a.balance) } : {};
        break;
      }
      case '/wallet/getaccountresource':
        reply = { ...(state.resources.get(String(body.address)) ?? {}) };
        break;
      case '/wallet/triggerconstantcontract':
        reply = trigger(body);
        break;
      case '/wallet/getnowblock': {
        const id =
          state.block.number.toString(16).padStart(16, '0') + 'ab'.repeat(24);
        reply = {
          blockID: id,
          block_header: {
            raw_data: {
              number: Number(state.block.number),
              timestamp: Number(state.block.timestamp),
            },
          },
        };
        break;
      }
      case '/wallet/broadcasthex': {
        const hex = String(body.transaction);
        state.broadcasts.push(hex);
        reply = state.broadcastReply
          ? state.broadcastReply(hex)
          : { result: true, txid: decodeTransaction(hex).txid };
        break;
      }
      case '/walletsolidity/gettransactioninfobyid':
        reply = state.txInfo.get(String(body.value)) ?? {};
        break;
      case '/wallet/gettransactioninfobyid':
        reply =
          state.blockTxInfo.get(String(body.value)) ??
          state.txInfo.get(String(body.value)) ??
          {};
        break;
      default:
        return { ok: false, status: 404, text: async () => 'not found' };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(reply) };
  };

  return {
    state,
    fetch,
    client: new TronHttpClient('https://node.test', fetch),
  };
}
