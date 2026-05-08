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
 *   2. Local file: ~/.config/ssp-relay/paymaster-{chain}.json
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
  return path.join(
    os.homedir(),
    '.config',
    'ssp-relay',
    `paymaster-${chain}.json`,
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
};
