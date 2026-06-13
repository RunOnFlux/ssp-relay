// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect } from 'chai';
import { createHash } from 'crypto';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { validateSplitTxInstructions } from '../../src/services/solPaymasterService';

// ============================================================================
// Split-approval per-kind POSITIVE allowlist tests (plan §5, §11).
//
// The validator binds BOTH programId AND instruction shape (Anchor
// discriminator / SystemProgram u32 tag / ATA single-byte tag). A foreign
// program with an identical Anchor discriminator MUST be rejected because its
// programId does not match — this is the explicit fix for the
// discriminator-only weakness in validateReimbursement.
// ============================================================================

const SOL_MULTISIG_PROGRAM_ID = new PublicKey(
  'CisPSFTQoTnEqn5cUi1pgpfPp2xiTVRkK7eD5jBevxdX',
);
const ATA_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);
const SYSTEM_PROGRAM_ID = SystemProgram.programId;

function anchorDisc(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

const CREATE_DISC = anchorDisc('create_transaction');
const APPROVE_DISC = anchorDisc('approve_transaction');
const EXECUTE_DISC = anchorDisc('execute_transaction');
const CLOSE_DISC = anchorDisc('close_transaction');

// ---- inner create_transaction message encoder (mirrors the program borsh) --

interface CompiledInstruction {
  programIdIndex: number;
  accountIndexes: number[];
  data: Buffer;
}

function encodeInnerMessage(opts: {
  accountKeys: PublicKey[];
  instructions: CompiledInstruction[];
}): Buffer {
  const chunks: Buffer[] = [];
  chunks.push(Buffer.from([1, 1, 1])); // header: numSigners, writSigners, writNonSigners
  const akLen = Buffer.alloc(4);
  akLen.writeUInt32LE(opts.accountKeys.length, 0);
  chunks.push(akLen);
  for (const k of opts.accountKeys) chunks.push(k.toBuffer());
  const ixLen = Buffer.alloc(4);
  ixLen.writeUInt32LE(opts.instructions.length, 0);
  chunks.push(ixLen);
  for (const ix of opts.instructions) {
    chunks.push(Buffer.from([ix.programIdIndex]));
    const aiLen = Buffer.alloc(4);
    aiLen.writeUInt32LE(ix.accountIndexes.length, 0);
    chunks.push(aiLen, Buffer.from(ix.accountIndexes));
    const dLen = Buffer.alloc(4);
    dLen.writeUInt32LE(ix.data.length, 0);
    chunks.push(dLen, ix.data);
  }
  const altLen = Buffer.alloc(4);
  altLen.writeUInt32LE(0, 0);
  chunks.push(altLen);
  return Buffer.concat(chunks);
}

function encodeSystemTransfer(lamports: number): Buffer {
  const buf = Buffer.alloc(12);
  buf.writeUInt32LE(2, 0); // SystemInstruction::Transfer
  buf.writeBigUInt64LE(BigInt(lamports), 4);
  return buf;
}

// create_transaction ix whose inner message transfers `reimbursement` lamports
// vault -> paymaster.
function createIx(opts: {
  vault: PublicKey;
  paymaster: PublicKey;
  reimbursement: number;
}): TransactionInstruction {
  const message = encodeInnerMessage({
    accountKeys: [opts.vault, SYSTEM_PROGRAM_ID, opts.paymaster],
    instructions: [
      {
        programIdIndex: 1, // SystemProgram
        accountIndexes: [0, 2], // [vault, paymaster]
        data: encodeSystemTransfer(opts.reimbursement),
      },
    ],
  });
  const data = Buffer.concat([
    CREATE_DISC,
    Buffer.from([0]), // vault_index
    message,
  ]);
  return new TransactionInstruction({
    programId: SOL_MULTISIG_PROGRAM_ID,
    keys: [],
    data,
  });
}

function approveIx(
  programId = SOL_MULTISIG_PROGRAM_ID,
): TransactionInstruction {
  // approve_transaction discriminator + a u8 vault_index arg.
  const data = Buffer.concat([APPROVE_DISC, Buffer.from([0])]);
  return new TransactionInstruction({ programId, keys: [], data });
}

function executeIx(): TransactionInstruction {
  const data = Buffer.concat([EXECUTE_DISC, Buffer.from([0])]);
  return new TransactionInstruction({
    programId: SOL_MULTISIG_PROGRAM_ID,
    keys: [],
    data,
  });
}

function closeIx(): TransactionInstruction {
  const data = Buffer.concat([CLOSE_DISC, Buffer.from([0])]);
  return new TransactionInstruction({
    programId: SOL_MULTISIG_PROGRAM_ID,
    keys: [],
    data,
  });
}

function ataCreateIdempotentIx(): TransactionInstruction {
  // ATA createIdempotent = single-byte tag 1.
  return new TransactionInstruction({
    programId: ATA_PROGRAM_ID,
    keys: [],
    data: Buffer.from([1]),
  });
}

function nonceAdvanceIx(authority: PublicKey): TransactionInstruction {
  const fakeNonce = Keypair.generate().publicKey;
  return SystemProgram.nonceAdvance({
    noncePubkey: fakeNonce,
    authorizedPubkey: authority,
  });
}

function makeTx(
  paymaster: PublicKey,
  ixs: TransactionInstruction[],
): Transaction {
  const tx = new Transaction();
  tx.recentBlockhash = 'EETubP5AKHgjPAhzPAFcb8BAY6hDtV5oqBe5LBdnDS6E';
  tx.feePayer = paymaster;
  for (const ix of ixs) tx.add(ix);
  return tx;
}

describe('Solana Paymaster Service — validateSplitTxInstructions (per-kind allowlist)', function () {
  const paymaster = Keypair.generate().publicKey;
  const vault = Keypair.generate().publicKey;
  const signer = Keypair.generate().publicKey;

  // Floor for create with 1 signer tx: min(50_000) + splitPerTx(10_000) * (1+1)
  // = 70_000. We use a generous reimbursement well above any floor in accept
  // tests.
  const FAT_REIMBURSEMENT = 5_000_000;

  // ---------------------------------------------------------------- create ---

  describe('kind=create', function () {
    it('ACCEPTS nonceAdvance + create + single approve with sufficient reimbursement', function () {
      const tx = makeTx(paymaster, [
        nonceAdvanceIx(signer),
        createIx({ vault, paymaster, reimbursement: FAT_REIMBURSEMENT }),
        approveIx(),
      ]);
      expect(() =>
        validateSplitTxInstructions(tx, 'create', paymaster),
      ).to.not.throw();
    });

    it('ACCEPTS nonceAdvance + create + two approves (dual mode)', function () {
      const tx = makeTx(paymaster, [
        nonceAdvanceIx(signer),
        createIx({ vault, paymaster, reimbursement: FAT_REIMBURSEMENT }),
        approveIx(),
        approveIx(),
      ]);
      expect(() =>
        validateSplitTxInstructions(tx, 'create', paymaster),
      ).to.not.throw();
    });

    it('(d) enforces the create reimbursement floor with splitPerTxLamports', function () {
      // expectedSignerTxCount = 3 → floor = 50_000 + 10_000 * (3+1) = 90_000.
      const justUnder = makeTx(paymaster, [
        nonceAdvanceIx(signer),
        createIx({ vault, paymaster, reimbursement: 89_999 }),
        approveIx(),
      ]);
      expect(() =>
        validateSplitTxInstructions(justUnder, 'create', paymaster, {
          expectedSignerTxCount: 3,
        }),
      ).to.throw(/reimburse paymaster at least 90000/);

      const exact = makeTx(paymaster, [
        nonceAdvanceIx(signer),
        createIx({ vault, paymaster, reimbursement: 90_000 }),
        approveIx(),
      ]);
      expect(() =>
        validateSplitTxInstructions(exact, 'create', paymaster, {
          expectedSignerTxCount: 3,
        }),
      ).to.not.throw();
    });

    it('(d) enforces the create floor for M=15 (expectedSignerTxCount=15 → 210_000)', function () {
      // floor = minReimbursement(50_000) + splitPerTx(10_000) * (15 + 1)
      //       = 50_000 + 160_000 = 210_000.
      const justUnder = makeTx(paymaster, [
        nonceAdvanceIx(signer),
        createIx({ vault, paymaster, reimbursement: 209_999 }),
        approveIx(),
      ]);
      expect(() =>
        validateSplitTxInstructions(justUnder, 'create', paymaster, {
          expectedSignerTxCount: 15,
        }),
      ).to.throw(/reimburse paymaster at least 210000/);

      const exact = makeTx(paymaster, [
        nonceAdvanceIx(signer),
        createIx({ vault, paymaster, reimbursement: 210_000 }),
        approveIx(),
      ]);
      expect(() =>
        validateSplitTxInstructions(exact, 'create', paymaster, {
          expectedSignerTxCount: 15,
        }),
      ).to.not.throw();
    });

    it('(d) falls back to a conservative floor (70_000) when expectedSignerTxCount is absent', function () {
      // Fallback signerTxCount = 1 → floor = 50_000 + 10_000 * (1 + 1) = 70_000.
      const justUnder = makeTx(paymaster, [
        nonceAdvanceIx(signer),
        createIx({ vault, paymaster, reimbursement: 69_999 }),
        approveIx(),
      ]);
      expect(() =>
        validateSplitTxInstructions(justUnder, 'create', paymaster),
      ).to.throw(/reimburse paymaster at least 70000/);

      const exact = makeTx(paymaster, [
        nonceAdvanceIx(signer),
        createIx({ vault, paymaster, reimbursement: 70_000 }),
        approveIx(),
      ]);
      expect(() =>
        validateSplitTxInstructions(exact, 'create', paymaster),
      ).to.not.throw();
    });

    it('REJECTS a create tx with no approve ix', function () {
      const tx = makeTx(paymaster, [
        nonceAdvanceIx(signer),
        createIx({ vault, paymaster, reimbursement: FAT_REIMBURSEMENT }),
      ]);
      expect(() =>
        validateSplitTxInstructions(tx, 'create', paymaster),
      ).to.throw(/1-2 approve_transaction/);
    });

    it('REJECTS a create tx missing the nonceAdvance ix (advance required for create kind)', function () {
      const tx = makeTx(paymaster, [
        createIx({ vault, paymaster, reimbursement: FAT_REIMBURSEMENT }),
        approveIx(),
      ]);
      expect(() =>
        validateSplitTxInstructions(tx, 'create', paymaster),
      ).to.throw(/exactly one nonceAdvance/);
    });

    it('(b) REJECTS a rogue SystemProgram transfer riding the create tx', function () {
      const rogue = SystemProgram.transfer({
        fromPubkey: paymaster,
        toPubkey: signer,
        lamports: 1_000_000,
      });
      const tx = makeTx(paymaster, [
        nonceAdvanceIx(signer),
        createIx({ vault, paymaster, reimbursement: FAT_REIMBURSEMENT }),
        approveIx(),
        rogue,
      ]);
      expect(() =>
        validateSplitTxInstructions(tx, 'create', paymaster),
      ).to.throw(/non-allowlisted instruction/);
    });

    it('(a) REJECTS a foreign program ix carrying the identical create_transaction discriminator', function () {
      const foreignProgram = Keypair.generate().publicKey;
      const foreignCreate = new TransactionInstruction({
        programId: foreignProgram, // SAME discriminator, WRONG programId
        keys: [],
        data: Buffer.concat([CREATE_DISC, Buffer.from([0])]),
      });
      const tx = makeTx(paymaster, [
        nonceAdvanceIx(signer),
        foreignCreate,
        approveIx(),
      ]);
      expect(() =>
        validateSplitTxInstructions(tx, 'create', paymaster),
      ).to.throw(/non-allowlisted instruction/);
    });
  });

  // --------------------------------------------------------------- approve ---

  describe('kind=approve', function () {
    it('ACCEPTS nonceAdvance + single approve', function () {
      const tx = makeTx(paymaster, [nonceAdvanceIx(signer), approveIx()]);
      expect(() =>
        validateSplitTxInstructions(tx, 'approve', paymaster),
      ).to.not.throw();
    });

    it('ACCEPTS nonceAdvance + two approves (dual mode)', function () {
      const tx = makeTx(paymaster, [
        nonceAdvanceIx(signer),
        approveIx(),
        approveIx(),
      ]);
      expect(() =>
        validateSplitTxInstructions(tx, 'approve', paymaster),
      ).to.not.throw();
    });

    it('(c) REJECTS an approve tx WITHOUT nonceAdvance (approve txs always carry nonceAdvance per §3)', function () {
      const tx = makeTx(paymaster, [approveIx()]);
      expect(() =>
        validateSplitTxInstructions(tx, 'approve', paymaster),
      ).to.throw(/exactly one nonceAdvance/);
    });

    it('REJECTS an approve tx that also contains a create_transaction ix', function () {
      const tx = makeTx(paymaster, [
        nonceAdvanceIx(signer),
        approveIx(),
        createIx({ vault, paymaster, reimbursement: FAT_REIMBURSEMENT }),
      ]);
      expect(() =>
        validateSplitTxInstructions(tx, 'approve', paymaster),
      ).to.throw(/non-allowlisted instruction/);
    });

    it('(a) REJECTS a foreign program ix carrying the identical approve discriminator', function () {
      const foreignProgram = Keypair.generate().publicKey;
      const tx = makeTx(paymaster, [
        nonceAdvanceIx(signer),
        approveIx(foreignProgram),
      ]);
      expect(() =>
        validateSplitTxInstructions(tx, 'approve', paymaster),
      ).to.throw(/non-allowlisted instruction/);
    });
  });

  // --------------------------------------------------------------- execute ---

  describe('kind=execute', function () {
    it('ACCEPTS execute + close (no nonceAdvance — fresh blockhash)', function () {
      const tx = makeTx(paymaster, [executeIx(), closeIx()]);
      expect(() =>
        validateSplitTxInstructions(tx, 'execute', paymaster),
      ).to.not.throw();
    });

    it('ACCEPTS ATA createIdempotent + execute + close (SPL recipient)', function () {
      const tx = makeTx(paymaster, [
        ataCreateIdempotentIx(),
        executeIx(),
        closeIx(),
      ]);
      expect(() =>
        validateSplitTxInstructions(tx, 'execute', paymaster),
      ).to.not.throw();
    });

    it('ACCEPTS execute-only (close lands in a follow-up)', function () {
      const tx = makeTx(paymaster, [executeIx()]);
      expect(() =>
        validateSplitTxInstructions(tx, 'execute', paymaster),
      ).to.not.throw();
    });

    it('ACCEPTS close-only (§5 close-runs-separately after an external execute front-run)', function () {
      const tx = makeTx(paymaster, [closeIx()]);
      expect(() =>
        validateSplitTxInstructions(tx, 'execute', paymaster),
      ).to.not.throw();
    });

    it('ACCEPTS ATA createIdempotent + close-only', function () {
      const tx = makeTx(paymaster, [ataCreateIdempotentIx(), closeIx()]);
      expect(() =>
        validateSplitTxInstructions(tx, 'execute', paymaster),
      ).to.not.throw();
    });

    it('REJECTS execute tx with neither execute nor close ix (ATA only)', function () {
      const tx = makeTx(paymaster, [ataCreateIdempotentIx()]);
      expect(() =>
        validateSplitTxInstructions(tx, 'execute', paymaster),
      ).to.throw(/and\/or close_transaction/);
    });

    it('REJECTS a duplicate close_transaction ix', function () {
      const tx = makeTx(paymaster, [executeIx(), closeIx(), closeIx()]);
      expect(() =>
        validateSplitTxInstructions(tx, 'execute', paymaster),
      ).to.throw(/at most one close_transaction/);
    });

    it('REJECTS a duplicate execute_transaction ix', function () {
      const tx = makeTx(paymaster, [executeIx(), executeIx(), closeIx()]);
      expect(() =>
        validateSplitTxInstructions(tx, 'execute', paymaster),
      ).to.throw(/at most one execute_transaction/);
    });

    it('(b) REJECTS a rogue SystemProgram transfer riding the execute tx', function () {
      const rogue = SystemProgram.transfer({
        fromPubkey: paymaster,
        toPubkey: signer,
        lamports: 1_000_000,
      });
      const tx = makeTx(paymaster, [executeIx(), closeIx(), rogue]);
      expect(() =>
        validateSplitTxInstructions(tx, 'execute', paymaster),
      ).to.throw(/non-allowlisted instruction/);
    });

    it('(a) REJECTS a foreign program ix carrying the identical execute discriminator', function () {
      const foreignProgram = Keypair.generate().publicKey;
      const foreignExecute = new TransactionInstruction({
        programId: foreignProgram,
        keys: [],
        data: Buffer.concat([EXECUTE_DISC, Buffer.from([0])]),
      });
      const tx = makeTx(paymaster, [foreignExecute, closeIx()]);
      expect(() =>
        validateSplitTxInstructions(tx, 'execute', paymaster),
      ).to.throw(/non-allowlisted instruction/);
    });
  });
});
