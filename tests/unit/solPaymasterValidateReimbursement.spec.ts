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
import { validateReimbursement } from '../../src/services/solPaymasterService';

// ============================================================================
// Test fixtures: build a synthetic create_transaction ix that mirrors what
// the SSP Solana Multisig SDK produces. The ix data layout matches the
// borsh encoding the on-chain program (and the relay's validator) expects.
// ============================================================================

const PROGRAM_ID = new PublicKey(
  'CisPSFTQoTnEqn5cUi1pgpfPp2xiTVRkK7eD5jBevxdX',
);

const CREATE_TRANSACTION_DISCRIMINATOR = createHash('sha256')
  .update('global:create_transaction')
  .digest()
  .subarray(0, 8);

interface CompiledInstruction {
  programIdIndex: number;
  accountIndexes: number[];
  data: Buffer;
}

interface TransactionMessage {
  numSigners: number;
  numWritableSigners: number;
  numWritableNonSigners: number;
  accountKeys: PublicKey[];
  instructions: CompiledInstruction[];
  // addressTableLookups is empty for SSP proposals (program rejects ALTs)
}

function encodeMessage(msg: TransactionMessage): Buffer {
  const chunks: Buffer[] = [];
  chunks.push(
    Buffer.from([
      msg.numSigners,
      msg.numWritableSigners,
      msg.numWritableNonSigners,
    ]),
  );

  // account_keys
  const akLen = Buffer.alloc(4);
  akLen.writeUInt32LE(msg.accountKeys.length, 0);
  chunks.push(akLen);
  for (const k of msg.accountKeys) chunks.push(k.toBuffer());

  // instructions
  const ixLen = Buffer.alloc(4);
  ixLen.writeUInt32LE(msg.instructions.length, 0);
  chunks.push(ixLen);
  for (const ix of msg.instructions) {
    chunks.push(Buffer.from([ix.programIdIndex]));
    const aiLen = Buffer.alloc(4);
    aiLen.writeUInt32LE(ix.accountIndexes.length, 0);
    chunks.push(aiLen);
    chunks.push(Buffer.from(ix.accountIndexes));
    const dLen = Buffer.alloc(4);
    dLen.writeUInt32LE(ix.data.length, 0);
    chunks.push(dLen);
    chunks.push(ix.data);
  }

  // address_table_lookups: empty
  const altLen = Buffer.alloc(4);
  altLen.writeUInt32LE(0, 0);
  chunks.push(altLen);

  return Buffer.concat(chunks);
}

function encodeSystemTransferData(lamports: number | bigint): Buffer {
  const buf = Buffer.alloc(12);
  buf.writeUInt32LE(2, 0); // SystemInstruction::Transfer tag
  buf.writeBigUInt64LE(BigInt(lamports), 4);
  return buf;
}

/**
 * Build a synthetic create_transaction instruction with the given proposal
 * message. Used to construct test txs without pulling in the full SDK.
 */
function buildCreateTransactionIx(
  message: TransactionMessage,
): TransactionInstruction {
  const vaultIndex = 0;
  const data = Buffer.concat([
    CREATE_TRANSACTION_DISCRIMINATOR,
    Buffer.from([vaultIndex]),
    encodeMessage(message),
  ]);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [], // accounts list isn't validated by the relay; only the ix data is
    data,
  });
}

function makeOuterTx(opts: {
  paymaster: PublicKey;
  ixs: TransactionInstruction[];
}): Transaction {
  const tx = new Transaction();
  tx.recentBlockhash = 'EETubP5AKHgjPAhzPAFcb8BAY6hDtV5oqBe5LBdnDS6E';
  tx.feePayer = opts.paymaster;
  for (const ix of opts.ixs) tx.add(ix);
  return tx;
}

const MIN_LAMPORTS = 7_000_000;

describe('Solana Paymaster Service — validateReimbursement', function () {
  const paymaster = Keypair.generate().publicKey;
  const vault = Keypair.generate().publicKey;
  const recipient = Keypair.generate().publicKey;

  it('accepts a tx with a vault → paymaster transfer of exactly minLamports', function () {
    const message: TransactionMessage = {
      numSigners: 1,
      numWritableSigners: 1,
      numWritableNonSigners: 2,
      accountKeys: [vault, recipient, SystemProgram.programId, paymaster],
      instructions: [
        // user transfer (irrelevant to validation)
        {
          programIdIndex: 2,
          accountIndexes: [0, 1],
          data: encodeSystemTransferData(1000000),
        },
        // reimbursement
        {
          programIdIndex: 2,
          accountIndexes: [0, 3],
          data: encodeSystemTransferData(MIN_LAMPORTS),
        },
      ],
    };
    const tx = makeOuterTx({
      paymaster,
      ixs: [buildCreateTransactionIx(message)],
    });
    expect(() =>
      validateReimbursement(tx, paymaster, MIN_LAMPORTS),
    ).to.not.throw();
  });

  it('accepts a tx with multiple transfers to paymaster summing to minLamports', function () {
    const message: TransactionMessage = {
      numSigners: 1,
      numWritableSigners: 1,
      numWritableNonSigners: 2,
      accountKeys: [vault, recipient, SystemProgram.programId, paymaster],
      instructions: [
        {
          programIdIndex: 2,
          accountIndexes: [0, 3],
          data: encodeSystemTransferData(3_000_000),
        },
        {
          programIdIndex: 2,
          accountIndexes: [0, 3],
          data: encodeSystemTransferData(4_500_000),
        },
      ],
    };
    const tx = makeOuterTx({
      paymaster,
      ixs: [buildCreateTransactionIx(message)],
    });
    expect(() =>
      validateReimbursement(tx, paymaster, MIN_LAMPORTS),
    ).to.not.throw();
  });

  it('rejects a tx with reimbursement below minLamports', function () {
    const message: TransactionMessage = {
      numSigners: 1,
      numWritableSigners: 1,
      numWritableNonSigners: 2,
      accountKeys: [vault, SystemProgram.programId, paymaster],
      instructions: [
        {
          programIdIndex: 1,
          accountIndexes: [0, 2],
          data: encodeSystemTransferData(1000), // 0.000001 SOL — way under
        },
      ],
    };
    const tx = makeOuterTx({
      paymaster,
      ixs: [buildCreateTransactionIx(message)],
    });
    expect(() => validateReimbursement(tx, paymaster, MIN_LAMPORTS)).to.throw(
      /must reimburse paymaster/,
    );
  });

  it('rejects a tx with no transfer to paymaster (transfers to other addresses only)', function () {
    const message: TransactionMessage = {
      numSigners: 1,
      numWritableSigners: 1,
      numWritableNonSigners: 2,
      accountKeys: [vault, recipient, SystemProgram.programId],
      instructions: [
        {
          programIdIndex: 2,
          accountIndexes: [0, 1],
          data: encodeSystemTransferData(MIN_LAMPORTS), // sent to RECIPIENT, not paymaster
        },
      ],
    };
    const tx = makeOuterTx({
      paymaster,
      ixs: [buildCreateTransactionIx(message)],
    });
    expect(() => validateReimbursement(tx, paymaster, MIN_LAMPORTS)).to.throw(
      /must reimburse paymaster/,
    );
  });

  it('rejects a tx with no create_transaction ix at all', function () {
    const tx = makeOuterTx({
      paymaster,
      ixs: [
        // Just a SystemProgram transfer at the OUTER level — even if it
        // pays the paymaster, validation requires the multisig program's
        // create_transaction ix to be present.
        SystemProgram.transfer({
          fromPubkey: vault,
          toPubkey: paymaster,
          lamports: MIN_LAMPORTS,
        }),
      ],
    });
    expect(() => validateReimbursement(tx, paymaster, MIN_LAMPORTS)).to.throw(
      /does not contain a create_transaction/,
    );
  });

  it('ignores non-System programs (e.g. token transfers cannot satisfy reimbursement)', function () {
    // Build a proposal whose only ix is a token transfer. Even if the
    // accounts include the paymaster, it doesn't count as a SOL transfer
    // to paymaster (must be SystemProgram::Transfer).
    const tokenProgram = new PublicKey(
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    );
    const message: TransactionMessage = {
      numSigners: 1,
      numWritableSigners: 1,
      numWritableNonSigners: 1,
      accountKeys: [vault, paymaster, tokenProgram],
      instructions: [
        {
          programIdIndex: 2, // TOKEN_PROGRAM, not SystemProgram
          accountIndexes: [0, 1],
          data: encodeSystemTransferData(MIN_LAMPORTS),
        },
      ],
    };
    const tx = makeOuterTx({
      paymaster,
      ixs: [buildCreateTransactionIx(message)],
    });
    expect(() => validateReimbursement(tx, paymaster, MIN_LAMPORTS)).to.throw(
      /must reimburse paymaster/,
    );
  });
});
