// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
//
// Adversarial review of the TRON sponsor (2026-09-30). Every case here is a
// way an attacker who controls a vault could make SSP's energy account pay for
// a transaction that reverts, or deny a victim's sponsored send.
import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'fs';
import os from 'os';
import path from 'path';
import httpMocks from 'node-mocks-http';
import {
  buildOp,
  decodeTransaction,
  opToJson,
  selfCall,
  trc20TransferCall,
  trxFee,
  trxTransferCall,
} from '@runonflux/tron-multisig';
import tronSponsorApi from '../../src/apiServices/tronSponsorApi';
import tronSponsorService, {
  MAX_ACTIVE_RESERVATIONS_PER_VAULT,
  acceptAndBroadcast,
  callsShapeKey,
  quoteWithRuntime,
  relayerFilePath,
  resolveRelayers,
} from '../../src/services/tronSponsorService';
import {
  COLLECTOR,
  NOW_MS,
  RECIPIENT,
  S_ORIGIN,
  USDT,
  broadcastRequest,
  makeOp,
  makeRuntime,
  testVault,
} from '../helpers/tronRuntime';

const NOW_S = BigInt(NOW_MS / 1000);
const trxCall = [trxTransferCall(RECIPIENT, 1_000_000n)];
// Confirmation pollers that never finish: records stay 'broadcast'.
const neverConfirm = { sleep: () => new Promise(() => undefined) };

function setup(v, overrides = {}) {
  const env = makeRuntime(overrides);
  env.node.state.accounts.set(v.vault, { balance: 100_000_000n });
  env.node.state.accounts.set(RECIPIENT, { balance: 1n });
  env.node.state.trc20.set(USDT, new Map([[v.vault, 100_000_000n]]));
  return env;
}

async function outcome(p) {
  try {
    return { ok: true, value: await p };
  } catch (e) {
    return { ok: false, error: e };
  }
}

function failedReceipt(txid, originEnergy) {
  return {
    id: txid,
    blockNumber: 70_000_001,
    blockTimeStamp: 1_789_999_003_000,
    fee: 0,
    result: 'FAILED',
    receipt: {
      energy_usage_total: originEnergy,
      origin_energy_usage: originEnergy,
      net_usage: 1_200,
      result: 'REVERT',
    },
  };
}

/** Every broadcast lands in a block and fails on-chain, burning `energy`. */
function failOnChain(node, energy = 100_000) {
  node.state.broadcastReply = (hex) => {
    const id = decodeTransaction(hex).txid;
    node.state.txInfo.set(id, failedReceipt(id, energy));
    return { result: true, txid: id };
  };
}

describe('TRON sponsor hardening (adversarial review)', function () {
  describe('in-flight collisions (S pays for the loser)', function () {
    const v = testVault(0x71, 0x72);

    it('admits only ONE of two concurrent Ops of the same vault', async function () {
      // Op A drains the vault, Op B is a heavy batch with a TRX fee: each
      // simulates fine against the current state, together B reverts at the
      // fee after all its calls ran — on S's energy.
      const { rt, node } = setup(v, neverConfirm);
      const a = makeOp({ calls: trxCall, nonce: 1n });
      const b = makeOp({ calls: trxCall, nonce: 2n, feeAmount: 7_000_000n });
      const results = await Promise.all([
        outcome(acceptAndBroadcast(rt, broadcastRequest(v, a))),
        outcome(acceptAndBroadcast(rt, broadcastRequest(v, b))),
      ]);
      expect(node.state.broadcasts).to.have.length(1);
      const refusedOne = results.find((r) => !r.ok);
      expect(refusedOne, 'one of the two must be refused').to.exist;
      expect(refusedOne.error.message).to.match(
        /too many unconfirmed sponsored operations|temporarily unavailable/,
      );
    });

    it('admits only ONE of two concurrent Ops with the same nonce (different digests)', async function () {
      const { rt, node } = setup(v, neverConfirm);
      const a = makeOp({ calls: trxCall, nonce: 3n });
      const b = makeOp({ calls: trxCall, nonce: 3n, feeAmount: 7_000_000n });
      await Promise.all([
        outcome(acceptAndBroadcast(rt, broadcastRequest(v, a))),
        outcome(acceptAndBroadcast(rt, broadcastRequest(v, b))),
      ]);
      expect(node.state.broadcasts).to.have.length(1);
    });

    it('refuses a second Op of the vault until the first is in a block, then admits it', async function () {
      const { rt, node } = setup(v, neverConfirm);
      const first = await acceptAndBroadcast(
        rt,
        broadcastRequest(v, makeOp({ calls: trxCall, nonce: 4n })),
      );
      const second = broadcastRequest(
        v,
        makeOp({ calls: trxCall, nonce: 5n, feeAmount: 7_000_000n }),
      );
      const r = await outcome(acceptAndBroadcast(rt, second));
      expect(r.ok).to.equal(false);
      expect(r.error.message).to.match(
        /too many unconfirmed sponsored operations/,
      );
      // The first transaction reaches a block: its effects are now part of
      // the state every later simulation runs against.
      node.state.blockTxInfo.set(first.txid, {
        id: first.txid,
        blockNumber: 70_000_001,
        receipt: { result: 'SUCCESS' },
      });
      const ok = await acceptAndBroadcast(rt, second);
      expect(ok.txid).to.match(/^[0-9a-f]{64}$/);
      expect(node.state.broadcasts).to.have.length(2);
    });

    it('a dropped transaction stops blocking the vault once it can no longer be included', async function () {
      const { rt, node, clock } = setup(v, neverConfirm);
      await acceptAndBroadcast(
        rt,
        broadcastRequest(v, makeOp({ calls: trxCall, nonce: 6n })),
      );
      clock.now += 3 * 60_000;
      node.state.block.timestamp += 180_000n;
      const ok = await acceptAndBroadcast(
        rt,
        broadcastRequest(v, makeOp({ calls: trxCall, nonce: 7n })),
      );
      expect(ok.txid).to.match(/^[0-9a-f]{64}$/);
    });

    it("takes over a crashed holder's expired vault lock", async function () {
      const { rt, cols } = setup(v, neverConfirm);
      await cols.reservations.insertOne({
        chain: 'tron',
        vault: v.vault,
        nonce: 'broadcast-lock',
        source: 'lock',
        token: 'dead',
        createdAt: new Date(NOW_MS - 600_000),
        expiresAt: new Date(NOW_MS - 1),
      });
      const ok = await acceptAndBroadcast(
        rt,
        broadcastRequest(v, makeOp({ calls: trxCall, nonce: 9n })),
      );
      expect(ok.txid).to.match(/^[0-9a-f]{64}$/);
      // released after use: no lock document left behind
      expect(
        cols.reservations.docs.filter((d) => d.nonce === 'broadcast-lock'),
      ).to.have.length(0);
    });

    it('a concurrent duplicate of the SAME Op still gets the winner txid', async function () {
      const { rt, node } = setup(v, neverConfirm);
      const req = broadcastRequest(v, makeOp({ calls: trxCall, nonce: 8n }));
      const [a, b] = await Promise.all([
        acceptAndBroadcast(rt, req),
        acceptAndBroadcast(rt, req),
      ]);
      expect(a.txid).to.equal(b.txid);
      expect(node.state.broadcasts).to.have.length(1);
    });
  });

  describe('failure circuit breakers (divergence the relay cannot see coming)', function () {
    it('pauses sponsorship on the chain once on-chain failures burned the hourly budget', async function () {
      const v1 = testVault(0x73, 0x74);
      const v2 = testVault(0x75, 0x76);
      const env = setup(v1, { maxFailedEnergyPerHour: 200_000 });
      env.node.state.accounts.set(v2.vault, { balance: 100_000_000n });
      failOnChain(env.node, 250_000);
      const first = await acceptAndBroadcast(
        env.rt,
        broadcastRequest(v1, makeOp({ calls: trxCall, nonce: 1n })),
      );
      await first.confirmation;
      expect(env.cols.ops.docs[0].status).to.equal('failed');
      env.node.state.broadcastReply = null;
      const later = makeOp({
        calls: trxCall,
        nonce: 1n,
        deadline: NOW_S + 3n * 86_400n,
      });
      const r = await outcome(
        acceptAndBroadcast(env.rt, broadcastRequest(v2, later)),
      );
      expect(r.ok).to.equal(false);
      expect(r.error.message).to.match(/temporarily unavailable/);
      expect(env.node.state.broadcasts).to.have.length(1);
      // The window rolls: sponsorship resumes by itself.
      env.clock.now += 3_600_001;
      env.node.state.block.timestamp += 3_600_001n;
      const ok = await acceptAndBroadcast(env.rt, broadcastRequest(v2, later));
      expect(ok.txid).to.match(/^[0-9a-f]{64}$/);
    });

    it('feeds the breaker from the in-block receipt, before solidification', async function () {
      // Solidification takes ~1 min; waiting for it would let a burst of
      // attacks land before the breaker notices the first one.
      const v1 = testVault(0x81, 0x82);
      const v2 = testVault(0x83, 0x84);
      const env = setup(v1, { maxFailedEnergyPerHour: 200_000 });
      env.node.state.accounts.set(v2.vault, { balance: 100_000_000n });
      env.node.state.broadcastReply = (hex) => {
        const id = decodeTransaction(hex).txid;
        env.node.state.blockTxInfo.set(id, failedReceipt(id, 1_250_000));
        return { result: true, txid: id };
      };
      const first = await acceptAndBroadcast(
        env.rt,
        broadcastRequest(v1, makeOp({ calls: trxCall, nonce: 1n })),
      );
      await first.confirmation; // never solidifies within the 3 test polls
      env.node.state.broadcastReply = null;
      const r = await outcome(
        acceptAndBroadcast(
          env.rt,
          broadcastRequest(v2, makeOp({ calls: trxCall, nonce: 1n })),
        ),
      );
      expect(r.ok).to.equal(false);
      expect(r.error.message).to.match(/temporarily unavailable/);
    });

    it('counts a failure once even when seen in a block and again solidified', async function () {
      const v1 = testVault(0x85, 0x86);
      const env = setup(v1);
      env.node.state.broadcastReply = (hex) => {
        const id = decodeTransaction(hex).txid;
        env.node.state.blockTxInfo.set(id, failedReceipt(id, 300_000));
        env.node.state.txInfo.set(id, failedReceipt(id, 300_000));
        return { result: true, txid: id };
      };
      const first = await acceptAndBroadcast(
        env.rt,
        broadcastRequest(v1, makeOp({ calls: trxCall, nonce: 1n })),
      );
      await first.confirmation;
      expect(env.rt.failures.map((f) => f.energy)).to.deep.equal([300_000]);
    });

    it('stops sponsoring a vault after repeated on-chain failures, even through digest retries', async function () {
      const v = testVault(0x77, 0x78);
      const env = setup(v);
      failOnChain(env.node, 100_000);
      const req = broadcastRequest(v, makeOp({ calls: trxCall, nonce: 1n }));
      const a = await acceptAndBroadcast(env.rt, req);
      await a.confirmation;
      env.clock.now += 3_000;
      env.node.state.block.timestamp += 3_000n;
      // Retrying the same signed Op overwrites the record: the first failure
      // must not disappear with it.
      const b = await acceptAndBroadcast(env.rt, req);
      await b.confirmation;
      expect(b.txid).to.not.equal(a.txid);
      const rec = env.cols.ops.docs[0];
      expect(rec.status).to.equal('failed');
      expect(rec.priorFailures).to.have.length(1);
      expect(rec.priorFailures[0].txid).to.equal(a.txid);
      env.clock.now += 3_000;
      env.node.state.block.timestamp += 3_000n;
      const before = env.node.state.broadcasts.length;
      const r = await outcome(acceptAndBroadcast(env.rt, req));
      expect(r.ok).to.equal(false);
      expect(r.error.message).to.match(/failed on-chain/);
      const other = await outcome(
        acceptAndBroadcast(
          env.rt,
          broadcastRequest(v, makeOp({ calls: trxCall, nonce: 2n })),
        ),
      );
      expect(other.ok).to.equal(false);
      expect(other.error.message).to.match(/failed on-chain/);
      expect(env.node.state.broadcasts).to.have.length(before);
    });
  });

  describe("S's energy is committed across vaults", function () {
    it('does not admit two Ops (different vaults) that S can only pay one of', async function () {
      // Each broadcast checked S's energy against the chain alone: the second
      // would run OUT_OF_ENERGY and burn S's remaining energy with no fee.
      const v1 = testVault(0x91, 0x92);
      const v2 = testVault(0x93, 0x94);
      const env = setup(v1, neverConfirm);
      env.node.state.accounts.set(v2.vault, { balance: 100_000_000n });
      env.node.state.resources.set(S_ORIGIN, {
        EnergyLimit: 150_000,
        EnergyUsed: 0,
      });
      env.node.state.execute = { ok: true, energy: 100_000 };
      const results = await Promise.all([
        outcome(
          acceptAndBroadcast(
            env.rt,
            broadcastRequest(v1, makeOp({ calls: trxCall, nonce: 1n })),
          ),
        ),
        outcome(
          acceptAndBroadcast(
            env.rt,
            broadcastRequest(v2, makeOp({ calls: trxCall, nonce: 1n })),
          ),
        ),
      ]);
      expect(env.node.state.broadcasts).to.have.length(1);
      const refusedOne = results.find((x) => !x.ok);
      expect(refusedOne.error.message).to.match(/sponsor energy is low/);
      // Once the first transaction has had time to land (the node's figure
      // then already reflects it), S's energy is judged by the chain again.
      env.clock.now += 20_000;
      env.node.state.block.timestamp += 20_000n;
      const ok = await acceptAndBroadcast(
        env.rt,
        broadcastRequest(v2, makeOp({ calls: trxCall, nonce: 2n })),
      );
      expect(ok.txid).to.match(/^[0-9a-f]{64}$/);
    });
  });

  describe('deadline vs transaction expiry', function () {
    it('refuses an Op whose deadline can pass while the transaction is still includable', async function () {
      // The relay clock lags the chain by 30 s: now + 70 s clears the 60 s
      // margin, but the transaction (head + 60 s) could land after the
      // deadline and revert Expired — on S's energy.
      const v = testVault(0x79, 0x7a);
      const { rt, node } = setup(v);
      node.state.block.timestamp = BigInt(NOW_MS) + 30_000n;
      const r = await outcome(
        acceptAndBroadcast(
          rt,
          broadcastRequest(
            v,
            makeOp({ calls: trxCall, deadline: NOW_S + 70n }),
          ),
        ),
      );
      expect(r.ok).to.equal(false);
      expect(r.error.message).to.match(/deadline/);
      expect(node.state.broadcasts).to.have.length(0);
    });
  });

  describe('quote reservations', function () {
    it("an attacker's quotes on a victim's vault cannot refuse the victim's broadcast", async function () {
      const v = testVault(0x7b, 0x7c);
      const { rt, node } = setup(v, neverConfirm);
      const victimCalls = [
        trc20TransferCall(USDT, RECIPIENT, 1_000_000n),
        trc20TransferCall(USDT, RECIPIENT, 2_000_000n),
        trc20TransferCall(USDT, RECIPIENT, 3_000_000n),
      ];
      const quoteReq = (calls) => ({
        chain: 'tron',
        signers: [...v.config.signers],
        threshold: 2,
        calls: opToJson(buildOp({ calls, nonce: 0n, deadline: 1n })).calls,
        feeToken: 'TRX',
      });
      const victim = await quoteWithRuntime(rt, quoteReq(victimCalls), {
        trusted: false,
      });
      expect(victim.nonce).to.equal('0');
      // Anyone can quote any vault (signers are public after its first Op).
      // Enough cheap quotes evict the victim's reservation and re-reserve
      // its nonce with the attacker's tiny energy figure.
      let attacker;
      for (let i = 0; i < MAX_ACTIVE_RESERVATIONS_PER_VAULT; i++) {
        attacker = await quoteWithRuntime(rt, quoteReq(trxCall), {
          trusted: false,
        });
      }
      expect(attacker.nonce).to.equal('0');
      const simulated = BigInt(victim.energy.estimate);
      expect(simulated * 4n > BigInt(attacker.energy.estimate) * 5n).to.equal(
        true,
      );
      node.state.execute = { ok: true, energy: Number(simulated) };
      const op = buildOp({
        calls: victimCalls,
        nonce: 0n,
        deadline: BigInt(victim.deadline),
        fee: trxFee(BigInt(victim.fee.amount), COLLECTOR),
      });
      const r = await outcome(acceptAndBroadcast(rt, broadcastRequest(v, op)));
      expect(r.ok, r.ok ? '' : r.error.message).to.equal(true);
    });

    it('binds a quote to the calls shape, not the amounts (send-max still matches)', function () {
      const other = testVault(0x11, 0x12).vault;
      expect(callsShapeKey([trxTransferCall(RECIPIENT, 5n)])).to.equal(
        callsShapeKey([trxTransferCall(RECIPIENT, 7_000_000n)]),
      );
      expect(callsShapeKey([trc20TransferCall(USDT, RECIPIENT, 1n)])).to.equal(
        callsShapeKey([trc20TransferCall(USDT, RECIPIENT, 99n)]),
      );
      expect(callsShapeKey([trxTransferCall(RECIPIENT, 5n)])).to.not.equal(
        callsShapeKey([trxTransferCall(other, 5n)]),
      );
      expect(
        callsShapeKey([trc20TransferCall(USDT, RECIPIENT, 1n)]),
      ).to.not.equal(callsShapeKey([trc20TransferCall(USDT, other, 1n)]));
      expect(callsShapeKey(trxCall)).to.not.equal(
        callsShapeKey([...trxCall, ...trxCall]),
      );
    });

    it('refuses oversized calls in a quote before any node work', async function () {
      const v = testVault(0x7d, 0x7e);
      const { rt } = setup(v);
      const votes = Array.from({ length: 3_000 }, () => ({
        witness: RECIPIENT,
        count: 1n,
      }));
      const call = selfCall(v.vault, { action: 'voteWitnesses', votes });
      const r = await outcome(
        quoteWithRuntime(
          rt,
          {
            chain: 'tron',
            signers: [...v.config.signers],
            threshold: 2,
            calls: opToJson(buildOp({ calls: [call], nonce: 0n, deadline: 1n }))
              .calls,
          },
          { trusted: false },
        ),
      );
      expect(r.ok).to.equal(false);
      expect(r.error.message).to.match(/too large/);
    });
  });

  describe('relayer key file', function () {
    let tmpHome: string;
    let homedirStub: sinon.SinonStub;
    const ENV = 'SSP_TRON_NILE_RELAYER_KEYS';
    let saved: string | undefined;

    beforeEach(function () {
      tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ssp-relay-tron-'));
      homedirStub = sinon.stub(os, 'homedir').returns(tmpHome);
      saved = process.env[ENV];
      delete process.env[ENV];
    });

    afterEach(function () {
      homedirStub.restore();
      fs.rmSync(tmpHome, { recursive: true, force: true });
      if (saved === undefined) delete process.env[ENV];
      else process.env[ENV] = saved;
    });

    it('a generated Nile key is never left in a pre-existing world-readable file', function () {
      const file = relayerFilePath('tronNile');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '', { mode: 0o644 });
      fs.chmodSync(file, 0o644);
      const r = resolveRelayers('tronNile');
      expect(r.source).to.equal('generated');
      expect(fs.statSync(file).mode & 0o777).to.equal(0o600);
    });
  });

  describe('error echo', function () {
    afterEach(function () {
      sinon.restore();
    });

    it('does not echo database internals to the public caller', async function () {
      const err = new Error(
        'E11000 duplicate key error collection: sspdb.tron_sponsor_ops index: digest_1 dup key',
      );
      err.name = 'MongoServerError';
      sinon.stub(tronSponsorService, 'broadcast').rejects(err);
      const res = httpMocks.createResponse();
      await tronSponsorApi.postBroadcast(
        httpMocks.createRequest({ method: 'POST', body: { chain: 'tron' } }),
        res,
      );
      const data = JSON.parse(res._getData()).data;
      expect(data.code).to.equal('500');
      expect(data.message).to.not.match(/tron_sponsor_ops|sspdb|E11000/);
      expect(data.name).to.not.match(/Mongo/);
    });
  });
});
