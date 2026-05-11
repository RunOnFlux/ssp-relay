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
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  SolanaMultisigClient,
  deriveNonceAccount,
} from '@runonflux/solana-multisig';
import log from '../lib/log';

// Reimbursement fees the wallet pays via vault → paymaster transfer inside
// the multisig proposal. Wallets fetch via GET /v1/sol/paymaster.
// minReimbursementLamports is the floor enforced by validateReimbursement.
//
// First-send rent (consumer 2-of-2):
//   multisig PDA      86 bytes → ~0.00149 SOL   (permanent — never refunded)
//   durable nonce account  80 bytes → ~0.00145 SOL   (permanent — recoverable
//                                                     only on vault offboarding
//                                                     via SystemProgram::nonceWithdraw)
//   network fee   ~3 sigs  → ~0.000015 SOL
//   proposal rent          → refunded via close_transaction (net 0)
//   total cost            ≈ 0.00295 SOL = ~3.0M lamports
//   firstSendLamports     = 3.2M  → ~200K lamport surplus per first send
//
// Subsequent send: 5K network fee, paymaster collects 100K → ~95K surplus.
// SPL with new ATA: + 2.04M ATA rent, paymaster collects extra 2.5M → ~460K surplus.
export const FEE_SCHEDULE = {
  subsequentSendLamports: 100_000,
  firstSendLamports: 3_200_000, // multisig PDA rent + nonce account rent + network + small bump
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

/**
 * Hard-coded SSP Solana Multisig program ID. Same address on devnet AND
 * mainnet (will be deployed under separate authority on mainnet).
 *
 * Hard-coded (not config) because there's only ever one canonical program
 * per chain — the wallet/key apps embed the same constant.
 */
const SOL_MULTISIG_PROGRAM_ID = new PublicKey(
  'CisPSFTQoTnEqn5cUi1pgpfPp2xiTVRkK7eD5jBevxdX',
);

/**
 * One-shot pre-setup for a new SSP Solana vault: initializes the multisig
 * AND provisions its durable nonce account, in a single paymaster-signed
 * tx. After this lands, the wallet can immediately build durable-nonce send
 * txes — every subsequent send is blockhash-race-immune.
 *
 * Called via `POST /v1/sol/setup` before the user's first send. The wallet
 * detects "multisig and/or nonce missing" via `getAccountInfo` and posts
 * here; the relay paymaster handles setup atomically and synchronously.
 *
 * Recovery accounting:
 *   - Multisig PDA rent (~1.5M lamports): permanent, never refundable.
 *   - Nonce account rent (~1.44M lamports): refundable via
 *     `SystemProgram.nonceWithdraw` if user later offboards.
 *   - First user send reimburses paymaster via vault → paymaster transfer
 *     inside the proposal message (firstSendLamports = 3.2M covers both
 *     rents + network + small surplus).
 *
 * Anti-grief: this function validates the vault has SOL balance ≥
 * firstSendLamports + buffer before provisioning. Without that, an attacker
 * could spin up endless fake `(walletPub, keyPub)` pairs and bleed paymaster
 * SOL. Combined with `requireWkIdentityAuth` on the endpoint, griefing
 * requires (a) being an authenticated SSP user and (b) parking ≥3.2M
 * lamports per spawned vault — net-negative for the attacker.
 *
 * Idempotent: if multisig + nonce already exist on-chain, returns the
 * current state without sending any tx (handy for wallet retries).
 */
async function setupSolMultisig(opts: {
  chain: string;
  walletPubkey: string;
  keyPubkey: string;
}): Promise<{
  signature: string | null;
  multisigAddress: string;
  vaultAddress: string;
  nonceAccount: string;
  nonceValue: string;
  alreadyProvisioned: boolean;
}> {
  const info = getPaymaster(opts.chain);
  const walletPubkey = new PublicKey(opts.walletPubkey);
  const keyPubkey = new PublicKey(opts.keyPubkey);
  const members = [walletPubkey, keyPubkey];
  const threshold = 2;

  const client = new SolanaMultisigClient(
    info.connection,
    SOL_MULTISIG_PROGRAM_ID,
  );

  const multisigAddress = client.deriveAddress(members, threshold);
  const vaultAddress = client.deriveVaultAddress(multisigAddress, 0);
  const nonceAccount = await deriveNonceAccount(multisigAddress);

  // Idempotency check: if both multisig + nonce already exist, return
  // current state immediately. Wallet treats this as success and proceeds
  // with the actual send.
  const [existingMultisig, existingNonceAccountInfo] = await Promise.all([
    client.getMultisig(multisigAddress),
    info.connection.getAccountInfo(nonceAccount),
  ]);
  if (existingMultisig && existingNonceAccountInfo) {
    const nonceState = await info.connection.getNonceAndContext(nonceAccount);
    if (!nonceState.value) {
      throw new Error(
        `nonce ${nonceAccount.toBase58()} exists but is uninitialized — corrupt state`,
      );
    }
    return {
      signature: null,
      multisigAddress: multisigAddress.toBase58(),
      vaultAddress: vaultAddress.toBase58(),
      nonceAccount: nonceAccount.toBase58(),
      nonceValue: nonceState.value.nonce,
      alreadyProvisioned: true,
    };
  }

  // Balance gate: refuse to provision if the vault can't reimburse the
  // paymaster on its first send. This prevents the "drain paymaster by
  // spamming setup on never-funded vaults" attack.
  const vaultBalance = await info.connection.getBalance(vaultAddress);
  const minVaultBalance = FEE_SCHEDULE.firstSendLamports + 50_000; // buffer for tx fees
  if (vaultBalance < minVaultBalance) {
    throw new Error(
      `Vault ${vaultAddress.toBase58()} balance ${vaultBalance} lamports is below the required minimum ${minVaultBalance} for setup (firstSendLamports + buffer). Fund the vault before calling setup.`,
    );
  }

  // Build the bundled setup ixs. Order is order-dependent: init must come
  // before provision because provision_nonce reads multisig.members for
  // the invoke_signed seed derivation.
  const setupIxs: TransactionInstruction[] = [];
  if (!existingMultisig) {
    const sortedMembers = members
      .slice()
      .sort((a, b) => Buffer.compare(a.toBuffer(), b.toBuffer()));
    const { instruction: initIx } =
      await client.buildInitializeMultisigInstruction({
        members: sortedMembers,
        threshold,
        payer: info.pubkey,
      });
    setupIxs.push(initIx);
  }
  if (!existingNonceAccountInfo) {
    const { instruction: provisionIx } =
      await client.buildProvisionNonceInstruction({
        multisigAddress,
        payer: info.pubkey,
      });
    setupIxs.push(provisionIx);
  }

  // Legacy tx is fine here — 2 ixs, ~6 unique accounts, well under 1232 bytes.
  const tx = new Transaction().add(...setupIxs);
  const { blockhash } = await info.connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = info.pubkey;
  tx.partialSign(info.keypair);

  const signature = await info.connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  await info.connection.confirmTransaction(signature, 'confirmed');

  // Re-fetch nonce so the caller gets the live nonce value to use as
  // `recentBlockhash` in their next bundled send tx.
  const nonceState = await info.connection.getNonceAndContext(nonceAccount);
  if (!nonceState.value) {
    throw new Error(
      `nonce ${nonceAccount.toBase58()} did not initialize after setup tx`,
    );
  }

  log.info(
    `[solPaymaster] setup ${opts.chain} multisig=${multisigAddress.toBase58()} nonce=${nonceAccount.toBase58()} sig=${signature}`,
  );

  return {
    signature,
    multisigAddress: multisigAddress.toBase58(),
    vaultAddress: vaultAddress.toBase58(),
    nonceAccount: nonceAccount.toBase58(),
    nonceValue: nonceState.value.nonce,
    alreadyProvisioned: false,
  };
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
  setupSolMultisig,
  getFeeSchedule,
};
