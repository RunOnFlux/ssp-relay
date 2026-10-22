/* eslint-disable @typescript-eslint/no-explicit-any */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
/**
 * POST /v1/sol/setup end to end (API handler → real paymaster service, RPC
 * stubbed): the released wallet's setup call keeps working, while paid setups
 * are budgeted per client IP and globally (SOL-6 rent grind).
 */
import { expect } from 'chai';
import sinon from 'sinon';
import bs58 from 'bs58';
import config from 'config';
import httpMocks from 'node-mocks-http';
import {
  Connection,
  Keypair,
  PublicKey,
  SendTransactionError,
  Transaction,
} from '@solana/web3.js';
import { SolanaMultisigClient } from '@runonflux/solana-multisig';

// Same pattern as the sibling paymaster specs: only configure a devnet
// paymaster when no other spec has, and resolve the live one dynamically (the
// service caches it per chain on first use).
if (!process.env.SSP_SOLANA_DEVNET_PAYMASTER_KEY) {
  process.env.SSP_SOLANA_DEVNET_PAYMASTER_KEY = bs58.encode(
    Keypair.generate().secretKey,
  );
}

import solPaymasterApi from '../../src/apiServices/solPaymasterApi';
import solPaymasterService, {
  multisigProgramId,
} from '../../src/services/solPaymasterService';
import log from '../../src/lib/log';
import {
  flushPaymasterAudits,
  setPaymasterAuditRetryPolicy,
} from '../../src/services/solPaymasterAudit';
import {
  recordSponsoredFailure,
  resetPaymasterBreaker,
  MAX_FAILURES_PER_CLIENT,
} from '../../src/services/solPaymasterBreaker';
import {
  resetSetupGuard,
  setupBudgetUsage,
  SETUP_GUARD_ENV,
} from '../../src/services/solPaymasterSetupGuard';

const MULTISIG_RENT = 1_489_920;
const NONCE_RENT = 1_447_680;
const SETUP_FEE = 5_000;

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

/** What wallet 2.1.3 posts (useSolSendStrategy: axios.post, unsigned). */
function setupReq(ip: string, body?: Record<string, unknown>) {
  const req = httpMocks.createRequest({
    method: 'POST',
    url: '/v1/sol/setup',
    body: body ?? {
      chain: 'solDevnet',
      walletPubkey: Keypair.generate().publicKey.toBase58(),
      keyPubkey: Keypair.generate().publicKey.toBase58(),
    },
  });
  req.socket = { remoteAddress: ip };
  return req;
}

async function post(req) {
  const res = httpMocks.createResponse();
  await solPaymasterApi.postSetup(req, res);
  return JSON.parse(res._getData());
}

interface ChainState {
  provisioned?: boolean;
  vaultLamports?: number;
  sendError?: Error;
  landedError?: unknown;
}

let paymaster: PublicKey;

function stubChain(state: ChainState = {}) {
  sinon
    .stub(SolanaMultisigClient.prototype, 'getMultisig')
    .callsFake(async () =>
      state.provisioned
        ? { members: [], threshold: 2, transactionIndex: 0n, bump: 255 }
        : null,
    );
  sinon
    .stub(Connection.prototype, 'getAccountInfo')
    .callsFake(async () =>
      state.provisioned ? ({ lamports: NONCE_RENT } as any) : null,
    );
  sinon
    .stub(Connection.prototype, 'getBalance')
    .callsFake(async () => state.vaultLamports ?? 5_000_000);
  sinon.stub(Connection.prototype, 'getLatestBlockhash').resolves({
    blockhash: Keypair.generate().publicKey.toBase58(),
    lastValidBlockHeight: 1,
  });
  let n = 0;
  const send = sinon
    .stub(Connection.prototype, 'sendRawTransaction')
    .callsFake(async () => {
      if (state.sendError) throw state.sendError;
      n += 1;
      return `5xSetupSig${n}`;
    });
  sinon.stub(Connection.prototype, 'getSignatureStatuses').callsFake(
    async () =>
      ({
        value: [
          { err: state.landedError ?? null, confirmationStatus: 'confirmed' },
        ],
      }) as any,
  );
  sinon.stub(Connection.prototype, 'getNonceAndContext').resolves({
    context: { slot: 1 },
    value: { nonce: 'NonceValue1111111111111111111111111111111111' },
  } as any);
  const pre = 10_000_000_000;
  const getTransaction = sinon
    .stub(Connection.prototype, 'getTransaction')
    .callsFake(
      async () =>
        ({
          slot: 1,
          meta: {
            err: state.landedError ?? null,
            fee: SETUP_FEE,
            preBalances: [pre],
            postBalances: [
              state.landedError
                ? pre - SETUP_FEE
                : pre - MULTISIG_RENT - NONCE_RENT - SETUP_FEE,
            ],
          },
          transaction: {
            message: { staticAccountKeys: [paymaster] },
            signatures: [],
          },
        }) as any,
    );
  return { send, getTransaction };
}

describe('POST /v1/sol/setup — paid setup budget (SOL-6)', function () {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(function () {
    reinstallConfigStub();
    paymaster = new PublicKey(
      solPaymasterService.getPaymasterPubkey('solDevnet'),
    );
    for (const name of Object.values(SETUP_GUARD_ENV)) {
      savedEnv[name] = process.env[name];
      delete process.env[name];
    }
    resetSetupGuard();
    resetPaymasterBreaker();
    setPaymasterAuditRetryPolicy({ attempts: 2, delayMs: 0 });
  });

  afterEach(async function () {
    await flushPaymasterAudits();
    setPaymasterAuditRetryPolicy(null);
    for (const name of Object.values(SETUP_GUARD_ENV)) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[name];
    }
    sinon.restore();
    resetSetupGuard();
    resetPaymasterBreaker();
  });

  it('provisions a released-wallet-shaped first send and charges the measured cost', async function () {
    const { send } = stubChain();
    const body = await post(setupReq('203.0.113.30'));
    expect(body.status).to.equal('success');
    expect(body.data.signature).to.equal('5xSetupSig1');
    expect(body.data.alreadyProvisioned).to.equal(false);
    expect(body.data.nonceValue).to.equal(
      'NonceValue1111111111111111111111111111111111',
    );
    // one paymaster-signed tx: initialize_multisig + provision_nonce
    const sent = Transaction.from(send.firstCall.args[0] as Buffer);
    expect(sent.feePayer!.equals(paymaster)).to.equal(true);
    expect(sent.instructions).to.have.length(2);
    for (const ix of sent.instructions) {
      expect(ix.programId.equals(multisigProgramId('solDevnet'))).to.equal(
        true,
      );
    }
    // charged up front with the estimate, settled with the measured cost
    await flushPaymasterAudits();
    expect(setupBudgetUsage()).to.deep.equal({
      count: 1,
      lamports: MULTISIG_RENT + NONCE_RENT + SETUP_FEE,
    });
  });

  it('refuses the 4th paid setup from one IP within the hour without sending; other IPs are served', async function () {
    const { send } = stubChain();
    for (let i = 0; i < 3; i++) {
      expect((await post(setupReq('203.0.113.31'))).status).to.equal('success');
    }
    const refused = await post(setupReq('203.0.113.31'));
    expect(refused.status).to.equal('error');
    expect(refused.data.message).to.match(
      /Too many new Solana vault setups from your network in the last hour/,
    );
    expect(send.callCount).to.equal(3);
    expect((await post(setupReq('198.51.100.31'))).status).to.equal('success');
    expect(send.callCount).to.equal(4);
  });

  it('never charges the idempotent already-provisioned path (wallet retries)', async function () {
    const state: ChainState = {};
    const { send } = stubChain(state);
    for (let i = 0; i < 3; i++) {
      await post(setupReq('203.0.113.32'));
    }
    // the per-IP budget is used up, but a retry for a provisioned vault is
    // free and still answered
    state.provisioned = true;
    for (let i = 0; i < 5; i++) {
      const body = await post(setupReq('203.0.113.32'));
      expect(body.status).to.equal('success');
      expect(body.data.alreadyProvisioned).to.equal(true);
      expect(body.data.signature).to.equal(null);
    }
    expect(send.callCount).to.equal(3);
    expect(setupBudgetUsage().count).to.equal(3);
  });

  it('does not charge balance-gate refusals (user funds the vault, then retries)', async function () {
    const state: ChainState = { vaultLamports: 1_000_000 };
    const { send } = stubChain(state);
    const body = {
      chain: 'solDevnet',
      walletPubkey: Keypair.generate().publicKey.toBase58(),
      keyPubkey: Keypair.generate().publicKey.toBase58(),
    };
    for (let i = 0; i < 5; i++) {
      const refused = await post(setupReq('203.0.113.33', body));
      expect(refused.data.message).to.match(/below the required minimum/);
    }
    state.vaultLamports = 4_000_000;
    expect((await post(setupReq('203.0.113.33', body))).status).to.equal(
      'success',
    );
    expect(send.callCount).to.equal(1);
    expect(setupBudgetUsage().count).to.equal(1);
  });

  it('releases the charge when the RPC refuses the setup in preflight', async function () {
    const state: ChainState = {
      sendError: new SendTransactionError({
        action: 'send',
        signature: '',
        transactionMessage: 'Transaction simulation failed',
        logs: [],
      }),
    };
    stubChain(state);
    for (let i = 0; i < 4; i++) {
      const body = await post(setupReq('203.0.113.34'));
      expect(body.status).to.equal('error');
    }
    expect(setupBudgetUsage().count).to.equal(0);
    state.sendError = undefined;
    expect((await post(setupReq('203.0.113.34'))).status).to.equal('success');
  });

  it('keeps the charge for a setup that landed but failed (the fee was paid)', async function () {
    stubChain({ landedError: { InstructionError: [0, { Custom: 0 }] } });
    const body = await post(setupReq('203.0.113.35'));
    expect(body.status).to.equal('error');
    expect(body.data.message).to.match(/landed but failed on-chain/);
    await flushPaymasterAudits();
    expect(setupBudgetUsage()).to.deep.equal({
      count: 1,
      lamports: SETUP_FEE,
    });
  });

  it('refuses everyone once the global hourly budget is used up and alerts once', async function () {
    const error = sinon.spy(log, 'error');
    process.env.SSP_SOLANA_SETUP_GLOBAL_HOURLY = '2';
    const { send } = stubChain();
    expect((await post(setupReq('203.0.113.40'))).status).to.equal('success');
    expect((await post(setupReq('203.0.113.41'))).status).to.equal('success');
    for (const ip of ['203.0.113.42', '203.0.113.43', '203.0.113.44']) {
      const refused = await post(setupReq(ip));
      expect(refused.status).to.equal('error');
      expect(refused.data.message).to.match(/temporarily unavailable/);
    }
    expect(send.callCount).to.equal(2);
    const alerts = error
      .getCalls()
      .map((c) => String(c.args[0]))
      .filter((l) => l.startsWith('[solPaymaster] ALERT'));
    expect(alerts).to.have.length(1);
  });

  it('gives no new vaults to a client the failure/loss breaker has stopped', async function () {
    sinon.stub(log, 'warn');
    const { send } = stubChain();
    for (let i = 0; i < MAX_FAILURES_PER_CLIENT; i++) {
      recordSponsoredFailure({ multisig: `M${i}`, client: '203.0.113.50' });
    }
    const refused = await post(setupReq('203.0.113.50'));
    expect(refused.status).to.equal('error');
    expect(refused.data.message).to.match(/sponsorship refused.*client/);
    expect(send.called).to.equal(false);
  });
});
