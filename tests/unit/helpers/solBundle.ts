// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test helper
/**
 * Builds Solana paymaster bundles the way SSP Wallet (consumer) and the
 * enterprise builder do — with the REAL @runonflux/solana-multisig
 * instruction encoders — so the paymaster allowlist is tested against the
 * genuine wire shape. Every piece can be swapped out to build attacks.
 */
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  SolanaMultisigClient,
  deriveMultisigAddress,
  deriveVaultAddress,
  deriveNonceAccount,
} from '@runonflux/solana-multisig';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { multisigProgramId } from '../../../src/services/solPaymasterService';

// SPL Memo v2 (the program SSP Wallet and the enterprise builder use).
export const MEMO_PROGRAM_ID = new PublicKey(
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
);

export interface BundleOptions {
  chain?: string;
  paymaster: PublicKey;
  reimbursementLamports?: number;
  spl?: boolean;
  priorityFee?: boolean;
  /** Extra approvers (enterprise-style M > 2). */
  extraApprovers?: number;
  /** Executor: 'wallet' (consumer) or 'paymaster' (enterprise). */
  executor?: 'wallet' | 'paymaster';
  vaultIndex?: number;
  /** Rewrite the inner proposal message before it is encoded. */
  mutateMessage?: (msg, ctx) => void;
  /** Reuse member keypairs (same multisig across bundles). */
  wallet?: Keypair;
  key?: Keypair;
  /** Price-only ComputeBudget (no SetComputeUnitLimit). */
  priceOnly?: boolean;
}

export interface BuiltBundle {
  ixs: TransactionInstruction[];
  ctx: {
    programId: PublicKey;
    paymaster: PublicKey;
    wallet: Keypair;
    key: Keypair;
    approvers: Keypair[];
    multisig: PublicKey;
    vault: PublicKey;
    transactionAddress: PublicKey;
    transactionIndex: bigint;
    nonceAccount: PublicKey;
    destAta?: PublicKey;
    mint?: PublicKey;
    recipient: PublicKey;
    client: SolanaMultisigClient;
  };
}

export async function buildBundle(opts: BundleOptions): Promise<BuiltBundle> {
  const chain = opts.chain ?? 'solDevnet';
  const programId = multisigProgramId(chain);
  const client = new SolanaMultisigClient(
    new Connection('http://127.0.0.1:1'),
    programId,
  );
  const paymaster = opts.paymaster;
  const wallet = opts.wallet ?? Keypair.generate();
  const key = opts.key ?? Keypair.generate();
  const extra = Array.from({ length: opts.extraApprovers ?? 0 }, () =>
    Keypair.generate(),
  );
  const members = [
    wallet.publicKey,
    key.publicKey,
    ...extra.map((k) => k.publicKey),
  ];
  const [multisig] = deriveMultisigAddress(members, 2, programId);
  const vaultIndex = opts.vaultIndex ?? 0;
  const [vault] = deriveVaultAddress(multisig, vaultIndex, programId);
  const recipient = Keypair.generate().publicKey;
  const reimbursement = BigInt(opts.reimbursementLamports ?? 100_000);

  const reimburseData = SystemProgram.transfer({
    fromPubkey: vault,
    toPubkey: paymaster,
    lamports: reimbursement,
  }).data;

  let message;
  let destAta: PublicKey | undefined;
  let mint: PublicKey | undefined;
  const outer: TransactionInstruction[] = [];
  if (opts.spl) {
    mint = Keypair.generate().publicKey;
    const sourceAta = getAssociatedTokenAddressSync(mint, vault, true);
    destAta = getAssociatedTokenAddressSync(mint, recipient, true);
    outer.push(
      createAssociatedTokenAccountIdempotentInstruction(
        paymaster,
        destAta,
        recipient,
        mint,
      ),
    );
    const transferData = createTransferCheckedInstruction(
      sourceAta,
      mint,
      destAta,
      vault,
      1_000n,
      6,
    ).data;
    const keys = [
      vault,
      sourceAta,
      destAta,
      paymaster,
      mint,
      TOKEN_PROGRAM_ID,
      SystemProgram.programId,
    ];
    message = {
      numSigners: 1,
      numWritableSigners: 1,
      numWritableNonSigners: 3,
      accountKeys: keys,
      instructions: [
        {
          programIdIndex: 5,
          accountIndexes: new Uint8Array([1, 4, 2, 0]),
          data: new Uint8Array(transferData),
        },
        {
          programIdIndex: 6,
          accountIndexes: new Uint8Array([0, 3]),
          data: new Uint8Array(reimburseData),
        },
      ],
      addressTableLookups: [],
    };
  } else {
    const transferData = SystemProgram.transfer({
      fromPubkey: vault,
      toPubkey: recipient,
      lamports: 1_000_000n,
    }).data;
    message = {
      numSigners: 1,
      numWritableSigners: 1,
      numWritableNonSigners: 2,
      accountKeys: [vault, recipient, paymaster, SystemProgram.programId],
      instructions: [
        {
          programIdIndex: 3,
          accountIndexes: new Uint8Array([0, 1]),
          data: new Uint8Array(transferData),
        },
        {
          programIdIndex: 3,
          accountIndexes: new Uint8Array([0, 2]),
          data: new Uint8Array(reimburseData),
        },
      ],
      addressTableLookups: [],
    };
  }
  const ctxPartial = { vault, paymaster, recipient, multisig, programId };
  if (opts.mutateMessage) opts.mutateMessage(message, ctxPartial);
  const remaining = message.accountKeys.map((pubkey, i) => ({
    pubkey,
    isSigner: false,
    isWritable:
      i < message.numWritableSigners ||
      (i >= message.numSigners &&
        i < message.numSigners + message.numWritableNonSigners),
  }));

  const {
    instruction: createIx,
    transactionAddress,
    transactionIndex,
  } = await client.buildCreateTransactionInstruction({
    multisigAddress: multisig,
    currentTransactionIndex: 0n,
    vaultIndex,
    message,
    creator: wallet.publicKey,
    payer: paymaster,
  });
  const approvers = [wallet, key, ...extra];
  const approveIxs = await Promise.all(
    approvers.map((kp) =>
      client.buildApproveTransactionInstruction({
        multisigAddress: multisig,
        transactionAddress,
        transactionIndex,
        member: kp.publicKey,
      }),
    ),
  );
  const executeIx = await client.buildExecuteTransactionInstruction({
    multisigAddress: multisig,
    transactionAddress,
    transactionIndex,
    executor: opts.executor === 'paymaster' ? paymaster : wallet.publicKey,
    remainingAccounts: remaining,
  });
  const closeIx = await client.buildCloseTransactionInstruction({
    multisigAddress: multisig,
    transactionAddress,
    transactionIndex,
    payer: paymaster,
  });
  const nonceAccount = await deriveNonceAccount(multisig);
  const nonceIx = SystemProgram.nonceAdvance({
    noncePubkey: nonceAccount,
    authorizedPubkey: paymaster,
  });
  const priority = opts.priceOnly
    ? [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 })]
    : opts.priorityFee
      ? [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
        ]
      : [];

  return {
    ixs: [
      nonceIx,
      ...priority,
      ...outer,
      createIx,
      ...approveIxs,
      executeIx,
      closeIx,
    ],
    ctx: {
      programId,
      paymaster,
      wallet,
      key,
      approvers,
      multisig,
      vault,
      transactionAddress,
      transactionIndex,
      nonceAccount,
      destAta,
      mint,
      recipient,
      client,
    },
  };
}

export function assemble(
  ixs: TransactionInstruction[],
  paymaster: PublicKey,
): Transaction {
  const tx = new Transaction();
  tx.recentBlockhash = Keypair.generate().publicKey.toBase58();
  tx.feePayer = paymaster;
  tx.add(...ixs);
  return tx;
}

/** Round-trip through the wire format, as the relay receives it. */
export function wireRoundTrip(tx: Transaction): Transaction {
  return Transaction.from(
    tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
  );
}
