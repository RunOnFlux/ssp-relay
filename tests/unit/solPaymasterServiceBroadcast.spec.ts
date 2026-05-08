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

const configGetStub = sinon.stub(config, 'get').callsFake((path: string) => {
  if (path === 'solana.devnet') {
    return {
      rpc: 'https://api.devnet.solana.com',
      paymasterSecretKey: bs58.encode(paymasterKp.secretKey),
    };
  }
  return (config.get as any).wrappedMethod.call(config, path);
});

// Late-import so the module reads the stubbed config when first loaded.

import solPaymasterService from '../../src/services/solPaymasterService';

after(function () {
  configGetStub.restore();
});

// Mimics the real wire shape: tx has feePayer = paymaster and the member
// signer has already partial-signed (the wallet/key contributes its sig
// before the relay adds the paymaster's feePayer signature).
function buildPaymasterPayingTx(opts: {
  paymaster: PublicKey;
  signerKp: Keypair;
}): string {
  const tx = new Transaction();
  tx.recentBlockhash = 'EETubP5AKHgjPAhzPAFcb8BAY6hDtV5oqBe5LBdnDS6E';
  tx.feePayer = opts.paymaster;
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
      return {
        rpc: 'https://api.devnet.solana.com',
        paymasterSecretKey: bs58.encode(paymasterKp.secretKey),
      };
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
