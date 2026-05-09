/**
 * Solana paymaster — signs feePayer slot for SSP multisig sends so users
 * don't need SOL in their leaf keypair (vault PDA is the deposit address).
 *
 * Keypair resolution: env var → ~/.config/solana/ssp-paymaster-{slot}.json
 * → (devnet only) auto-generate. See README for setup.
 */
import config from 'config';
import bs58 from 'bs58';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import log from '../lib/log';

// Auto-top-up the leaf keypair when low — the program forces payer=creator
// and creator must be a multisig member, so the leaf needs SOL for rent.
const LEAF_TOP_UP_THRESHOLD_LAMPORTS = 10_000_000;
const LEAF_TOP_UP_AMOUNT_LAMPORTS = 50_000_000;

// Reimbursement fees the wallet pays via vault → paymaster transfer inside
// the multisig proposal. Wallets fetch via GET /v1/sol/paymaster.
// minReimbursementLamports is the floor enforced by validateReimbursement.
export const FEE_SCHEDULE = {
  subsequentSendLamports: 100_000,
  firstSendLamports: 2_600_000, // adds multisig PDA rent (~2.4M, permanent)
  splFeeBumpLamports: 2_500_000, // recipient ATA rent if creating
  minReimbursementLamports: 50_000,
} as const;

export type FeeSchedule = typeof FEE_SCHEDULE;

interface SolanaChainConfig {
  rpc: string;
}

interface PaymasterInfo {
  pubkey: PublicKey;
  keypair: Keypair;
  connection: Connection;
}

const paymasters: Record<string, PaymasterInfo | null> = {};

// Exported for unit testing — parses either base58 or JSON-array-form
// secret keys produced by `solana-keygen new`.
export function decodeSecretKey(input: string): Uint8Array {
  if (!input) {
    throw new Error('Paymaster secret key is empty');
  }
  // Accept either base58-encoded 64-byte secret OR JSON byte array (the
  // form `solana-keygen new` produces).
  const trimmed = input.trim();
  if (trimmed.startsWith('[')) {
    const arr = JSON.parse(trimmed) as number[];
    if (!Array.isArray(arr) || arr.length !== 64) {
      throw new Error('Paymaster JSON keypair must be a 64-byte array');
    }
    return Uint8Array.from(arr);
  }
  const bytes = bs58.decode(trimmed);
  if (bytes.length !== 64) {
    throw new Error(
      `Paymaster base58 key must decode to 64 bytes (got ${bytes.length})`,
    );
  }
  return bytes;
}

function chainSlot(chain: string): 'devnet' | 'mainnet' {
  if (chain === 'solDevnet') return 'devnet';
  if (chain === 'solMainnet') return 'mainnet';
  throw new Error(`Unsupported Solana chain: ${chain}`);
}

function envVarFor(chain: string): string {
  return `SSP_SOLANA_${chainSlot(chain).toUpperCase()}_PAYMASTER_KEY`;
}

function keypairPathFor(chain: string): string {
  // Use the canonical Solana CLI config dir so operators can manage the
  // keypair with `solana-keygen` / `solana config` etc.
  return path.join(
    os.homedir(),
    '.config',
    'solana',
    `ssp-paymaster-${chainSlot(chain)}.json`,
  );
}

interface ResolveResult {
  keypair: Keypair;
  source: 'env' | 'file' | 'generated';
}

// Mainnet returns null when unconfigured — auto-gen is devnet-only since
// mainnet must always be a deliberate operator action.
export function resolveKeypair(chain: string): ResolveResult | null {
  const envKey = process.env[envVarFor(chain)];
  if (envKey && envKey.length > 0) {
    return {
      keypair: Keypair.fromSecretKey(decodeSecretKey(envKey)),
      source: 'env',
    };
  }

  const filePath = keypairPathFor(chain);
  if (fs.existsSync(filePath)) {
    const contents = fs.readFileSync(filePath, 'utf8');
    return {
      keypair: Keypair.fromSecretKey(decodeSecretKey(contents)),
      source: 'file',
    };
  }

  // Auto-generate for devnet only. Mainnet must always be explicit.
  if (chain === 'solDevnet') {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const keypair = Keypair.generate();
    fs.writeFileSync(filePath, JSON.stringify(Array.from(keypair.secretKey)), {
      mode: 0o600,
    });
    return { keypair, source: 'generated' };
  }

  return null;
}

function getPaymaster(chain: string): PaymasterInfo {
  if (paymasters[chain]) {
    return paymasters[chain]!;
  }
  const slotKey = chainSlot(chain);
  const chainCfg = config.get<SolanaChainConfig>(`solana.${slotKey}`);

  const resolved = resolveKeypair(chain);
  if (!resolved) {
    throw new Error(
      `Solana paymaster not configured for ${chain} — set ${envVarFor(chain)} or place a keypair at ${keypairPathFor(chain)}`,
    );
  }
  const connection = new Connection(chainCfg.rpc, 'confirmed');
  const info: PaymasterInfo = {
    pubkey: resolved.keypair.publicKey,
    keypair: resolved.keypair,
    connection,
  };
  paymasters[chain] = info;
  log.info(
    `[solPaymaster] loaded ${chain} paymaster ${resolved.keypair.publicKey.toBase58()} (source: ${resolved.source})`,
  );
  return info;
}

/** Returns the configured paymaster public key for a chain. */
function getPaymasterPubkey(chain: string): string {
  return getPaymaster(chain).pubkey.toBase58();
}

/** Returns the fee schedule (lamports) for wallets to compute reimbursement. */
function getFeeSchedule(): FeeSchedule {
  return FEE_SCHEDULE;
}

// Anchor discriminator for the multisig program's create_transaction ix.
const CREATE_TRANSACTION_DISCRIMINATOR: Buffer = createHash('sha256')
  .update('global:create_transaction')
  .digest()
  .subarray(0, 8);

const SYSTEM_PROGRAM_ID = new PublicKey('11111111111111111111111111111111');

/**
 * Walks the outer tx for a `create_transaction` ix, borsh-decodes the
 * inline proposal message, and confirms it has a SystemProgram.transfer
 * to `paymasterPubkey` totaling at least `minLamports`. Throws otherwise.
 */
export function validateReimbursement(
  tx: Transaction,
  paymasterPubkey: PublicKey,
  minLamports: number,
): void {
  const createIx = tx.instructions.find(
    (ix) =>
      ix.data.length >= 8 &&
      ix.data.subarray(0, 8).equals(CREATE_TRANSACTION_DISCRIMINATOR),
  );
  if (!createIx) {
    throw new Error(
      'Tx does not contain a create_transaction instruction — paymaster only signs SSP multisig txs',
    );
  }

  // Borsh layout after the 8-byte discriminator: u8 vault_index, then
  // TransactionMessage = 3×u8 header + Vec<Pubkey> + Vec<CompiledInstruction>
  // + Vec<AddressTableLookup>.
  const data = createIx.data;
  let off = 8 + 1 + 3;

  const accountKeysLen = data.readUInt32LE(off);
  off += 4;
  const accountKeys: PublicKey[] = [];
  for (let i = 0; i < accountKeysLen; i++) {
    accountKeys.push(new PublicKey(data.subarray(off, off + 32)));
    off += 32;
  }

  const ixCount = data.readUInt32LE(off);
  off += 4;

  let totalToPaymaster = 0;
  for (let i = 0; i < ixCount; i++) {
    const programIdIdx = data.readUInt8(off);
    off += 1;
    const accountIdxLen = data.readUInt32LE(off);
    off += 4;
    const accountIdxs = data.subarray(off, off + accountIdxLen);
    off += accountIdxLen;
    const ixDataLen = data.readUInt32LE(off);
    off += 4;
    const ixData = data.subarray(off, off + ixDataLen);
    off += ixDataLen;

    const ixProgram = accountKeys[programIdIdx];
    if (!ixProgram || !ixProgram.equals(SYSTEM_PROGRAM_ID)) continue;
    if (ixData.length < 12 || ixData.readUInt32LE(0) !== 2) continue; // not Transfer
    if (accountIdxs.length < 2) continue;
    const toPubkey = accountKeys[accountIdxs[1]];
    if (!toPubkey || !toPubkey.equals(paymasterPubkey)) continue;

    const lamportsBig = ixData.readBigUInt64LE(4);
    const lamports =
      lamportsBig > BigInt(Number.MAX_SAFE_INTEGER)
        ? Number.MAX_SAFE_INTEGER
        : Number(lamportsBig);
    totalToPaymaster += lamports;
  }

  if (totalToPaymaster < minLamports) {
    throw new Error(
      `Tx must reimburse paymaster at least ${minLamports} lamports inside the proposal (got ${totalToPaymaster})`,
    );
  }
}

async function broadcastWithPaymaster(
  chain: string,
  serializedTxBase64: string,
): Promise<string> {
  const info = getPaymaster(chain);
  const txBytes = Buffer.from(serializedTxBase64, 'base64');
  const tx = Transaction.from(txBytes);

  if (!tx.feePayer || !tx.feePayer.equals(info.pubkey)) {
    throw new Error(
      `Tx feePayer (${tx.feePayer?.toBase58() ?? 'unset'}) does not match paymaster (${info.pubkey.toBase58()})`,
    );
  }

  validateReimbursement(tx, info.pubkey, FEE_SCHEDULE.minReimbursementLamports);

  // Top up any non-paymaster signer that's below threshold so the proposal
  // creator has rent to pay. Cycles back via close_transaction in steady state.
  const signerPubkeys = new Set<string>();
  for (const sig of tx.signatures) {
    const pk = sig.publicKey.toBase58();
    if (pk !== info.pubkey.toBase58()) {
      signerPubkeys.add(pk);
    }
  }
  for (const pk of signerPubkeys) {
    const target = new PublicKey(pk);
    const balance = await info.connection.getBalance(target);
    if (balance < LEAF_TOP_UP_THRESHOLD_LAMPORTS) {
      log.info(
        `[solPaymaster] top-up ${pk} (balance ${balance} < ${LEAF_TOP_UP_THRESHOLD_LAMPORTS})`,
      );
      const fundTx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: info.pubkey,
          toPubkey: target,
          lamports: LEAF_TOP_UP_AMOUNT_LAMPORTS,
        }),
      );
      await sendAndConfirmTransaction(info.connection, fundTx, [info.keypair], {
        commitment: 'confirmed',
      });
    }
  }

  tx.partialSign(info.keypair);

  const signature = await info.connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  await info.connection.confirmTransaction(signature, 'confirmed');
  log.info(`[solPaymaster] broadcast ${chain} tx ${signature}`);
  return signature;
}

// Startup banner: prints paymaster pubkey + balance per chain, or a loud
// warning if unconfigured / freshly generated.
export async function logPaymasterStatus(): Promise<void> {
  for (const chain of ['solDevnet', 'solMainnet']) {
    const slotKey = chainSlot(chain);
    let chainCfg: SolanaChainConfig;
    try {
      chainCfg = config.get<SolanaChainConfig>(`solana.${slotKey}`);
    } catch {
      log.warn(`[solPaymaster] ${chain}: no rpc configured, skipping`);
      continue;
    }
    const resolved = resolveKeypair(chain);
    if (!resolved) {
      log.warn(
        `[solPaymaster] ${chain}: NOT CONFIGURED — set ${envVarFor(chain)} env var or place a keypair at ${keypairPathFor(chain)}. Solana ${chain} paymaster endpoint will return errors until configured.`,
      );
      continue;
    }
    const pubkey = resolved.keypair.publicKey;
    const connection = new Connection(chainCfg.rpc, 'confirmed');
    let balanceSol = '?';
    try {
      const balance = await connection.getBalance(pubkey);
      balanceSol = (balance / 1e9).toFixed(4);
    } catch (e) {
      log.warn(
        `[solPaymaster] ${chain}: could not fetch balance (${(e as Error).message})`,
      );
    }
    if (resolved.source === 'generated') {
      log.warn(
        `[solPaymaster] ${chain}: generated new keypair at ${keypairPathFor(chain)} — fund ${pubkey.toBase58()} with ~5 SOL via https://faucet.solana.com before sending`,
      );
    } else {
      log.info(
        `[solPaymaster] ${chain} ready, paymaster=${pubkey.toBase58()} balance=${balanceSol} SOL (source: ${resolved.source})`,
      );
    }
  }
}

export default {
  getPaymasterPubkey,
  broadcastWithPaymaster,
  getFeeSchedule,
};
