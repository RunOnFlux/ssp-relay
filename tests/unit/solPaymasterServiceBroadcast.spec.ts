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
import {
  resetPaymasterBreaker,
  MAX_FAILURES_PER_MULTISIG,
  MAX_FAILURES_PER_CLIENT,
} from '../../src/services/solPaymasterBreaker';

after(function () {
  configGetStub.restore();
  delete process.env.SSP_SOLANA_DEVNET_PAYMASTER_KEY;
});

import { buildBundle, assemble } from './helpers/solBundle';

// A real SSP bundle (wallet shape), signed by the wallet and Key leaves the
// way SSP Wallet + SSP Key do before the Key posts it to /v1/sol/broadcast.
async function buildSignedBundle(opts: {
  paymaster: PublicKey;
  spl?: boolean;
  reimbursementLamports?: number;
  wallet?: Keypair;
  key?: Keypair;
}): Promise<string> {
  const { ixs, ctx } = await buildBundle({
    paymaster: opts.paymaster,
    spl: opts.spl,
    reimbursementLamports: opts.reimbursementLamports,
    wallet: opts.wallet,
    key: opts.key,
  });
  const tx = assemble(ixs, opts.paymaster);
  tx.partialSign(ctx.wallet, ctx.key);
  return tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString('base64');
}

// The pre-fix shape: nonceAdvance + a create_transaction carrying a
// reimbursement claim, nothing that executes it.
function legacyShapeTx(paymaster: PublicKey): string {
  const PROGRAM_ID = new PublicKey(
    'CisPSFTQoTnEqn5cUi1pgpfPp2xiTVRkK7eD5jBevxdX',
  );
  const { createHash } = require('crypto');
  const disc = createHash('sha256')
    .update('global:create_transaction')
    .digest()
    .subarray(0, 8);
  const vault = Keypair.generate().publicKey;
  const t = Buffer.alloc(12);
  t.writeUInt32LE(2, 0);
  t.writeBigUInt64LE(7_500_000n, 4);
  const u32 = (n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return b;
  };
  const data = Buffer.concat([
    disc,
    Buffer.from([0, 1, 1, 1]),
    u32(3),
    vault.toBuffer(),
    SystemProgram.programId.toBuffer(),
    paymaster.toBuffer(),
    u32(1),
    Buffer.from([1]),
    u32(2),
    Buffer.from([0, 2]),
    u32(12),
    t,
    u32(0),
  ]);
  const tx = new Transaction();
  tx.recentBlockhash = 'EETubP5AKHgjPAhzPAFcb8BAY6hDtV5oqBe5LBdnDS6E';
  tx.feePayer = paymaster;
  tx.add(
    SystemProgram.nonceAdvance({
      noncePubkey: Keypair.generate().publicKey,
      authorizedPubkey: memberKp.publicKey,
    }),
  );
  tx.add(
    new (require('@solana/web3.js').TransactionInstruction)({
      programId: PROGRAM_ID,
      keys: [],
      data,
    }),
  );
  tx.partialSign(memberKp);
  return tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString('base64');
}

function stubSimulation(postDelta: number, pre = 1_000_000_000) {
  const balance = sinon.stub(Connection.prototype, 'getBalance').resolves(pre);
  const simulate = sinon
    .stub(Connection.prototype, 'simulateTransaction')
    .resolves({
      context: { slot: 1 },
      value: {
        err: null,
        logs: [],
        accounts: [
          { lamports: pre + postDelta, owner: '', data: [], executable: false },
        ],
      },
    } as any);
  return { balance, simulate };
}

function stubSendAndConfirm(sig = '5xPaymasterFakeSig') {
  const send = sinon
    .stub(Connection.prototype, 'sendRawTransaction')
    .resolves(sig);
  sinon.stub(Connection.prototype, 'getSignatureStatuses').resolves({
    value: [{ err: null, confirmationStatus: 'confirmed' }],
  } as any);
  return send;
}

async function expectThrow(fn, pattern) {
  let threw: Error | null = null;
  try {
    await fn();
  } catch (e) {
    threw = e as Error;
  }
  expect(threw, 'expected a rejection').to.not.equal(null);
  expect(threw!.message).to.match(pattern);
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
    resetPaymasterBreaker();
  });

  afterEach(function () {
    sinon.restore();
  });

  it('throws when feePayer does not match the configured paymaster', async function () {
    stubSimulation(95_000);
    const wrongPaymaster = Keypair.generate();
    const txB64 = await buildSignedBundle({
      paymaster: wrongPaymaster.publicKey,
    });
    await expectThrow(
      () => solPaymasterService.broadcastWithPaymaster('solDevnet', txB64),
      /feePayer/,
    );
  });

  it('returns the broadcast signature when the tx is valid', async function () {
    const { simulate } = stubSimulation(95_000);
    const sendStub = stubSendAndConfirm();
    const txB64 = await buildSignedBundle({ paymaster: paymasterKp.publicKey });

    const sig = await solPaymasterService.broadcastWithPaymaster(
      'solDevnet',
      txB64,
    );
    expect(sig).to.equal('5xPaymasterFakeSig');
    expect(sendStub.calledOnce).to.equal(true);
    expect(simulate.calledOnce).to.equal(true);
    // the simulation asked for the paymaster account only
    const cfg = simulate.firstCall.args[1];
    expect(cfg.accounts.addresses).to.deep.equal([
      paymasterKp.publicKey.toBase58(),
    ]);
    expect(cfg.replaceRecentBlockhash).to.equal(false);
  });

  it('partial-signs the tx with the paymaster keypair before sending', async function () {
    stubSimulation(95_000);
    const sendStub = stubSendAndConfirm();
    const txB64 = await buildSignedBundle({ paymaster: paymasterKp.publicKey });

    await solPaymasterService.broadcastWithPaymaster('solDevnet', txB64);

    // Recover the wire bytes that were sent to RPC and verify the paymaster's
    // signature slot is now populated and the members' signatures survived.
    const sentBytes = sendStub.firstCall.args[0];
    const sentTx = Transaction.from(sentBytes as Buffer);
    for (const s of sentTx.signatures) {
      expect(s.signature, s.publicKey.toBase58()).to.not.equal(null);
    }
    expect(
      sentTx.signatures.some(
        (s) => s.publicKey.toBase58() === paymasterKp.publicKey.toBase58(),
      ),
    ).to.equal(true);
    expect(sentTx.verifySignatures()).to.equal(true);
  });

  it('refuses (and never sends) when the simulation shows the paymaster losing more than its fee', async function () {
    const { simulate } = stubSimulation(-1_000_000);
    const sendStub = stubSendAndConfirm();
    const txB64 = await buildSignedBundle({ paymaster: paymasterKp.publicKey });
    await expectThrow(
      () => solPaymasterService.broadcastWithPaymaster('solDevnet', txB64),
      /lose more than its network fee/,
    );
    expect(sendStub.called).to.equal(false);
    // re-checked once to rule out a concurrent balance change
    expect(simulate.callCount).to.equal(2);
  });

  it('accepts a loss within the signature fee + priority fee cap', async function () {
    stubSimulation(-(3 * 5_000 + 50_000));
    stubSendAndConfirm();
    const txB64 = await buildSignedBundle({ paymaster: paymasterKp.publicKey });
    const sig = await solPaymasterService.broadcastWithPaymaster(
      'solDevnet',
      txB64,
    );
    expect(sig).to.equal('5xPaymasterFakeSig');
  });

  it('refuses when the simulation fails or omits the paymaster account', async function () {
    sinon.stub(Connection.prototype, 'getBalance').resolves(1_000_000_000);
    const simulate = sinon
      .stub(Connection.prototype, 'simulateTransaction')
      .resolves({
        context: { slot: 1 },
        value: { err: { InstructionError: [3, { Custom: 1 }] }, logs: [] },
      } as any);
    const sendStub = stubSendAndConfirm();
    const txB64 = await buildSignedBundle({ paymaster: paymasterKp.publicKey });
    await expectThrow(
      () => solPaymasterService.broadcastWithPaymaster('solDevnet', txB64),
      /simulation failed/,
    );
    simulate.resolves({
      context: { slot: 1 },
      value: { err: null, logs: [], accounts: [null] },
    } as any);
    await expectThrow(
      () => solPaymasterService.broadcastWithPaymaster('solDevnet', txB64),
      /did not return the paymaster account/,
    );
    expect(sendStub.called).to.equal(false);
  });

  it('rejects the pre-fix shape (create_transaction claim with no execute/close)', async function () {
    stubSimulation(95_000);
    const sendStub = stubSendAndConfirm();
    await expectThrow(
      () =>
        solPaymasterService.broadcastWithPaymaster(
          'solDevnet',
          legacyShapeTx(paymasterKp.publicKey),
        ),
      /instruction count|SSP multisig/,
    );
    expect(sendStub.called).to.equal(false);
  });

  it('enforces the ATA rent floor when the bound recipient ATA does not exist', async function () {
    stubSimulation(95_000);
    const sendStub = stubSendAndConfirm();
    sinon.stub(Connection.prototype, 'getAccountInfo').resolves(null);
    const txB64 = await buildSignedBundle({
      paymaster: paymasterKp.publicKey,
      spl: true,
      reimbursementLamports: 100_000, // below min + splFeeBump
    });
    await expectThrow(
      () => solPaymasterService.broadcastWithPaymaster('solDevnet', txB64),
      /requires at least/,
    );
    expect(sendStub.called).to.equal(false);
  });

  it('only reads the paymaster balance (no signer balance lookups or extra txs)', async function () {
    const { balance } = stubSimulation(95_000);
    stubSendAndConfirm('5xSig');
    const txB64 = await buildSignedBundle({ paymaster: paymasterKp.publicKey });

    const addSpy = sinon.spy(Transaction.prototype, 'add');
    await solPaymasterService.broadcastWithPaymaster('solDevnet', txB64);

    for (const call of balance.getCalls()) {
      expect(call.args[0].toBase58()).to.equal(
        paymasterKp.publicKey.toBase58(),
      );
    }
    // No internal Transaction.add() — the broadcast service doesn't build
    // its own auxiliary txs.
    expect(addSpy.called).to.equal(false);
  });
  describe('failure breaker (bundles that land but fail on-chain)', function () {
    function stubLandedFailure() {
      const send = sinon
        .stub(Connection.prototype, 'sendRawTransaction')
        .resolves('5xFailedSig');
      const statuses = sinon
        .stub(Connection.prototype, 'getSignatureStatuses')
        .resolves({
          value: [
            {
              err: { InstructionError: [4, { Custom: 1 }] },
              confirmationStatus: 'confirmed',
            },
          ],
        } as any);
      return { send, statuses };
    }

    it('stops sponsoring a multisig after repeated landed failures, before signing', async function () {
      const { simulate } = stubSimulation(95_000);
      const { send } = stubLandedFailure();
      const wallet = Keypair.generate();
      const key = Keypair.generate();
      for (let i = 0; i < MAX_FAILURES_PER_MULTISIG; i++) {
        const txB64 = await buildSignedBundle({
          paymaster: paymasterKp.publicKey,
          wallet,
          key,
        });
        await expectThrow(
          () => solPaymasterService.broadcastWithPaymaster('solDevnet', txB64),
          /landed but failed on-chain/,
        );
      }
      expect(send.callCount).to.equal(MAX_FAILURES_PER_MULTISIG);
      const simsBefore = simulate.callCount;
      const next = await buildSignedBundle({
        paymaster: paymasterKp.publicKey,
        wallet,
        key,
      });
      await expectThrow(
        () => solPaymasterService.broadcastWithPaymaster('solDevnet', next),
        /sponsorship refused.*multisig/,
      );
      expect(send.callCount).to.equal(MAX_FAILURES_PER_MULTISIG);
      expect(simulate.callCount).to.equal(simsBefore);
      // another vault is unaffected
      const other = await buildSignedBundle({
        paymaster: paymasterKp.publicKey,
      });
      await expectThrow(
        () => solPaymasterService.broadcastWithPaymaster('solDevnet', other),
        /landed but failed on-chain/,
      );
    });

    it('stops sponsoring a client (IP key) after repeated landed failures across vaults', async function () {
      stubSimulation(95_000);
      const { send } = stubLandedFailure();
      for (let i = 0; i < MAX_FAILURES_PER_CLIENT; i++) {
        const txB64 = await buildSignedBundle({
          paymaster: paymasterKp.publicKey,
        });
        await expectThrow(
          () =>
            solPaymasterService.broadcastWithPaymaster('solDevnet', txB64, {
              clientKey: '203.0.113.7',
            }),
          /landed but failed on-chain/,
        );
      }
      const fresh = await buildSignedBundle({
        paymaster: paymasterKp.publicKey,
      });
      await expectThrow(
        () =>
          solPaymasterService.broadcastWithPaymaster('solDevnet', fresh, {
            clientKey: '203.0.113.7',
          }),
        /sponsorship refused.*client/,
      );
      expect(send.callCount).to.equal(MAX_FAILURES_PER_CLIENT);
      // a different client is still served (and reaches the chain)
      await expectThrow(
        () =>
          solPaymasterService.broadcastWithPaymaster('solDevnet', fresh, {
            clientKey: '198.51.100.1',
          }),
        /landed but failed on-chain/,
      );
      expect(send.callCount).to.equal(MAX_FAILURES_PER_CLIENT + 1);
    });

    it('does not count successful sponsored bundles', async function () {
      stubSimulation(95_000);
      stubSendAndConfirm();
      const wallet = Keypair.generate();
      const key = Keypair.generate();
      for (let i = 0; i < MAX_FAILURES_PER_MULTISIG + 2; i++) {
        const txB64 = await buildSignedBundle({
          paymaster: paymasterKp.publicKey,
          wallet,
          key,
        });
        expect(
          await solPaymasterService.broadcastWithPaymaster('solDevnet', txB64),
        ).to.equal('5xPaymasterFakeSig');
      }
    });
  });
});
