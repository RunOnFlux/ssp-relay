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
 *   failure circuit breaker (chain) → per-vault lock (one acceptance at a
 *   time) → per-vault daily cap and on-chain failure limit → no same-nonce
 *   Op in flight, no earlier Op of the vault still outside a block → nonce
 *   unused on-chain → sponsor sanity → full simulation of sponsor.execute
 *   from the relayer (ret FAILED detected) → deadline outlasts the tx
 *   expiry → fee ≥ cost now (no markup) → energy ≤ quote × 1.25, ≤ 1.2M
 *   launch cap, ≤ origin_energy_limit → S has the energy (or a rental
 *   delivered it) → build (fee_limit omitted), sign, record, broadcast,
 *   compare txid → background confirmation from walletsolidity.
 *
 * All vault math (addresses, digests, ABI, protobuf) is the SDK's.
 * Keys are never logged; only relayer ADDRESSES are.
 */
import config from 'config';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash, randomBytes } from 'crypto';
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
  encodeSponsorExecute,
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
  validateOpForVault,
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

/**
 * Energy cap for the sponsor's vault call: the simulated energy of the whole
 * transaction (a superset of the vault call) + 25%, never above the launch cap.
 */
export function broadcastEnergyCap(simulatedEnergy: bigint): bigint {
  const cap = (simulatedEnergy * 5n + 3n) / 4n;
  return cap < MAX_SPONSORED_ENERGY ? cap : MAX_SPONSORED_ENERGY;
}
/** Simulated energy may exceed the quoted estimate by at most 25 %. */
export const QUOTE_TOLERANCE_NUM = 5n;
export const QUOTE_TOLERANCE_DEN = 4n;
/** "keep a little TRX": TRX is the default fee token only above fee + 1 TRX. */
export const TRX_FEE_BUFFER_SUN = 1_000_000n;
/** Active relay-picked reservations per vault; the oldest is evicted beyond. */
export const MAX_ACTIVE_RESERVATIONS_PER_VAULT = 32;
/** 64 words × 256 = the first 16,384 nonces. */
export const MAX_NONCE_WORDS_SCANNED = 64n;
/**
 * Sponsored Ops per vault that may be broadcast but not yet in a block. Every
 * Op is simulated against the head state, so a second Op admitted before the
 * first is in a block can collide with it (same funds, same nonce) and revert
 * on S's energy. 1 = strictly one at a time until the previous one lands.
 */
export const MAX_IN_FLIGHT_PER_VAULT = 1;
/** A 'broadcast' record older than this no longer counts as in flight. */
const IN_FLIGHT_WINDOW_MS = 5 * 60 * 1000;
/**
 * A transaction not in a block this long after it was built can never be
 * included (it expires 60 s after its reference block): it stops holding the
 * vault's in-flight slot. The extra minute absorbs relay↔chain clock skew.
 */
const PENDING_INCLUSION_WINDOW_MS = 2 * 60 * 1000;
/**
 * On-chain failures (receipts, not refusals) per vault per rolling 24 h after
 * which the vault is no longer sponsored. S pays for every one of them, and
 * the vault's owner can always force one (e.g. a self-paid Op that spends the
 * fee balance while the sponsored Op is in flight). 2 still lets one retry
 * through (an enterprise proposal is retried with the same signatures).
 */
export const MAX_ONCHAIN_FAILURES_PER_VAULT_PER_DAY = 2;
/** Default chain-wide budget: energy S may burn on failed Ops per hour. */
export const DEFAULT_MAX_FAILED_ENERGY_PER_HOUR = 2_500_000;
const MAX_PRIOR_FAILURES_KEPT = 20;
/**
 * How long energy committed to a broadcast is held against S's available
 * energy: until the transaction is surely in a block the node has seen.
 */
const COMMITTED_ENERGY_WINDOW_MS = 15_000;
/** Per-vault acceptance lock (a document in the reservations collection). */
const VAULT_LOCK_NONCE = 'broadcast-lock';
/** How long a crashed lock holder can block a vault's broadcasts. */
const VAULT_LOCK_TTL_MS = 3 * 60 * 1000;
const VAULT_LOCK_POLL_MS = 100;
const VAULT_LOCK_POLLS = 60;
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
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    // `mode` only applies when the file is created: an existing (empty) file
    // keeps its permissions, so tighten them before the key goes in.
    if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
    fs.writeFileSync(file, `${bytesToHex(key!)}\n`, { mode: 0o600 });
    fs.chmodSync(file, 0o600);
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

function configuredMaxFailedEnergyPerHour(): number {
  const n = config.has('tron.maxFailedEnergyPerHour')
    ? Number(config.get<number>('tron.maxFailedEnergyPerHour'))
    : DEFAULT_MAX_FAILED_ENERGY_PER_HOUR;
  return Number.isSafeInteger(n) && n >= 0
    ? n
    : DEFAULT_MAX_FAILED_ENERGY_PER_HOUR;
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
  /**
   * Circuit breaker: once failed sponsored transactions burned this much of
   * S's energy in the rolling hour, the chain refuses new broadcasts until
   * the window rolls. 0 disables it.
   */
  maxFailedEnergyPerHour: number;
  /** On-chain failures seen by this process's pollers (the breaker's window). */
  failures: { atMs: number; energy: number }[];
  /** Energy committed to this process's recent broadcasts (see ensureSponsorEnergy). */
  committedEnergy: { atMs: number; energy: bigint }[];
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
    maxFailedEnergyPerHour: configuredMaxFailedEnergyPerHour(),
    failures: [],
    committedEnergy: [],
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
  // Same bound as a broadcast Op: the body parser allows 15 MB.
  if (JSON.stringify(calls).length > MAX_OP_JSON_BYTES) {
    refuse('calls are too large');
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

/**
 * The energy-relevant shape of a call list: targets, selectors, recipients
 * and which amounts are non-zero — but not the amounts themselves, so a
 * send-max Op rebuilt with `maxSendable` still matches its quote.
 */
export function callsShapeKey(calls: readonly Call[]): string {
  const parts = calls.map((c) => {
    let transfer: ReturnType<typeof decodeTrc20Transfer> = null;
    try {
      transfer = c.data.length > 0 ? decodeTrc20Transfer(c.data) : null;
    } catch {
      transfer = null;
    }
    const data = transfer
      ? `trc20:${transfer.to}:${transfer.amount > 0n ? 1 : 0}`
      : bytesToHex(c.data);
    return [
      c.to,
      c.value > 0n ? 1 : 0,
      c.tokenId.toString(),
      c.tokenValue > 0n ? 1 : 0,
      data,
    ].join('|');
  });
  return createHash('sha256').update(parts.join(';')).digest('hex');
}

/**
 * The energy quoted for (vault, nonce), but only if that quote was for the
 * same calls. Anyone can quote any vault (its signers are public once it has
 * executed), and a public quote may take over a nonce whose reservation was
 * evicted: without this binding, an attacker's tiny quote on a victim's
 * nonce would make the victim's broadcast fail the ×1.25 check.
 */
async function quotedEnergyFor(
  rt: TronRuntime,
  vault: string,
  nonce: bigint,
  kind: FeeKind,
  callsKey: string,
): Promise<bigint | null> {
  const { reservations } = await rt.collections();
  const r = await reservations.findOne({
    chain: rt.chain,
    vault,
    nonce: nonce.toString(),
  });
  if (!r || r.callsKey !== callsKey) return null;
  const e = r.energy?.[kind === 'TRX' ? 'trx' : 'usdt'];
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
    if ((c.value > 0n || c.tokenValue > 0n) && c.to === vault) {
      refuse(`call ${i}: a TRX / TRC-10 transfer to the vault itself`);
    }
    if (c.tokenValue > 0n) {
      if (!(await isSafeValueRecipient(rt, c.to))) {
        refuse(
          `call ${i}: a TRC-10 transfer to a contract can't be sponsored; ${selfPay}`,
        );
      }
      continue;
    }
    if (c.data.length === 0) {
      if (c.value > 0n && !(await isSafeValueRecipient(rt, c.to))) {
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
    const callsKey = callsShapeKey(calls);
    if (reservedHere) {
      await reservations.updateOne(key, {
        $set: { energy: energyRecord, callsKey },
      });
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
            callsKey,
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

/**
 * Energy this process committed to broadcasts that the node's resource figure
 * may not reflect yet (not in a block, or the block not seen by the node that
 * answered). Without it, two Ops of DIFFERENT vaults checked at the same time
 * both see S's full energy; the second then runs OUT_OF_ENERGY and burns what
 * S has left with no fee paid.
 */
function committedEnergy(rt: TronRuntime, nowMs: number): bigint {
  const cutoff = nowMs - COMMITTED_ENERGY_WINDOW_MS;
  rt.committedEnergy = rt.committedEnergy.filter((c) => c.atMs > cutoff);
  return rt.committedEnergy.reduce((sum, c) => sum + c.energy, 0n);
}

async function ensureSponsorEnergy(
  rt: TronRuntime,
  origin: string,
  need: bigint,
  digestHex: string,
): Promise<void> {
  const res = await rt.client.getAccountResource(origin);
  // From each read to its commit there is no await: in this process the
  // check and the commitment are atomic.
  let committed = committedEnergy(rt, rt.nowMs());
  if (res.availableEnergy >= need + committed) {
    rt.committedEnergy.push({ atMs: rt.nowMs(), energy: need });
    return;
  }
  const unavailable =
    'TRON sponsor temporarily unavailable (sponsor energy is low); try again later or pay the network fee yourself';
  if (rt.rental === null) {
    log.warn(
      `[tronSponsor] ${rt.chain}: S ${origin} has ${res.availableEnergy} energy (${committed} committed to pending broadcasts), needs ${need}; no rental provider, refusing`,
    );
    refuse(unavailable);
  }
  const shortfall = ((need + committed - res.availableEnergy) * 11n) / 10n;
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
  committed = committedEnergy(rt, rt.nowMs());
  if (after.availableEnergy < need + committed) refuse(unavailable);
  rt.committedEnergy.push({ atMs: rt.nowMs(), energy: need });
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
  /** Earlier attempts of this same Op that failed on-chain (S paid). */
  priorFailures?: {
    txid: string;
    at: Date;
    energyUsed: number;
    originEnergyUsed: number | null;
    error: string | null;
  }[];
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
  try {
    validateOpForVault(op, vault);
  } catch (e) {
    refuse(`invalid op: ${(e as Error).message}`);
  }
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

  // Chain-wide circuit breaker (see assertFailureBudget).
  assertFailureBudget(rt, nowMs);

  // One acceptance at a time per vault: the daily cap, the failure limit and
  // the in-flight rule below are check-then-insert, and two concurrent
  // requests would otherwise both pass them. A concurrent duplicate of the
  // SAME Op waits here and then gets the winner's txid.
  let token = await tryLockVault(rt, vault);
  let attempt = 0;
  while (token === null) {
    const winner = await ops.findOne({ digest: digestHex });
    if (winner && winner.status !== 'failed') {
      return { txid: String(winner.txid), confirmation: null };
    }
    if (++attempt > VAULT_LOCK_POLLS) {
      refuse(
        'TRON sponsor temporarily unavailable for this vault (another sponsored operation is being processed); retry in a few seconds',
      );
    }
    await lockPause(VAULT_LOCK_POLL_MS);
    token = await tryLockVault(rt, vault);
  }
  const held = token;
  let released = false;
  const release = async (): Promise<void> => {
    if (released) return;
    released = true;
    await unlockVault(rt, vault, held).catch((e) =>
      log.warn(
        `[tronSponsor] ${rt.chain}: vault lock release failed for ${vault}: ${(e as Error).message}`,
      ),
    );
  };
  try {
    return await acceptLocked(rt, {
      cfg,
      vault,
      op,
      digestHex,
      signaturesPacked,
      kind,
      release,
    });
  } finally {
    if (!released) await release();
  }
}

// ---------------------------------------------------------------------------
// Per-vault lock, failure accounting
// ---------------------------------------------------------------------------

const lockPause = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Take the vault's acceptance lock: a unique (chain, vault, 'broadcast-lock')
 * document in the reservations collection, whose TTL index also reaps a lock
 * a crashed holder left behind. Returns the holder token, or null when busy.
 */
async function tryLockVault(
  rt: TronRuntime,
  vault: string,
): Promise<string | null> {
  const { reservations } = await rt.collections();
  const now = rt.nowMs();
  const token = randomBytes(16).toString('hex');
  const key = { chain: rt.chain, vault, nonce: VAULT_LOCK_NONCE };
  const fields = {
    source: 'lock',
    token,
    createdAt: new Date(now),
    expiresAt: new Date(now + VAULT_LOCK_TTL_MS),
  };
  try {
    await reservations.insertOne({ ...key, ...fields });
    return token;
  } catch (e) {
    if (!isDuplicateKeyError(e)) throw e;
  }
  // The holder crashed: take over its expired lock (atomically).
  const stale = await reservations.findOneAndUpdate(
    { ...key, expiresAt: { $lte: new Date(now) } },
    { $set: fields },
  );
  return stale ? token : null;
}

async function unlockVault(
  rt: TronRuntime,
  vault: string,
  token: string,
): Promise<void> {
  const { reservations } = await rt.collections();
  await reservations.deleteOne({
    chain: rt.chain,
    vault,
    nonce: VAULT_LOCK_NONCE,
    token,
  });
}

/**
 * Whether a broadcast transaction is in a block (not necessarily solidified).
 * Fails closed: an unreachable node counts as "not yet".
 */
async function isInBlock(rt: TronRuntime, txid: string): Promise<boolean> {
  try {
    return (await rt.client.getTransactionInfo(txid)) !== null;
  } catch {
    return false;
  }
}

/** Energy S burned on failed sponsored transactions in the rolling hour. */
function failedEnergyLastHour(rt: TronRuntime, nowMs: number): number {
  const cutoff = nowMs - 3_600_000;
  rt.failures = rt.failures.filter((f) => f.atMs > cutoff);
  return rt.failures.reduce((sum, f) => sum + f.energy, 0);
}

/**
 * The relay cannot prevent every revert: the vault's owner can race a
 * self-paid Op that spends the fee balance, or deploy code (CREATE2) at a
 * TRX recipient between the simulation and the block — and a reverting call
 * target can burn up to origin_energy_limit. This bounds what such attacks
 * cost per hour; the poller feeds it from real receipts.
 */
function assertFailureBudget(rt: TronRuntime, nowMs: number): void {
  if (rt.maxFailedEnergyPerHour <= 0) return;
  const burned = failedEnergyLastHour(rt, nowMs);
  if (burned >= rt.maxFailedEnergyPerHour) {
    log.error(
      `[tronSponsor] ${rt.chain}: circuit breaker OPEN — failed sponsored transactions burned ${burned} energy in the last hour (budget ${rt.maxFailedEnergyPerHour}); refusing broadcasts`,
    );
    refuse(
      'TRON sponsor temporarily unavailable (too many sponsored transactions failed on-chain recently); try again later or pay the network fee yourself',
    );
  }
}

/** S's share of a failed receipt (all of it: consume_user_resource_percent 0). */
function failureEnergy(info: {
  originEnergyUsage: bigint;
  energyUsageTotal: bigint;
}): number {
  return Number(
    info.originEnergyUsage > 0n
      ? info.originEnergyUsage
      : info.energyUsageTotal,
  );
}

function noteOnchainFailure(rt: TronRuntime, energy: number): void {
  if (Number.isFinite(energy) && energy > 0) {
    rt.failures.push({ atMs: rt.nowMs(), energy });
  }
}

/** Failures that executed on-chain (a receipt, not a refusal or expiry). */
function onchainFailuresSince(docs: Document[], cutoffMs: number): number {
  let n = 0;
  for (const d of docs) {
    if (d.status === 'failed' && typeof d.energyUsed === 'number') n++;
    if (Array.isArray(d.priorFailures)) {
      for (const f of d.priorFailures as { at?: unknown }[]) {
        const at = new Date(f?.at as string | number | Date).getTime();
        if (Number.isFinite(at) && at >= cutoffMs) n++;
      }
    }
  }
  return n;
}

/** Everything after the per-vault lock (see acceptAndBroadcast). */
async function acceptLocked(
  rt: TronRuntime,
  p: {
    cfg: VaultConfig;
    vault: string;
    op: Op;
    digestHex: string;
    signaturesPacked: Uint8Array;
    kind: FeeKind;
    /** Releases the vault lock once the record makes this Op visible. */
    release: () => Promise<void>;
  },
): Promise<{ txid: string; confirmation: Promise<void> | null }> {
  const { cfg, vault, op, digestHex, signaturesPacked, kind } = p;
  const n = rt.network;
  const sponsor = n.sponsor!;
  const { ops } = await rt.collections();
  const nowMs = rt.nowMs();

  // Re-read under the lock: a concurrent request may have finished this Op.
  const existing = await ops.findOne({ digest: digestHex });
  if (existing && existing.status !== 'failed') {
    return { txid: String(existing.txid), confirmation: null };
  }

  // Launch cap per vault.
  const dayAgo = new Date(nowMs - 86_400_000);
  if (rt.maxOpsPerVaultPerDay > 0) {
    const recent = await ops.countDocuments({
      chain: rt.chain,
      vault,
      createdAt: { $gte: dayAgo },
    });
    if (recent >= rt.maxOpsPerVaultPerDay) {
      refuse('daily sponsored-operation limit reached for this vault');
    }
  }

  // A vault whose sponsored Ops keep failing on-chain stops being sponsored.
  const lastDay = await ops
    .find({ chain: rt.chain, vault, createdAt: { $gte: dayAgo } })
    .limit(500)
    .toArray();
  const failures = onchainFailuresSince(lastDay, dayAgo.getTime());
  if (failures >= MAX_ONCHAIN_FAILURES_PER_VAULT_PER_DAY) {
    refuse(
      `sponsored operations of this vault failed on-chain ${failures} times in the last 24 h, so sponsorship is paused for it; pay the network fee yourself or try again later`,
    );
  }

  // In-flight bound. Every Op is simulated against the CURRENT state, so two
  // Ops of one vault broadcast together can each simulate fine and still
  // collide on-chain (same nonce, or together more than the balance); the
  // loser reverts and S pays for the revert. Refuse a second Op with the same
  // nonce outright, and admit the next Op of a vault only once the previous
  // one is in a block (its effects are then in the state simulations see).
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
  let pending = 0;
  for (const r of inFlight) {
    const created = new Date(r.createdAt).getTime();
    if (created < nowMs - PENDING_INCLUSION_WINDOW_MS) continue; // expired
    if (!(await isInBlock(rt, String(r.txid)))) pending++;
  }
  if (pending >= MAX_IN_FLIGHT_PER_VAULT) {
    refuse(
      'too many unconfirmed sponsored operations for this vault; wait a few seconds for the previous one to reach a block',
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
  // Simulate with the largest cap we would ever sponsor; the broadcast then
  // caps the vault call at ~1.25x what the simulation used, so an Op that
  // diverges on-chain (a recipient that gains code, a racing Op) costs S at
  // most that, never its whole origin_energy_limit (the TVM forwards ALL
  // remaining energy on a CALL).
  const calldata = encodeSponsorExecute({
    signersPacked: packSigners(cfg.signers),
    threshold: cfg.threshold,
    op,
    signaturesPacked,
    energyCap: MAX_SPONSORED_ENERGY,
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
  // The transaction can be included until `expiration` (chain time): the Op
  // must still be valid then, or it may revert Expired on S's energy. The
  // earlier check uses the relay clock, which can lag the chain.
  if (op.deadline * 1000n < expiration) {
    refuse(
      'Op deadline has passed or is too close (it must outlast the transaction expiry)',
    );
  }
  let timestamp = BigInt(nowMs);
  if (timestamp >= expiration) timestamp = block.timestamp;
  const raw = buildExecuteTransaction({
    owner: relayer.address,
    target: sponsor,
    config: cfg,
    op,
    signaturesPacked,
    feeLimit: 0n, // omitted: the relayer can never burn TRX for energy
    energyCap: broadcastEnergyCap(energy),
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
  let quoted = await quotedEnergyFor(
    rt,
    vault,
    op.nonce,
    kind,
    callsShapeKey(op.calls),
  );
  if (quoted === null) {
    log.warn(
      `[tronSponsor] ${rt.chain}: no quote on record for ${vault} nonce ${op.nonce} and these calls; re-estimating`,
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
    // Retrying a failed Op reuses its record (unique digest). Keep the
    // evidence of an attempt that failed ON-CHAIN (S paid for it): the
    // per-vault failure limit and the audit trail both need it.
    const prior = (
      Array.isArray(existing.priorFailures) ? existing.priorFailures : []
    ) as Record<string, unknown>[];
    const priorFailures =
      typeof existing.energyUsed === 'number'
        ? [
            ...prior,
            {
              txid: String(existing.txid),
              at: existing.createdAt,
              energyUsed: existing.energyUsed,
              originEnergyUsed: existing.originEnergyUsed ?? null,
              error: existing.error ?? null,
            },
          ].slice(-MAX_PRIOR_FAILURES_KEPT)
        : prior;
    const claimed = await ops.findOneAndUpdate(
      { digest: digestHex, status: 'failed', txid: existing.txid },
      {
        $set: {
          ...record,
          ...(priorFailures.length > 0 ? { priorFailures } : {}),
        },
        $unset: { error: '', confirmedAt: '' },
      },
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
  // The 'broadcast' record now holds the vault's in-flight slot.
  await p.release();

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
  // The circuit breaker learns of a failure from the in-block receipt (~3 s)
  // rather than waiting ~1 min for solidification; the record's status is
  // still decided by the solidified receipt only.
  let seenInBlock = false;
  let failureNoted = false;
  for (let i = 0; i < attempts; i++) {
    await rt.sleep(rt.confirm.intervalMs);
    if (!seenInBlock) {
      try {
        const head = await rt.client.getTransactionInfo(txid);
        if (head !== null) {
          seenInBlock = true;
          if (head.result !== 'SUCCESS') {
            noteOnchainFailure(rt, failureEnergy(head));
            failureNoted = true;
          }
        }
      } catch {
        // the solidified read below decides
      }
    }
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
      if (!failureNoted) noteOnchainFailure(rt, failureEnergy(info));
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
