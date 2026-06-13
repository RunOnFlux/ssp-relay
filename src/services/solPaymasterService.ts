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
  NONCE_ACCOUNT_LENGTH,
  PublicKey,
  SendTransactionError,
  SystemProgram,
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
  // Per-tx surcharge for split-approval proposals. The paymaster fronts
  // ~5000 lamports network fee on every member-signed split tx (creator +
  // each approval) plus the execute tx. The creator tx's inner reimbursement
  // transfer must cover splitPerTxLamports × (M_signerTxs + 1) on top of the
  // base floor so abandoned/multi-signer split proposals don't bleed the
  // paymaster. Validated in validateSplitCreateReimbursement (§5).
  splitPerTxLamports: 10_000,
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

/**
 * Probe whether an Associated Token Account already exists on-chain.
 * Enterprise fee estimation uses this to decide whether to add the
 * splFeeBumpLamports surcharge — when the ATA exists, the bundled
 * create-ATA-idempotent ix is a no-op and the paymaster pays no rent.
 *
 * Returns false on any RPC error so the caller falls back to charging
 * the bump defensively.
 */
async function checkAtaExists(
  chain: string,
  ataPubkeyBase58: string,
): Promise<boolean> {
  try {
    const info = getPaymaster(chain);
    const ata = new PublicKey(ataPubkeyBase58);
    const account = await info.connection.getAccountInfo(ata);
    return account !== null;
  } catch {
    return false;
  }
}

// Anchor discriminators are sha256("global:<ix_name>")[..8]. NOTE: a
// discriminator alone is NOT a sufficient allowlist key — it is forgeable by
// any program that defines an instruction with the same name. The split-flow
// validator below ALWAYS pairs the discriminator with the owning programId
// (see assertSplitInstructionAllowed). Do NOT reuse the discriminator-only
// matcher pattern from validateReimbursement for trust decisions.
function anchorDiscriminator(ixName: string): Buffer {
  return createHash('sha256')
    .update(`global:${ixName}`)
    .digest()
    .subarray(0, 8);
}

// Anchor discriminator for the multisig program's create_transaction ix.
const CREATE_TRANSACTION_DISCRIMINATOR: Buffer =
  anchorDiscriminator('create_transaction');
const APPROVE_TRANSACTION_DISCRIMINATOR: Buffer = anchorDiscriminator(
  'approve_transaction',
);
const EXECUTE_TRANSACTION_DISCRIMINATOR: Buffer = anchorDiscriminator(
  'execute_transaction',
);
const CLOSE_TRANSACTION_DISCRIMINATOR: Buffer =
  anchorDiscriminator('close_transaction');

const SYSTEM_PROGRAM_ID = new PublicKey('11111111111111111111111111111111');

// Associated Token Account program — same address on devnet + mainnet. The
// split execute tx may carry an idempotent ATA-create ix for SPL recipients.
const ATA_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);

// Associated Token Account program instructions are NOT Anchor-discriminated;
// they use a single-byte tag. createIdempotent = tag 1 (create = tag 0).
const ATA_CREATE_IDEMPOTENT_TAG = 1;

// SystemProgram::AdvanceNonceAccount tag (durable-nonce advance, ix[0] of
// every member-signed split tx).
const SYSTEM_ADVANCE_NONCE_TAG = 4;

// SPL Token Program (legacy) — same on devnet + mainnet.
const SPL_TOKEN_PROGRAM_ID = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
);

export interface ReimbursementInspection {
  totalToPaymaster: number;
  // Set when the inner proposal contains an SPL Transfer (tag 3) or
  // TransferChecked (tag 12). Caller can query getAccountInfo(destAta) to
  // decide whether the splFeeBumpLamports floor applies — if the ATA
  // doesn't exist on-chain, the paymaster will pay ~2.04M lamports in rent
  // to create it (the create-idempotent ix sits on the outer tx with the
  // paymaster as payer), and the wallet must reimburse that bump.
  splDestAta?: PublicKey;
}

/**
 * Walks the outer tx for a `create_transaction` ix, borsh-decodes the
 * inline proposal message, and confirms it has a SystemProgram.transfer
 * to `paymasterPubkey` totaling at least `minLamports`. Throws otherwise.
 *
 * Also enforces that the OUTER tx contains no rogue SystemProgram.transfer
 * ixs that drain the paymaster. The paymaster signs the outer tx so any
 * top-level transfer FROM paymaster would be implicitly authorized — a
 * user could otherwise submit a tx like `[create_transaction(legit
 * reimbursement), SystemProgram.transfer(paymaster → attacker)]` that
 * passes inner-message validation but drains paymaster funds. Legitimate
 * proposal bundles only contain nonceAdvance + multisig-program ixs at
 * the outer level — never raw SystemProgram.transfer.
 *
 * Returns inspection metadata (totalToPaymaster + any SPL destAta found
 * in the inner proposal) so callers can run additional async checks like
 * `enforceSplAtaFloor`.
 */
export function validateReimbursement(
  tx: Transaction,
  paymasterPubkey: PublicKey,
  minLamports: number,
): ReimbursementInspection {
  // SystemProgram outer-ix allowlist. Legitimate proposal bundles only need
  // one SystemProgram ix at the outer level: AdvanceNonceAccount (tag 4).
  // Anything else risks draining the paymaster since the paymaster signs
  // the entire outer tx — e.g. Transfer (tag 2) or TransferWithSeed (tag 11)
  // would let a malicious caller move paymaster SOL anywhere. Reject all
  // SystemProgram tags except AdvanceNonceAccount.
  for (const ix of tx.instructions) {
    if (!ix.programId.equals(SYSTEM_PROGRAM_ID)) continue;
    if (ix.data.length < 4) {
      throw new Error(
        'Outer tx contains a malformed SystemProgram ix (data < 4 bytes)',
      );
    }
    const tag = ix.data.readUInt32LE(0);
    if (tag !== SYSTEM_ADVANCE_NONCE_TAG) {
      throw new Error(
        `Outer tx contains a non-allowlisted SystemProgram ix (tag ${tag}) — paymaster only signs proposal bundles that use SystemProgram for AdvanceNonceAccount only`,
      );
    }
  }

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
  let splDestAta: PublicKey | undefined;
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
    if (!ixProgram) continue;

    if (ixProgram.equals(SYSTEM_PROGRAM_ID)) {
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
      continue;
    }

    if (ixProgram.equals(SPL_TOKEN_PROGRAM_ID)) {
      // SPL Transfer (tag 3) or TransferChecked (tag 12).
      // accountIdxs layout: [source_ata, dest_ata, authority, ...].
      if (ixData.length < 1) continue;
      const tag = ixData.readUInt8(0);
      if (tag !== 3 && tag !== 12) continue;
      if (accountIdxs.length < 2) continue;
      const destAta = accountKeys[accountIdxs[1]];
      if (destAta) splDestAta = destAta;
      continue;
    }
  }

  if (totalToPaymaster < minLamports) {
    throw new Error(
      `Tx must reimburse paymaster at least ${minLamports} lamports inside the proposal (got ${totalToPaymaster})`,
    );
  }

  return { totalToPaymaster, splDestAta };
}

/**
 * Verify the reimbursement floor is high enough to cover the paymaster's
 * outlay for SPL transfers that create a new recipient ATA. The wallet
 * may legitimately skip the splFeeBumpLamports surcharge when it has
 * pre-checked that the destination ATA already exists (the create-ATA
 * ix is idempotent — no rent paid). We re-verify on-chain at broadcast
 * time so a malicious wallet can't claim "ATA exists" and stick the
 * paymaster with ~2.04M lamports of unreimbursed rent.
 *
 * Floor model: base reimbursement minimum + splFeeBumpLamports when the
 * recipient ATA is missing. We don't try to detect first-vs-subsequent
 * here — the wallet over-pays firstSendLamports voluntarily; the floor
 * just guards against under-payment of the ATA rent component.
 */
export async function enforceSplAtaFloor(
  inspection: ReimbursementInspection,
  connection: Connection,
  feeSchedule: FeeSchedule,
): Promise<void> {
  if (!inspection.splDestAta) return;
  const ataInfo = await connection.getAccountInfo(inspection.splDestAta);
  if (ataInfo !== null) return; // ATA exists — idempotent create is a no-op
  const requiredMin =
    feeSchedule.minReimbursementLamports + feeSchedule.splFeeBumpLamports;
  if (inspection.totalToPaymaster < requiredMin) {
    throw new Error(
      `SPL transfer to non-existent ATA ${inspection.splDestAta.toBase58()} requires at least ${requiredMin} lamports of paymaster reimbursement to cover ATA rent (got ${inspection.totalToPaymaster})`,
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
  // Check tx didn't just confirm-but-fail on-chain (e.g., concurrent setup
  // race lands first → our duplicate fails). Confirmation alone doesn't
  // imply execution success.
  const confirmResult = await info.connection.confirmTransaction(
    signature,
    'confirmed',
  );
  if (confirmResult.value.err) {
    throw new Error(
      `Consumer setup tx ${signature} landed but failed on-chain: ${JSON.stringify(confirmResult.value.err)}`,
    );
  }

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

  const inspection = validateReimbursement(
    tx,
    info.pubkey,
    FEE_SCHEDULE.minReimbursementLamports,
  );
  await enforceSplAtaFloor(inspection, info.connection, FEE_SCHEDULE);

  tx.partialSign(info.keypair);

  const signature = await info.connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  // `confirmTransaction` resolves once the tx is included + confirmed by the
  // cluster — but a CONFIRMED tx may still have FAILED in execution (ix
  // returned an error, insufficient funds, etc.). The on-chain SignatureResult
  // surfaces this via `value.err` (non-null = failure). If we don't check it,
  // the enterprise layer marks the proposal as `broadcast` and emails success
  // for a tx that actually didn't move funds.
  const confirmResult = await info.connection.confirmTransaction(
    signature,
    'confirmed',
  );
  if (confirmResult.value.err) {
    throw new Error(
      `Solana tx ${signature} landed but failed on-chain: ${JSON.stringify(confirmResult.value.err)}`,
    );
  }
  log.info(`[solPaymaster] broadcast ${chain} tx ${signature}`);
  return signature;
}

/**
 * Sign + submit a setup-class paymaster tx (initialize_multisig +
 * provision_nonce, or similar one-shot provisioning). Unlike
 * `broadcastWithPaymaster` this does NOT enforce a vault→paymaster
 * reimbursement transfer — setup costs are recovered later on the FIRST
 * send via the proposal's reimbursement transfer. Anti-grief (vault
 * balance gate) is the caller's responsibility; enterprise checks vault
 * balance ≥ firstSendLamports + buffer before invoking this primitive.
 *
 * Trust boundary: enterprise builds the tx with paymaster as feePayer +
 * the on-chain ixs, passes the unsigned blob here; this function adds the
 * paymaster sig and submits. Paymaster private key never leaves the
 * public layer.
 */
async function signAndSubmitSetupTx(
  chain: string,
  serializedTxBase64: string,
): Promise<string> {
  const info = getPaymaster(chain);
  const txBytes = Buffer.from(serializedTxBase64, 'base64');
  const tx = Transaction.from(txBytes);

  if (!tx.feePayer || !tx.feePayer.equals(info.pubkey)) {
    throw new Error(
      `Setup tx feePayer (${tx.feePayer?.toBase58() ?? 'unset'}) does not match paymaster (${info.pubkey.toBase58()})`,
    );
  }

  tx.partialSign(info.keypair);

  const signature = await info.connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  // Setup txs (initialize_multisig + provision_nonce) can fail on-chain if
  // a concurrent call already initialized the multisig, or if the multisig
  // program rejects the config. Surface the on-chain error instead of
  // returning a "success" signature for a failed tx.
  const confirmResult = await info.connection.confirmTransaction(
    signature,
    'confirmed',
  );
  if (confirmResult.value.err) {
    throw new Error(
      `Solana setup tx ${signature} landed but failed on-chain: ${JSON.stringify(confirmResult.value.err)}`,
    );
  }
  log.info(`[solPaymaster] setup-broadcast ${chain} tx ${signature}`);
  return signature;
}

// ============================================================
// Split-approval flow (§4, §5) — Squads-style per-signer on-chain approvals.
// One small paymaster-feePayer tx per SSP signer, plus a paymaster-only
// execute tx, all gated by a POSITIVE per-kind instruction allowlist.
// ============================================================

export type SplitTxKind = 'create' | 'approve' | 'execute';

// An allowed instruction shape for a split tx: the instruction MUST be owned
// by `programId` AND (for Anchor ixs) start with `discriminator`, or (for
// tagged ixs like SystemProgram/ATA) have its first byte equal `tag`. Both the
// programId AND the shape are bound — a foreign program that happens to define
// an instruction with the same Anchor discriminator is rejected because its
// programId does not match. This is the explicit fix for the discriminator-only
// weakness in validateReimbursement (§5).
interface AllowedShape {
  programId: PublicKey;
  // Anchor 8-byte discriminator (multisig program ixs).
  discriminator?: Buffer;
  // Single-byte tag (SystemProgram AdvanceNonceAccount, ATA createIdempotent).
  tag?: number;
  // u32-LE tag at offset 0 (SystemProgram instructions encode their tag as a
  // 4-byte little-endian discriminant, NOT a single byte).
  u32Tag?: number;
}

function matchesShape(
  ix: TransactionInstruction,
  shape: AllowedShape,
): boolean {
  if (!ix.programId.equals(shape.programId)) return false;
  if (shape.discriminator) {
    return (
      ix.data.length >= 8 && ix.data.subarray(0, 8).equals(shape.discriminator)
    );
  }
  if (shape.u32Tag !== undefined) {
    return ix.data.length >= 4 && ix.data.readUInt32LE(0) === shape.u32Tag;
  }
  if (shape.tag !== undefined) {
    return ix.data.length >= 1 && ix.data.readUInt8(0) === shape.tag;
  }
  return false;
}

// Per-kind POSITIVE allowlists. EVERY instruction in the tx must match one of
// the kind's allowed shapes; anything else → reject. The cardinality
// constraints (exactly one create, 1-2 approves, etc.) are enforced in
// validateSplitTxInstructions below.
const SPLIT_NONCE_ADVANCE_SHAPE: AllowedShape = {
  programId: SYSTEM_PROGRAM_ID,
  u32Tag: SYSTEM_ADVANCE_NONCE_TAG,
};
const SPLIT_CREATE_SHAPE: AllowedShape = {
  programId: SOL_MULTISIG_PROGRAM_ID,
  discriminator: CREATE_TRANSACTION_DISCRIMINATOR,
};
const SPLIT_APPROVE_SHAPE: AllowedShape = {
  programId: SOL_MULTISIG_PROGRAM_ID,
  discriminator: APPROVE_TRANSACTION_DISCRIMINATOR,
};
const SPLIT_EXECUTE_SHAPE: AllowedShape = {
  programId: SOL_MULTISIG_PROGRAM_ID,
  discriminator: EXECUTE_TRANSACTION_DISCRIMINATOR,
};
const SPLIT_CLOSE_SHAPE: AllowedShape = {
  programId: SOL_MULTISIG_PROGRAM_ID,
  discriminator: CLOSE_TRANSACTION_DISCRIMINATOR,
};
const SPLIT_ATA_CREATE_SHAPE: AllowedShape = {
  programId: ATA_PROGRAM_ID,
  tag: ATA_CREATE_IDEMPOTENT_TAG,
};

/**
 * Borsh-decode a create_transaction inner message and sum SystemProgram
 * transfers whose destination is the paymaster. Mirrors the inner-message
 * walk in validateReimbursement but is scoped to the SOL reimbursement total
 * only (the split create tx never creates ATAs — §5). Returns the total
 * lamports the inner proposal will transfer vault → paymaster on execution.
 */
function sumInnerReimbursement(
  createIx: TransactionInstruction,
  paymasterPubkey: PublicKey,
): number {
  const data = createIx.data;
  // 8 discriminator + 1 vault_index + 3 message header.
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
    if (ixData.length < 12 || ixData.readUInt32LE(0) !== 2) continue; // Transfer
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
  return totalToPaymaster;
}

/**
 * Validate a split tx against the POSITIVE per-kind allowlist (§5). Throws
 * on any disallowed instruction, missing required instruction, or wrong
 * cardinality. feePayer + size are checked by the caller.
 *
 * Counts of expected member-signed approval ixs (`M_signerTxs`) needed for the
 * create-kind reimbursement floor are derived from the tx itself:
 *   - create: the number of approve ixs riding the creator tx (1 single, 2 dual)
 *     is the creator's own contribution; the floor adds splitPerTxLamports per
 *     subsequent signer tx + the execute tx. The caller passes the expected
 *     total signer-tx count via `minLamports`/`splitPerTxLamports` math below.
 *
 * For the create kind the reimbursement floor is:
 *   totalToPaymaster >= minReimbursementLamports
 *                       + splitPerTxLamports × (expectedSignerTxCount + 1)
 * where expectedSignerTxCount is supplied by the enterprise layer (it knows
 * M). When not supplied we fall back to charging for the txs visible on this
 * creator tx (creator + execute) — a conservative minimum.
 */
export function validateSplitTxInstructions(
  tx: Transaction,
  kind: SplitTxKind,
  paymasterPubkey: PublicKey,
  opts?: { expectedSignerTxCount?: number },
): void {
  const ixs = tx.instructions;
  if (ixs.length === 0) {
    throw new Error(`Split ${kind} tx contains no instructions`);
  }

  const countMatching = (shape: AllowedShape): number =>
    ixs.filter((ix) => matchesShape(ix, shape)).length;

  if (kind === 'create') {
    // nonceAdvance + exactly one create_transaction + 1-2 approve_transaction.
    const allowed = [
      SPLIT_NONCE_ADVANCE_SHAPE,
      SPLIT_CREATE_SHAPE,
      SPLIT_APPROVE_SHAPE,
    ];
    for (const ix of ixs) {
      if (!allowed.some((shape) => matchesShape(ix, shape))) {
        throw new Error(
          `Split create tx contains a non-allowlisted instruction (program ${ix.programId.toBase58()})`,
        );
      }
    }
    const nonceCount = countMatching(SPLIT_NONCE_ADVANCE_SHAPE);
    if (nonceCount !== 1) {
      throw new Error(
        `Split create tx must contain exactly one nonceAdvance ix (got ${nonceCount})`,
      );
    }
    const createCount = countMatching(SPLIT_CREATE_SHAPE);
    if (createCount !== 1) {
      throw new Error(
        `Split create tx must contain exactly one create_transaction ix (got ${createCount})`,
      );
    }
    const approveCount = countMatching(SPLIT_APPROVE_SHAPE);
    if (approveCount < 1 || approveCount > 2) {
      throw new Error(
        `Split create tx must contain 1-2 approve_transaction ixs (got ${approveCount})`,
      );
    }

    // Reimbursement floor (§5): the create tx's inner message must transfer at
    // least minReimbursementLamports + splitPerTxLamports × (signerTxs + 1) to
    // the paymaster. signerTxs+1 covers every member-signed tx plus the
    // paymaster execute tx. When the enterprise layer does not pass the
    // expected count, charge for the txs visible here (this creator tx + the
    // execute tx = 2) as a conservative minimum.
    const createIx = ixs.find((ix) => matchesShape(ix, SPLIT_CREATE_SHAPE))!;
    const total = sumInnerReimbursement(createIx, paymasterPubkey);
    const signerTxCount = Math.max(1, opts?.expectedSignerTxCount ?? 1);
    const floor =
      FEE_SCHEDULE.minReimbursementLamports +
      FEE_SCHEDULE.splitPerTxLamports * (signerTxCount + 1);
    if (total < floor) {
      throw new Error(
        `Split create tx must reimburse paymaster at least ${floor} lamports inside the proposal (got ${total})`,
      );
    }
    return;
  }

  if (kind === 'approve') {
    // nonceAdvance + 1-2 approve_transaction ONLY. No inner message → no
    // reimbursement check. nonceAdvance is mandatory (approve txs always ride
    // a pool nonce — §3).
    const allowed = [SPLIT_NONCE_ADVANCE_SHAPE, SPLIT_APPROVE_SHAPE];
    for (const ix of ixs) {
      if (!allowed.some((shape) => matchesShape(ix, shape))) {
        throw new Error(
          `Split approve tx contains a non-allowlisted instruction (program ${ix.programId.toBase58()})`,
        );
      }
    }
    const nonceCount = countMatching(SPLIT_NONCE_ADVANCE_SHAPE);
    if (nonceCount !== 1) {
      throw new Error(
        `Split approve tx must contain exactly one nonceAdvance ix (got ${nonceCount})`,
      );
    }
    const approveCount = countMatching(SPLIT_APPROVE_SHAPE);
    if (approveCount < 1 || approveCount > 2) {
      throw new Error(
        `Split approve tx must contain 1-2 approve_transaction ixs (got ${approveCount})`,
      );
    }
    return;
  }

  // execute: optional ATA createIdempotent + (execute_transaction AND/OR
  // close_transaction), each at most once, at least one present. The execute tx
  // uses a fresh blockhash (no nonceAdvance) — absence of nonceAdvance is
  // expected here. A close-only tx is accepted so the §5 "close runs
  // separately" path works after a third party front-ran the execute
  // (AlreadyExecuted): the proposal is already executed on-chain, so we only
  // need to reclaim rent via close_transaction. An execute-only tx is also
  // accepted (close can land in a follow-up).
  const allowed = [
    SPLIT_ATA_CREATE_SHAPE,
    SPLIT_EXECUTE_SHAPE,
    SPLIT_CLOSE_SHAPE,
  ];
  for (const ix of ixs) {
    if (!allowed.some((shape) => matchesShape(ix, shape))) {
      throw new Error(
        `Split execute tx contains a non-allowlisted instruction (program ${ix.programId.toBase58()})`,
      );
    }
  }
  const executeCount = countMatching(SPLIT_EXECUTE_SHAPE);
  if (executeCount > 1) {
    throw new Error(
      `Split execute tx may contain at most one execute_transaction ix (got ${executeCount})`,
    );
  }
  const closeCount = countMatching(SPLIT_CLOSE_SHAPE);
  if (closeCount > 1) {
    throw new Error(
      `Split execute tx may contain at most one close_transaction ix (got ${closeCount})`,
    );
  }
  if (executeCount === 0 && closeCount === 0) {
    throw new Error(
      'Split execute tx must contain an execute_transaction and/or close_transaction ix (got neither)',
    );
  }
  const ataCount = countMatching(SPLIT_ATA_CREATE_SHAPE);
  if (ataCount > 1) {
    throw new Error(
      `Split execute tx may contain at most one ATA createIdempotent ix (got ${ataCount})`,
    );
  }
}

// The multisig program's AlreadyExecuted custom error code, surfaced when a
// proposal was already executed (front-run by a third party). Verified in
// solana-multisig/target/idl/solana_multisig.json (errors[].code === 6008).
// Anchor reports custom errors as `custom program error: 0x<code>` in the logs
// and as { InstructionError: [ixIndex, { Custom: code }] } in value.err.
// Treated as SUCCESS for kind='execute' (§5).
const ALREADY_EXECUTED_CODE = 6008;
const ALREADY_EXECUTED_CODE_HEX = `0x${ALREADY_EXECUTED_CODE.toString(16)}`; // '0x1778'

/**
 * Structurally inspect a `confirmTransaction().value.err` TransactionError for
 * the program's AlreadyExecuted custom error (code 6008). The previous
 * `JSON.stringify(...).includes('AlreadyExecuted')` matcher was dead code: the
 * structured err is `{ InstructionError: [ixIndex, { Custom: 6008 }] }` — it
 * never contains the literal string "AlreadyExecuted". Walks the
 * InstructionError tuple for a second element whose `Custom` field equals 6008.
 */
function errorIndicatesAlreadyExecuted(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const ixErr = (err as { InstructionError?: unknown }).InstructionError;
  if (!Array.isArray(ixErr) || ixErr.length < 2) return false;
  const detail = ixErr[1];
  if (detail == null || typeof detail !== 'object') return false;
  const custom = (detail as { Custom?: unknown }).Custom;
  return typeof custom === 'number' && custom === ALREADY_EXECUTED_CODE;
}

/**
 * Detect the AlreadyExecuted error from a preflight-throw path. With
 * skipPreflight=false, an already-executed proposal makes `sendRawTransaction`
 * THROW a `SendTransactionError` during simulation BEFORE any confirm — so the
 * structured value.err path is never reached. The Anchor failure surfaces in
 * the simulation logs as a line containing the error name and/or
 * `custom program error: 0x1778`. Inspect both the eagerly-available `logs`
 * getter and (when available) the lazily-fetched `getLogs(connection)` output.
 */
async function thrownErrorIndicatesAlreadyExecuted(
  err: unknown,
  connection: Connection,
): Promise<boolean> {
  if (!(err instanceof SendTransactionError)) return false;
  const matches = (logs: readonly string[] | null | undefined): boolean =>
    !!logs &&
    logs.some(
      (line) =>
        line.includes('AlreadyExecuted') ||
        line.includes(ALREADY_EXECUTED_CODE_HEX),
    );
  // The eagerly-available logs getter (populated when the error was
  // constructed with simulation logs).
  if (matches(err.logs)) return true;
  // The error message itself can also carry the `Logs:` summary string.
  if (
    err.message.includes('AlreadyExecuted') ||
    err.message.includes(ALREADY_EXECUTED_CODE_HEX)
  ) {
    return true;
  }
  // Fall back to the lazy fetch (re-pulls the tx logs via the connection).
  try {
    const logs = await err.getLogs(connection);
    return matches(logs);
  } catch {
    return false;
  }
}

/**
 * Validate (POSITIVE per-kind allowlist) → partialSign(paymaster) → send →
 * confirm a split-flow tx. Returns the txid on confirmed-success. On
 * confirmed-with-error returns `{ landed: true }` so the enterprise layer
 * knows the durable nonce advanced (and must rebuild + re-sign). On execute,
 * an `AlreadyExecuted` program error is treated as SUCCESS (a third party
 * front-ran the execute and paid our fee) and reported via the optional
 * `alreadyExecuted: true` field (pinned contract) so the enterprise layer can
 * run close separately (§5).
 *
 * The paymaster private key never leaves this public layer; enterprise builds
 * the unsigned/partial-signed blob and hands it here. The allowlist binds BOTH
 * programId AND instruction shape so a forged same-discriminator foreign-program
 * ix is rejected.
 */
async function submitSplitTx(opts: {
  chain: string;
  partialSignedTxBase64: string;
  kind: SplitTxKind;
  expectedSignerTxCount?: number;
}): Promise<{
  txid?: string;
  error?: string;
  landed?: boolean;
  alreadyExecuted?: boolean;
}> {
  let connection: Connection | undefined;
  try {
    const info = getPaymaster(opts.chain);
    connection = info.connection;
    const txBytes = Buffer.from(opts.partialSignedTxBase64, 'base64');
    if (txBytes.length > 1232) {
      return {
        error: `Split ${opts.kind} tx exceeds the 1232-byte packet limit (${txBytes.length} bytes)`,
      };
    }
    const tx = Transaction.from(txBytes);

    if (!tx.feePayer || !tx.feePayer.equals(info.pubkey)) {
      return {
        error: `Split tx feePayer (${tx.feePayer?.toBase58() ?? 'unset'}) does not match paymaster (${info.pubkey.toBase58()})`,
      };
    }

    validateSplitTxInstructions(tx, opts.kind, info.pubkey, {
      expectedSignerTxCount: opts.expectedSignerTxCount,
    });

    tx.partialSign(info.keypair);

    // The fully serialized tx (with the paymaster sig) must still fit.
    const wire = tx.serialize();
    if (wire.length > 1232) {
      return {
        error: `Split ${opts.kind} tx exceeds the 1232-byte packet limit after paymaster sig (${wire.length} bytes)`,
      };
    }

    const signature = await info.connection.sendRawTransaction(wire, {
      skipPreflight: false,
      maxRetries: 3,
    });
    const confirmResult = await info.connection.confirmTransaction(
      signature,
      'confirmed',
    );
    if (confirmResult.value.err) {
      // execute kind: an AlreadyExecuted error means a third party front-ran
      // the execute and performed the exact proposed transfer (+ paid our
      // fee) — treat as success. close runs separately (§5).
      if (
        opts.kind === 'execute' &&
        errorIndicatesAlreadyExecuted(confirmResult.value.err)
      ) {
        log.info(
          `[solPaymaster] split execute ${opts.chain} tx ${signature} AlreadyExecuted (front-run) — treating as success`,
        );
        return { alreadyExecuted: true, landed: true };
      }
      // Confirmed-with-error: the durable nonce HAS advanced (member-signed
      // kinds). Surface landed:true so enterprise recycles the lease + rebuilds.
      log.warn(
        `[solPaymaster] split ${opts.kind} ${opts.chain} tx ${signature} landed but failed on-chain`,
      );
      return {
        error: `Split ${opts.kind} tx ${signature} landed but failed on-chain: ${JSON.stringify(confirmResult.value.err)}`,
        landed: true,
      };
    }
    log.info(
      `[solPaymaster] split ${opts.kind} broadcast ${opts.chain} tx ${signature}`,
    );
    return { txid: signature, landed: true };
  } catch (e) {
    // execute kind: with skipPreflight=false an already-executed proposal makes
    // sendRawTransaction THROW a SendTransactionError during simulation BEFORE
    // any confirm. Inspect its logs for the AlreadyExecuted custom error and
    // treat it as success — the tx never landed (no nonce advance), but the
    // proposal is already executed on-chain so close can run separately (§5).
    if (
      opts.kind === 'execute' &&
      connection &&
      (await thrownErrorIndicatesAlreadyExecuted(e, connection))
    ) {
      log.info(
        `[solPaymaster] split execute ${opts.chain} preflight AlreadyExecuted (front-run) — treating as success`,
      );
      return { alreadyExecuted: true };
    }
    // Send-level / build errors: the tx demonstrably never landed (no nonce
    // advance). landed is left undefined so enterprise may retry identical
    // bytes (§6.4.5).
    return { error: (e as Error).message };
  }
}

// ============================================================
// Paymaster durable-nonce pool (§4). Plain SystemProgram nonce accounts owned
// by the paymaster, derived via createAccountWithSeed(paymaster, 'ssp-pool-<i>')
// so the wallet→key handoff can take hours (the vault's own program-derived
// nonce stays dedicated to the bundled flow).
// ============================================================

const POOL_NONCE_SEED_PREFIX = 'ssp-pool-';
const POOL_NONCE_MAX_INDEX = 64; // cap per chain (§4)

function poolNonceSeed(index: number): string {
  return `${POOL_NONCE_SEED_PREFIX}${index}`;
}

/**
 * Provision a fresh paymaster-owned durable-nonce account. Probes seeds
 * ssp-pool-0..63 via getAccountInfo, picks the lowest unused index, then
 * createAccountWithSeed + nonceInitialize in one paymaster-signed tx (authority
 * = paymaster). The account is reusable forever; enterprise owns lease state.
 *
 * Returns the nonce account address on success. Throws/returns error if the
 * pool is exhausted (all 64 indices in use).
 */
async function createPoolNonce(
  chain: string,
): Promise<{ nonceAccount?: string; error?: string }> {
  try {
    const info = getPaymaster(chain);
    const rent =
      await info.connection.getMinimumBalanceForRentExemption(
        NONCE_ACCOUNT_LENGTH,
      );

    // Probe the lowest unused seed index. The paymaster's nonce accounts are
    // deterministic given the seed, so getAccountInfo tells us which exist.
    let chosenIndex = -1;
    let chosenPubkey: PublicKey | null = null;
    for (let i = 0; i < POOL_NONCE_MAX_INDEX; i++) {
      const seed = poolNonceSeed(i);
      const pubkey = await PublicKey.createWithSeed(
        info.pubkey,
        seed,
        SYSTEM_PROGRAM_ID,
      );
      const existing = await info.connection.getAccountInfo(pubkey);
      if (existing === null) {
        chosenIndex = i;
        chosenPubkey = pubkey;
        break;
      }
    }
    if (chosenIndex < 0 || !chosenPubkey) {
      return {
        error: `Paymaster nonce pool exhausted for ${chain} (cap ${POOL_NONCE_MAX_INDEX})`,
      };
    }

    const seed = poolNonceSeed(chosenIndex);
    const createIx = SystemProgram.createAccountWithSeed({
      fromPubkey: info.pubkey,
      newAccountPubkey: chosenPubkey,
      basePubkey: info.pubkey,
      seed,
      lamports: rent,
      space: NONCE_ACCOUNT_LENGTH,
      programId: SYSTEM_PROGRAM_ID,
    });
    const initIx = SystemProgram.nonceInitialize({
      noncePubkey: chosenPubkey,
      authorizedPubkey: info.pubkey,
    });

    const tx = new Transaction().add(createIx, initIx);
    const { blockhash } = await info.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = info.pubkey;
    tx.partialSign(info.keypair);

    const signature = await info.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
    const confirmResult = await info.connection.confirmTransaction(
      signature,
      'confirmed',
    );
    if (confirmResult.value.err) {
      return {
        error: `Pool nonce create tx ${signature} landed but failed on-chain: ${JSON.stringify(confirmResult.value.err)}`,
      };
    }
    log.info(
      `[solPaymaster] created pool nonce ${chain} ${chosenPubkey.toBase58()} (seed ${seed})`,
    );
    return { nonceAccount: chosenPubkey.toBase58() };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Read the current durable-nonce value (the blockhash a tx anchored to this
 * account must use as recentBlockhash). Enterprise must re-fetch this fresh on
 * every (re)build — never reuse a stored value (§4 lease lifecycle).
 */
async function getPoolNonceValue(
  chain: string,
  nonceAccountBase58: string,
): Promise<{ nonceValue?: string; error?: string }> {
  try {
    const info = getPaymaster(chain);
    const nonceAccount = new PublicKey(nonceAccountBase58);
    const nonceState = await info.connection.getNonceAndContext(nonceAccount);
    if (!nonceState.value) {
      return {
        error: `Nonce account ${nonceAccountBase58} not found or uninitialized`,
      };
    }
    return { nonceValue: nonceState.value.nonce };
  } catch (e) {
    return { error: (e as Error).message };
  }
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
  signAndSubmitSetupTx,
  getFeeSchedule,
  checkAtaExists,
  submitSplitTx,
  createPoolNonce,
  getPoolNonceValue,
};
