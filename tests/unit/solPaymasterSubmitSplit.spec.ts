/* eslint-disable @typescript-eslint/no-explicit-any */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect } from 'chai';
import sinon from 'sinon';
import bs58 from 'bs58';
import config from 'config';
import { createHash } from 'crypto';
import {
  Connection,
  Keypair,
  PublicKey,
  SendTransactionError,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';

// Stable paymaster keypair (service caches per-chain on first lookup). The
// env var is set BEFORE the service module is imported so resolveKeypair takes
// the env path (no real file/auto-gen). If another spec in the same mocha
// process already configured a devnet paymaster, the service's per-chain cache
// wins — so we resolve the live paymaster pubkey dynamically rather than
// assuming our own keypair.
const signerKp = Keypair.generate();

if (!process.env.SSP_SOLANA_DEVNET_PAYMASTER_KEY) {
  process.env.SSP_SOLANA_DEVNET_PAYMASTER_KEY = bs58.encode(
    Keypair.generate().secretKey,
  );
}

import solPaymasterService from '../../src/services/solPaymasterService';

// Resolved once in before() — works whether or not a sibling spec already
// cached the devnet paymaster.
let paymasterPubkey: PublicKey;

const SOL_MULTISIG_PROGRAM_ID = new PublicKey(
  'CisPSFTQoTnEqn5cUi1pgpfPp2xiTVRkK7eD5jBevxdX',
);

function anchorDisc(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}
const EXECUTE_DISC = anchorDisc('execute_transaction');
const CLOSE_DISC = anchorDisc('close_transaction');
const APPROVE_DISC = anchorDisc('approve_transaction');

function multisigIx(disc: Buffer): TransactionInstruction {
  return new TransactionInstruction({
    programId: SOL_MULTISIG_PROGRAM_ID,
    keys: [],
    data: Buffer.concat([disc, Buffer.from([0])]),
  });
}

// A valid execute tx: execute_transaction + close_transaction, feePayer =
// paymaster, fresh blockhash (no nonceAdvance for execute kind).
function buildExecuteTxB64(paymaster: PublicKey): string {
  const tx = new Transaction();
  tx.recentBlockhash = 'EETubP5AKHgjPAhzPAFcb8BAY6hDtV5oqBe5LBdnDS6E';
  tx.feePayer = paymaster;
  tx.add(multisigIx(EXECUTE_DISC));
  tx.add(multisigIx(CLOSE_DISC));
  return tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString('base64');
}

function reinstallConfigStub() {
  if ((config.get as any).restore) {
    (config.get as any).restore();
  }
  sinon.stub(config, 'get').callsFake((path: string) => {
    if (path === 'solana.devnet') {
      return { rpc: 'https://api.devnet.solana.com' };
    }
    return undefined;
  });
}

describe('Solana Paymaster Service — submitSplitTx', function () {
  before(function () {
    reinstallConfigStub();
    paymasterPubkey = new PublicKey(
      solPaymasterService.getPaymasterPubkey('solDevnet'),
    );
  });
  beforeEach(function () {
    reinstallConfigStub();
  });
  afterEach(function () {
    sinon.restore();
  });

  it('returns an error (not throw) when feePayer does not match the paymaster', async function () {
    const wrong = Keypair.generate();
    const txB64 = buildExecuteTxB64(wrong.publicKey);
    const result = await solPaymasterService.submitSplitTx({
      chain: 'solDevnet',
      partialSignedTxBase64: txB64,
      kind: 'execute',
    });
    expect(result.error).to.match(/feePayer/);
    expect(result.txid).to.equal(undefined);
  });

  it('submits a valid execute tx and returns txid + landed:true', async function () {
    const sendStub = sinon
      .stub(Connection.prototype, 'sendRawTransaction')
      .resolves('5xSplitExecuteSig');
    sinon
      .stub(Connection.prototype, 'confirmTransaction')
      .resolves({ value: { err: null } } as any);

    const txB64 = buildExecuteTxB64(paymasterPubkey);
    const result = await solPaymasterService.submitSplitTx({
      chain: 'solDevnet',
      partialSignedTxBase64: txB64,
      kind: 'execute',
    });
    expect(result.txid).to.equal('5xSplitExecuteSig');
    expect(result.landed).to.equal(true);
    expect(result.error).to.equal(undefined);
    expect(sendStub.calledOnce).to.equal(true);
  });

  it('treats a structured AlreadyExecuted (Custom:6008) confirm error on execute as SUCCESS (front-run tolerance)', async function () {
    sinon
      .stub(Connection.prototype, 'sendRawTransaction')
      .resolves('5xFrontRunSig');
    // The REALISTIC shape: confirmTransaction().value.err for the program's
    // AlreadyExecuted is { InstructionError: [ixIndex, { Custom: 6008 }] }.
    // The previous test fed the literal string "AlreadyExecuted", which the
    // structured err NEVER contains — so the detection was dead code.
    sinon.stub(Connection.prototype, 'confirmTransaction').resolves({
      value: { err: { InstructionError: [1, { Custom: 6008 }] } },
    } as any);

    const txB64 = buildExecuteTxB64(paymasterPubkey);
    const result = await solPaymasterService.submitSplitTx({
      chain: 'solDevnet',
      partialSignedTxBase64: txB64,
      kind: 'execute',
    });
    // Reported via the pinned `alreadyExecuted` field, NOT by overloading txid.
    expect(result.alreadyExecuted).to.equal(true);
    expect(result.landed).to.equal(true);
    expect(result.error).to.equal(undefined);
    expect(result.txid).to.equal(undefined);
  });

  it('treats a preflight-throw AlreadyExecuted (SendTransactionError logs) on execute as SUCCESS', async function () {
    // skipPreflight=false: an already-executed proposal makes sendRawTransaction
    // THROW a SendTransactionError during simulation BEFORE any confirm. The
    // Anchor failure surfaces in the simulation logs (custom program error:
    // 0x1778 == 6008, and the error name).
    const sendErr = new SendTransactionError({
      action: 'send',
      signature: '5xPreflightSig',
      transactionMessage: 'Transaction simulation failed',
      logs: [
        'Program CisPSFTQoTnEqn5cUi1pgpfPp2xiTVRkK7eD5jBevxdX invoke [1]',
        'Program log: AnchorError occurred. Error Code: AlreadyExecuted. Error Number: 6008.',
        'Program CisPSFTQoTnEqn5cUi1pgpfPp2xiTVRkK7eD5jBevxdX failed: custom program error: 0x1778',
      ],
    });
    sinon.stub(Connection.prototype, 'sendRawTransaction').rejects(sendErr);
    const confirmStub = sinon.stub(Connection.prototype, 'confirmTransaction');

    const txB64 = buildExecuteTxB64(paymasterPubkey);
    const result = await solPaymasterService.submitSplitTx({
      chain: 'solDevnet',
      partialSignedTxBase64: txB64,
      kind: 'execute',
    });
    expect(result.alreadyExecuted).to.equal(true);
    // The tx never landed (no nonce advance) — landed must NOT be set.
    expect(result.landed).to.equal(undefined);
    expect(result.error).to.equal(undefined);
    expect(confirmStub.called).to.equal(false);
  });

  it('does NOT treat a different Custom error (6001 ≠ 6008) on execute as AlreadyExecuted', async function () {
    sinon
      .stub(Connection.prototype, 'sendRawTransaction')
      .resolves('5xOtherCustomSig');
    // Custom 6001 = TooManyMembers — must NOT be mistaken for AlreadyExecuted.
    sinon.stub(Connection.prototype, 'confirmTransaction').resolves({
      value: { err: { InstructionError: [0, { Custom: 6001 }] } },
    } as any);

    const txB64 = buildExecuteTxB64(paymasterPubkey);
    const result = await solPaymasterService.submitSplitTx({
      chain: 'solDevnet',
      partialSignedTxBase64: txB64,
      kind: 'execute',
    });
    expect(result.alreadyExecuted).to.equal(undefined);
    expect(result.landed).to.equal(true);
    expect(result.error).to.match(/landed but failed on-chain/);
    expect(result.txid).to.equal(undefined);
  });

  it('AlreadyExecuted detection is honored ONLY for kind=execute (a non-execute Custom:6008 still fails)', async function () {
    // A create/approve tx with Custom:6008 in value.err is NOT treated as
    // success — the AlreadyExecuted tolerance is scoped to kind='execute' (§5).
    sinon
      .stub(Connection.prototype, 'sendRawTransaction')
      .resolves('5xApproveSig');
    sinon.stub(Connection.prototype, 'confirmTransaction').resolves({
      value: { err: { InstructionError: [1, { Custom: 6008 }] } },
    } as any);

    const tx = new Transaction();
    tx.recentBlockhash = 'EETubP5AKHgjPAhzPAFcb8BAY6hDtV5oqBe5LBdnDS6E';
    tx.feePayer = paymasterPubkey;
    // The paymaster is the only signer it can supply via partialSign, so the
    // nonce authority is the paymaster here — otherwise serialize() throws a
    // missing-signature error and we never reach the confirm path.
    tx.add(
      SystemProgram.nonceAdvance({
        noncePubkey: Keypair.generate().publicKey,
        authorizedPubkey: paymasterPubkey,
      }),
    );
    tx.add(multisigIx(APPROVE_DISC));
    const txB64 = tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString('base64');

    const result = await solPaymasterService.submitSplitTx({
      chain: 'solDevnet',
      partialSignedTxBase64: txB64,
      kind: 'approve',
    });
    expect(result.alreadyExecuted).to.equal(undefined);
    expect(result.landed).to.equal(true);
    expect(result.error).to.match(/landed but failed on-chain/);
  });

  it('returns landed:true with an error on a NON-AlreadyExecuted confirmed-with-error (nonce advanced)', async function () {
    sinon
      .stub(Connection.prototype, 'sendRawTransaction')
      .resolves('5xFailedSig');
    sinon.stub(Connection.prototype, 'confirmTransaction').resolves({
      value: { err: { InstructionError: [0, 'ConstraintSeeds'] } },
    } as any);

    const txB64 = buildExecuteTxB64(paymasterPubkey);
    const result = await solPaymasterService.submitSplitTx({
      chain: 'solDevnet',
      partialSignedTxBase64: txB64,
      kind: 'execute',
    });
    expect(result.landed).to.equal(true);
    expect(result.error).to.match(/landed but failed on-chain/);
    expect(result.txid).to.equal(undefined);
    expect(result.alreadyExecuted).to.equal(undefined);
  });

  it('(e) rejects a tx exceeding the 1232-byte packet limit without sending', async function () {
    const sendStub = sinon.stub(Connection.prototype, 'sendRawTransaction');
    // The size cap is checked on the raw decoded bytes BEFORE any parsing, so a
    // blob that simply decodes to > 1232 bytes must be rejected outright. (A
    // real Transaction.serialize() throws its own RangeError at this size, so
    // we hand an oversized opaque blob to exercise the service's own guard.)
    const oversized = Buffer.alloc(1300, 7).toString('base64');

    const result = await solPaymasterService.submitSplitTx({
      chain: 'solDevnet',
      partialSignedTxBase64: oversized,
      kind: 'execute',
    });
    expect(result.error).to.match(/1232-byte packet limit/);
    expect(sendStub.called).to.equal(false);
  });

  it('rejects (without sending) a tx whose instructions fail the allowlist', async function () {
    const sendStub = sinon.stub(Connection.prototype, 'sendRawTransaction');
    // execute kind but tx only has a nonceAdvance — fails the allowlist.
    const tx = new Transaction();
    tx.recentBlockhash = 'EETubP5AKHgjPAhzPAFcb8BAY6hDtV5oqBe5LBdnDS6E';
    tx.feePayer = paymasterPubkey;
    tx.add(
      SystemProgram.nonceAdvance({
        noncePubkey: Keypair.generate().publicKey,
        authorizedPubkey: signerKp.publicKey,
      }),
    );
    const txB64 = tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString('base64');

    const result = await solPaymasterService.submitSplitTx({
      chain: 'solDevnet',
      partialSignedTxBase64: txB64,
      kind: 'execute',
    });
    expect(result.error).to.be.a('string');
    expect(sendStub.called).to.equal(false);
  });
});
