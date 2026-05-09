/**
 * Solana paymaster service.
 *
 * SSP users hold their funds in a multisig vault PDA, but Solana txs
 * require a feePayer keypair (PDAs can't sign). Without a paymaster, users
 * would need to keep SOL in their leaf Ed25519 keypair address — bad UX
 * since the visible deposit address (vault) is different from the leaf.
 *
 * This service holds per-chain paymaster keypairs that sign tx feePayer
 * slots on behalf of users. The relay validates the inbound tx (signed by
 * both wallet+key members) and adds the paymaster's feePayer signature
 * before broadcasting.
 *
 * Cost model:
 *   First send (init+create+approve+approve+execute): ~0.01 SOL per user
 *     - Most goes to multisig PDA + proposal PDA rent (recoverable)
 *   Subsequent sends: ~0.007 SOL per send (proposal rent)
 *
 * Per-user rate limiting + fee budget tracking left for follow-up.
 *
 * Keypair resolution (per chain), tried in order:
 *   1. Env var: SSP_SOLANA_DEVNET_PAYMASTER_KEY / SSP_SOLANA_MAINNET_PAYMASTER_KEY
 *   2. Local file: ~/.config/solana/ssp-paymaster-{devnet|mainnet}.json
 *      (canonical Solana CLI keypair location — same place `solana-keygen
 *      new` writes by default, so operators can use familiar tooling)
 *   3. (devnet only) auto-generate a fresh keypair, persist to (2)
 *   4. (mainnet) leave unconfigured — endpoint will return errors
 */
import config from 'config';
import bs58 from 'bs58';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import log from '../lib/log';

// Wallet's leaf must hold ~0.007 SOL to cover proposal PDA rent for a
// multisig send (program design forces `payer = creator`, where creator
// must be a multisig member). When relay broadcasts a user's tx, it
// auto-tops-up the creator from paymaster if low.
const LEAF_TOP_UP_THRESHOLD_LAMPORTS = 10_000_000; // 0.01 SOL
const LEAF_TOP_UP_AMOUNT_LAMPORTS = 50_000_000; // 0.05 SOL — covers ~7 sends

// ============================================================================
// Reimbursement fee schedule
// ============================================================================
// Every Solana broadcast must include a SystemProgram.transfer from the
// vault PDA to the paymaster INSIDE the multisig proposal's executed
// instructions. The paymaster signs feePayer for free in exchange. This
// keeps the paymaster's balance flat-or-positive over time and protects
// against abuse — the validator below rejects any tx without a sufficient
// reimbursement.
//
// As of the program upgrade that added `close_transaction`, the wallet
// also bundles a close instruction in the same outer tx as execute, which
// refunds proposal rent (~0.007 SOL) to the creator (the leaf). That
// dropped per-send fees by ~75× since the rent now cycles instead of being
// permanently locked on-chain.
//
// Fee components covered:
//   - Network tx fee:               ~15,000 lamports (3 sigs × 5,000) [non-recoverable]
//   - Markup (positive accrual):    ~85,000 lamports (~0.000085 SOL margin per send)
//   - First send adds:              ~2,500,000 (multisig PDA rent — never recovered)
//   - SPL adds:                     ~2,500,000 (recipient ATA rent if creating)
//
// Wallets compute the same numbers when constructing txs (fetched via
// `GET /v1/sol/paymaster?chain=...`). MIN_REIMBURSEMENT_LAMPORTS is the
// floor enforced by validateReimbursement().
export const FEE_SCHEDULE = {
  /** Per-send base reimbursement (subsequent sends, native SOL).
   *  ~0.0001 SOL — covers tx fee + small markup since rent cycles via close_transaction. */
  subsequentSendLamports: 100_000, // 0.0001 SOL
  /** Atomic first send (init+create+approve×2+execute+close), native SOL.
   *  Adds multisig PDA rent (~2.4M) which stays permanently on-chain
   *  (no close_multisig ix yet). */
  firstSendLamports: 2_600_000, // 0.0026 SOL
  /** Additional bump for SPL token transfers (covers recipient ATA rent
   *  when creating a new ATA — overcharges slightly when ATA already
   *  exists, in exchange for simpler logic and no info leak about
   *  recipient's token holdings). */
  splFeeBumpLamports: 2_500_000, // 0.0025 SOL
  /** Floor enforced by validateReimbursement. Slightly under the
   *  subsequent-send fee to allow client-side rounding drift. */
  minReimbursementLamports: 50_000, // 0.00005 SOL
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

/**
 * Resolves a Solana paymaster keypair for the given chain. Tries env var,
 * then a local file, then (devnet only) auto-generates and persists.
 * Returns null for mainnet if nothing is configured (the operator must
 * deliberately set up mainnet — never auto-gen).
 */
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

// ============================================================================
// Reimbursement validation
// ============================================================================

/**
 * Anchor instruction discriminator: sha256("global:create_transaction")[:8].
 * Computed at module load — the multisig program's `create_transaction` ix
 * always begins its instruction data with these 8 bytes. Wallets that
 * construct a Solana tx via the SDK's `buildCreateTransactionInstruction`
 * always include this prefix.
 */
const CREATE_TRANSACTION_DISCRIMINATOR: Buffer = (() => {
  // Lazy require to avoid pulling crypto at import time.

  const { createHash } = require('crypto') as typeof import('crypto');
  return createHash('sha256')
    .update('global:create_transaction')
    .digest()
    .subarray(0, 8);
})();

/** SystemProgram pubkey, used to identify transfer ixs in the proposal. */
const SYSTEM_PROGRAM_ID = new PublicKey('11111111111111111111111111111111');

/**
 * Walks the outer tx's instructions, finds the `create_transaction` ix
 * (which carries the proposal's TransactionMessage inline as ix data),
 * decodes the message, and verifies it includes a SystemProgram.transfer
 * to `paymasterPubkey` totaling at least `minLamports`.
 *
 * Throws on any failure mode: missing create_transaction ix, malformed
 * proposal data, or insufficient reimbursement. The caller (broadcastWithPaymaster)
 * surfaces the error to the client.
 */
export function validateReimbursement(
  tx: Transaction,
  paymasterPubkey: PublicKey,
  minLamports: number,
): void {
  // Find the create_transaction ix in the outer tx. Every SSP-built Solana
  // tx (consumer or enterprise, first or subsequent send) includes one.
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

  // Decode borsh-encoded args after the discriminator:
  //   1 byte: vault_index (u8)
  //   TransactionMessage:
  //     u8 num_signers
  //     u8 num_writable_signers
  //     u8 num_writable_non_signers
  //     Vec<Pubkey> account_keys = u32 LE length + N×32
  //     Vec<CompiledInstruction> instructions = u32 LE length +
  //       per ix: u8 program_id_index + Vec<u8> account_indexes (u32 + N) + Vec<u8> data (u32 + N)
  //     Vec<MessageAddressTableLookup> address_table_lookups = u32 LE length + per: 32 + Vec<u8> + Vec<u8>
  const data = createIx.data;
  let off = 8 + 1; // skip discriminator + vault_index

  // Header: 3 × u8
  off += 3;

  // account_keys
  const accountKeysLen = data.readUInt32LE(off);
  off += 4;
  const accountKeys: PublicKey[] = [];
  for (let i = 0; i < accountKeysLen; i++) {
    accountKeys.push(new PublicKey(data.subarray(off, off + 32)));
    off += 32;
  }

  // instructions
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

    // Is this a SystemProgram instruction?
    const ixProgram = accountKeys[programIdIdx];
    if (!ixProgram || !ixProgram.equals(SYSTEM_PROGRAM_ID)) continue;

    // SystemInstruction tag is u32 LE at offset 0:
    //   2 = Transfer, with payload [u64 lamports]
    if (ixData.length < 4) continue;
    const tag = ixData.readUInt32LE(0);
    if (tag !== 2) continue; // not Transfer
    if (ixData.length < 12) continue;

    // accountIndexes for Transfer: [from, to]
    if (accountIdxs.length < 2) continue;
    const toIdx = accountIdxs[1];
    const toPubkey = accountKeys[toIdx];
    if (!toPubkey || !toPubkey.equals(paymasterPubkey)) continue;

    // Read u64 lamports as bigint (proposal can specify > 2^53 in theory,
    // but practically all amounts fit in safe integer range — clamp to MAX
    // for the comparison below).
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

/**
 * Add the paymaster's feePayer signature to a partially-signed tx and
 * broadcast it. Auto-tops-up the user's leaf keypair from paymaster if
 * needed (SSP Solana Multisig program forces `payer = creator` for the
 * proposal PDA, where creator must be a member, so the wallet's leaf
 * keypair must hold a small SOL balance for proposal rent — paymaster
 * funds it transparently).
 *
 * `serializedTxBase64` should be a Solana Transaction with:
 *   - feePayer = paymaster pubkey
 *   - all member-level partial signatures in place (wallet+key)
 *   - paymaster's signer slot still unsigned
 *
 * Returns the broadcast tx signature.
 */
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

  // Anti-abuse: require the proposal to reimburse the paymaster. Validates
  // the create_transaction ix's inline TransactionMessage for a
  // SystemProgram.transfer to paymaster of >= MIN_REIMBURSEMENT_LAMPORTS.
  validateReimbursement(tx, info.pubkey, FEE_SCHEDULE.minReimbursementLamports);

  // Auto-fund member signers (wallet leaf + key leaf) so they can pay any
  // creator/payer rent the multisig program forces them to cover. Find all
  // Signer pubkeys in the tx other than the paymaster and top up each one
  // that's below threshold. The amount is small (covers ~7 sends per fund)
  // and acts as a transparent fee sponsorship.
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

/**
 * Startup banner: for each Solana chain, print the configured paymaster
 * pubkey + balance, OR a loud notice if it's unconfigured (mainnet) or
 * was just generated (devnet) and needs funding.
 */
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
