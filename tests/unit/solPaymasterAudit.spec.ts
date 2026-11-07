/* eslint-disable @typescript-eslint/no-explicit-any */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect } from 'chai';
import sinon from 'sinon';
import { Keypair } from '@solana/web3.js';
import log from '../../src/lib/log';
import {
  auditSetupTx,
  auditSponsoredBundle,
  fetchPaymasterTxCost,
  flushPaymasterAudits,
  paymasterCostFromTransaction,
  setPaymasterAuditRetryPolicy,
  sponsoredBundleLoss,
} from '../../src/services/solPaymasterAudit';
import {
  assertSponsorshipAllowed,
  MAX_FAILURES_PER_CLIENT,
  MAX_FAILURES_PER_MULTISIG,
  resetPaymasterBreaker,
  sponsorshipEventCount,
} from '../../src/services/solPaymasterBreaker';
import {
  reserveSetup,
  resetSetupGuard,
  setupBudgetUsage,
} from '../../src/services/solPaymasterSetupGuard';

// Rent of a 165-byte SPL token account (what an idempotent ATA create pays).
const ATA_RENT = 2_039_280;
// A consumer 2-of-2 bundle: paymaster + wallet + Key signatures.
const FEE = 3 * 5_000;
const PRE = 1_000_000_000;

const paymaster = Keypair.generate().publicKey;
const others = [Keypair.generate().publicKey, Keypair.generate().publicKey];

/** A getTransaction response for a tx whose fee payer is the paymaster. */
function confirmedTx({
  pre = PRE,
  post,
  fee = FEE,
  err = null,
  keys = [paymaster, ...others],
}: {
  pre?: number;
  post: number;
  fee?: number;
  err?: unknown;
  keys?: any[];
}) {
  return {
    slot: 1,
    meta: {
      fee,
      err,
      preBalances: keys.map((_, i) => (i === 0 ? pre : 5_000_000)),
      postBalances: keys.map((_, i) => (i === 0 ? post : 5_000_000)),
    },
    transaction: { message: { staticAccountKeys: keys }, signatures: [] },
  };
}

function fakeConnection(getTransaction: sinon.SinonStub) {
  return { getTransaction } as any;
}

describe('Solana paymaster post-send audit (measured paymaster cost)', function () {
  beforeEach(function () {
    resetPaymasterBreaker();
    resetSetupGuard();
    setPaymasterAuditRetryPolicy({ attempts: 3, delayMs: 0 });
  });

  afterEach(async function () {
    await flushPaymasterAudits();
    setPaymasterAuditRetryPolicy(null);
    sinon.restore();
    resetPaymasterBreaker();
    resetSetupGuard();
  });

  describe('loss accounting from pre/post balances', function () {
    it('a normal reimbursed send is no loss (the paymaster ends richer)', function () {
      // 100k reimbursement inside the bundle, 15k network fee.
      const cost = paymasterCostFromTransaction(
        confirmedTx({ post: PRE - FEE + 100_000 }),
        paymaster,
      );
      expect(cost.netCostLamports).to.equal(FEE - 100_000);
      expect(cost.feeLamports).to.equal(FEE);
      expect(cost.failed).to.equal(false);
      expect(sponsoredBundleLoss(cost)).to.equal(0);
    });

    it('an honest new-recipient SPL send (ATA rent covered by the bump) is no loss', function () {
      const reimbursement = 100_000 + 2_500_000; // base + splFeeBumpLamports
      const cost = paymasterCostFromTransaction(
        confirmedTx({ post: PRE - FEE - ATA_RENT + reimbursement }),
        paymaster,
      );
      expect(sponsoredBundleLoss(cost)).to.equal(0);
    });

    it('an ATA rent re-paid after the simulation is a loss of rent minus reimbursement', function () {
      // The wallet sized the reimbursement for an existing ATA (no bump); the
      // recipient closed it before execution, so the create paid rent again.
      const cost = paymasterCostFromTransaction(
        confirmedTx({ post: PRE - FEE - ATA_RENT + 100_000 }),
        paymaster,
      );
      expect(sponsoredBundleLoss(cost)).to.equal(ATA_RENT - 100_000);
    });

    it('a landed-but-failed tx costs only its fee (no loss beyond the fee)', function () {
      const cost = paymasterCostFromTransaction(
        confirmedTx({
          post: PRE - FEE,
          err: { InstructionError: [4, { Custom: 1 }] },
        }),
        paymaster,
      );
      expect(cost.failed).to.equal(true);
      expect(sponsoredBundleLoss(cost)).to.equal(0);
    });

    it('does not credit the fee when the paymaster is not the fee payer', function () {
      const cost = paymasterCostFromTransaction(
        confirmedTx({ post: PRE - 10_000, keys: [others[0], paymaster] }),
        paymaster,
      );
      expect(cost.feeLamports).to.equal(0);
      expect(cost.netCostLamports).to.equal(0);
    });

    it('refuses to guess when the response lacks the data', function () {
      expect(() =>
        paymasterCostFromTransaction(
          { meta: null, transaction: { message: { staticAccountKeys: [] } } },
          paymaster,
        ),
      ).to.throw(/no status meta/);
      expect(() =>
        paymasterCostFromTransaction(
          confirmedTx({ post: PRE, keys: others }),
          paymaster,
        ),
      ).to.throw(/not an account/);
    });

    it('reads the confirmed transaction at confirmed commitment and retries a lagging RPC', async function () {
      const getTransaction = sinon.stub();
      getTransaction.onFirstCall().resolves(null);
      getTransaction
        .onSecondCall()
        .resolves(confirmedTx({ post: PRE - FEE + 100_000 }));
      const cost = await fetchPaymasterTxCost(
        fakeConnection(getTransaction),
        '5xSig',
        paymaster,
      );
      expect(cost.netCostLamports).to.equal(FEE - 100_000);
      expect(getTransaction.callCount).to.equal(2);
      expect(getTransaction.firstCall.args[0]).to.equal('5xSig');
      expect(getTransaction.firstCall.args[1]).to.deep.equal({
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
    });
  });

  describe('auditSponsoredBundle → failure breaker', function () {
    it('records nothing for a normal send', async function () {
      const error = sinon.spy(log, 'error');
      const getTransaction = sinon
        .stub()
        .resolves(confirmedTx({ post: PRE - FEE + 100_000 }));
      const keys = { multisig: 'MultisigA', client: '203.0.113.1' };
      auditSponsoredBundle({
        connection: fakeConnection(getTransaction),
        signature: '5xOk',
        paymaster,
        chain: 'solMainnet',
        breakerKeys: keys,
      });
      await flushPaymasterAudits();
      expect(getTransaction.calledOnce).to.equal(true);
      expect(sponsorshipEventCount(keys)).to.deep.equal({
        multisig: 0,
        client: 0,
      });
      expect(error.called).to.equal(false);
    });

    it('logs a LOSS and counts it per multisig and per client; the breaker trips after the threshold', async function () {
      const error = sinon.spy(log, 'error');
      const getTransaction = sinon
        .stub()
        .resolves(confirmedTx({ post: PRE - FEE - ATA_RENT + 100_000 }));
      const keys = { multisig: 'MultisigRace', client: '203.0.113.2' };
      for (let i = 0; i < MAX_FAILURES_PER_MULTISIG; i++) {
        assertSponsorshipAllowed(keys); // still sponsored before the threshold
        auditSponsoredBundle({
          connection: fakeConnection(getTransaction),
          signature: `5xRace${i}`,
          paymaster,
          chain: 'solMainnet',
          breakerKeys: keys,
        });
        await flushPaymasterAudits();
      }
      expect(sponsorshipEventCount(keys)).to.deep.equal({
        multisig: MAX_FAILURES_PER_MULTISIG,
        client: MAX_FAILURES_PER_MULTISIG,
      });
      expect(() => assertSponsorshipAllowed(keys)).to.throw(
        /sponsorship refused.*multisig/,
      );
      const lossLines = error
        .getCalls()
        .map((c) => String(c.args[0]))
        .filter((l) => l.startsWith('[solPaymaster] LOSS '));
      expect(lossLines).to.have.length(MAX_FAILURES_PER_MULTISIG);
      expect(lossLines[0]).to.contain(`LOSS ${ATA_RENT - 100_000} lamports`);
      expect(lossLines[0]).to.contain('5xRace0');
      expect(lossLines[0]).to.contain('multisig=MultisigRace');
      expect(lossLines[0]).to.contain('client=203.0.113.2');
    });

    it('trips the per-client breaker across fresh multisigs', async function () {
      sinon.stub(log, 'error');
      const getTransaction = sinon
        .stub()
        .resolves(confirmedTx({ post: PRE - FEE - ATA_RENT + 100_000 }));
      const client = '203.0.113.3';
      for (let i = 0; i < MAX_FAILURES_PER_CLIENT; i++) {
        auditSponsoredBundle({
          connection: fakeConnection(getTransaction),
          signature: `5xC${i}`,
          paymaster,
          chain: 'solMainnet',
          breakerKeys: { multisig: `Fresh${i}`, client },
        });
      }
      await flushPaymasterAudits();
      expect(() =>
        assertSponsorshipAllowed({ multisig: 'FreshNext', client }),
      ).to.throw(/sponsorship refused.*client/);
      // another client is unaffected
      expect(() =>
        assertSponsorshipAllowed({ multisig: 'FreshNext', client: '1.2.3.4' }),
      ).to.not.throw();
    });

    it('never throws when the RPC fails in the post-check; logs it and counts nothing', async function () {
      const warn = sinon.spy(log, 'warn');
      const getTransaction = sinon
        .stub()
        .rejects(new Error('503 Service Unavailable'));
      const keys = { multisig: 'MultisigRpcDown', client: '203.0.113.4' };
      expect(() =>
        auditSponsoredBundle({
          connection: fakeConnection(getTransaction),
          signature: '5xRpc',
          paymaster,
          chain: 'solMainnet',
          breakerKeys: keys,
        }),
      ).to.not.throw();
      await flushPaymasterAudits();
      expect(getTransaction.callCount).to.equal(3); // retried per policy
      const line = warn
        .getCalls()
        .map((c) => String(c.args[0]))
        .find((l) => l.includes('post-send balance check failed'));
      expect(line).to.contain('5xRpc');
      expect(line).to.contain('503 Service Unavailable');
      expect(sponsorshipEventCount(keys).multisig).to.equal(0);
    });

    it('logs when the transaction never shows up (null responses)', async function () {
      const warn = sinon.spy(log, 'warn');
      const getTransaction = sinon.stub().resolves(null);
      auditSponsoredBundle({
        connection: fakeConnection(getTransaction),
        signature: '5xMissing',
        paymaster,
        chain: 'solMainnet',
        breakerKeys: { multisig: 'M' },
      });
      await flushPaymasterAudits();
      expect(
        warn.getCalls().some((c) => /not found/.test(String(c.args[0]))),
      ).to.equal(true);
    });

    it('survives a synchronously throwing connection', async function () {
      sinon.stub(log, 'warn');
      const getTransaction = sinon.stub().throws(new Error('boom'));
      expect(() =>
        auditSponsoredBundle({
          connection: fakeConnection(getTransaction),
          signature: '5xBoom',
          paymaster,
          chain: 'solMainnet',
          breakerKeys: { multisig: 'M' },
        }),
      ).to.not.throw();
      await flushPaymasterAudits();
    });

    it('counts a measured on-chain failure only when the caller could not confirm the outcome', async function () {
      sinon.stub(log, 'warn');
      const getTransaction = sinon.stub().resolves(
        confirmedTx({
          post: PRE - FEE,
          err: { InstructionError: [4, { Custom: 1 }] },
        }),
      );
      const confirmed = { multisig: 'ConfirmedFail' };
      auditSponsoredBundle({
        connection: fakeConnection(getTransaction),
        signature: '5xF1',
        paymaster,
        chain: 'solMainnet',
        breakerKeys: confirmed,
      });
      const timedOut = { multisig: 'TimedOutFail', client: '203.0.113.9' };
      auditSponsoredBundle({
        connection: fakeConnection(getTransaction),
        signature: '5xF2',
        paymaster,
        chain: 'solMainnet',
        breakerKeys: timedOut,
        outcomeUnknown: true,
      });
      await flushPaymasterAudits();
      // the confirm path already counted the first one itself
      expect(sponsorshipEventCount(confirmed).multisig).to.equal(0);
      expect(sponsorshipEventCount(timedOut)).to.deep.equal({
        multisig: 1,
        client: 1,
      });
    });
  });

  describe('auditSetupTx → setup budget', function () {
    const MULTISIG_RENT = 1_489_920;
    const NONCE_RENT = 1_447_680;

    it('settles the reservation with the measured cost', async function () {
      const info = sinon.spy(log, 'info');
      const reservation = reserveSetup({
        clientKey: '203.0.113.5',
        estimateLamports: 3_200_000,
      });
      expect(setupBudgetUsage().lamports).to.equal(3_200_000);
      const getTransaction = sinon.stub().resolves(
        confirmedTx({
          post: PRE - MULTISIG_RENT - NONCE_RENT - 5_000,
          fee: 5_000,
        }),
      );
      auditSetupTx({
        connection: fakeConnection(getTransaction),
        signature: '5xSetup',
        paymaster,
        chain: 'solMainnet',
        breakerKeys: { multisig: 'NewVault', client: '203.0.113.5' },
        maxRentLamports: 3_200_000,
        reservation,
      });
      await flushPaymasterAudits();
      expect(setupBudgetUsage()).to.deep.equal({
        count: 1,
        lamports: MULTISIG_RENT + NONCE_RENT + 5_000,
      });
      expect(
        info
          .getCalls()
          .some((c) =>
            String(c.args[0]).includes(
              `cost the paymaster ${MULTISIG_RENT + NONCE_RENT + 5_000} lamports`,
            ),
          ),
      ).to.equal(true);
      expect(sponsorshipEventCount({ multisig: 'NewVault' }).multisig).to.equal(
        0,
      );
    });

    it('keeps the estimate when the post-check fails (no throw)', async function () {
      const warn = sinon.spy(log, 'warn');
      const reservation = reserveSetup({ estimateLamports: 3_200_000 });
      const getTransaction = sinon.stub().rejects(new Error('timeout'));
      auditSetupTx({
        connection: fakeConnection(getTransaction),
        signature: '5xSetupRpc',
        paymaster,
        chain: 'solMainnet',
        breakerKeys: { multisig: 'NewVault2' },
        maxRentLamports: 3_200_000,
        reservation,
      });
      await flushPaymasterAudits();
      expect(setupBudgetUsage().lamports).to.equal(3_200_000);
      expect(
        warn
          .getCalls()
          .some((c) =>
            String(c.args[0]).includes('post-setup balance check failed'),
          ),
      ).to.equal(true);
    });

    it('flags a setup that paid more rent than the schedule covers', async function () {
      const error = sinon.spy(log, 'error');
      const getTransaction = sinon
        .stub()
        .resolves(confirmedTx({ post: PRE - 4_000_000 - 5_000, fee: 5_000 }));
      auditSetupTx({
        connection: fakeConnection(getTransaction),
        signature: '5xFat',
        paymaster,
        chain: 'solMainnet',
        breakerKeys: { multisig: 'FatVault', client: '203.0.113.6' },
        maxRentLamports: 3_200_000,
      });
      await flushPaymasterAudits();
      expect(
        error
          .getCalls()
          .some((c) =>
            String(c.args[0]).startsWith('[solPaymaster] LOSS 800000'),
          ),
      ).to.equal(true);
      expect(
        sponsorshipEventCount({ multisig: 'FatVault', client: '203.0.113.6' }),
      ).to.deep.equal({ multisig: 1, client: 1 });
    });
  });
});
