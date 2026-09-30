/**
 * TRON sponsor: SSP's energy account pays for vault operations.
 *
 * Every sponsored Op is a call from one of SSP's relayer EOAs to the
 * SSPSponsor contract, which was deployed by the energy account S with
 * consume_user_resource_percent = 0. TRON bills the energy of the WHOLE call
 * tree (factory deploy, vault clone, token frames) to S's staked, delegated
 * or rented energy, INCLUDING REVERTS (spike T7). Relayers send with
 * fee_limit omitted (0), so they can never burn TRX for energy: the relayer
 * only risks its bandwidth. The vault pays SSP a fee inside the same signed
 * Op (D1), so a sponsored transaction must never cost more than it pays.
 *
 * This file is the only place that decides whether S pays for an Op. The
 * acceptance rule (TRON_WIRING_BRIEF.md "Sponsor acceptance rule") is
 * implemented in `acceptAndBroadcast`, in this order:
 *   structural validation → signatures assemble to the derived vault →
 *   digest dedupe → kill switch / deployment / relayers → fee recipient is
 *   the collector → fee token ∈ {TRX, USDT} → ≤ 16 calls → deadline window →
 *   per-vault daily cap → no same-nonce Op in flight, ≤ 4 in flight per
 *   vault → nonce unused on-chain → sponsor sanity → full
 *   simulation of sponsor.execute from the relayer (ret FAILED detected) →
 *   fee ≥ cost now (no markup) → energy ≤ quote × 1.25, ≤ 1.2M launch cap,
 *   ≤ origin_energy_limit → S has the energy (or a rental delivered it) →
 *   build (fee_limit omitted), sign, record, broadcast, compare txid →
 *   background confirmation from walletsolidity.
 *
 * All vault math (addresses, digests, ABI, protobuf) is the SDK's.
 * Keys are never logged; only relayer ADDRESSES are.
 */
import config from 'config';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomBytes } from 'crypto';
import type { Collection, Document } from 'mongodb';
import {
  MAX_CALLS,
  MAX_SIGNERS,
  NETWORKS,
  TRX_FEE_TOKEN,
  ZERO_ADDRESS,
  assembleSignatures,
  buildConfig,
  buildExecuteTransaction,
  buildOp,
  bytesToHex,
  decodeBoolResult,
  decodeSelfCall,
  decodeTrc20Transfer,
  deriveVault,
  encodeExecute,
  encodeIsRelayer,
  encodeTrc20BalanceOf,
  encodeTrc20Transfer,
  getNetwork,
  hexToBytes,
  isNonceSetInWord,
  isTronMultisigError,
  isValidAddress,
  localSigner,
  nonceBitPosition,
  opDigest,
  opFromJson,
  packSigners,
  serializeTransaction,
  signTransaction,
  toHex20,
  trxFee,
  txidHex,
  type Call,
  type LocalSigner,
  type NetworkConfig,
  type Op,
  type VaultConfig,
} from '@runonflux/tron-multisig';
import {
  simulationFailure,
  type TronHttpClient,
} from '@runonflux/tron-multisig/rpc';
import log from '../lib/log';
import serviceHelper from './serviceHelper';
import ratesService from './ratesService';
import { tokens as tokenLists } from './tokens';
import {
  createTronClient,
  tronChainConfig,
  tronSlot,
  type TronChainConfig,
} from './tronRpc';
import {
  CEILING_TRX_SUN,
  CEILING_USDT_UNITS,
  DEFAULT_MARKUP,
  ENERGY,
  baseEnergy,
  executeBandwidthBytes,
  isSaneTrxRate,
  isTrxToken,
  minimumFee,
  priceFee,
  signedTxBandwidthBytes,
  validateMarkup,
  type UsdRates,
} from './tronSponsorPricing';
import {
  CATFEE_MAX_QUANTITY,
  CATFEE_MIN_QUANTITY,
  rentalProviderFromEnv,
  type EnergyRentalProvider,
} from './tronEnergyRental';
import {
  TRON_CHAINS,
  isTronChain,
  type TronBroadcastRequest,
  type TronChain,
  type TronQuote,
  type TronQuoteRequest,
  type TronSponsorContext,
} from '../types/tron';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Consumer default deadline (wallet default, contract §5.5). */
export const CONSUMER_DEFAULT_DEADLINE_S = 30n * 60n;
/** Consumer maximum (the key refuses more than 2 h). */
export const CONSUMER_MAX_DEADLINE_S = 2n * 3600n;
/** Acceptance window: enterprise proposals expire in ≤ 30 days; 31 with slack. */
export const MAX_DEADLINE_WINDOW_S = 31n * 86400n;
/**
 * An Op whose deadline passes before the transaction is in a block reverts
 * `Expired` and S still pays the energy. Transactions expire 60 s after their
 * reference block, so demand at least that much deadline left.
 */
export const MIN_DEADLINE_MARGIN_S = 60n;
/** Launch cap (plan §8.2): no single sponsored transaction above this. */
export const MAX_SPONSORED_ENERGY = 1_200_000n;
/** Simulated energy may exceed the quoted estimate by at most 25 %. */
export const QUOTE_TOLERANCE_NUM = 5n;
export const QUOTE_TOLERANCE_DEN = 4n;
/** "keep a little TRX": TRX is the default fee token only above fee + 1 TRX. */
export const TRX_FEE_BUFFER_SUN = 1_000_000n;
/** Active relay-picked reservations per vault; the oldest is evicted beyond. */
export const MAX_ACTIVE_RESERVATIONS_PER_VAULT = 32;
/** 64 words × 256 = the first 16,384 nonces. */
export const MAX_NONCE_WORDS_SCANNED = 64n;
/** Unconfirmed sponsored Ops per vault (bounds revert exposure, see below). */
export const MAX_IN_FLIGHT_PER_VAULT = 4;
/** A 'broadcast' record older than this no longer counts as in flight. */
const IN_FLIGHT_WINDOW_MS = 5 * 60 * 1000;
const MAX_RELAYERS = 16;
const MAX_OP_JSON_BYTES = 64 * 1024;
const SPONSOR_META_TTL_MS = 5 * 60 * 1000;
const TX_EXPIRATION_MS = 60_000n;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * A deliberate refusal (bad input, acceptance rule, sponsor unavailable). The
 * message is safe to return to the caller; nothing secret goes into it.
 */
export class TronSponsorRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TronSponsorRefusal';
  }
}

function refuse(message: string): never {
  throw new TronSponsorRefusal(message);
}

function isDuplicateKeyError(e: unknown): boolean {
  return (
    !!e && typeof e === 'object' && (e as { code?: unknown }).code === 11000
  );
}

// ---------------------------------------------------------------------------
// Network resolution (the override rule)
// ---------------------------------------------------------------------------

type DeploymentField =
  | 'factory'
  | 'implementation'
  | 'sponsor'
  | 'feeCollector';
const DEPLOYMENT_FIELDS: DeploymentField[] = [
  'factory',
  'implementation',
  'sponsor',
  'feeCollector',
];

/**
 * The SDK network for a chain, with config overrides applied under the rule
 * from the brief: an override may only fill a value the pinned SDK table has
 * as null; an override that differs from a pinned value throws (startup
 * calls this through assertTronConfig, so the relay refuses to boot).
 */
export function resolveTronNetwork(
  chain: TronChain,
  overrides: Partial<TronChainConfig> = tronChainConfig(chain),
  // The SDK table; a parameter only so tests can exercise a pinned value
  // (every deployment field is still null in the SDK today).
  pinned: NetworkConfig = NETWORKS[tronSlot(chain)],
): NetworkConfig {
  const merged: Record<DeploymentField, string | null> = {
    factory: pinned.factory,
    implementation: pinned.implementation,
    sponsor: pinned.sponsor,
    feeCollector: pinned.feeCollector,
  };
  for (const field of DEPLOYMENT_FIELDS) {
    const raw = overrides?.[field];
    if (raw === undefined || raw === null || raw === '') continue;
    if (typeof raw !== 'string' || !isValidAddress(raw)) {
      throw new Error(
        `config tron.${tronSlot(chain)}.${field} is not a valid TRON address`,
      );
    }
    const pinnedValue = pinned[field];
    if (pinnedValue !== null && pinnedValue !== raw) {
      throw new Error(
        `config tron.${tronSlot(chain)}.${field} (${raw}) conflicts with the SDK's pinned ${pinnedValue}; remove the override`,
      );
    }
    merged[field] = raw;
  }
  return getNetwork({
    name: pinned.name,
    chainId: pinned.chainId,
    usdt: pinned.usdt,
    ...merged,
  });
}

function isDeploymentComplete(n: NetworkConfig): boolean {
  return (
    n.factory !== null &&
    n.implementation !== null &&
    n.sponsor !== null &&
    n.feeCollector !== null &&
    n.usdt !== null
  );
}

// ---------------------------------------------------------------------------
// Relayer keys
// ---------------------------------------------------------------------------

export interface Relayer {
  readonly address: string;
  readonly signer: LocalSigner;
}

export type RelayerSource = 'env' | 'file' | 'generated' | 'none';

export function relayerEnvVar(chain: TronChain): string {
  return `SSP_TRON_${tronSlot(chain).toUpperCase()}_RELAYER_KEYS`;
}

export function relayerFilePath(chain: TronChain): string {
  return path.join(
    os.homedir(),
    '.config',
    'ssp-relay',
    `tron-relayers-${tronSlot(chain)}.txt`,
  );
}

/**
 * Parse a comma / whitespace separated list of 32-byte hex private keys
 * (optional 0x). Errors name the key's POSITION only, never its content.
 */
export function parseRelayerKeys(raw: string, label: string): Relayer[] {
  const parts = raw
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length > MAX_RELAYERS) {
    throw new Error(`${label}: at most ${MAX_RELAYERS} relayer keys`);
  }
  const out: Relayer[] = [];
  const seen = new Set<string>();
  parts.forEach((part, i) => {
    const hex = part.startsWith('0x') ? part.slice(2) : part;
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new Error(`${label}: relayer key #${i + 1} is not 32-byte hex`);
    }
    let signer: LocalSigner;
    try {
      signer = localSigner(hexToBytes(hex.toLowerCase()));
    } catch {
      throw new Error(
        `${label}: relayer key #${i + 1} is not a valid secp256k1 key`,
      );
    }
    if (seen.has(signer.address)) return;
    seen.add(signer.address);
    out.push({ address: signer.address, signer });
  });
  return out;
}

/**
 * env var → file → (Nile only) auto-generate. Mainnet NEVER auto-generates:
 * a relayer must be allow-listed on the sponsor (setRelayer) and funded, so
 * mainnet relayers are always a deliberate operator action.
 */
export function resolveRelayers(
  chain: TronChain,
  env: NodeJS.ProcessEnv = process.env,
): { relayers: Relayer[]; source: RelayerSource } {
  const envVar = relayerEnvVar(chain);
  const fromEnv = env[envVar];
  if (fromEnv && fromEnv.trim().length > 0) {
    return { relayers: parseRelayerKeys(fromEnv, envVar), source: 'env' };
  }
  const file = relayerFilePath(chain);
  if (fs.existsSync(file)) {
    const relayers = parseRelayerKeys(fs.readFileSync(file, 'utf8'), file);
    if (relayers.length > 0) return { relayers, source: 'file' };
  }
  if (chain === 'tronNile') {
    let key: Uint8Array | null = null;
    let signer: LocalSigner | null = null;
    while (signer === null) {
      const raw = randomBytes(32);
      key = new Uint8Array(raw);
      raw.fill(0);
      try {
        signer = localSigner(key);
      } catch {
        signer = null; // out-of-range scalar (≈2^-128); draw again
      }
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${bytesToHex(key!)}\n`, { mode: 0o600 });
    key!.fill(0);
    return {
      relayers: [{ address: signer.address, signer }],
      source: 'generated',
    };
  }
  return { relayers: [], source: 'none' };
}

export function isKillSwitchOn(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.TRON_SPONSOR_ENABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function configuredEnergyPriceSun(
  env: NodeJS.ProcessEnv = process.env,
): bigint {
  const raw =
    env.TRON_ENERGY_PRICE_SUN ??
    (config.has('tron.energyPriceSun')
      ? String(config.get<number>('tron.energyPriceSun'))
      : '45');
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 1000) {
    throw new Error(
      'tron.energyPriceSun / TRON_ENERGY_PRICE_SUN must be an integer in [1, 1000]',
    );
  }
  return BigInt(n);
}

function configuredMarkup(): number {
  return config.has('tron.markup')
    ? validateMarkup(config.get<number>('tron.markup'))
    : DEFAULT_MARKUP;
}

function configuredDailyCap(): number {
  const n = config.has('tron.maxOpsPerVaultPerDay')
    ? Number(config.get<number>('tron.maxOpsPerVaultPerDay'))
    : 50;
  return Number.isInteger(n) && n >= 0 ? n : 50;
}

// ---------------------------------------------------------------------------
// Runtime (everything a request needs; injectable for tests)
// ---------------------------------------------------------------------------

interface SponsorMeta {
  origin: string;
  originEnergyLimit: bigint;
  consumeUserResourcePercent: bigint;
}

export interface TronCollections {
  ops: Collection<Document>;
  reservations: Collection<Document>;
}

export interface TronRuntime {
  chain: TronChain;
  network: NetworkConfig;
  client: TronHttpClient;
  relayers: Relayer[];
  relayerSource: RelayerSource;
  relayerError: string | null;
  energyPriceSun: bigint;
  defaultMarkup: number;
  maxOpsPerVaultPerDay: number;
  rental: EnergyRentalProvider | null;
  killSwitchOn: () => boolean;
  collections: () => Promise<TronCollections>;
  rates: () => UsdRates;
  nowMs: () => number;
  sleep: (ms: number) => Promise<void>;
  confirm: { intervalMs: number; attempts: number };
  rrIndex: number;
  sponsorMeta: { at: number; meta: SponsorMeta } | null;
}

async function defaultCollections(): Promise<TronCollections> {
  const db = await serviceHelper.databaseConnection();
  const database = db.db(config.database.database);
  return {
    ops: database.collection(config.collections.tronSponsorOps),
    reservations: database.collection(config.collections.tronNonceReservations),
  };
}

function defaultRates(): UsdRates {
  const crypto = (ratesService.getRates().crypto ?? {}) as Record<
    string,
    unknown
  >;
  const trx = crypto.trx;
  const usdt = crypto.usdt;
  return {
    trxUsd: isSaneTrxRate(trx) ? trx : null,
    usdtUsd: typeof usdt === 'number' ? usdt : 1,
  };
}

function buildRuntime(chain: TronChain): TronRuntime {
  const network = resolveTronNetwork(chain);
  let relayers: Relayer[] = [];
  let relayerSource: RelayerSource = 'none';
  let relayerError: string | null = null;
  try {
    ({ relayers, source: relayerSource } = resolveRelayers(chain));
  } catch (e) {
    // Fail closed without taking the rest of the relay down: the chain is
    // simply not sponsored until the keys are fixed.
    relayerError = (e as Error).message;
    log.error(`[tronSponsor] ${chain}: relayer keys rejected: ${relayerError}`);
  }
  return {
    chain,
    network,
    client: createTronClient(chain),
    relayers,
    relayerSource,
    relayerError,
    energyPriceSun: configuredEnergyPriceSun(),
    defaultMarkup: configuredMarkup(),
    maxOpsPerVaultPerDay: configuredDailyCap(),
    rental: rentalProviderFromEnv(chain),
    killSwitchOn: () => isKillSwitchOn(),
    collections: defaultCollections,
    rates: defaultRates,
    nowMs: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    confirm: { intervalMs: 3_000, attempts: 80 },
    rrIndex: 0,
    sponsorMeta: null,
  };
}

const runtimes: Partial<Record<TronChain, TronRuntime>> = {};

export function getRuntime(chain: TronChain): TronRuntime {
  if (!isTronChain(chain)) refuse('Invalid or unsupported TRON chain');
  if (!runtimes[chain]) runtimes[chain] = buildRuntime(chain);
  return runtimes[chain]!;
}

/** Tests only: install (or clear) a runtime for a chain. */
export function __setRuntimeForTests(
  chain: TronChain,
  rt: TronRuntime | null,
): void {
  if (rt === null) delete runtimes[chain];
  else runtimes[chain] = rt;
}

/** Why the sponsor is off on this chain, or null when it is on. */
export function unavailableReason(rt: TronRuntime): string | null {
  if (!rt.killSwitchOn()) return 'TRON_SPONSOR_ENABLED is off';
  if (!isDeploymentComplete(rt.network)) {
    return 'the TRON vault contracts are not deployed on this network yet';
  }
  if (rt.relayers.length === 0) return 'no relayer keys are configured';
  return null;
}

function requireAvailable(rt: TronRuntime): void {
  const reason = unavailableReason(rt);
  if (reason !== null) {
    refuse(`TRON sponsorship is not available on ${rt.chain}: ${reason}`);
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export function getSponsorContext(chain: TronChain): TronSponsorContext {
  const rt = getRuntime(chain);
  const n = rt.network;
  return {
    enabled: unavailableReason(rt) === null,
    chain,
    chainId: n.chainId.toString(),
    factory: n.factory,
    implementation: n.implementation,
    sponsor: n.sponsor,
    feeCollector: n.feeCollector,
    ceilings: {
      trx: CEILING_TRX_SUN.toString(),
      usdt: CEILING_USDT_UNITS.toString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Input parsing (every field is untrusted)
// ---------------------------------------------------------------------------

function parseUint(v: unknown, what: string): bigint {
  if (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(v)) {
    refuse(`${what} must be a canonical decimal string`);
  }
  return BigInt(v);
}

export function parseVaultConfig(
  signers: unknown,
  threshold: unknown,
): VaultConfig {
  if (
    !Array.isArray(signers) ||
    signers.length === 0 ||
    signers.length > MAX_SIGNERS
  ) {
    refuse(`signers must be an array of 1..${MAX_SIGNERS} TRON addresses`);
  }
  for (const s of signers) {
    if (!isValidAddress(s)) refuse('signers contains an invalid TRON address');
  }
  if (
    typeof threshold !== 'number' ||
    !Number.isInteger(threshold) ||
    threshold < 1 ||
    threshold > signers.length
  ) {
    refuse('threshold must be an integer in 1..signers.length');
  }
  try {
    return buildConfig(signers as string[], threshold);
  } catch (e) {
    refuse(`invalid vault config: ${(e as Error).message}`);
  }
}

/** Strict canonical parse of calls, reusing the SDK's Op JSON parser. */
function parseCalls(calls: unknown): readonly Call[] {
  if (!Array.isArray(calls) || calls.length > MAX_CALLS) {
    refuse(`calls must be an array of at most ${MAX_CALLS} calls`);
  }
  try {
    return opFromJson({
      calls,
      nonce: '0',
      deadline: '1',
      fee: { token: TRX_FEE_TOKEN, amount: '0', recipient: ZERO_ADDRESS },
    }).calls;
  } catch (e) {
    refuse(`invalid calls: ${(e as Error).message}`);
  }
}

function parseOp(op: unknown): Op {
  if (!op || typeof op !== 'object' || Array.isArray(op)) {
    refuse('op must be an Op JSON object');
  }
  if (JSON.stringify(op).length > MAX_OP_JSON_BYTES) refuse('op is too large');
  try {
    return opFromJson(op);
  } catch (e) {
    refuse(`invalid op: ${(e as Error).message}`);
  }
}

function parseSignatures(sigs: unknown, cfg: VaultConfig): Uint8Array[] {
  if (
    !Array.isArray(sigs) ||
    sigs.length < cfg.threshold ||
    sigs.length > cfg.signers.length
  ) {
    refuse('signatures must be an array of threshold..signers.length items');
  }
  return sigs.map((s) => {
    if (typeof s !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(s)) {
      refuse('each signature must be 65-byte 0x hex');
    }
    return hexToBytes(s.slice(2).toLowerCase());
  });
}

type FeeKind = 'TRX' | 'USDT';

function feeKindOf(token: string, n: NetworkConfig): FeeKind | null {
  if (isTrxToken(token)) return 'TRX';
  if (n.usdt !== null && token === n.usdt) return 'USDT';
  return null;
}

function feeTokenAddress(kind: FeeKind, n: NetworkConfig): string {
  return kind === 'TRX' ? TRX_FEE_TOKEN : n.usdt!;
}

// ---------------------------------------------------------------------------
// Chain reads
// ---------------------------------------------------------------------------

async function sponsorMeta(rt: TronRuntime): Promise<SponsorMeta> {
  const now = rt.nowMs();
  if (rt.sponsorMeta && now - rt.sponsorMeta.at < SPONSOR_META_TTL_MS) {
    return rt.sponsorMeta.meta;
  }
  const c = await rt.client.getContract(rt.network.sponsor!);
  if (c === null || c.originAddress === null) {
    refuse('TRON sponsor contract not found on chain');
  }
  const meta: SponsorMeta = {
    origin: c.originAddress,
    originEnergyLimit: c.originEnergyLimit,
    consumeUserResourcePercent: c.consumeUserResourcePercent,
  };
  rt.sponsorMeta = { at: now, meta };
  return meta;
}

async function trc20BalanceOrZero(
  rt: TronRuntime,
  token: string,
  holder: string,
): Promise<bigint> {
  try {
    return await rt.client.trc20BalanceOf(token, holder);
  } catch {
    return 0n;
  }
}

/** Energy of one call made BY the vault. */
async function callEnergy(
  rt: TronRuntime,
  vault: string,
  deployed: boolean,
  call: Call,
  index: number,
): Promise<bigint> {
  if (call.data.length === 0) {
    // Plain TRX (or TRC-10) transfer: no token frame to simulate.
    let e = ENERGY.TRX_CALL;
    if (call.to !== vault && (await rt.client.getAccount(call.to)) === null) {
      e += ENERGY.NEW_ACCOUNT;
    }
    return e;
  }
  if (call.to === vault && !deployed) return ENERGY.SELF_CALL;
  const sim = await rt.client.triggerConstant({
    owner: vault,
    contract: call.to,
    data: call.data,
    callValue: call.value,
    ...(call.tokenId > 0n
      ? { tokenId: call.tokenId, callTokenValue: call.tokenValue }
      : {}),
  });
  if (!sim.ok) {
    refuse(`call #${index} would fail: ${simulationFailure(sim).message}`);
  }
  return sim.energyUsed;
}

/** Energy of a TRC-20 (USDT) fee: transfer + 2 × balanceOf + bookkeeping. */
async function usdtFeeEnergy(
  rt: TronRuntime,
  vault: string,
  usdtBalance: bigint,
): Promise<bigint> {
  const usdt = rt.network.usdt!;
  if (usdtBalance <= 0n) return ENERGY.USDT_FEE_FALLBACK;
  const amount = usdtBalance < 1_000_000n ? usdtBalance : 1_000_000n;
  const [t, b] = await Promise.all([
    rt.client.triggerConstant({
      owner: vault,
      contract: usdt,
      data: encodeTrc20Transfer(rt.network.feeCollector!, amount),
    }),
    rt.client.triggerConstant({
      owner: vault,
      contract: usdt,
      data: encodeTrc20BalanceOf(vault),
    }),
  ]);
  if (!t.ok || !b.ok) return ENERGY.USDT_FEE_FALLBACK;
  return t.energyUsed + 2n * b.energyUsed + ENERGY.TRC20_FEE_OVERHEAD;
}

interface EnergyEstimate {
  trx: bigint;
  usdt: bigint;
}

async function estimateOpEnergy(
  rt: TronRuntime,
  p: {
    vault: string;
    deployed: boolean;
    threshold: number;
    calls: readonly Call[];
    coldNonceWord: boolean;
    usdtBalance: bigint;
  },
): Promise<EnergyEstimate> {
  let calls = 0n;
  for (let i = 0; i < p.calls.length; i++) {
    calls += await callEnergy(rt, p.vault, p.deployed, p.calls[i], i);
  }
  const base =
    baseEnergy({
      threshold: p.threshold,
      deployed: p.deployed,
      coldNonceWord: p.coldNonceWord,
      callCount: p.calls.length,
    }) + calls;
  return {
    trx: base + ENERGY.TRX_FEE,
    usdt: base + (await usdtFeeEnergy(rt, p.vault, p.usdtBalance)),
  };
}

async function isColdNonceWord(
  rt: TronRuntime,
  vault: string,
  deployed: boolean,
  nonce: bigint,
): Promise<boolean> {
  if (!deployed) return true;
  const { word } = nonceBitPosition(nonce);
  return (await rt.client.nonceBitmap(vault, word)) === 0n;
}

// ---------------------------------------------------------------------------
// Nonce reservations (consumer)
// ---------------------------------------------------------------------------

async function lowestFreeNonce(
  rt: TronRuntime,
  vault: string,
  deployed: boolean,
  reserved: Set<string>,
): Promise<{ nonce: bigint; cold: boolean }> {
  for (let word = 0n; word < MAX_NONCE_WORDS_SCANNED; word++) {
    const bitmap = deployed ? await rt.client.nonceBitmap(vault, word) : 0n;
    for (let bit = 0n; bit < 256n; bit++) {
      const n = (word << 8n) | bit;
      if (isNonceSetInWord(bitmap, n) || reserved.has(n.toString())) continue;
      return { nonce: n, cold: bitmap === 0n };
    }
  }
  refuse('no free nonce in the first 16,384 nonces of this vault');
}

/**
 * Pick the lowest nonce that is neither used on-chain nor reserved by an
 * unexpired quote, and reserve it until `deadline` (unique index on
 * chain+vault+nonce makes concurrent quotes pick different nonces).
 */
export async function pickAndReserveNonce(
  rt: TronRuntime,
  vault: string,
  deployed: boolean,
  deadline: bigint,
): Promise<{ nonce: bigint; coldNonceWord: boolean }> {
  const { reservations } = await rt.collections();
  const now = new Date(rt.nowMs());
  await reservations.deleteMany({
    chain: rt.chain,
    vault,
    expiresAt: { $lte: now },
  });
  const active = await reservations
    .find({ chain: rt.chain, vault, expiresAt: { $gt: now } })
    .toArray();
  const relayOwned = active
    .filter((r) => r.source === 'relay')
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  const evict = relayOwned.slice(
    0,
    Math.max(0, relayOwned.length - MAX_ACTIVE_RESERVATIONS_PER_VAULT + 1),
  );
  for (const r of evict) {
    await reservations.deleteOne({ chain: rt.chain, vault, nonce: r.nonce });
  }
  const evicted = new Set(evict.map((r) => String(r.nonce)));
  const reserved = new Set(
    active.map((r) => String(r.nonce)).filter((n) => !evicted.has(n)),
  );
  for (let attempt = 0; attempt < 8; attempt++) {
    const { nonce, cold } = await lowestFreeNonce(
      rt,
      vault,
      deployed,
      reserved,
    );
    try {
      await reservations.insertOne({
        chain: rt.chain,
        vault,
        nonce: nonce.toString(),
        source: 'relay',
        deadline: deadline.toString(),
        expiresAt: new Date(Number(deadline) * 1000),
        createdAt: now,
        energy: null,
      });
      return { nonce, coldNonceWord: cold };
    } catch (e) {
      if (!isDuplicateKeyError(e)) throw e;
      reserved.add(nonce.toString());
    }
  }
  refuse('could not reserve a nonce for this vault; retry');
}

async function quotedEnergyFor(
  rt: TronRuntime,
  vault: string,
  nonce: bigint,
  kind: FeeKind,
): Promise<bigint | null> {
  const { reservations } = await rt.collections();
  const r = await reservations.findOne({
    chain: rt.chain,
    vault,
    nonce: nonce.toString(),
  });
  const e = r?.energy?.[kind === 'TRX' ? 'trx' : 'usdt'];
  return typeof e === 'number' && Number.isSafeInteger(e) && e > 0
    ? BigInt(e)
    : null;
}

// ---------------------------------------------------------------------------
// Quote
// ---------------------------------------------------------------------------

export interface QuoteOptions {
  /**
   * True only for the enterprise hook: allows a caller-chosen nonce, a
   * deadline up to 31 days and a custom markup. The public HTTP route is
   * never trusted (a public nonce parameter would let anyone overwrite the
   * quoted energy another member's broadcast is checked against).
   */
  trusted: boolean;
}

function parseDeadline(v: unknown, nowS: bigint, maxWindowS: bigint): bigint {
  if (v === undefined) return nowS + CONSUMER_DEFAULT_DEADLINE_S;
  const d = parseUint(v, 'deadline');
  if (d <= nowS + MIN_DEADLINE_MARGIN_S)
    refuse('deadline is too close or in the past');
  if (d > nowS + maxWindowS) refuse('deadline is too far in the future');
  return d;
}

function tokenOutflows(
  calls: readonly Call[],
  usdt: string,
  skipIndex: number,
): { trx: bigint; usdt: bigint } {
  let trx = 0n;
  let usdtOut = 0n;
  calls.forEach((c, i) => {
    if (i === skipIndex) return;
    trx += c.value;
    if (c.to === usdt) {
      const t = decodeTrc20Transfer(c.data);
      if (t) usdtOut += t.amount;
    }
  });
  return { trx, usdt: usdtOut };
}

function findMaxCall(calls: readonly Call[], token: string): number {
  const matches: number[] = [];
  calls.forEach((c, i) => {
    const hit =
      token === TRX_FEE_TOKEN
        ? c.data.length === 0 && c.tokenValue === 0n && c.value > 0n
        : c.to === token && decodeTrc20Transfer(c.data) !== null;
    if (hit) matches.push(i);
  });
  if (matches.length !== 1) {
    refuse('max requires exactly one transfer of that token in calls');
  }
  return matches[0];
}

// ---------------------------------------------------------------------------
// Sponsorable calls
// ---------------------------------------------------------------------------
//
// S pays for reverts, and a transaction is simulated a few seconds before it
// executes. A call target whose behaviour can differ between the simulation
// and the real execution (block number, timestamp, energy left, …) could pass
// simulation and then revert on-chain after burning up to the sponsor's
// origin_energy_limit — with no fee paid, from a vault the attacker controls
// and at zero cost to them. So only calls whose executed code is known and
// deterministic are sponsored:
//   - TRX / TRC-10 to an account WITHOUT code, or to an SSP vault clone of our
//     own implementation (its receive() is empty);
//   - `transfer(address,uint256)` on a TRC-20 in the relay's token whitelist;
//   - the vault's own self-calls (cancel nonces, Stake 2.0 hooks).
// Everything else can still execute — self-paid, through the escape hatch.

const CLONE_RUNTIME_PREFIX = '363d3d373d3d3d363d73';
const CLONE_RUNTIME_SUFFIX = '5af43d82803e903d91602b57fd5bf3';

function sponsorableTokens(chain: TronChain): ReadonlySet<string> {
  return new Set(
    tokenLists[chain]()
      .map((t) => t.contract)
      .filter((c) => c !== ''),
  );
}

/** True when `to` has no code, or is an SSP vault clone of our implementation. */
async function isSafeValueRecipient(
  rt: TronRuntime,
  to: string,
): Promise<boolean> {
  const info = await rt.client.getContractInfo(to);
  if (info === null || info.runtimeCode.length === 0) return true;
  const impl = rt.network.implementation;
  if (impl === null) return false;
  const code = bytesToHex(info.runtimeCode).toLowerCase();
  const expectedPrefix =
    CLONE_RUNTIME_PREFIX +
    toHex20(impl).replace(/^0x/, '').toLowerCase() +
    CLONE_RUNTIME_SUFFIX;
  // EIP-1167 runtime (45 bytes) followed by the 32-byte configHash argument.
  return code.length === (45 + 32) * 2 && code.startsWith(expectedPrefix);
}

export async function assertSponsorableCalls(
  rt: TronRuntime,
  vault: string,
  calls: readonly Call[],
): Promise<void> {
  const tokens = sponsorableTokens(rt.chain);
  const selfPay = 'pay the network fee yourself to run it';
  for (const [i, c] of calls.entries()) {
    if (c.tokenValue > 0n) {
      if (!(await isSafeValueRecipient(rt, c.to))) {
        refuse(
          `call ${i}: a TRC-10 transfer to a contract can't be sponsored; ${selfPay}`,
        );
      }
      continue;
    }
    if (c.data.length === 0) {
      if (c.to !== vault && !(await isSafeValueRecipient(rt, c.to))) {
        refuse(
          `call ${i}: a TRX transfer to a contract can't be sponsored; ${selfPay}`,
        );
      }
      continue;
    }
    if (c.to === vault) {
      if (c.value !== 0n || decodeSelfCall(c.data) === null) {
        refuse(`call ${i}: unsupported vault self-call`);
      }
      continue;
    }
    if (c.value === 0n && tokens.has(c.to)) {
      // decodeTrc20Transfer returns null (not throws) for anything that is not
      // exactly a canonical transfer(address,uint256) — e.g. approve().
      let transfer: ReturnType<typeof decodeTrc20Transfer> = null;
      try {
        transfer = decodeTrc20Transfer(c.data);
      } catch {
        transfer = null;
      }
      if (transfer !== null) continue;
    }
    refuse(
      `call ${i}: only TRX, TRC-10 and whitelisted TRC-20 transfers can be sponsored; ${selfPay}`,
    );
  }
}

export async function quoteWithRuntime(
  rt: TronRuntime,
  req: TronQuoteRequest,
  opts: QuoteOptions,
): Promise<TronQuote> {
  if (!req || typeof req !== 'object') refuse('invalid quote request');
  requireAvailable(rt);
  const n = rt.network;
  const cfg = parseVaultConfig(req.signers, req.threshold);
  const vault = deriveVault(n, cfg).address;
  const calls = parseCalls(req.calls);
  await assertSponsorableCalls(rt, vault, calls);
  if (!opts.trusted && (req.nonce !== undefined || req.markup !== undefined)) {
    refuse('nonce and markup are chosen by the relay');
  }
  const markup =
    req.markup === undefined ? rt.defaultMarkup : validateMarkup(req.markup);
  const nowMs = rt.nowMs();
  const nowS = BigInt(Math.floor(nowMs / 1000));
  const deadline = parseDeadline(
    req.deadline,
    nowS,
    opts.trusted ? MAX_DEADLINE_WINDOW_S : CONSUMER_MAX_DEADLINE_S,
  );
  let requested: FeeKind | null = null;
  if (req.feeToken !== undefined) {
    requested =
      typeof req.feeToken === 'string' ? feeKindOf(req.feeToken, n) : null;
    if (requested === null) refuse('feeToken must be TRX or the network USDT');
  }
  let maxToken: string | null = null;
  let maxIndex = -1;
  if (req.max !== undefined) {
    const t = req.max?.token;
    if (typeof t !== 'string') refuse('max.token must be a string');
    maxToken = isTrxToken(t) ? TRX_FEE_TOKEN : t;
    if (!isValidAddress(maxToken))
      refuse('max.token must be TRX or a TRC-20 address');
    maxIndex = findMaxCall(calls, maxToken);
  }

  const usdt = n.usdt!;
  const [deployed, account, usdtBalance] = await Promise.all([
    rt.client.hasCode(vault),
    rt.client.getAccount(vault),
    trc20BalanceOrZero(rt, usdt, vault),
  ]);
  const trxBalance = account?.balance ?? 0n;

  let nonce: bigint;
  let coldNonceWord: boolean;
  let reservedHere = false;
  if (req.nonce !== undefined) {
    nonce = parseUint(req.nonce, 'nonce');
    if (deployed) {
      const { word } = nonceBitPosition(nonce);
      const bitmap = await rt.client.nonceBitmap(vault, word);
      if (isNonceSetInWord(bitmap, nonce)) refuse('nonce is already used');
      coldNonceWord = bitmap === 0n;
    } else {
      coldNonceWord = true;
    }
  } else {
    ({ nonce, coldNonceWord } = await pickAndReserveNonce(
      rt,
      vault,
      deployed,
      deadline,
    ));
    reservedHere = true;
  }

  const { reservations } = await rt.collections();
  try {
    const energy = await estimateOpEnergy(rt, {
      vault,
      deployed,
      threshold: cfg.threshold,
      calls,
      coldNonceWord,
      usdtBalance,
    });
    const bandwidthBytes = executeBandwidthBytes({
      owner: rt.relayers[0].address,
      sponsor: n.sponsor!,
      config: cfg,
      op: buildOp({ calls, nonce, deadline, fee: trxFee(1n, n.feeCollector!) }),
      nowMs: BigInt(nowMs),
    });
    const rates = rt.rates();
    const common = {
      bandwidthBytes,
      energyPriceSun: rt.energyPriceSun,
      markup,
      rates,
    };
    const feeTrx = priceFee({ token: 'TRX', energy: energy.trx, ...common });
    let feeUsdt: bigint | null = null;
    try {
      feeUsdt = priceFee({ token: 'USDT', energy: energy.usdt, ...common });
    } catch {
      feeUsdt = null; // no trustworthy TRX/USD rate: TRX only
    }
    if (requested === 'USDT' && feeUsdt === null) {
      refuse('USDT fees are unavailable right now (no TRX/USD rate)');
    }

    const out = tokenOutflows(calls, usdt, maxIndex);
    const maxIsTrx = maxToken === TRX_FEE_TOKEN;
    const trxCovers = trxBalance >= out.trx + feeTrx;
    const trxCoversWithBuffer =
      trxBalance >= out.trx + feeTrx + (maxIsTrx ? 0n : TRX_FEE_BUFFER_SUN);
    const usdtCovers = feeUsdt !== null && usdtBalance >= out.usdt + feeUsdt;

    let kind: FeeKind;
    let sponsorAvailable = true;
    let reason: string | undefined;
    if (requested !== null) {
      kind = requested;
      sponsorAvailable = kind === 'TRX' ? trxCovers : usdtCovers;
    } else if (trxCoversWithBuffer) {
      kind = 'TRX';
    } else if (usdtCovers) {
      kind = 'USDT';
    } else {
      kind = 'TRX';
      sponsorAvailable = false;
    }
    if (!sponsorAvailable) {
      reason =
        feeUsdt === null
          ? `INSUFFICIENT_FEE_BALANCE: the vault needs ${feeTrx} sun of TRX for the network fee`
          : `INSUFFICIENT_FEE_BALANCE: the vault needs ${feeTrx} sun of TRX or ${feeUsdt} USDT units for the network fee`;
    }
    const feeAmount = kind === 'TRX' ? feeTrx : feeUsdt!;
    const feeToken = feeTokenAddress(kind, n);

    let maxSendable: TronQuote['maxSendable'];
    if (maxToken !== null) {
      const balance = maxIsTrx
        ? trxBalance
        : maxToken === usdt
          ? usdtBalance
          : await trc20BalanceOrZero(rt, maxToken, vault);
      const others = maxIsTrx ? out.trx : maxToken === usdt ? out.usdt : 0n;
      let left = balance - others - (feeToken === maxToken ? feeAmount : 0n);
      if (left < 0n) left = 0n;
      maxSendable = { token: maxToken, amount: left.toString() };
    }

    const energyRecord = {
      trx: Number(energy.trx),
      usdt: Number(energy.usdt),
    };
    const key = { chain: rt.chain, vault, nonce: nonce.toString() };
    if (reservedHere) {
      await reservations.updateOne(key, { $set: { energy: energyRecord } });
    } else {
      await reservations.updateOne(
        key,
        {
          $set: {
            ...key,
            source: 'supplied',
            deadline: deadline.toString(),
            expiresAt: new Date(Number(deadline) * 1000),
            energy: energyRecord,
          },
          $setOnInsert: { createdAt: new Date(nowMs) },
        },
        { upsert: true },
      );
    }

    const quote: TronQuote = {
      vault,
      deployed,
      nonce: nonce.toString(),
      deadline: deadline.toString(),
      fee: {
        token: feeToken,
        amount: feeAmount.toString(),
        recipient: n.feeCollector!,
      },
      feeOptions: [
        { token: TRX_FEE_TOKEN, amount: feeTrx.toString() },
        ...(feeUsdt !== null
          ? [{ token: usdt, amount: feeUsdt.toString() }]
          : []),
      ],
      energy: {
        estimate: (kind === 'TRX' ? energy.trx : energy.usdt).toString(),
      },
      sponsorAvailable,
      ...(reason !== undefined ? { unavailableReason: reason } : {}),
      ...(maxSendable !== undefined ? { maxSendable } : {}),
    };
    return quote;
  } catch (e) {
    if (reservedHere) {
      await reservations
        .deleteOne({ chain: rt.chain, vault, nonce: nonce.toString() })
        .catch(() => undefined);
    }
    throw e;
  }
}

export async function quote(
  req: TronQuoteRequest,
  opts: QuoteOptions = { trusted: false },
): Promise<TronQuote> {
  if (!req || typeof req !== 'object' || !isTronChain(req.chain)) {
    refuse('Invalid or unsupported TRON chain');
  }
  return quoteWithRuntime(getRuntime(req.chain), req, opts);
}

// ---------------------------------------------------------------------------
// Energy provisioning
// ---------------------------------------------------------------------------

async function ensureSponsorEnergy(
  rt: TronRuntime,
  origin: string,
  need: bigint,
  digestHex: string,
): Promise<void> {
  const res = await rt.client.getAccountResource(origin);
  if (res.availableEnergy >= need) return;
  const unavailable =
    'TRON sponsor temporarily unavailable (sponsor energy is low); try again later or pay the network fee yourself';
  if (rt.rental === null) {
    log.warn(
      `[tronSponsor] ${rt.chain}: S ${origin} has ${res.availableEnergy} energy, needs ${need}; no rental provider, refusing`,
    );
    refuse(unavailable);
  }
  const shortfall = ((need - res.availableEnergy) * 11n) / 10n;
  let quantity = ((shortfall + 999n) / 1000n) * 1000n;
  if (quantity < CATFEE_MIN_QUANTITY) quantity = CATFEE_MIN_QUANTITY;
  if (quantity > CATFEE_MAX_QUANTITY) quantity = CATFEE_MAX_QUANTITY;
  // Idempotent per Op and minute: a retried request never buys twice.
  const clientOrderId = `ssp-${digestHex.slice(2, 34)}-${Math.floor(rt.nowMs() / 60_000)}`;
  try {
    const { orderId } = await rt.rental.rent({
      receiver: origin,
      quantity,
      clientOrderId,
    });
    log.info(
      `[tronSponsor] ${rt.chain}: rented ${quantity} energy for S via ${rt.rental.name} (order ${orderId})`,
    );
  } catch (e) {
    log.warn(
      `[tronSponsor] ${rt.chain}: energy rental failed: ${(e as Error).message}`,
    );
    refuse(unavailable);
  }
  const after = await rt.client.getAccountResource(origin);
  if (after.availableEnergy < need) refuse(unavailable);
}

// ---------------------------------------------------------------------------
// Broadcast (the acceptance rule)
// ---------------------------------------------------------------------------

async function pickRelayer(rt: TronRuntime, bytes: bigint): Promise<Relayer> {
  const count = rt.relayers.length;
  for (let k = 0; k < count; k++) {
    const idx = (rt.rrIndex + k) % count;
    const r = rt.relayers[idx];
    try {
      const [res, acct] = await Promise.all([
        rt.client.getAccountResource(r.address),
        rt.client.getAccount(r.address),
      ]);
      const burnable = acct?.balance ?? 0n;
      if (res.availableBandwidth >= bytes || burnable >= bytes * 1000n) {
        rt.rrIndex = (idx + 1) % count;
        return r;
      }
      log.warn(
        `[tronSponsor] ${rt.chain}: relayer ${r.address} lacks bandwidth/TRX for ${bytes} bytes`,
      );
    } catch (e) {
      log.warn(
        `[tronSponsor] ${rt.chain}: relayer ${r.address} check failed: ${(e as Error).message}`,
      );
    }
  }
  refuse('TRON sponsor temporarily unavailable (no relayer can pay bandwidth)');
}

export interface SponsoredOpRecord {
  txid: string;
  digest: string;
  chain: TronChain;
  vault: string;
  nonce: string;
  relayer: string;
  energyUsed: number | null;
  energyPenalty: number | null;
  originEnergyUsed: number | null;
  netUsage: number | null;
  netFee: number | null;
  /** base58: TRX_FEE_TOKEN for TRX, else the TRC-20 contract. */
  feeToken: string;
  /** Base units (sun / USDT units) as a decimal string. */
  feeAmount: string;
  callCount: number;
  status: 'broadcast' | 'confirmed' | 'failed';
  error?: string;
  createdAt: Date;
  confirmedAt?: Date;
}

export async function acceptAndBroadcast(
  rt: TronRuntime,
  req: TronBroadcastRequest,
): Promise<{ txid: string; confirmation: Promise<void> | null }> {
  if (!req || typeof req !== 'object') refuse('invalid broadcast request');
  const n = rt.network;
  if (n.factory === null || n.implementation === null) {
    refuse(`TRON vaults are not deployed on ${rt.chain} yet`);
  }

  // Structural: derive the vault ourselves, never trust a client vault.
  const cfg = parseVaultConfig(req.signers, req.threshold);
  const vault = deriveVault(n, cfg).address;
  const op = parseOp(req.op);
  const sigs = parseSignatures(req.signatures, cfg);
  const digest = opDigest(n.chainId, vault, op);
  const digestHex = `0x${bytesToHex(digest)}`;
  let signaturesPacked: Uint8Array;
  try {
    signaturesPacked = assembleSignatures(digest, cfg, sigs);
  } catch (e) {
    refuse(`signatures rejected: ${(e as Error).message}`);
  }

  // Dedupe: an Op already in flight or confirmed returns its txid.
  const { ops } = await rt.collections();
  const existing = await ops.findOne({ digest: digestHex });
  if (existing && existing.status !== 'failed') {
    return { txid: String(existing.txid), confirmation: null };
  }

  requireAvailable(rt);
  const sponsor = n.sponsor!;

  // Fee recipient, fee token, calls, deadline.
  if (op.fee.recipient !== n.feeCollector) {
    refuse('fee recipient must be the SSP fee collector');
  }
  const kind = feeKindOf(op.fee.token, n);
  if (kind === null) refuse('fee token must be TRX or the network USDT');
  if (op.calls.length > MAX_CALLS) refuse(`at most ${MAX_CALLS} calls`);
  await assertSponsorableCalls(rt, vault, op.calls);
  const nowMs = rt.nowMs();
  const nowS = BigInt(Math.floor(nowMs / 1000));
  if (op.deadline <= nowS + MIN_DEADLINE_MARGIN_S) {
    refuse('Op deadline has passed or is too close');
  }
  if (op.deadline > nowS + MAX_DEADLINE_WINDOW_S) {
    refuse('Op deadline is too far in the future');
  }
  if (op.fee.amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    refuse('fee amount out of range');
  }

  // Launch cap per vault.
  if (rt.maxOpsPerVaultPerDay > 0) {
    const recent = await ops.countDocuments({
      chain: rt.chain,
      vault,
      createdAt: { $gte: new Date(nowMs - 86_400_000) },
    });
    if (recent >= rt.maxOpsPerVaultPerDay) {
      refuse('daily sponsored-operation limit reached for this vault');
    }
  }

  // In-flight bound. Every Op is simulated against the CURRENT state, so two
  // Ops of one vault broadcast together can each simulate fine and still
  // collide on-chain (same nonce, or together more than the balance); the
  // loser reverts and S pays for the revert. Refuse a second Op with the same
  // nonce outright, and cap how many unconfirmed Ops a vault may have.
  const inFlight = await ops
    .find({
      chain: rt.chain,
      vault,
      status: 'broadcast',
      createdAt: { $gte: new Date(nowMs - IN_FLIGHT_WINDOW_MS) },
    })
    .toArray();
  if (inFlight.some((r) => String(r.nonce) === op.nonce.toString())) {
    refuse('another Op with this nonce is already being broadcast');
  }
  if (inFlight.length >= MAX_IN_FLIGHT_PER_VAULT) {
    refuse(
      'too many unconfirmed sponsored operations for this vault; wait for them to confirm',
    );
  }

  // Nonce unused on-chain (a not-yet-deployed vault has used none).
  const deployed = await rt.client.hasCode(vault);
  if (deployed && (await rt.client.isNonceUsed(vault, op.nonce))) {
    refuse('Op nonce is already used');
  }

  // Sponsor sanity: S pays everything only with percent 0.
  const meta = await sponsorMeta(rt);
  if (meta.consumeUserResourcePercent !== 0n) {
    refuse(
      'TRON sponsor misconfigured (consume_user_resource_percent is not 0)',
    );
  }
  if (meta.originEnergyLimit <= 0n) {
    refuse('TRON sponsor misconfigured (origin_energy_limit is 0)');
  }

  // Relayer (bandwidth pre-check), then the full simulation from it.
  const estBytes = executeBandwidthBytes({
    owner: rt.relayers[0].address,
    sponsor,
    config: cfg,
    op,
    nowMs: BigInt(nowMs),
  });
  const relayer = await pickRelayer(rt, estBytes);
  const calldata = encodeExecute({
    signersPacked: packSigners(cfg.signers),
    threshold: cfg.threshold,
    op,
    signaturesPacked,
  });
  const sim = await rt.client.triggerConstant({
    owner: relayer.address,
    contract: sponsor,
    data: calldata,
  });
  // `sim.ok` is false on ret[0].ret === 'FAILED', a result message or a
  // missing result.result: a reverting simulation still says result: true.
  if (!sim.ok) refuse(`simulation failed: ${simulationFailure(sim).message}`);
  const energy = sim.energyUsed;
  if (energy <= 0n) refuse('simulation returned no energy usage');

  // Build and sign now so the cost uses the exact bandwidth.
  const block = await rt.client.getNowBlock();
  const expiration = block.timestamp + TX_EXPIRATION_MS;
  let timestamp = BigInt(nowMs);
  if (timestamp >= expiration) timestamp = block.timestamp;
  const raw = buildExecuteTransaction({
    owner: relayer.address,
    target: sponsor,
    config: cfg,
    op,
    signaturesPacked,
    feeLimit: 0n, // omitted: the relayer can never burn TRX for energy
    ref: block.ref,
    expiration,
    timestamp,
  });
  const signed = await signTransaction(raw, relayer.signer);
  const txHex = serializeTransaction(signed);
  const txid = txidHex(raw);
  const bandwidthBytes = signedTxBandwidthBytes(txHex);

  // fee ≥ cost now, NO markup.
  let minFee: bigint;
  try {
    minFee = minimumFee({
      token: kind,
      energy,
      bandwidthBytes,
      energyPriceSun: rt.energyPriceSun,
      rates: rt.rates(),
    });
  } catch (e) {
    refuse(`cannot price a ${kind} fee right now: ${(e as Error).message}`);
  }
  if (op.fee.amount < minFee) {
    refuse(
      `fee ${op.fee.amount} is below the current cost ${minFee} (${energy} energy, ${bandwidthBytes} bytes); request a new quote`,
    );
  }

  // Energy caps: quote × 1.25, launch cap, origin_energy_limit.
  let quoted = await quotedEnergyFor(rt, vault, op.nonce, kind);
  if (quoted === null) {
    log.warn(
      `[tronSponsor] ${rt.chain}: no quote on record for ${vault} nonce ${op.nonce}; re-estimating`,
    );
    const est = await estimateOpEnergy(rt, {
      vault,
      deployed,
      threshold: cfg.threshold,
      calls: op.calls,
      coldNonceWord: await isColdNonceWord(rt, vault, deployed, op.nonce),
      usdtBalance:
        kind === 'USDT' ? await trc20BalanceOrZero(rt, n.usdt!, vault) : 0n,
    });
    quoted = kind === 'TRX' ? est.trx : est.usdt;
  }
  if (energy * QUOTE_TOLERANCE_DEN > quoted * QUOTE_TOLERANCE_NUM) {
    refuse(
      `simulated energy ${energy} exceeds the quoted ${quoted} by more than 25%; request a new quote`,
    );
  }
  if (energy > MAX_SPONSORED_ENERGY) {
    refuse(
      `simulated energy ${energy} exceeds the ${MAX_SPONSORED_ENERGY} cap`,
    );
  }
  if (energy > meta.originEnergyLimit) {
    refuse(
      `simulated energy ${energy} exceeds the sponsor's origin_energy_limit ${meta.originEnergyLimit}`,
    );
  }

  // S must have the energy now (fee_limit 0: a shortfall would fail the tx
  // OUT_OF_ENERGY and S's partial energy would be lost).
  await ensureSponsorEnergy(rt, meta.origin, energy, digestHex);

  // Record first: the unique digest index is the concurrency lock.
  const record: SponsoredOpRecord = {
    txid,
    digest: digestHex,
    chain: rt.chain,
    vault,
    nonce: op.nonce.toString(),
    relayer: relayer.address,
    energyUsed: null,
    energyPenalty: null,
    originEnergyUsed: null,
    netUsage: null,
    netFee: null,
    feeToken: op.fee.token,
    feeAmount: op.fee.amount.toString(),
    callCount: op.calls.length,
    status: 'broadcast',
    createdAt: new Date(nowMs),
  };
  if (existing && existing.status === 'failed') {
    const claimed = await ops.findOneAndUpdate(
      { digest: digestHex, status: 'failed' },
      { $set: record, $unset: { error: '', confirmedAt: '' } },
    );
    if (!claimed) {
      const winner = await ops.findOne({ digest: digestHex });
      if (winner) return { txid: String(winner.txid), confirmation: null };
      refuse('concurrent broadcast of the same Op; retry');
    }
  } else {
    try {
      await ops.insertOne({ ...record });
    } catch (e) {
      if (!isDuplicateKeyError(e)) throw e;
      const winner = await ops.findOne({ digest: digestHex });
      return { txid: String(winner?.txid ?? txid), confirmation: null };
    }
  }

  try {
    const res = await rt.client.broadcastHex(txHex);
    if (res.txid !== '' && res.txid.toLowerCase() !== txid) {
      await ops.updateOne(
        { digest: digestHex, txid },
        { $set: { status: 'failed', error: `node returned txid ${res.txid}` } },
      );
      refuse('node returned a different txid than the one signed');
    }
  } catch (e) {
    if (e instanceof TronSponsorRefusal) throw e;
    if (isTronMultisigError(e, 'BROADCAST_FAILED')) {
      if (!/DUP_TRANSACTION/.test(e.message)) {
        await ops.updateOne(
          { digest: digestHex, txid },
          { $set: { status: 'failed', error: e.message } },
        );
        throw new Error(`TRON broadcast refused: ${e.message}`);
      }
      // Same bytes already in the pool: that is our transaction.
    } else {
      // Transport failure: the node may have accepted it. Keep the record in
      // 'broadcast' and let the poller settle it; a retry returns this txid.
      confirmSponsoredTx(rt, txid, digestHex).catch((err) => log.error(err));
      throw new Error(
        `TRON broadcast outcome unknown for ${txid}: ${(e as Error).message}`,
      );
    }
  }
  log.info(
    `[tronSponsor] ${rt.chain} broadcast ${txid} vault=${vault} nonce=${op.nonce} relayer=${relayer.address} energy=${energy} fee=${op.fee.amount} ${kind}`,
  );
  const confirmation = confirmSponsoredTx(rt, txid, digestHex);
  return { txid, confirmation };
}

function toSafeNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^[0-9]+$/.test(v)) {
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

/**
 * Poll walletsolidity/gettransactioninfobyid (HTTP only: the proxy's
 * WebSocket path is not dependable, as on Solana) until the transaction is
 * solidified, then record the receipt. A transaction that is still unknown
 * after all attempts has expired (60 s TaPoS window) and is marked failed.
 */
export async function confirmSponsoredTx(
  rt: TronRuntime,
  txid: string,
  digestHex: string,
  attempts: number = rt.confirm.attempts,
): Promise<void> {
  const { ops } = await rt.collections();
  for (let i = 0; i < attempts; i++) {
    await rt.sleep(rt.confirm.intervalMs);
    let info: Awaited<ReturnType<TronHttpClient['getTransactionInfo']>>;
    try {
      info = await rt.client.getTransactionInfo(txid, { solidified: true });
    } catch {
      continue;
    }
    if (info === null) continue;
    const receipt = (info.raw.receipt ?? {}) as Record<string, unknown>;
    const receiptFields = {
      energyUsed: Number(info.energyUsageTotal),
      energyPenalty: toSafeNumber(receipt.energy_penalty_total) ?? 0,
      originEnergyUsed: Number(info.originEnergyUsage),
      netUsage: Number(info.netUsage),
      netFee: Number(info.netFee),
    };
    if (info.energyFee > 0n) {
      log.warn(
        `[tronSponsor] ${rt.chain} ${txid}: energy_fee ${info.energyFee} sun was burned — S did not cover the whole transaction`,
      );
    }
    if (info.result === 'SUCCESS') {
      await ops.updateOne(
        { digest: digestHex, txid },
        {
          $set: {
            ...receiptFields,
            status: 'confirmed',
            confirmedAt: new Date(rt.nowMs()),
          },
          $unset: { error: '' },
        },
      );
      log.info(`[tronSponsor] ${rt.chain} confirmed ${txid}`);
    } else {
      const why =
        info.revert && info.revert.kind === 'custom'
          ? `: ${info.revert.signature}`
          : info.revert && info.revert.kind === 'error'
            ? `: ${info.revert.message}`
            : info.resMessage
              ? `: ${info.resMessage}`
              : '';
      await ops.updateOne(
        { digest: digestHex, txid },
        {
          $set: {
            ...receiptFields,
            status: 'failed',
            error: `${info.result}${why}`,
          },
        },
      );
      log.warn(
        `[tronSponsor] ${rt.chain} ${txid} failed on-chain: ${info.result}${why}`,
      );
    }
    return;
  }
  await ops.updateOne(
    { digest: digestHex, txid, status: 'broadcast' },
    {
      $set: {
        status: 'failed',
        error: `not solidified after ${attempts} polls (expired or dropped)`,
      },
    },
  );
}

export async function broadcast(
  req: TronBroadcastRequest,
): Promise<{ txid: string }> {
  if (!req || typeof req !== 'object' || !isTronChain(req.chain)) {
    refuse('Invalid or unsupported TRON chain');
  }
  const { txid, confirmation } = await acceptAndBroadcast(
    getRuntime(req.chain),
    req,
  );
  confirmation?.catch((e) => log.error(e));
  return { txid };
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

/** Throws on a config the relay must not run with (override conflicts). */
export function assertTronConfig(): void {
  for (const chain of TRON_CHAINS) {
    resolveTronNetwork(chain);
  }
  configuredEnergyPriceSun();
  configuredMarkup();
}

/** Re-attach pollers to broadcasts a restart left unsettled. */
export async function resumePendingConfirmations(): Promise<void> {
  for (const chain of TRON_CHAINS) {
    let rt: TronRuntime;
    try {
      rt = getRuntime(chain);
    } catch {
      continue;
    }
    const { ops } = await rt.collections();
    const pending = await ops
      .find({ chain, status: 'broadcast' })
      .limit(200)
      .toArray();
    for (const p of pending) {
      const ageMs = rt.nowMs() - new Date(p.createdAt).getTime();
      confirmSponsoredTx(
        rt,
        String(p.txid),
        String(p.digest),
        ageMs > 10 * 60_000 ? 1 : rt.confirm.attempts,
      ).catch((e) => log.error(e));
    }
  }
}

export async function logTronSponsorStatus(): Promise<void> {
  log.info(
    `[tronSponsor] kill switch TRON_SPONSOR_ENABLED=${isKillSwitchOn() ? 'on' : 'OFF'}`,
  );
  for (const chain of TRON_CHAINS) {
    try {
      const rt = getRuntime(chain);
      const n = rt.network;
      const reason = unavailableReason(rt);
      log.info(
        `[tronSponsor] ${chain}: ${reason === null ? 'ENABLED' : `disabled (${reason})`}; factory=${n.factory ?? '-'} sponsor=${n.sponsor ?? '-'} feeCollector=${n.feeCollector ?? '-'} energyPrice=${rt.energyPriceSun} sun rental=${rt.rental?.name ?? 'off'}`,
      );
      if (rt.relayerError) {
        log.error(`[tronSponsor] ${chain}: relayer keys: ${rt.relayerError}`);
      } else if (rt.relayers.length === 0) {
        log.warn(
          `[tronSponsor] ${chain}: no relayers — set ${relayerEnvVar(chain)} (comma-separated hex keys)`,
        );
      } else if (rt.relayerSource === 'generated') {
        log.warn(
          `[tronSponsor] ${chain}: generated relayer ${rt.relayers[0].address} at ${relayerFilePath(chain)} — fund it and allow-list it with sponsor.setRelayer`,
        );
      }
      if (n.sponsor === null) continue;
      let origin: string | null = null;
      try {
        const meta = await sponsorMeta(rt);
        origin = meta.origin;
        const res = await rt.client.getAccountResource(meta.origin);
        log.info(
          `[tronSponsor] ${chain}: S=${meta.origin} energy ${res.availableEnergy}/${res.energyLimit} origin_energy_limit=${meta.originEnergyLimit} percent=${meta.consumeUserResourcePercent}`,
        );
        if (meta.consumeUserResourcePercent !== 0n) {
          log.error(
            `[tronSponsor] ${chain}: sponsor consume_user_resource_percent must be 0`,
          );
        }
      } catch (e) {
        log.warn(
          `[tronSponsor] ${chain}: sponsor read failed${origin ? ` (S=${origin})` : ''}: ${(e as Error).message}`,
        );
      }
      for (const r of rt.relayers) {
        try {
          const [acct, res, allowed] = await Promise.all([
            rt.client.getAccount(r.address),
            rt.client.getAccountResource(r.address),
            rt.client
              .triggerConstant({
                owner: r.address,
                contract: n.sponsor,
                data: encodeIsRelayer(r.address),
              })
              .then((c) => (c.ok ? decodeBoolResult(c.result) : false)),
          ]);
          log.info(
            `[tronSponsor] ${chain}: relayer ${r.address} (${rt.relayerSource}) TRX=${acct?.balance ?? 0n} sun bandwidth=${res.availableBandwidth} allow-listed=${allowed}`,
          );
          if (!allowed) {
            log.error(
              `[tronSponsor] ${chain}: relayer ${r.address} is NOT allow-listed on the sponsor; every broadcast from it will fail simulation`,
            );
          }
        } catch (e) {
          log.warn(
            `[tronSponsor] ${chain}: relayer ${r.address} status failed: ${(e as Error).message}`,
          );
        }
      }
    } catch (e) {
      log.error(`[tronSponsor] ${chain}: ${(e as Error).message}`);
    }
  }
  await resumePendingConfirmations().catch((e) => log.error(e));
}

export default {
  getSponsorContext,
  quote,
  broadcast,
  assertTronConfig,
  logTronSponsorStatus,
};
