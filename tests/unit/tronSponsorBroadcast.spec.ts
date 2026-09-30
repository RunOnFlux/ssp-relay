// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect } from 'chai';
import {
  bytesToHex,
  decodeTransaction,
  localSigner,
  opDigest,
  hexToBytes,
  opFromJson,
  recoverTransactionSigners,
  trc20Fee,
  buildOp,
  trxTransferCall,
} from '@runonflux/tron-multisig';
import {
  MAX_IN_FLIGHT_PER_VAULT,
  acceptAndBroadcast,
  parseRelayerKeys,
} from '../../src/services/tronSponsorService';
import { REVERT_BAD_SIGNATURE } from '../helpers/fakeTronNode';
import {
  COLLECTOR,
  NETWORK,
  NOW_MS,
  RECIPIENT,
  RELAYER,
  S_ORIGIN,
  SPONSOR,
  USDT,
  broadcastRequest,
  makeOp,
  makeRuntime,
  testVault,
  vectors,
} from '../helpers/tronRuntime';

const LEAF = vectors.consumer.leaves['0-0'];
const V = vectors.consumerOp;
const NOW_S = BigInt(NOW_MS / 1000);

function vectorRequest(signatures = [V.walletSignature, V.keySignature]) {
  return {
    chain: 'tron',
    signers: LEAF.signers,
    threshold: 2,
    op: V.op,
    signatures,
  };
}

function receipt(txid, result = 'SUCCESS', extra = {}) {
  return {
    id: txid,
    blockNumber: 70_000_001,
    blockTimeStamp: 1_789_999_003_000,
    fee: 1_339_000,
    receipt: {
      energy_usage_total: 100_000,
      origin_energy_usage: 100_000,
      energy_penalty_total: 49_635,
      net_usage: 0,
      net_fee: 1_339_000,
      result,
    },
    ...extra,
  };
}

/** Vectors' vault funded with USDT so the transfer call simulates. */
function vectorSetup(overrides = {}) {
  const env = makeRuntime(overrides);
  env.node.state.trc20.set(USDT, new Map([[LEAF.address, 100_000_000n]]));
  env.node.state.broadcastReply = (hex) => {
    const id = decodeTransaction(hex).txid;
    env.node.state.txInfo.set(id, receipt(id));
    return { result: true, txid: id };
  };
  return env;
}

async function refused(rt, req, pattern: RegExp) {
  let err;
  try {
    await acceptAndBroadcast(rt, req);
  } catch (e) {
    err = e;
  }
  expect(err, 'expected a refusal').to.exist;
  expect(err.message).to.match(pattern);
  return err;
}

describe('TRON sponsor broadcast — acceptance rule', function () {
  describe('vectors (tron-ssp-vectors.json consumerOp)', function () {
    it('reproduces the vector digest and execute calldata, broadcasts with fee_limit omitted', async function () {
      const { rt, node, cols } = vectorSetup();
      expect(
        `0x${bytesToHex(opDigest(NETWORK.chainId, LEAF.address, opFromJson(V.op)))}`,
      ).to.equal(V.digest);
      const { txid, confirmation } = await acceptAndBroadcast(
        rt,
        vectorRequest([V.keySignature, V.walletSignature]), // any order
      );
      expect(node.state.broadcasts).to.have.length(1);
      const tx = decodeTransaction(node.state.broadcasts[0]);
      expect(tx.txid).to.equal(txid);
      expect(tx.raw.feeLimit).to.equal(0n);
      expect(tx.raw.contract.type).to.equal('TriggerSmartContract');
      const p = tx.raw.contract.parameter;
      expect(p.ownerAddress).to.equal(RELAYER);
      expect(p.contractAddress).to.equal(SPONSOR);
      expect(p.callValue).to.equal(0n);
      expect(`0x${bytesToHex(p.data)}`).to.equal(V.executeCalldata);
      expect(recoverTransactionSigners(tx)).to.deep.equal([RELAYER]);
      // expiration = reference block + 60 s
      expect(tx.raw.expiration).to.equal(1_789_999_060_000n);

      const rec = cols.ops.docs[0];
      expect(rec).to.include({
        txid,
        digest: V.digest,
        chain: 'tron',
        vault: LEAF.address,
        nonce: '7',
        relayer: RELAYER,
        feeToken: V.op.fee.token,
        feeAmount: '6300000',
        callCount: 1,
        status: 'broadcast',
      });
      await confirmation;
      expect(cols.ops.docs[0]).to.include({
        status: 'confirmed',
        energyUsed: 100_000,
        energyPenalty: 49_635,
        originEnergyUsed: 100_000,
        netUsage: 0,
        netFee: 1_339_000,
      });
      expect(cols.ops.docs[0].confirmedAt).to.be.instanceOf(Date);
    });

    it('simulates sponsor.execute from the relayer with the vector calldata', async function () {
      const { rt, node } = vectorSetup();
      await acceptAndBroadcast(rt, vectorRequest());
      const sim = node.state.requests.find(
        (r) =>
          r.path === '/wallet/triggerconstantcontract' &&
          r.body.contract_address === SPONSOR,
      );
      expect(sim.body.owner_address).to.equal(RELAYER);
      expect(`0x${sim.body.data}`).to.equal(V.executeCalldata);
    });

    it('dedupes by digest: a repeat returns the same txid without re-broadcasting', async function () {
      const { rt, node } = vectorSetup();
      const a = await acceptAndBroadcast(rt, vectorRequest());
      const b = await acceptAndBroadcast(rt, vectorRequest());
      expect(b.txid).to.equal(a.txid);
      expect(b.confirmation).to.equal(null);
      expect(node.state.broadcasts).to.have.length(1);
    });

    it('a concurrent duplicate loses the unique-index race and gets the winner txid', async function () {
      const { rt, node } = vectorSetup();
      const [a, b] = await Promise.all([
        acceptAndBroadcast(rt, vectorRequest()),
        acceptAndBroadcast(rt, vectorRequest()),
      ]);
      expect(a.txid).to.equal(b.txid);
      expect(node.state.broadcasts).to.have.length(1);
    });

    it('allows a retry once the previous attempt failed on-chain', async function () {
      const { rt, node, cols, clock } = vectorSetup();
      node.state.broadcastReply = (hex) => {
        const id = decodeTransaction(hex).txid;
        node.state.txInfo.set(id, {
          ...receipt(id, 'REVERT'),
          result: 'FAILED',
          contractResult: [REVERT_BAD_SIGNATURE],
        });
        return { result: true, txid: id };
      };
      const first = await acceptAndBroadcast(rt, vectorRequest());
      await first.confirmation;
      expect(cols.ops.docs[0].status).to.equal('failed');
      expect(cols.ops.docs[0].error).to.equal('REVERT: BadSignature()');
      clock.now += 3_000;
      node.state.block.timestamp += 3_000n;
      node.state.broadcastReply = null;
      const second = await acceptAndBroadcast(rt, vectorRequest());
      expect(second.txid).to.not.equal(first.txid);
      expect(node.state.broadcasts).to.have.length(2);
      expect(cols.ops.docs).to.have.length(1);
      expect(cols.ops.docs[0]).to.include({
        txid: second.txid,
        status: 'broadcast',
      });
      expect(cols.ops.docs[0].error).to.equal(undefined);
    });
  });

  describe('signatures and structure', function () {
    it('rejects a signature from a non-member', async function () {
      const { rt } = vectorSetup();
      const stranger = localSigner(new Uint8Array(32).fill(0x55));
      const bad = `0x${bytesToHex(stranger.signDigest(hexToBytes(V.digest)))}`;
      await refused(
        rt,
        vectorRequest([V.walletSignature, bad]),
        /signatures rejected/,
      );
    });

    it('rejects fewer signatures than the threshold', async function () {
      const { rt } = vectorSetup();
      await refused(
        rt,
        vectorRequest([V.walletSignature]),
        /threshold\.\.signers/,
      );
    });

    it('rejects duplicate signatures by one member', async function () {
      const { rt } = vectorSetup();
      await refused(
        rt,
        vectorRequest([V.walletSignature, V.walletSignature]),
        /signatures rejected/,
      );
    });

    it('rejects a non-canonical Op', async function () {
      const { rt } = vectorSetup();
      const req = vectorRequest();
      req.op = { ...V.op, nonce: '07' };
      await refused(rt, req, /invalid op/);
    });

    it('rejects a signature over another vault (signers changed)', async function () {
      const { rt } = vectorSetup();
      const req = vectorRequest();
      req.signers = vectors.consumer.leaves['0-1'].signers;
      await refused(rt, req, /signatures rejected/);
    });
  });

  describe('acceptance rule refusals', function () {
    const v = testVault();
    const trxCall = [trxTransferCall(RECIPIENT, 1_000_000n)];

    function setup(overrides = {}) {
      const env = makeRuntime(overrides);
      env.node.state.accounts.set(v.vault, { balance: 100_000_000n });
      env.node.state.accounts.set(RECIPIENT, { balance: 1n });
      env.node.state.trc20.set(USDT, new Map([[v.vault, 100_000_000n]]));
      return env;
    }

    it('accepts a well-formed TRX-fee Op (baseline for the cases below)', async function () {
      const { rt, node } = setup();
      const { txid } = await acceptAndBroadcast(
        rt,
        broadcastRequest(v, makeOp({ calls: trxCall })),
      );
      expect(txid).to.match(/^[0-9a-f]{64}$/);
      expect(node.state.broadcasts).to.have.length(1);
    });

    it('fee recipient must be the fee collector', async function () {
      const { rt, node } = setup();
      await refused(
        rt,
        broadcastRequest(v, makeOp({ calls: trxCall, recipient: RECIPIENT })),
        /fee recipient must be the SSP fee collector/,
      );
      expect(node.state.broadcasts).to.have.length(0);
    });

    it('fee token must be TRX or USDT', async function () {
      const { rt } = setup();
      const op = buildOp({
        calls: trxCall,
        nonce: 0n,
        deadline: 1_790_000_000n,
        fee: trc20Fee(RECIPIENT, 10_000_000n, COLLECTOR),
      });
      await refused(
        rt,
        broadcastRequest(v, op),
        /fee token must be TRX or the network USDT/,
      );
    });

    it('fee must cover the cost now (no markup)', async function () {
      const { rt, node } = setup();
      node.state.execute = { ok: true, energy: 100_000 };
      await refused(
        rt,
        broadcastRequest(v, makeOp({ calls: trxCall, feeAmount: 5_000_000n })),
        /below the current cost/,
      );
    });

    it('a USDT fee is converted at the current TRX rate', async function () {
      const { rt, node } = setup();
      node.state.execute = { ok: true, energy: 100_000 };
      // cost ≈ (100,000 × 45 + ~1.2k bytes × 1000) sun ≈ 5.7 TRX ≈ 1.93 USDT
      await refused(
        rt,
        broadcastRequest(
          v,
          makeOp({ calls: trxCall, feeToken: 'USDT', feeAmount: 1_800_000n }),
        ),
        /below the current cost/,
      );
      const ok = await acceptAndBroadcast(
        rt,
        broadcastRequest(
          v,
          makeOp({ calls: trxCall, feeToken: 'USDT', feeAmount: 2_000_000n }),
        ),
      );
      expect(ok.txid).to.match(/^[0-9a-f]{64}$/);
    });

    it('refuses a USDT fee when the TRX rate is unknown', async function () {
      const { rt } = setup({ rates: () => ({ trxUsd: null, usdtUsd: 1 }) });
      await refused(
        rt,
        broadcastRequest(
          v,
          makeOp({ calls: trxCall, feeToken: 'USDT', feeAmount: 9_000_000n }),
        ),
        /cannot price a USDT fee/,
      );
    });

    it('deadline must not have passed (with a 60 s margin)', async function () {
      const { rt } = setup();
      await refused(
        rt,
        broadcastRequest(v, makeOp({ calls: trxCall, deadline: NOW_S + 30n })),
        /deadline has passed or is too close/,
      );
    });

    it('deadline must be within 31 days', async function () {
      const { rt } = setup();
      await refused(
        rt,
        broadcastRequest(
          v,
          makeOp({ calls: trxCall, deadline: NOW_S + 32n * 86_400n }),
        ),
        /too far in the future/,
      );
    });

    it('nonce must be unused on-chain', async function () {
      const { rt, node } = setup();
      node.state.contracts.set(v.vault, { runtimecode: 'cc' });
      node.state.nonceBitmaps.set(v.vault, new Map([[0n, 1n]]));
      await refused(
        rt,
        broadcastRequest(v, makeOp({ calls: trxCall, nonce: 0n })),
        /nonce is already used/,
      );
    });

    it('detects a reverting simulation even though result.result is true', async function () {
      const { rt, node, cols } = setup();
      node.state.execute = {
        ok: false,
        energy: 18_325,
        result: REVERT_BAD_SIGNATURE,
      };
      await refused(
        rt,
        broadcastRequest(v, makeOp({ calls: trxCall })),
        /simulation failed: simulation failed: BadSignature\(\)/,
      );
      expect(node.state.broadcasts).to.have.length(0);
      expect(cols.ops.docs).to.have.length(0);
    });

    it('energy may exceed the quote by at most 25 %', async function () {
      const { rt, node, cols } = setup();
      await cols.reservations.insertOne({
        chain: 'tron',
        vault: v.vault,
        nonce: '0',
        source: 'relay',
        expiresAt: new Date(NOW_MS + 600_000),
        energy: { trx: 70_000, usdt: 150_000 },
      });
      node.state.execute = { ok: true, energy: 90_000 };
      await refused(
        rt,
        broadcastRequest(v, makeOp({ calls: trxCall, feeAmount: 20_000_000n })),
        /exceeds the quoted 70000 by more than 25%/,
      );
      node.state.execute = { ok: true, energy: 87_500 };
      const ok = await acceptAndBroadcast(
        rt,
        broadcastRequest(v, makeOp({ calls: trxCall, feeAmount: 20_000_000n })),
      );
      expect(ok.txid).to.match(/^[0-9a-f]{64}$/);
    });

    it('energy must fit the sponsor origin_energy_limit', async function () {
      const { rt, node } = setup();
      node.state.contracts.get(SPONSOR).originEnergyLimit = 50_000;
      node.state.execute = { ok: true, energy: 60_000 };
      await refused(
        rt,
        broadcastRequest(v, makeOp({ calls: trxCall })),
        /origin_energy_limit 50000/,
      );
    });

    it('energy must stay under the 1.2M launch cap', async function () {
      const { rt, node, cols } = setup();
      await cols.reservations.insertOne({
        chain: 'tron',
        vault: v.vault,
        nonce: '0',
        energy: { trx: 1_300_000, usdt: 1_300_000 },
      });
      node.state.execute = { ok: true, energy: 1_300_000 };
      await refused(
        rt,
        broadcastRequest(v, makeOp({ calls: trxCall, feeAmount: 80_000_000n })),
        /exceeds the 1200000 cap/,
      );
    });

    it('refuses (no burning) when S lacks energy and no rental is configured', async function () {
      const { rt, node } = setup();
      node.state.resources.set(S_ORIGIN, {
        EnergyLimit: 50_000,
        EnergyUsed: 0,
      });
      await refused(
        rt,
        broadcastRequest(v, makeOp({ calls: trxCall })),
        /sponsor temporarily unavailable/,
      );
      expect(node.state.broadcasts).to.have.length(0);
    });

    it('rents energy for S when a rental provider is configured', async function () {
      const rentals = [];
      const env = setup();
      env.node.state.resources.set(S_ORIGIN, {
        EnergyLimit: 50_000,
        EnergyUsed: 0,
      });
      env.rt.rental = {
        name: 'mock',
        async rent(p) {
          rentals.push(p);
          env.node.state.resources.set(S_ORIGIN, {
            EnergyLimit: 50_000 + Number(p.quantity),
            EnergyUsed: 0,
          });
          return { orderId: 'o1' };
        },
      };
      await acceptAndBroadcast(
        env.rt,
        broadcastRequest(v, makeOp({ calls: trxCall })),
      );
      expect(rentals).to.have.length(1);
      expect(rentals[0].receiver).to.equal(S_ORIGIN);
      expect(rentals[0].quantity).to.equal(65_000n);
      expect(rentals[0].clientOrderId).to.match(/^ssp-[0-9a-f]{32}-\d+$/);
      expect(env.node.state.broadcasts).to.have.length(1);
    });

    it('refuses when the rental fails', async function () {
      const env = setup();
      env.node.state.resources.set(S_ORIGIN, { EnergyLimit: 0, EnergyUsed: 0 });
      env.rt.rental = {
        name: 'mock',
        async rent() {
          throw new Error(
            'CatFee order refused: code=201 insufficient balance',
          );
        },
      };
      await refused(
        env.rt,
        broadcastRequest(v, makeOp({ calls: trxCall })),
        /sponsor temporarily unavailable/,
      );
    });

    it('refuses while the kill switch is off', async function () {
      const { rt } = setup({ killSwitchOn: () => false });
      await refused(
        rt,
        broadcastRequest(v, makeOp({ calls: trxCall })),
        /TRON_SPONSOR_ENABLED is off/,
      );
    });

    it('refuses without relayers', async function () {
      const { rt } = setup({ relayers: [] });
      await refused(
        rt,
        broadcastRequest(v, makeOp({ calls: trxCall })),
        /no relayer keys/,
      );
    });

    it('refuses a sponsor whose consume_user_resource_percent is not 0', async function () {
      const { rt, node } = setup();
      node.state.contracts.get(SPONSOR).percent = 100;
      await refused(
        rt,
        broadcastRequest(v, makeOp({ calls: trxCall })),
        /consume_user_resource_percent/,
      );
    });

    // Confirmation pollers that never finish: the records stay 'broadcast'.
    const neverConfirm = { sleep: () => new Promise(() => undefined) };

    it('refuses a second Op with the same nonce while the first is in flight', async function () {
      const { rt } = setup(neverConfirm);
      await acceptAndBroadcast(
        rt,
        broadcastRequest(v, makeOp({ calls: trxCall, nonce: 5n })),
      );
      await refused(
        rt,
        broadcastRequest(
          v,
          makeOp({ calls: trxCall, nonce: 5n, feeAmount: 7_000_000n }),
        ),
        /another Op with this nonce/,
      );
    });

    it(`caps unconfirmed Ops per vault at ${MAX_IN_FLIGHT_PER_VAULT}`, async function () {
      const { rt } = setup(neverConfirm);
      for (let i = 0; i < MAX_IN_FLIGHT_PER_VAULT; i++) {
        await acceptAndBroadcast(
          rt,
          broadcastRequest(
            v,
            makeOp({ calls: trxCall, nonce: BigInt(10 + i) }),
          ),
        );
      }
      await refused(
        rt,
        broadcastRequest(v, makeOp({ calls: trxCall, nonce: 99n })),
        /too many unconfirmed/,
      );
    });

    it('applies the per-vault daily cap', async function () {
      const { rt } = setup({ maxOpsPerVaultPerDay: 1 });
      await acceptAndBroadcast(
        rt,
        broadcastRequest(v, makeOp({ calls: trxCall, nonce: 1n })),
      );
      await refused(
        rt,
        broadcastRequest(v, makeOp({ calls: trxCall, nonce: 2n })),
        /daily sponsored-operation limit/,
      );
    });
  });

  describe('relayers and the node', function () {
    const v = testVault(0x61, 0x62);
    const trxCall = [trxTransferCall(RECIPIENT, 1_000_000n)];

    function setup(overrides = {}) {
      const env = makeRuntime(overrides);
      env.node.state.accounts.set(v.vault, { balance: 100_000_000n });
      env.node.state.accounts.set(RECIPIENT, { balance: 1n });
      return env;
    }

    it('round-robins relayers and skips one that cannot pay bandwidth', async function () {
      const second = parseRelayerKeys('12'.repeat(32), 'test')[0];
      const env = setup();
      env.rt.relayers = [...env.rt.relayers, second];
      env.node.state.relayers.add(second.address);
      env.node.state.resources.set(RELAYER, { NetLimit: 0, NetUsed: 0 });
      env.node.state.accounts.set(RELAYER, { balance: 0n });
      env.node.state.accounts.set(second.address, { balance: 50_000_000n });
      await acceptAndBroadcast(
        env.rt,
        broadcastRequest(v, makeOp({ calls: trxCall, nonce: 1n })),
      );
      const tx = decodeTransaction(env.node.state.broadcasts[0]);
      expect(tx.raw.contract.parameter.ownerAddress).to.equal(second.address);
    });

    it('refuses when no relayer can pay bandwidth', async function () {
      const env = setup();
      env.node.state.resources.set(RELAYER, { NetLimit: 0, NetUsed: 0 });
      env.node.state.accounts.set(RELAYER, { balance: 0n });
      await refused(
        env.rt,
        broadcastRequest(v, makeOp({ calls: trxCall })),
        /no relayer can pay bandwidth/,
      );
    });

    it('refuses and records a node that returns a different txid', async function () {
      const env = setup();
      env.node.state.broadcastReply = () => ({
        result: true,
        txid: 'ab'.repeat(32),
      });
      await refused(
        env.rt,
        broadcastRequest(v, makeOp({ calls: trxCall })),
        /different txid/,
      );
      expect(env.cols.ops.docs[0].status).to.equal('failed');
    });

    it('marks the record failed when the node refuses the broadcast', async function () {
      const env = setup();
      env.node.state.broadcastReply = () => ({
        result: false,
        code: 'BANDWIDTH_ERROR',
        message: Buffer.from('account bandwidth is not enough').toString('hex'),
      });
      await refused(
        env.rt,
        broadcastRequest(v, makeOp({ calls: trxCall })),
        /TRON broadcast refused: broadcast refused: BANDWIDTH_ERROR/,
      );
      expect(env.cols.ops.docs[0]).to.include({ status: 'failed' });
      expect(env.cols.ops.docs[0].error).to.match(/BANDWIDTH_ERROR/);
    });

    it('treats DUP_TRANSACTION_ERROR as our own transaction', async function () {
      const env = setup();
      env.node.state.broadcastReply = () => ({
        result: false,
        code: 'DUP_TRANSACTION_ERROR',
      });
      const { txid } = await acceptAndBroadcast(
        env.rt,
        broadcastRequest(v, makeOp({ calls: trxCall })),
      );
      expect(env.cols.ops.docs[0]).to.include({ txid, status: 'broadcast' });
    });

    it('marks a transaction that never solidifies as failed (expired)', async function () {
      const env = setup();
      const { confirmation } = await acceptAndBroadcast(
        env.rt,
        broadcastRequest(v, makeOp({ calls: trxCall })),
      );
      await confirmation;
      expect(env.cols.ops.docs[0].status).to.equal('failed');
      expect(env.cols.ops.docs[0].error).to.match(
        /not solidified after 3 polls/,
      );
    });
  });
});
