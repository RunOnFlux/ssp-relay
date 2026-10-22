/**
 * EVM call guard — relay-side stopgap for security finding C-4.
 *
 * A consumer EVM send reaches SSP Key as `POST /v1/action` with
 * `action: 'tx'` and the wallet's `MultiSigUserOp.toJson()` as the payload
 * (SSP Wallet 2.1.3 src/lib/constructTx.ts constructAndSignEVMTransaction).
 * The wallet always builds the userOp callData itself as
 * `execute(target, value, data)` from what it is asked to send, but for a
 * WalletConnect `eth_sendTransaction` the target, value and data are the
 * dApp's. A malicious dApp can therefore ask for
 * `execute(<the account itself>, value > 0, upgradeToAndCall(evil, ...))`.
 * Released clients (wallet 2.1.3, Key 2.1.1) show that as a tiny send to
 * the user's own address, and one approval replaces the account's
 * implementation — a permanent takeover. The SSP smart account's admin
 * functions (`upgradeToAndCall`, `withdrawDepositTo`) only accept calls from
 * the account itself, so the only way to reach them is an inner call whose
 * target is the userOp `sender`.
 *
 * SSP Key 2.1.1 reads the same bytes this guard reads: it JSON-parses the
 * payload, displays `userOpRequest.callData` decoded with viem against the
 * account ABI, and broadcasts `userOpRequest` with the summed signature.
 *
 * Refused (RELAY_EVM_CALL_GUARD_MODE=enforce, the default):
 *   - an inner call whose target is the userOp `sender` with non-empty
 *     calldata (a plain value transfer to self, empty calldata, is allowed);
 *   - an inner call, to any target, whose calldata starts with an upgrade
 *     selector (`upgradeTo`, `upgradeToAndCall`);
 *   - a top-level callData that is not `execute` / `executeBatch` (it would
 *     run directly on the account);
 *   - a payload that does not parse as a userOp. The payload format is built
 *     by the wallet, never by a dApp, and SSP Key 2.1.1 cannot sign such a
 *     payload either (`MultiSigUserOp.fromJson` throws), so failing closed
 *     costs no legitimate send and leaves no parse gap to slip through.
 *
 * Only the consumer `tx` action is inspected; the enterprise vault flow has
 * its own checks.
 */
import { decodeFunctionData, isAddress, parseAbi } from 'viem';
import blockchains from '../services/blockchains';
import log from './log';

/** `execute(address,uint256,bytes)` — the only selector SSP Wallet 2.1.3 produces. */
export const EXECUTE_SELECTOR = '0xb61d27f6';
/**
 * `executeBatch(address[],bytes[])` — part of the account ABI (no per-call
 * value). SDK 1.3.0's encodeBatchExecute cannot encode it (it passes three
 * arrays) and the released wallet never batches, but the account accepts it,
 * so it is decoded and every inner call is checked like `execute`.
 */
export const EXECUTE_BATCH_SELECTOR = '0x18dfb3c7';

/**
 * Selectors refused anywhere: as the top-level callData or as any inner
 * call, whatever its target. The SSP account is UUPS (OpenZeppelin 5, so
 * only `upgradeToAndCall` exists on it); `upgradeTo` is the OpenZeppelin 4
 * spelling, refused as well.
 */
export const UPGRADE_SELECTORS: Readonly<Record<string, string>> = {
  '0x3659cfe6': 'upgradeTo(address)',
  '0x4f1ef286': 'upgradeToAndCall(address,bytes)',
};

/**
 * The SSP account's other state-changing functions, named in refusal reasons
 * only. Every one of them is already refused when called on the account
 * itself (self-call rule) or as the top-level callData (selector allowlist);
 * none of them can be reached on the account from any other target
 * (`_requireSelfCall` / AccessControl admin = the owners' combined Schnorr
 * addresses). They are deliberately NOT refused on third-party targets:
 * `grantRole` / `revokeRole` / `renounceRole` are generic OpenZeppelin
 * AccessControl functions that legitimate dApps use.
 */
const ACCOUNT_FUNCTION_NAMES: Readonly<Record<string, string>> = {
  ...UPGRADE_SELECTORS,
  [EXECUTE_SELECTOR]: 'execute(address,uint256,bytes)',
  [EXECUTE_BATCH_SELECTOR]: 'executeBatch(address[],bytes[])',
  '0x4d44560d': 'withdrawDepositTo(address,uint256)',
  '0x4a58db19': 'addDeposit()',
  '0x2f2ff15d': 'grantRole(bytes32,address)',
  '0xd547741f': 'revokeRole(bytes32,address)',
  '0x36568abe': 'renounceRole(bytes32,address)',
  '0xa224cee7': 'initialize(address[])',
};

const SSP_ACCOUNT_EXECUTE_ABI = parseAbi([
  'function execute(address dest, uint256 value, bytes func)',
  'function executeBatch(address[] dest, bytes[] func)',
]);

const HEX_RE = /^0x[0-9a-fA-F]*$/;

export type EvmCallGuardMode = 'enforce' | 'log';

/**
 * RELAY_EVM_CALL_GUARD_MODE: 'enforce' (default; unset, empty or any value
 * other than 'log') refuses; 'log' only logs and lets the request through.
 * Read per request.
 */
export function evmCallGuardMode(): EvmCallGuardMode {
  return process.env.RELAY_EVM_CALL_GUARD_MODE === 'log' ? 'log' : 'enforce';
}

export function logEvmCallGuardModeBanner(): void {
  if (evmCallGuardMode() === 'log') {
    log.warn(
      '[EVM-GUARD] WARNING: RELAY_EVM_CALL_GUARD_MODE=log — consumer EVM tx requests that call the smart account itself, upgrade it or use a non-execute top-level call are only LOGGED and still delivered to SSP Key. Unset it (enforce) as soon as possible.',
    );
  } else {
    log.info(
      '[EVM-GUARD] RELAY_EVM_CALL_GUARD_MODE=enforce — consumer EVM tx requests that call the smart account itself or upgrade it are refused',
    );
  }
}

interface InnerCall {
  target: string;
  data: string;
}

export type UserOpCheck =
  | { allowed: true; calls: number }
  | { allowed: false; reason: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function selectorOf(data: string): string | null {
  return data.length >= 10 ? data.slice(0, 10).toLowerCase() : null;
}

function describeSelector(selector: string | null): string {
  if (!selector) return 'calldata shorter than a selector';
  const name = ACCOUNT_FUNCTION_NAMES[selector];
  return name ? `${selector} ${name}` : selector;
}

function refuse(reason: string): UserOpCheck {
  return { allowed: false, reason };
}

function decodeInnerCalls(callData: `0x${string}`): InnerCall[] {
  const decoded = decodeFunctionData({
    abi: SSP_ACCOUNT_EXECUTE_ABI,
    data: callData,
  });
  if (decoded.functionName === 'execute') {
    const [target, , data] = decoded.args;
    return [{ target, data }];
  }
  const [targets, datas] = decoded.args;
  if (targets.length !== datas.length) {
    // The account reverts on this ("wrong array lengths").
    throw new Error('executeBatch array lengths differ');
  }
  return targets.map((target, i) => ({ target, data: datas[i] }));
}

/**
 * Checks a consumer EVM `tx` payload (`MultiSigUserOp.toJson()` JSON) against
 * the C-4 rules. Pure; never throws. Reasons carry only selectors, indices
 * and addresses — never the payload, signatures or nonces.
 */
export function checkUserOpPayload(payload: unknown): UserOpCheck {
  if (typeof payload !== 'string') return refuse('payload is not a string');
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return refuse('payload is not valid JSON');
  }
  if (!isPlainObject(parsed)) return refuse('payload is not a JSON object');
  const op = parsed.userOpRequest;
  if (!isPlainObject(op)) return refuse('payload has no userOpRequest object');
  const { sender, callData } = op;
  if (typeof sender !== 'string' || !isAddress(sender, { strict: false })) {
    return refuse('userOpRequest.sender is not an address');
  }
  if (
    typeof callData !== 'string' ||
    !HEX_RE.test(callData) ||
    callData.length % 2 !== 0
  ) {
    return refuse('userOpRequest.callData is not a hex string');
  }

  const topSelector = selectorOf(callData);
  if (topSelector && UPGRADE_SELECTORS[topSelector]) {
    return refuse(
      `top-level callData is ${describeSelector(topSelector)} on the account`,
    );
  }
  if (
    topSelector !== EXECUTE_SELECTOR &&
    topSelector !== EXECUTE_BATCH_SELECTOR
  ) {
    return refuse(
      `top-level callData is not execute/executeBatch (${describeSelector(topSelector)})`,
    );
  }

  let calls: InnerCall[];
  try {
    calls = decodeInnerCalls(callData as `0x${string}`);
  } catch {
    return refuse(
      `top-level ${describeSelector(topSelector)} calldata does not decode`,
    );
  }

  const self = sender.toLowerCase();
  for (let i = 0; i < calls.length; i += 1) {
    const { target, data } = calls[i];
    const innerSelector = selectorOf(data);
    if (innerSelector && UPGRADE_SELECTORS[innerSelector]) {
      return refuse(
        `inner call #${i} to ${target} is ${describeSelector(innerSelector)}`,
      );
    }
    if (target.toLowerCase() === self && data.length > 2) {
      return refuse(
        `inner call #${i} calls the account itself (${describeSelector(innerSelector)})`,
      );
    }
  }
  return { allowed: true, calls: calls.length };
}

/** True when the payload is JSON carrying a `userOpRequest` object. */
function looksLikeUserOp(payload: string): boolean {
  try {
    const parsed: unknown = JSON.parse(payload);
    return isPlainObject(parsed) && 'userOpRequest' in parsed;
  } catch {
    return false;
  }
}

export interface EvmCallGuardVerdict {
  /** True when the request must not be stored or delivered to SSP Key. */
  refused: boolean;
  /** Why the payload violates the rules (set in both modes). */
  reason?: string;
}

/**
 * Applies the C-4 rules to a `POST /v1/action` body. Only `action: 'tx'` on
 * an EVM chain is inspected, plus `tx` on a chain this relay does not know
 * whose payload is a userOp; UTXO and Solana payloads are left alone.
 * Logs every violation with an `[EVM-GUARD]` prefix.
 */
export function guardConsumerEvmTx(body: {
  action: unknown;
  chain: unknown;
  wkIdentity: unknown;
  payload: unknown;
}): EvmCallGuardVerdict {
  if (body.action !== 'tx' || typeof body.chain !== 'string') {
    return { refused: false };
  }
  const chain = body.chain;
  const known = Object.prototype.hasOwnProperty.call(blockchains, chain);
  if (known) {
    if (blockchains[chain].chainType !== 'evm') return { refused: false };
  } else if (
    typeof body.payload !== 'string' ||
    !looksLikeUserOp(body.payload)
  ) {
    return { refused: false };
  }

  const check = checkUserOpPayload(body.payload);
  if (check.allowed === true) return { refused: false };

  const identity = String(body.wkIdentity).slice(0, 100);
  const where = `tx for ${identity} on ${chain.slice(0, 64)}`;
  if (evmCallGuardMode() === 'log') {
    log.warn(
      `[EVM-GUARD] WOULD REFUSE (RELAY_EVM_CALL_GUARD_MODE=log, delivered) ${where}: ${check.reason}`,
    );
    return { refused: false, reason: check.reason };
  }
  log.warn(`[EVM-GUARD] REFUSED ${where}: ${check.reason}`);
  return { refused: true, reason: check.reason };
}
