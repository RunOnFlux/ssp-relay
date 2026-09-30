// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect } from 'chai';
import {
  TRX_FEE_TOKEN,
  buildConfig,
  buildOp,
  opToJson,
  trc20TransferCall,
  trxFee,
  trxTransferCall,
} from '@runonflux/tron-multisig';
import {
  MAX_ACTIVE_RESERVATIONS_PER_VAULT,
  quoteWithRuntime,
} from '../../src/services/tronSponsorService';
import {
  ENERGY,
  executeBandwidthBytes,
  priceFee,
} from '../../src/services/tronSponsorPricing';
import {
  COLLECTOR,
  NOW_MS,
  RECIPIENT,
  RELAYER,
  SPONSOR,
  USDT,
  makeRuntime,
  vectors,
} from '../helpers/tronRuntime';

const LEAF = vectors.consumer.leaves['0-0'];
const VAULT = LEAF.address;
const NOW_S = BigInt(NOW_MS / 1000);
const RATES = { trxUsd: 0.338, usdtUsd: 1 };

function callsJson(calls) {
  return opToJson(buildOp({ calls, nonce: 0n, deadline: 1n })).calls;
}

const USDT_SEND = [trc20TransferCall(USDT, RECIPIENT, 25_000_000n)];

function request(extra = {}) {
  return {
    chain: 'tron',
    signers: LEAF.signers,
    threshold: 2,
    calls: callsJson(USDT_SEND),
    ...extra,
  };
}

function setup(opts: { trx?: bigint; usdt?: bigint } = {}) {
  const env = makeRuntime();
  const { node } = env;
  if (opts.trx !== undefined) {
    node.state.accounts.set(VAULT, { balance: opts.trx });
  }
  node.state.trc20.set(USDT, new Map([[VAULT, opts.usdt ?? 100_000_000n]]));
  // the recipient already exists as an account
  node.state.accounts.set(RECIPIENT, { balance: 1n });
  return env;
}

function expectedFee(
  energy: bigint,
  deadline: bigint,
  markup = 1.15,
  token = 'TRX',
) {
  const bandwidthBytes = executeBandwidthBytes({
    owner: RELAYER,
    sponsor: SPONSOR,
    config: buildConfig(LEAF.signers, 2),
    op: buildOp({
      calls: USDT_SEND,
      nonce: 0n,
      deadline,
      fee: trxFee(1n, COLLECTOR),
    }),
    nowMs: BigInt(NOW_MS),
  });
  return priceFee({
    token,
    energy,
    bandwidthBytes,
    energyPriceSun: 45n,
    markup,
    rates: RATES,
  });
}

describe('TRON sponsor quote', function () {
  it('quotes a first (undeployed) consumer send: nonce 0, deploy + cold word priced in', async function () {
    const { rt, cols } = setup({ trx: 50_000_000n });
    const q = await quoteWithRuntime(rt, request(), { trusted: false });
    const base = 28_600n + ENERGY.DEPLOY + ENERGY.COLD_NONCE_WORD + 64_285n;
    const energyTrx = base + ENERGY.TRX_FEE;
    const energyUsdt = base + 64_285n + 2n * 3_000n + ENERGY.TRC20_FEE_OVERHEAD;
    const deadline = NOW_S + 1800n;
    expect(q.vault).to.equal(VAULT);
    expect(q.deployed).to.equal(false);
    expect(q.nonce).to.equal('0');
    expect(q.deadline).to.equal(deadline.toString());
    expect(q.energy.estimate).to.equal(energyTrx.toString());
    expect(q.fee).to.deep.equal({
      token: TRX_FEE_TOKEN,
      amount: expectedFee(energyTrx, deadline).toString(),
      recipient: COLLECTOR,
    });
    expect(q.feeOptions).to.deep.equal([
      {
        token: TRX_FEE_TOKEN,
        amount: expectedFee(energyTrx, deadline).toString(),
      },
      {
        token: USDT,
        amount: expectedFee(energyUsdt, deadline, 1.15, 'USDT').toString(),
      },
    ]);
    expect(q.sponsorAvailable).to.equal(true);
    expect(q.maxSendable).to.equal(undefined);
    // Typical first send ≈ 9.8 TRX at launch pricing (plan §6.4).
    expect(Number(q.fee.amount) / 1e6).to.be.within(8, 12);
    const r = cols.reservations.docs[0];
    expect(r).to.include({
      chain: 'tron',
      vault: VAULT,
      nonce: '0',
      source: 'relay',
    });
    expect(r.expiresAt.getTime()).to.equal(Number(deadline) * 1000);
    expect(r.energy).to.deep.equal({
      trx: Number(energyTrx),
      usdt: Number(energyUsdt),
    });
  });

  it('reserves nonces: a second quote skips the first reservation', async function () {
    const { rt, cols } = setup({ trx: 50_000_000n });
    const a = await quoteWithRuntime(rt, request(), { trusted: false });
    const b = await quoteWithRuntime(rt, request(), { trusted: false });
    expect([a.nonce, b.nonce]).to.deep.equal(['0', '1']);
    expect(cols.reservations.docs).to.have.length(2);
  });

  it('reuses a nonce once its reservation expired (deadline passed)', async function () {
    const { rt, clock } = setup({ trx: 50_000_000n });
    await quoteWithRuntime(rt, request(), { trusted: false });
    clock.now += 31 * 60 * 1000;
    const again = await quoteWithRuntime(rt, request(), { trusted: false });
    expect(again.nonce).to.equal('0');
  });

  it('evicts the oldest relay reservation beyond the per-vault cap', async function () {
    const { rt, cols } = setup({ trx: 50_000_000n });
    for (let i = 0; i < MAX_ACTIVE_RESERVATIONS_PER_VAULT; i++) {
      await cols.reservations.insertOne({
        chain: 'tron',
        vault: VAULT,
        nonce: String(i),
        source: 'relay',
        expiresAt: new Date(NOW_MS + 600_000),
        createdAt: new Date(NOW_MS - 100_000 + i),
        energy: null,
      });
    }
    const q = await quoteWithRuntime(rt, request(), { trusted: false });
    expect(q.nonce).to.equal('0');
    expect(cols.reservations.docs).to.have.length(
      MAX_ACTIVE_RESERVATIONS_PER_VAULT,
    );
  });

  it('scans the on-chain nonce bitmap of a deployed vault (warm word, no deploy)', async function () {
    const { rt, node } = setup({ trx: 50_000_000n });
    node.state.contracts.set(VAULT, { runtimecode: 'cc' });
    node.state.nonceBitmaps.set(VAULT, new Map([[0n, 0b111n]]));
    const q = await quoteWithRuntime(rt, request(), { trusted: false });
    expect(q.deployed).to.equal(true);
    expect(q.nonce).to.equal('3');
    expect(q.energy.estimate).to.equal(
      (28_600n + 64_285n + ENERGY.TRX_FEE).toString(),
    );
  });

  it('prices a fresh bitmap word as cold on a deployed vault', async function () {
    const { rt, node } = setup({ trx: 50_000_000n });
    node.state.contracts.set(VAULT, { runtimecode: 'cc' });
    node.state.nonceBitmaps.set(VAULT, new Map([[0n, (1n << 256n) - 1n]]));
    const q = await quoteWithRuntime(rt, request(), { trusted: false });
    expect(q.nonce).to.equal('256');
    expect(q.energy.estimate).to.equal(
      (28_600n + ENERGY.COLD_NONCE_WORD + 64_285n + ENERGY.TRX_FEE).toString(),
    );
  });

  it('falls back to a USDT fee when the vault holds no TRX', async function () {
    const { rt } = setup({ usdt: 100_000_000n });
    const q = await quoteWithRuntime(rt, request(), { trusted: false });
    expect(q.fee.token).to.equal(USDT);
    expect(q.fee.amount).to.equal(q.feeOptions[1].amount);
    expect(q.sponsorAvailable).to.equal(true);
    expect(Number(q.fee.amount) / 1e6).to.be.within(3, 6); // plan: ≈3.5–4.6 USDT
  });

  it('keeps a 1 TRX buffer before defaulting to a TRX fee', async function () {
    const probe = await quoteWithRuntime(
      setup({ trx: 50_000_000n }).rt,
      request(),
      { trusted: false },
    );
    const fee = BigInt(probe.feeOptions[0].amount);
    const { rt } = setup({ trx: fee + 500_000n, usdt: 100_000_000n });
    const q = await quoteWithRuntime(rt, request(), { trusted: false });
    expect(q.fee.token).to.equal(USDT);
  });

  it('honours an explicit feeToken', async function () {
    const { rt } = setup({ trx: 50_000_000n });
    const q = await quoteWithRuntime(rt, request({ feeToken: USDT }), {
      trusted: false,
    });
    expect(q.fee.token).to.equal(USDT);
    const t = await quoteWithRuntime(rt, request({ feeToken: 'TRX' }), {
      trusted: false,
    });
    expect(t.fee.token).to.equal(TRX_FEE_TOKEN);
  });

  it('refuses a fee token other than TRX or USDT', async function () {
    const { rt } = setup({ trx: 50_000_000n });
    let err;
    try {
      await quoteWithRuntime(rt, request({ feeToken: RECIPIENT }), {
        trusted: false,
      });
    } catch (e) {
      err = e;
    }
    expect(err?.message).to.match(/feeToken must be TRX or the network USDT/);
  });

  it('returns sponsorAvailable:false with a reason when nothing covers the fee', async function () {
    const { rt } = setup({ trx: 1_000_000n, usdt: 25_000_000n });
    const q = await quoteWithRuntime(rt, request(), { trusted: false });
    expect(q.sponsorAvailable).to.equal(false);
    expect(q.unavailableReason).to.match(/^INSUFFICIENT_FEE_BALANCE/);
    expect(q.fee.token).to.equal(TRX_FEE_TOKEN);
  });

  it('computes maxSendable for a TRX send-max (balance − fee)', async function () {
    const { rt } = setup({ trx: 50_000_000n });
    const calls = callsJson([trxTransferCall(RECIPIENT, 50_000_000n)]);
    const q = await quoteWithRuntime(
      rt,
      request({ calls, max: { token: 'TRX' } }),
      { trusted: false },
    );
    expect(q.fee.token).to.equal(TRX_FEE_TOKEN);
    expect(q.maxSendable).to.deep.equal({
      token: TRX_FEE_TOKEN,
      amount: (50_000_000n - BigInt(q.fee.amount)).toString(),
    });
  });

  it('computes maxSendable for a USDT send-max paid in TRX (full balance)', async function () {
    const { rt } = setup({ trx: 50_000_000n, usdt: 100_000_000n });
    const calls = callsJson([trc20TransferCall(USDT, RECIPIENT, 100_000_000n)]);
    const q = await quoteWithRuntime(
      rt,
      request({ calls, max: { token: USDT } }),
      { trusted: false },
    );
    expect(q.fee.token).to.equal(TRX_FEE_TOKEN);
    expect(q.maxSendable).to.deep.equal({ token: USDT, amount: '100000000' });
  });

  it('computes maxSendable for a USDT send-max paid in USDT (balance − fee)', async function () {
    const { rt } = setup({ usdt: 100_000_000n });
    const calls = callsJson([trc20TransferCall(USDT, RECIPIENT, 100_000_000n)]);
    const q = await quoteWithRuntime(
      rt,
      request({ calls, max: { token: USDT } }),
      { trusted: false },
    );
    expect(q.fee.token).to.equal(USDT);
    expect(q.maxSendable.amount).to.equal(
      (100_000_000n - BigInt(q.fee.amount)).toString(),
    );
  });

  it('refuses max unless exactly one call moves that token', async function () {
    const { rt } = setup({ trx: 50_000_000n });
    let err;
    try {
      await quoteWithRuntime(rt, request({ max: { token: 'TRX' } }), {
        trusted: false,
      });
    } catch (e) {
      err = e;
    }
    expect(err?.message).to.match(/exactly one transfer/);
  });

  it('adds +25k energy for a TRX call to an account that does not exist', async function () {
    const { rt, node } = setup({ trx: 50_000_000n });
    const calls = callsJson([trxTransferCall(RECIPIENT, 1_000_000n)]);
    const existing = await quoteWithRuntime(rt, request({ calls }), {
      trusted: false,
    });
    node.state.accounts.delete(RECIPIENT);
    const fresh = await quoteWithRuntime(rt, request({ calls }), {
      trusted: false,
    });
    expect(
      BigInt(fresh.energy.estimate) - BigInt(existing.energy.estimate),
    ).to.equal(ENERGY.NEW_ACCOUNT);
  });

  it('refuses when a call would revert, and releases the nonce', async function () {
    const { rt, cols } = setup({ trx: 50_000_000n, usdt: 1_000_000n });
    let err;
    try {
      await quoteWithRuntime(rt, request(), { trusted: false });
    } catch (e) {
      err = e;
    }
    expect(err?.message).to.match(/call #0 would fail: simulation failed/);
    expect(cols.reservations.docs).to.have.length(0);
  });

  it('public route: nonce and markup are chosen by the relay', async function () {
    const { rt } = setup({ trx: 50_000_000n });
    for (const extra of [{ nonce: '5' }, { markup: 1.0 }]) {
      let err;
      try {
        await quoteWithRuntime(rt, request(extra), { trusted: false });
      } catch (e) {
        err = e;
      }
      expect(err?.message).to.match(/chosen by the relay/);
    }
  });

  it('public route: deadline is capped at 2 hours', async function () {
    const { rt } = setup({ trx: 50_000_000n });
    let err;
    try {
      await quoteWithRuntime(
        rt,
        request({ deadline: (NOW_S + 3n * 3600n).toString() }),
        { trusted: false },
      );
    } catch (e) {
      err = e;
    }
    expect(err?.message).to.match(/too far/);
  });

  it('enterprise (trusted): own nonce, 20-day deadline, 1.5 markup, no relay reservation', async function () {
    const { rt, cols } = setup({ trx: 50_000_000n });
    const deadline = NOW_S + 20n * 86400n;
    const q = await quoteWithRuntime(
      rt,
      request({ nonce: '42', deadline: deadline.toString(), markup: 1.5 }),
      { trusted: true },
    );
    expect(q.nonce).to.equal('42');
    expect(q.deadline).to.equal(deadline.toString());
    const base = 28_600n + ENERGY.DEPLOY + ENERGY.COLD_NONCE_WORD + 64_285n;
    expect(q.fee.amount).to.equal(
      expectedFee(base + ENERGY.TRX_FEE, deadline, 1.5).toString(),
    );
    const r = cols.reservations.docs[0];
    expect(r).to.include({ nonce: '42', source: 'supplied' });
    expect(r.energy.trx).to.equal(Number(base + ENERGY.TRX_FEE));
  });

  it('enterprise (trusted): refuses a nonce already used on-chain', async function () {
    const { rt, node } = setup({ trx: 50_000_000n });
    node.state.contracts.set(VAULT, { runtimecode: 'cc' });
    node.state.nonceBitmaps.set(VAULT, new Map([[0n, 1n << 42n]]));
    let err;
    try {
      await quoteWithRuntime(rt, request({ nonce: '42' }), { trusted: true });
    } catch (e) {
      err = e;
    }
    expect(err?.message).to.match(/nonce is already used/);
  });

  it('offers only TRX (and refuses a USDT request) without a TRX/USD rate', async function () {
    const { rt } = setup({ trx: 50_000_000n });
    rt.rates = () => ({ trxUsd: null, usdtUsd: 1 });
    const q = await quoteWithRuntime(rt, request(), { trusted: false });
    expect(q.feeOptions.map((o) => o.token)).to.deep.equal([TRX_FEE_TOKEN]);
    let err;
    try {
      await quoteWithRuntime(rt, request({ feeToken: USDT }), {
        trusted: false,
      });
    } catch (e) {
      err = e;
    }
    expect(err?.message).to.match(/USDT fees are unavailable/);
  });

  it('refuses when sponsoring is disabled (kill switch)', async function () {
    const { rt } = setup({ trx: 50_000_000n });
    rt.killSwitchOn = () => false;
    let err;
    try {
      await quoteWithRuntime(rt, request(), { trusted: false });
    } catch (e) {
      err = e;
    }
    expect(err?.name).to.equal('TronSponsorRefusal');
    expect(err?.message).to.match(
      /not available on tron: TRON_SPONSOR_ENABLED/,
    );
  });

  it('never trusts a client vault: the vault is derived from signers', async function () {
    const { rt } = setup({ trx: 50_000_000n });
    const q = await quoteWithRuntime(
      rt,
      request({ signers: [...LEAF.signers].reverse(), vault: 'TXXX' }),
      { trusted: false },
    );
    expect(q.vault).to.equal(VAULT);
  });

  it('rejects malformed input', async function () {
    const { rt } = setup({ trx: 50_000_000n });
    const bad = [
      request({ signers: ['not-an-address', LEAF.signers[1]] }),
      request({ threshold: 3 }),
      request({
        calls: [
          {
            to: RECIPIENT,
            value: '01',
            data: '0x',
            tokenId: '0',
            tokenValue: '0',
          },
        ],
      }),
      request({ calls: new Array(17).fill(callsJson(USDT_SEND)[0]) }),
      request({ signers: [LEAF.signers[0], LEAF.signers[0]] }),
    ];
    for (const r of bad) {
      let err;
      try {
        await quoteWithRuntime(rt, r, { trusted: false });
      } catch (e) {
        err = e;
      }
      expect(err?.name, JSON.stringify(r).slice(0, 80)).to.equal(
        'TronSponsorRefusal',
      );
    }
  });
});
