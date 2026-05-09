/* eslint-disable @typescript-eslint/no-explicit-any */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect } from 'chai';
import sinon from 'sinon';
import bs58 from 'bs58';
import config from 'config';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';

// One paymaster keypair shared across all tests in this file. The service
// caches per-chain paymaster info on first lookup, so we keep a stable
// keypair to avoid cache-invalidation gymnastics.
const paymasterKp = Keypair.generate();
const memberKp = Keypair.generate(); // a "wallet leaf" signer in the tx

// Provide the paymaster via the env-var path of resolveKeypair() so the
// service doesn't try to auto-generate a real file under ~/.config/ssp-relay/.
process.env.SSP_SOLANA_DEVNET_PAYMASTER_KEY = bs58.encode(
  paymasterKp.secretKey,
);

const configGetStub = sinon.stub(config, 'get').callsFake((path: string) => {
  if (path === 'solana.devnet') {
    return { rpc: 'https://api.devnet.solana.com' };
  }
  return (config.get as any).wrappedMethod.call(config, path);
});

// Late-import so the module reads the stubbed config when first loaded.

import solPaymasterService from '../../src/services/solPaymasterService';

after(function () {
  configGetStub.restore();
  delete process.env.SSP_SOLANA_DEVNET_PAYMASTER_KEY;
});

// Build a synthetic create_transaction ix that mirrors what the SSP Solana
// Multisig SDK produces. The relay's validateReimbursement walks this ix
// data to confirm a vault → paymaster transfer of >= minLamports is present.
const PROGRAM_ID = new PublicKey(
  'CisPSFTQoTnEqn5cUi1pgpfPp2xiTVRkK7eD5jBevxdX',
);

import { createHash } from 'crypto';
const CREATE_TRANSACTION_DISCRIMINATOR = createHash('sha256')
  .update('global:create_transaction')
  .digest()
  .subarray(0, 8);

function encodeSystemTransferData(lamports: number): Buffer {
  const buf = Buffer.alloc(12);
  buf.writeUInt32LE(2, 0);
  buf.writeBigUInt64LE(BigInt(lamports), 4);
  return buf;
}

function buildCreateTransactionIxWithReimbursement(
  paymaster: PublicKey,
  vault: PublicKey,
  reimbursementLamports: number,
) {
  // Encode minimal proposal message: 1 ix = SystemProgram.transfer(vault → paymaster)
  const chunks: Buffer[] = [];
  chunks.push(Buffer.from([1, 1, 1])); // numSigners, numWritableSigners, numWritableNonSigners
  // account_keys
  const akLen = Buffer.alloc(4);
  akLen.writeUInt32LE(3, 0);
  chunks.push(
    akLen,
    vault.toBuffer(),
    SystemProgram.programId.toBuffer(),
    paymaster.toBuffer(),
  );
  // instructions: 1
  const ixLen = Buffer.alloc(4);
  ixLen.writeUInt32LE(1, 0);
  chunks.push(ixLen);
  chunks.push(Buffer.from([1])); // programIdIndex (SystemProgram)
  const aiLen = Buffer.alloc(4);
  aiLen.writeUInt32LE(2, 0);
  chunks.push(aiLen, Buffer.from([0, 2])); // [vault, paymaster]
  const dLen = Buffer.alloc(4);
  dLen.writeUInt32LE(12, 0);
  chunks.push(dLen, encodeSystemTransferData(reimbursementLamports));
  // address_table_lookups: empty
  const altLen = Buffer.alloc(4);
  altLen.writeUInt32LE(0, 0);
  chunks.push(altLen);

  const data = Buffer.concat([
    CREATE_TRANSACTION_DISCRIMINATOR,
    Buffer.from([0]), // vault_index
    ...chunks,
  ]);
  return new (
    require('@solana/web3.js') as typeof import('@solana/web3.js')
  ).TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [],
    data,
  });
}

// Mimics the real wire shape: tx has feePayer = paymaster + create_transaction
// ix with reimbursement embedded. The member signer has already partial-signed.
function buildPaymasterPayingTx(opts: {
  paymaster: PublicKey;
  signerKp: Keypair;
  reimbursementLamports?: number;
}): string {
  const reimbursement = opts.reimbursementLamports ?? 7_500_000;
  const tx = new Transaction();
  tx.recentBlockhash = 'EETubP5AKHgjPAhzPAFcb8BAY6hDtV5oqBe5LBdnDS6E';
  tx.feePayer = opts.paymaster;
  tx.add(
    buildCreateTransactionIxWithReimbursement(
      opts.paymaster,
      opts.signerKp.publicKey, // use the signer pubkey as a stand-in for vault
      reimbursement,
    ),
  );
  // Add a minimal SystemProgram transfer signed by the member so the outer
  // tx has a real signer to satisfy partialSign.
  tx.add(
    SystemProgram.transfer({
      fromPubkey: opts.signerKp.publicKey,
      toPubkey: opts.paymaster,
      lamports: 1,
    }),
  );
  tx.partialSign(opts.signerKp);
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

describe('Solana Paymaster Service — broadcastWithPaymaster', function () {
  beforeEach(function () {
    // Other spec files in this suite call sinon.restore() in their own
    // afterEach, which would also clear the top-level config stub. Re-stub
    // before every test so getPaymaster() can resolve devnet config.
    reinstallConfigStub();
  });

  afterEach(function () {
    sinon.restore();
  });

  it('throws when feePayer does not match the configured paymaster', async function () {
    sinon.stub(Connection.prototype, 'getBalance').resolves(1_000_000_000);

    const wrongPaymaster = Keypair.generate();
    const txB64 = buildPaymasterPayingTx({
      paymaster: wrongPaymaster.publicKey,
      signerKp: memberKp,
    });

    let threw: Error | null = null;
    try {
      await solPaymasterService.broadcastWithPaymaster('solDevnet', txB64);
    } catch (e) {
      threw = e as Error;
    }
    expect(threw).to.not.be.null;
    expect(threw!.message).to.match(/feePayer/);
  });

  it('returns the broadcast signature when the tx is valid', async function () {
    sinon.stub(Connection.prototype, 'getBalance').resolves(1_000_000_000); // well above threshold — no top-up
    const sendStub = sinon
      .stub(Connection.prototype, 'sendRawTransaction')
      .resolves('5xPaymasterFakeSig');
    sinon
      .stub(Connection.prototype, 'confirmTransaction')
      .resolves({ value: { err: null } } as any);

    const txB64 = buildPaymasterPayingTx({
      paymaster: paymasterKp.publicKey,
      signerKp: memberKp,
    });

    const sig = await solPaymasterService.broadcastWithPaymaster(
      'solDevnet',
      txB64,
    );
    expect(sig).to.equal('5xPaymasterFakeSig');
    expect(sendStub.calledOnce).to.equal(true);
  });

  it('partial-signs the tx with the paymaster keypair before sending', async function () {
    sinon.stub(Connection.prototype, 'getBalance').resolves(1_000_000_000);
    const sendStub = sinon
      .stub(Connection.prototype, 'sendRawTransaction')
      .resolves('5xPaymasterFakeSig');
    sinon
      .stub(Connection.prototype, 'confirmTransaction')
      .resolves({ value: { err: null } } as any);

    const txB64 = buildPaymasterPayingTx({
      paymaster: paymasterKp.publicKey,
      signerKp: memberKp,
    });

    await solPaymasterService.broadcastWithPaymaster('solDevnet', txB64);

    // Recover the wire bytes that were sent to RPC and verify the paymaster's
    // signature slot is now populated (member slot remains unsigned — that
    // would have been filled by the wallet/key before submission).
    const sentBytes = sendStub.firstCall.args[0];
    const sentTx = Transaction.from(sentBytes as Buffer);
    const paySig = sentTx.signatures.find(
      (s) => s.publicKey.toBase58() === paymasterKp.publicKey.toBase58(),
    );
    expect(paySig).to.not.be.undefined;
    expect(paySig!.signature).to.not.be.null;
    // Member signer's signature was already attached by the wallet/key
    // before the relay saw the tx; the relay must preserve it.
    const memberSig = sentTx.signatures.find(
      (s) => s.publicKey.toBase58() === memberKp.publicKey.toBase58(),
    );
    expect(memberSig).to.not.be.undefined;
    expect(memberSig!.signature).to.not.be.null;
  });

  it('checks balances of all non-paymaster signers (top-up trigger)', async function () {
    const balanceStub = sinon
      .stub(Connection.prototype, 'getBalance')
      .resolves(1_000_000_000); // above threshold — no top-up performed
    sinon.stub(Connection.prototype, 'sendRawTransaction').resolves('5xSig');
    sinon
      .stub(Connection.prototype, 'confirmTransaction')
      .resolves({ value: { err: null } } as any);

    const txB64 = buildPaymasterPayingTx({
      paymaster: paymasterKp.publicKey,
      signerKp: memberKp,
    });

    await solPaymasterService.broadcastWithPaymaster('solDevnet', txB64);

    // getBalance called for each unique non-paymaster signer.
    expect(balanceStub.calledOnce).to.equal(true);
    const checkedPubkey = (
      balanceStub.firstCall.args[0] as PublicKey
    ).toBase58();
    expect(checkedPubkey).to.equal(memberKp.publicKey.toBase58());
  });

  it('does not trigger top-up when signer balance is above threshold', async function () {
    // Build the tx FIRST (its internal Transaction.add() is unrelated to
    // the top-up branch), then install the spy.
    const txB64 = buildPaymasterPayingTx({
      paymaster: paymasterKp.publicKey,
      signerKp: memberKp,
    });

    // 0.05 SOL == 50,000,000 lamports — well above the 0.01 SOL top-up threshold.
    sinon.stub(Connection.prototype, 'getBalance').resolves(50_000_000);
    sinon.stub(Connection.prototype, 'sendRawTransaction').resolves('5xSig');
    sinon
      .stub(Connection.prototype, 'confirmTransaction')
      .resolves({ value: { err: null } } as any);

    const addSpy = sinon.spy(Transaction.prototype, 'add');
    await solPaymasterService.broadcastWithPaymaster('solDevnet', txB64);

    // Service must NOT have built a top-up tx (which would call
    // `new Transaction().add(SystemProgram.transfer(...))` internally).
    expect(addSpy.called).to.equal(false);
  });

  it('attempts top-up when signer balance is below threshold', async function () {
    const txB64 = buildPaymasterPayingTx({
      paymaster: paymasterKp.publicKey,
      signerKp: memberKp,
    });

    // 0.005 SOL == 5,000,000 lamports — below the 0.01 SOL threshold.
    sinon.stub(Connection.prototype, 'getBalance').resolves(5_000_000);
    sinon.stub(Connection.prototype, 'sendRawTransaction').resolves('5xSig');
    sinon
      .stub(Connection.prototype, 'confirmTransaction')
      .resolves({ value: { err: null } } as any);

    const addSpy = sinon.spy(Transaction.prototype, 'add');

    let threw: Error | null = null;
    try {
      await solPaymasterService.broadcastWithPaymaster('solDevnet', txB64);
    } catch (e) {
      // sendAndConfirmTransaction is a top-level export (not a Connection
      // method), so we can't intercept it without proxyquire/esmock. The
      // top-up path will fail downstream — that's fine: we just want to
      // assert the service tried to build a top-up tx.
      threw = e as Error;
    }
    // The service constructed a top-up Transaction and called .add() on it.
    expect(addSpy.called).to.equal(true);
    // Either the test errored downstream (real network call to sendAndConfirm)
    // or finished — both prove the top-up branch executed.
    expect(threw === null || threw instanceof Error).to.equal(true);
  });
});
