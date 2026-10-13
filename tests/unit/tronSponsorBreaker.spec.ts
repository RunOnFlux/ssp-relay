// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
//
// 2026-10 security review, TRX-1: the sponsor's failure breakers and energy
// commitments are persisted (shared by every relay process, kept across
// restarts), failures are also counted per signing key and per client, and a
// vault without paid sponsored history gets a lower energy cap.
import { expect } from 'chai';
import {
  buildConfig,
  buildOp,
  bytesToHex,
  decodeSponsorExecute,
  decodeTransaction,
  deriveVault,
  localSigner,
  opDigest,
  opToJson,
  trc20TransferCall,
  trxFee,
  trxTransferCall,
} from '@runonflux/tron-multisig';
import {
  DEFAULT_MAX_NEW_VAULT_FAILED_ENERGY_PER_HOUR,
  MIN_VAULTS_FOR_CHAIN_BREAKER,
  acceptAndBroadcast,
  assertTronConfig,
  broadcastEnergyCap,
  callsShapeKey,
  clientKeyOf,
  configuredMaxNewVaultFailedEnergyPerHour,
  configuredNewVaultMaxEnergy,
  configuredNewVaultPaidOps,
  newVaultEnergyCap,
  quoteWithRuntime,
} from '../../src/services/tronSponsorService';
import defaultConfig from '../../config/default';
import {
  COLLECTOR,
  NETWORK,
  NOW_MS,
  RECIPIENT,
  S_ORIGIN,
  USDT,
  broadcastRequest,
  makeOp,
  makeRuntime,
} from '../helpers/tronRuntime';

const NOW_S = BigInt(NOW_MS / 1000);
const trxCall = [trxTransferCall(RECIPIENT, 1_000_000n)];
const neverConfirm = { sleep: () => new Promise(() => undefined) };

const key = (seed: number) => localSigner(new Uint8Array(32).fill(seed));

/** A vault of `members` (threshold `m`) whose Ops are signed by `signing` only. */
function vaultOf(members, m, signing = members) {
  const config = buildConfig(
    members.map((k) => k.address),
    m,
  );
  const vault = deriveVault(NETWORK, config).address;
  return {
    config,
    vault,
    sign(op) {
      const d = opDigest(NETWORK.chainId, vault, op);
      return signing.map((k) => `0x${bytesToHex(k.signDigest(d))}`);
    },
  };
}

function fund(env, v) {
  env.node.state.accounts.set(v.vault, { balance: 100_000_000n });
  env.node.state.accounts.set(RECIPIENT, { balance: 1n });
  env.node.state.trc20.set(USDT, new Map([[v.vault, 100_000_000n]]));
}

function failedReceipt(txid, energy) {
  return {
    id: txid,
    blockNumber: 70_000_001,
    blockTimeStamp: 1_789_999_003_000,
    fee: 0,
    result: 'FAILED',
    receipt: {
      energy_usage_total: energy,
      origin_energy_usage: energy,
      net_usage: 1_200,
      result: 'REVERT',
    },
  };
}

function failOnChain(node, energy = 100_000) {
  node.state.broadcastReply = (hex) => {
    const id = decodeTransaction(hex).txid;
    node.state.txInfo.set(id, failedReceipt(id, energy));
    return { result: true, txid: id };
  };
}

async function outcome(p) {
  try {
    return { ok: true, value: await p };
  } catch (e) {
    return { ok: false, error: e };
  }
}

/** Broadcast an Op that fails on-chain and wait for the poller to see it. */
async function failOnce(env, v, nonce, opts = {}) {
  failOnChain(env.node, 100_000);
  const r = await acceptAndBroadcast(
    env.rt,
    broadcastRequest(v, makeOp({ calls: trxCall, nonce })),
    opts,
  );
  await r.confirmation;
  env.node.state.broadcastReply = null;
  env.clock.now += 3_000;
  env.node.state.block.timestamp += 3_000n;
  return r;
}

function failureEvents(cols) {
  return cols.reservations.docs.filter((d) => d.vault === '#failure');
}

function capOf(node, i = node.state.broadcasts.length - 1) {
  const tx = decodeTransaction(node.state.broadcasts[i]);
  return decodeSponsorExecute(tx.raw.contract.parameter.data).energyCap;
}

/** Record a relay quote for (vault, nonce, calls) at `energy`. */
function quoteFor(env, v, nonce, energy, calls = trxCall) {
  return env.cols.reservations.insertOne({
    chain: 'tron',
    vault: v.vault,
    nonce: nonce.toString(),
    energy: { trx: energy, usdt: energy },
    callsKey: callsShapeKey(calls),
  });
}

/** `n` confirmed, fee-paying sponsored Ops of `v`: a proven vault. */
async function paidHistory(env, v, n) {
  for (let i = 0; i < n; i++) {
    await env.cols.ops.insertOne({
      txid: `${i}`.padStart(64, 'c'),
      digest: `0x${`${i}`.padStart(64, 'd')}${v.vault}`,
      chain: 'tron',
      vault: v.vault,
      nonce: `${100 + i}`,
      status: 'confirmed',
      feeAmount: '6300000',
      createdAt: new Date(NOW_MS - 3_600_000),
    });
  }
}

/** Broadcast an Op of `v` that fails on-chain burning `energy`. */
async function failWith(env, v, nonce, energy) {
  failOnChain(env.node, energy);
  const r = await acceptAndBroadcast(
    env.rt,
    broadcastRequest(v, makeOp({ calls: trxCall, nonce })),
  );
  await r.confirmation;
  env.node.state.broadcastReply = null;
  env.clock.now += 3_000;
  env.node.state.block.timestamp += 3_000n;
  return r;
}

/** 40 distinct member keys (seeds clear of the fixtures' fixed keys). */
const KEYS_40 = Array.from({ length: 40 }, (_, i) => key(0x50 + i));

describe('TRON sponsor breakers (2026-10 review, TRX-1)', function () {
  describe('per signing key', function () {
    it('counts failures against the keys that SIGNED, never against keys merely listed in a config', async function () {
      const attacker = key(0xa1);
      const victim = key(0xa2);
      const friend = key(0xa3);
      // 1-of-2 [attacker, victim]: anyone can list a victim's key; only the
      // attacker signs.
      const trap = vaultOf([attacker, victim], 1, [attacker]);
      const env = makeRuntime();
      fund(env, trap);
      await failOnce(env, trap, 1n);
      await failOnce(env, trap, 2n);
      const events = failureEvents(env.cols);
      expect(events).to.have.length(2);
      expect(events.every((e) => e.signers.length === 1)).to.equal(true);
      expect(events[0].signers).to.deep.equal([attacker.address]);
      expect(events[0].opVault).to.equal(trap.vault);

      // The victim's own vault is not poisoned.
      const own = vaultOf([victim, friend], 2);
      fund(env, own);
      const ok = await acceptAndBroadcast(
        env.rt,
        broadcastRequest(own, makeOp({ calls: trxCall, nonce: 1n })),
      );
      expect(ok.txid).to.match(/^[0-9a-f]{64}$/);

      // A FRESH vault that the attacker signs for is refused (vaults are free).
      const fresh = vaultOf([attacker, key(0xa4)], 1, [attacker]);
      fund(env, fresh);
      const before = env.node.state.broadcasts.length;
      const r = await outcome(
        acceptAndBroadcast(
          env.rt,
          broadcastRequest(fresh, makeOp({ calls: trxCall, nonce: 1n })),
        ),
      );
      expect(r.ok).to.equal(false);
      expect(r.error.name).to.equal('TronSponsorRefusal');
      expect(r.error.message).to.match(
        /signed by a key of this operation failed on-chain 2 times/,
      );
      expect(env.node.state.broadcasts).to.have.length(before);
      // The window rolls (24 h): sponsorship resumes.
      env.clock.now += 86_400_001;
      env.node.state.block.timestamp += 86_400_001n;
      const later = await acceptAndBroadcast(
        env.rt,
        broadcastRequest(
          fresh,
          makeOp({
            calls: trxCall,
            nonce: 1n,
            deadline: NOW_S + 2n * 86_400n,
          }),
        ),
      );
      expect(later.txid).to.match(/^[0-9a-f]{64}$/);
    });
  });

  describe('per client', function () {
    it('pauses a client (hashed IP) whose Ops keep failing, across fresh vaults and keys', async function () {
      const env = makeRuntime();
      const K = clientKeyOf('198.51.100.9');
      for (let i = 0; i < 3; i++) {
        const v = vaultOf([key(0xb0 + 2 * i), key(0xb1 + 2 * i)], 2);
        fund(env, v);
        await failOnce(env, v, 1n, { clientKey: K });
      }
      const events = failureEvents(env.cols);
      expect(events.map((e) => e.clientKey)).to.deep.equal([K, K, K]);
      // Raw IPs are never stored, only the hash.
      expect(JSON.stringify(env.cols.reservations.docs)).to.not.include(
        '198.51.100.9',
      );
      expect(JSON.stringify(env.cols.ops.docs)).to.not.include('198.51.100.9');
      expect(env.cols.ops.docs.every((d) => d.clientKey === K)).to.equal(true);

      const next = vaultOf([key(0xc1), key(0xc2)], 2);
      fund(env, next);
      const req = broadcastRequest(next, makeOp({ calls: trxCall, nonce: 1n }));
      const r = await outcome(
        acceptAndBroadcast(env.rt, req, { clientKey: K }),
      );
      expect(r.ok).to.equal(false);
      expect(r.error.message).to.match(
        /from this client failed on-chain 3 times/,
      );
      // Another client, or the enterprise hook (no client key), is unaffected.
      const other = await acceptAndBroadcast(env.rt, req, {
        clientKey: clientKeyOf('198.51.100.10'),
      });
      expect(other.txid).to.match(/^[0-9a-f]{64}$/);
    });

    it('ignores a malformed client key (no accounting rather than a shared bucket)', async function () {
      const env = makeRuntime();
      const v = vaultOf([key(0xc3), key(0xc4)], 2);
      fund(env, v);
      await failOnce(env, v, 1n, { clientKey: 'not-a-hash' });
      expect(failureEvents(env.cols)[0].clientKey).to.equal(null);
    });
  });

  describe('persistence', function () {
    it('the chain-wide budget survives a restart and is shared by every relay process', async function () {
      const v1 = vaultOf([key(0xd1), key(0xd2)], 2);
      // Fresh vaults: the new-vault pool is the one that trips here; it is
      // persisted exactly like the chain-wide one.
      const env1 = makeRuntime({
        maxFailedEnergyPerHour: 200_000,
        maxNewVaultFailedEnergyPerHour: 200_000,
      });
      fund(env1, v1);
      failOnChain(env1.node, 250_000);
      const first = await acceptAndBroadcast(
        env1.rt,
        broadcastRequest(v1, makeOp({ calls: trxCall, nonce: 1n })),
      );
      await first.confirmation;
      // A second process (or the same one after a restart): fresh runtime,
      // same database.
      const env2 = makeRuntime({
        maxFailedEnergyPerHour: 200_000,
        maxNewVaultFailedEnergyPerHour: 200_000,
        collections: env1.rt.collections,
      });
      const v2 = vaultOf([key(0xd3), key(0xd4)], 2);
      fund(env2, v2);
      const r = await outcome(
        acceptAndBroadcast(
          env2.rt,
          broadcastRequest(v2, makeOp({ calls: trxCall, nonce: 1n })),
        ),
      );
      expect(r.ok).to.equal(false);
      expect(r.error.message).to.match(/temporarily unavailable/);
      expect(env2.node.state.broadcasts).to.have.length(0);
    });

    it("S's committed energy is shared across processes", async function () {
      const shared = makeRuntime(neverConfirm);
      const p1 = makeRuntime({
        ...neverConfirm,
        collections: shared.rt.collections,
      });
      const p2 = makeRuntime({
        ...neverConfirm,
        collections: shared.rt.collections,
      });
      for (const p of [p1, p2]) {
        p.node.state.resources.set(S_ORIGIN, {
          EnergyLimit: 150_000,
          EnergyUsed: 0,
        });
        p.node.state.execute = { ok: true, energy: 100_000 };
      }
      const v1 = vaultOf([key(0xe1), key(0xe2)], 2);
      const v2 = vaultOf([key(0xe3), key(0xe4)], 2);
      fund(p1, v1);
      fund(p2, v2);
      const results = await Promise.all([
        outcome(
          acceptAndBroadcast(
            p1.rt,
            broadcastRequest(v1, makeOp({ calls: trxCall, nonce: 1n })),
          ),
        ),
        outcome(
          acceptAndBroadcast(
            p2.rt,
            broadcastRequest(v2, makeOp({ calls: trxCall, nonce: 1n })),
          ),
        ),
      ]);
      // Two processes, one S: never both (each node alone says 150k free).
      expect(
        p1.node.state.broadcasts.length + p2.node.state.broadcasts.length,
      ).to.equal(1);
      const refused = results.find((x) => !x.ok);
      expect(refused.error.message).to.match(/sponsor energy is low/);
      // Sequentially too: a process that starts after the first broadcast
      // still sees its commitment until the window passes.
      const v3 = vaultOf([key(0xe5), key(0xe6)], 2);
      const p3 = makeRuntime({
        ...neverConfirm,
        collections: shared.rt.collections,
      });
      p3.node.state.resources.set(S_ORIGIN, {
        EnergyLimit: 150_000,
        EnergyUsed: 0,
      });
      p3.node.state.execute = { ok: true, energy: 100_000 };
      fund(p3, v3);
      const r3 = await outcome(
        acceptAndBroadcast(
          p3.rt,
          broadcastRequest(v3, makeOp({ calls: trxCall, nonce: 1n })),
        ),
      );
      expect(r3.ok).to.equal(false);
      expect(r3.error.message).to.match(/sponsor energy is low/);
      p3.clock.now += 20_000;
      p3.node.state.block.timestamp += 20_000n;
      const ok = await acceptAndBroadcast(
        p3.rt,
        broadcastRequest(v3, makeOp({ calls: trxCall, nonce: 2n })),
      );
      expect(ok.txid).to.match(/^[0-9a-f]{64}$/);
    });

    it('fails CLOSED when the breaker state cannot be read', async function () {
      const env = makeRuntime();
      const v = vaultOf([key(0xe7), key(0xe8)], 2);
      fund(env, v);
      const broken = Object.create(env.cols.reservations);
      broken.find = () => ({
        limit() {
          return this;
        },
        toArray: async () => {
          throw Object.assign(new Error('connection refused'), {
            name: 'MongoNetworkError',
          });
        },
      });
      env.rt.collections = async () => ({
        ops: env.cols.ops,
        reservations: broken,
      });
      const r = await outcome(
        acceptAndBroadcast(
          env.rt,
          broadcastRequest(v, makeOp({ calls: trxCall, nonce: 1n })),
        ),
      );
      expect(r.ok).to.equal(false);
      expect(r.error.name).to.equal('TronSponsorRefusal');
      expect(r.error.message).to.match(/failure accounting unavailable/);
      expect(env.node.state.broadcasts).to.have.length(0);
    });
  });

  describe('new-vault energy cap', function () {
    it('caps an unproven vault below the launch cap; paid history lifts it', async function () {
      const env = makeRuntime();
      const v = vaultOf([key(0xf1), key(0xf2)], 2);
      fund(env, v);
      const bigFee = { calls: trxCall, feeAmount: 80_000_000n };

      // 400k > the 350k new-vault cap: refused, nothing broadcast.
      await quoteFor(env, v, 0n, 400_000);
      env.node.state.execute = { ok: true, energy: 400_000 };
      const r = await outcome(
        acceptAndBroadcast(
          env.rt,
          broadcastRequest(v, makeOp({ ...bigFee, nonce: 0n })),
        ),
      );
      expect(r.ok).to.equal(false);
      expect(r.error.message).to.match(
        /exceeds the 350000 cap for a vault that has not yet paid 3 sponsored fees/,
      );
      expect(env.node.state.broadcasts).to.have.length(0);

      // Under the cap: accepted, energyCap still 1.25 × the simulation.
      await quoteFor(env, v, 1n, 300_000);
      env.node.state.execute = { ok: true, energy: 300_000 };
      const ok = await acceptAndBroadcast(
        env.rt,
        broadcastRequest(v, makeOp({ ...bigFee, nonce: 1n })),
      );
      await ok.confirmation; // never solidifies → 'failed' (no receipt)
      expect(capOf(env.node)).to.equal(375_000n);
      // Records carry the signing keys for failure attribution.
      expect(env.cols.ops.docs[0].signers).to.deep.equal([...v.config.signers]);

      // Three confirmed, fee-paying sponsored Ops: the full launch cap.
      await paidHistory(env, v, 3);
      env.clock.now += 3_000;
      env.node.state.block.timestamp += 3_000n;
      await quoteFor(env, v, 2n, 400_000);
      env.node.state.execute = { ok: true, energy: 400_000 };
      const lifted = await acceptAndBroadcast(
        env.rt,
        broadcastRequest(v, makeOp({ ...bigFee, nonce: 2n })),
      );
      expect(lifted.txid).to.match(/^[0-9a-f]{64}$/);
      expect(capOf(env.node)).to.equal(broadcastEnergyCap(400_000n));
    });

    it('zero-fee or unconfirmed records do not count as paid history', async function () {
      const env = makeRuntime();
      const v = vaultOf([key(0xf3), key(0xf4)], 2);
      fund(env, v);
      for (const [i, status, feeAmount] of [
        [0, 'broadcast', '6300000'],
        [1, 'failed', '6300000'],
        [2, 'confirmed', '0'],
        [3, 'confirmed', '6300000'],
        [4, 'confirmed', '6300000'],
      ]) {
        await env.cols.ops.insertOne({
          digest: `0x${String(i).padStart(64, 'e')}`,
          chain: 'tron',
          vault: v.vault,
          nonce: `${200 + i}`,
          status,
          feeAmount,
          createdAt: new Date(NOW_MS - 7_200_000),
        });
      }
      await quoteFor(env, v, 0n, 400_000);
      env.node.state.execute = { ok: true, energy: 400_000 };
      const r = await outcome(
        acceptAndBroadcast(
          env.rt,
          broadcastRequest(
            v,
            makeOp({ calls: trxCall, nonce: 0n, feeAmount: 80_000_000n }),
          ),
        ),
      );
      expect(r.ok).to.equal(false);
      expect(r.error.message).to.match(/has not yet paid 3 sponsored fees/);
    });

    it('the quote says NEW_VAULT_ENERGY_CAP instead of letting members sign a doomed Op', async function () {
      const env = makeRuntime();
      const v = vaultOf([key(0xf5), key(0xf6)], 2);
      fund(env, v);
      env.node.state.accounts.set(v.vault, { balance: 500_000_000n });
      env.node.state.energy.transfer = 400_000;
      const calls = [trc20TransferCall(USDT, RECIPIENT, 1_000_000n)];
      const req = {
        chain: 'tron',
        signers: [...v.config.signers],
        threshold: 2,
        calls: opToJson(buildOp({ calls, nonce: 0n, deadline: 1n })).calls,
      };
      const q = await quoteWithRuntime(env.rt, req, { trusted: false });
      expect(q.sponsorAvailable).to.equal(false);
      expect(q.unavailableReason).to.match(/^NEW_VAULT_ENERGY_CAP/);
      await paidHistory(env, v, 3);
      const q2 = await quoteWithRuntime(env.rt, req, { trusted: false });
      expect(q2.sponsorAvailable).to.equal(true);
    });

    it('scales with the threshold: base + 4,650 per signature above 2, never above 1.2M', function () {
      expect(newVaultEnergyCap(350_000n, 1)).to.equal(350_000n);
      expect(newVaultEnergyCap(350_000n, 2)).to.equal(350_000n);
      expect(newVaultEnergyCap(350_000n, 3)).to.equal(354_650n);
      expect(newVaultEnergyCap(350_000n, 20)).to.equal(433_700n);
      expect(newVaultEnergyCap(350_000n, 40)).to.equal(526_700n);
      expect(newVaultEnergyCap(1_100_000n, 40)).to.equal(1_200_000n);
      // garbage never widens the cap
      expect(newVaultEnergyCap(350_000n, 2.5)).to.equal(350_000n);
      expect(newVaultEnergyCap(350_000n, Number.NaN)).to.equal(350_000n);
    });

    it('a 20-of-40 first send (~382k) is sponsored; 2-of-2 keeps the 350k cap; over the scaled cap is refused', async function () {
      // ENERGY.md: 2-of-2 first send to a new USDT holder with a USDT fee
      // ≈ 305k; 20-of-40 adds ≈ 77k of signature verification ≈ 382k.
      const env = makeRuntime();
      const big = vaultOf(KEYS_40, 20, KEYS_40.slice(0, 20));
      fund(env, big);
      const bigFee = { calls: trxCall, feeAmount: 80_000_000n };
      await quoteFor(env, big, 0n, 382_000);
      env.node.state.execute = { ok: true, energy: 382_000 };
      const ok = await acceptAndBroadcast(
        env.rt,
        broadcastRequest(big, makeOp({ ...bigFee, nonce: 0n })),
      );
      expect(ok.txid).to.match(/^[0-9a-f]{64}$/);
      // energyCap 1.25 × the simulation (under 1.25 × the 433,700 cap)
      expect(capOf(env.node)).to.equal(477_500n);
      expect(env.cols.ops.docs[0].vaultProven).to.equal(false);
      await ok.confirmation;

      // The same energy on a fresh 2-of-2: still capped at 350k.
      const small = vaultOf([key(0x91), key(0x92)], 2);
      fund(env, small);
      await quoteFor(env, small, 0n, 382_000);
      const r = await outcome(
        acceptAndBroadcast(
          env.rt,
          broadcastRequest(small, makeOp({ ...bigFee, nonce: 0n })),
        ),
      );
      expect(r.ok).to.equal(false);
      expect(r.error.message).to.match(
        /exceeds the 350000 cap for a vault that has not yet paid/,
      );

      // Above the scaled cap: refused, nothing broadcast.
      env.clock.now += 3_000;
      env.node.state.block.timestamp += 3_000n;
      const before = env.node.state.broadcasts.length;
      await quoteFor(env, big, 1n, 433_701);
      env.node.state.execute = { ok: true, energy: 433_701 };
      const over = await outcome(
        acceptAndBroadcast(
          env.rt,
          broadcastRequest(big, makeOp({ ...bigFee, nonce: 1n })),
        ),
      );
      expect(over.ok).to.equal(false);
      expect(over.error.message).to.match(
        /exceeds the 433700 cap for a vault that has not yet paid 3 sponsored fees/,
      );
      expect(env.node.state.broadcasts).to.have.length(before);
    });

    it('the quote applies the same threshold-scaled cap', async function () {
      const env = makeRuntime();
      const big = vaultOf(KEYS_40, 20, KEYS_40.slice(0, 20));
      fund(env, big);
      env.node.state.accounts.set(big.vault, { balance: 500_000_000n });
      // 20-of-40 USDT transfer: ≈ 387k estimated — above the flat 350k,
      // within 433,700.
      env.node.state.energy.transfer = 200_000;
      const calls = [trc20TransferCall(USDT, RECIPIENT, 1_000_000n)];
      const jsonCalls = opToJson(
        buildOp({ calls, nonce: 0n, deadline: 1n }),
      ).calls;
      const q = await quoteWithRuntime(
        env.rt,
        {
          chain: 'tron',
          signers: [...big.config.signers],
          threshold: 20,
          calls: jsonCalls,
        },
        { trusted: false },
      );
      expect(Number(q.energy.estimate)).to.be.greaterThan(350_000);
      expect(Number(q.energy.estimate)).to.be.at.most(433_700);
      expect(q.sponsorAvailable).to.equal(true);
      // Heavier calls: over the scaled cap → NEW_VAULT_ENERGY_CAP naming it.
      env.node.state.energy.transfer = 260_000;
      const q2 = await quoteWithRuntime(
        env.rt,
        {
          chain: 'tron',
          signers: [...big.config.signers],
          threshold: 20,
          calls: jsonCalls,
        },
        { trusted: false },
      );
      expect(q2.sponsorAvailable).to.equal(false);
      expect(q2.unavailableReason).to.match(
        /^NEW_VAULT_ENERGY_CAP: .* above the 433700 sponsored/,
      );
    });

    it('config: TRON_NEW_VAULT_MAX_ENERGY / TRON_NEW_VAULT_PAID_OPS are validated', function () {
      expect(configuredNewVaultMaxEnergy({})).to.equal(350_000n);
      expect(configuredNewVaultPaidOps({})).to.equal(3);
      expect(
        configuredNewVaultMaxEnergy({ TRON_NEW_VAULT_MAX_ENERGY: '200000' }),
      ).to.equal(200_000n);
      expect(
        configuredNewVaultPaidOps({ TRON_NEW_VAULT_PAID_OPS: '0' }),
      ).to.equal(0);
      for (const bad of ['0', '49999', '1200001', '1e6', 'x', '300000.5']) {
        expect(() =>
          configuredNewVaultMaxEnergy({ TRON_NEW_VAULT_MAX_ENERGY: bad }),
        ).to.throw(/TRON_NEW_VAULT_MAX_ENERGY/);
      }
      for (const bad of ['-1', '1001', '2.5', 'many']) {
        expect(() =>
          configuredNewVaultPaidOps({ TRON_NEW_VAULT_PAID_OPS: bad }),
        ).to.throw(/TRON_NEW_VAULT_PAID_OPS/);
      }
    });
  });

  describe('failure pools (review round 1: the chain-wide breaker must not be cheap to trip)', function () {
    it('failures of fresh vaults pause only new vaults; proven vaults keep being sponsored', async function () {
      const env = makeRuntime({ maxNewVaultFailedEnergyPerHour: 300_000 });
      const a = vaultOf([key(0x93), key(0x94)], 2);
      fund(env, a);
      await failWith(env, a, 1n, 350_000);
      const [ev] = failureEvents(env.cols);
      expect(ev.proven).to.equal(false);
      expect(ev.energy).to.equal(350_000);

      // Another fresh vault: refused by the new-vault pool.
      const b = vaultOf([key(0x95), key(0x96)], 2);
      fund(env, b);
      const rb = await outcome(
        acceptAndBroadcast(
          env.rt,
          broadcastRequest(b, makeOp({ calls: trxCall, nonce: 1n })),
        ),
      );
      expect(rb.ok).to.equal(false);
      expect(rb.error.name).to.equal('TronSponsorRefusal');
      expect(rb.error.message).to.match(
        /temporarily unavailable for new vaults/,
      );

      // A proven vault: unaffected (the chain-wide pool is empty).
      const p = vaultOf([key(0x97), key(0x98)], 2);
      fund(env, p);
      await paidHistory(env, p, 3);
      const ok = await acceptAndBroadcast(
        env.rt,
        broadcastRequest(p, makeOp({ calls: trxCall, nonce: 1n })),
      );
      expect(ok.txid).to.match(/^[0-9a-f]{64}$/);
      expect(
        env.cols.ops.docs.find((d) => d.txid === ok.txid).vaultProven,
      ).to.equal(true);

      // The window rolls: new vaults are sponsored again.
      env.clock.now += 3_600_001;
      env.node.state.block.timestamp += 3_600_001n;
      const later = await acceptAndBroadcast(
        env.rt,
        broadcastRequest(
          b,
          makeOp({
            calls: trxCall,
            nonce: 1n,
            deadline: NOW_S + 2n * 86_400n,
          }),
        ),
      );
      expect(later.txid).to.match(/^[0-9a-f]{64}$/);
    });

    it(`the chain-wide breaker counts proven vaults only and trips at ${MIN_VAULTS_FOR_CHAIN_BREAKER} distinct vaults`, async function () {
      expect(MIN_VAULTS_FOR_CHAIN_BREAKER).to.equal(3);
      const env = makeRuntime({
        maxFailedEnergyPerHour: 200_000,
        maxNewVaultFailedEnergyPerHour: 50_000_000,
      });
      const proven = [0, 1, 2, 3].map((i) =>
        vaultOf([key(0xd5 + 2 * i), key(0xd6 + 2 * i)], 2),
      );
      for (const v of proven) {
        fund(env, v);
        await paidHistory(env, v, 3);
      }
      // A burst of fresh-vault failures never touches the chain-wide pool.
      for (let i = 0; i < 3; i++) {
        const f = vaultOf([key(0x60 + 2 * i), key(0x61 + 2 * i)], 2);
        fund(env, f);
        await failWith(env, f, 1n, 400_000);
      }
      // Two proven vaults fail (2 × 250k ≥ the 200k budget, but only two
      // distinct vaults): a third proven vault is still sponsored.
      await failWith(env, proven[0], 1n, 250_000);
      await failWith(env, proven[1], 1n, 250_000);
      expect(
        failureEvents(env.cols)
          .filter((e) => e.proven)
          .map((e) => e.opVault),
      ).to.deep.equal([proven[0].vault, proven[1].vault]);
      // ... and it fails too: three distinct proven vaults → chain-wide trip.
      await failWith(env, proven[2], 1n, 250_000);
      const r = await outcome(
        acceptAndBroadcast(
          env.rt,
          broadcastRequest(proven[3], makeOp({ calls: trxCall, nonce: 1n })),
        ),
      );
      expect(r.ok).to.equal(false);
      expect(r.error.message).to.match(
        /temporarily unavailable \(too many sponsored transactions failed/,
      );
      // Fresh vaults are refused as well (the whole chain is paused).
      const fresh = vaultOf([key(0x71), key(0x72)], 2);
      fund(env, fresh);
      const rf = await outcome(
        acceptAndBroadcast(
          env.rt,
          broadcastRequest(fresh, makeOp({ calls: trxCall, nonce: 1n })),
        ),
      );
      expect(rf.ok).to.equal(false);
      expect(rf.error.message).to.match(/too many sponsored transactions/);
    });

    it('failure events without a pool flag (written before 2026-10) count chain-wide', async function () {
      const env = makeRuntime({ maxFailedEnergyPerHour: 200_000 });
      for (let i = 0; i < 3; i++) {
        await env.cols.reservations.insertOne({
          chain: 'tron',
          vault: '#failure',
          nonce: `${i}`.padStart(64, 'f'),
          source: 'failure',
          energy: 100_000,
          opVault: `legacy-${i}`,
          signers: [],
          clientKey: null,
          atMs: NOW_MS - 60_000,
          createdAt: new Date(NOW_MS - 60_000),
          expiresAt: new Date(NOW_MS + 86_400_000),
        });
      }
      const p = vaultOf([key(0x73), key(0x74)], 2);
      fund(env, p);
      await paidHistory(env, p, 3);
      const r = await outcome(
        acceptAndBroadcast(
          env.rt,
          broadcastRequest(p, makeOp({ calls: trxCall, nonce: 1n })),
        ),
      );
      expect(r.ok).to.equal(false);
      expect(r.error.message).to.match(/too many sponsored transactions/);
    });

    it('a failure whose op record has no pool flag (pre-2026-10) counts chain-wide (fail closed)', async function () {
      const env = makeRuntime({ maxNewVaultFailedEnergyPerHour: 100_000 });
      const v = vaultOf([key(0x75), key(0x76)], 2);
      fund(env, v);
      await failWith(env, v, 1n, 150_000);
      expect(failureEvents(env.cols)[0].proven).to.equal(false);
      // Records written before 2026-10 carry no vaultProven flag.
      const env2 = makeRuntime({
        maxFailedEnergyPerHour: 1,
        maxNewVaultFailedEnergyPerHour: 100_000,
      });
      const w = vaultOf([key(0x77), key(0x78)], 2);
      fund(env2, w);
      const orig = env2.cols.ops.findOne.bind(env2.cols.ops);
      env2.cols.ops.findOne = async (q) => {
        const d = await orig(q);
        if (!d) return d;
        const copy = { ...d };
        delete copy.vaultProven;
        return copy;
      };
      await failWith(env2, w, 1n, 150_000);
      expect(failureEvents(env2.cols)[0].proven).to.equal(true);
    });

    it('maxNewVaultFailedEnergyPerHour 0: new-vault failures count toward the chain-wide breaker', async function () {
      const env = makeRuntime({
        maxFailedEnergyPerHour: 200_000,
        maxNewVaultFailedEnergyPerHour: 0,
      });
      for (let i = 0; i < 3; i++) {
        const f = vaultOf([key(0x79 + 2 * i), key(0x7a + 2 * i)], 2);
        fund(env, f);
        await failWith(env, f, 1n, 100_000);
      }
      expect(failureEvents(env.cols).every((e) => e.proven === false)).to.equal(
        true,
      );
      const p = vaultOf([key(0x8a), key(0x8b)], 2);
      fund(env, p);
      await paidHistory(env, p, 3);
      const r = await outcome(
        acceptAndBroadcast(
          env.rt,
          broadcastRequest(p, makeOp({ calls: trxCall, nonce: 1n })),
        ),
      );
      expect(r.ok).to.equal(false);
      expect(r.error.message).to.match(/too many sponsored transactions/);
    });

    it('config: TRON_MAX_NEW_VAULT_FAILED_ENERGY_PER_HOUR is validated; default 1.5M', function () {
      expect(DEFAULT_MAX_NEW_VAULT_FAILED_ENERGY_PER_HOUR).to.equal(1_500_000);
      expect(defaultConfig.tron.maxNewVaultFailedEnergyPerHour).to.equal(
        DEFAULT_MAX_NEW_VAULT_FAILED_ENERGY_PER_HOUR,
      );
      expect(configuredMaxNewVaultFailedEnergyPerHour({})).to.equal(1_500_000);
      expect(
        configuredMaxNewVaultFailedEnergyPerHour({
          TRON_MAX_NEW_VAULT_FAILED_ENERGY_PER_HOUR: '0',
        }),
      ).to.equal(0);
      expect(
        configuredMaxNewVaultFailedEnergyPerHour({
          TRON_MAX_NEW_VAULT_FAILED_ENERGY_PER_HOUR: '800000',
        }),
      ).to.equal(800_000);
      const cfg = (values) => ({
        has: (k) => k in values,
        get: (k) => values[k],
      });
      expect(
        configuredMaxNewVaultFailedEnergyPerHour(
          {},
          cfg({ 'tron.maxNewVaultFailedEnergyPerHour': 900_000 }),
        ),
      ).to.equal(900_000);
      for (const bad of ['-1', '100000001', '1e6', 'x', '2.5']) {
        expect(() =>
          configuredMaxNewVaultFailedEnergyPerHour({
            TRON_MAX_NEW_VAULT_FAILED_ENERGY_PER_HOUR: bad,
          }),
        ).to.throw(/TRON_MAX_NEW_VAULT_FAILED_ENERGY_PER_HOUR/);
        expect(() =>
          assertTronConfig(
            { TRON_MAX_NEW_VAULT_FAILED_ENERGY_PER_HOUR: bad },
            cfg({}),
          ),
        ).to.throw(/TRON_MAX_NEW_VAULT_FAILED_ENERGY_PER_HOUR/);
      }
    });
  });

  it('the TRX-1 race: a fresh vault cannot put the 1.2M launch cap at stake', async function () {
    // The attack: ~12 sponsored USDT transfers whose last call the attacker
    // makes revert between simulation and inclusion. A fresh vault's
    // simulation above the new-vault cap is refused outright.
    const env = makeRuntime();
    const v = vaultOf([key(0xf7), key(0xf8)], 2);
    fund(env, v);
    const calls = Array.from({ length: 12 }, () =>
      trc20TransferCall(USDT, RECIPIENT, 1n),
    );
    await env.cols.reservations.insertOne({
      chain: 'tron',
      vault: v.vault,
      nonce: '0',
      energy: { trx: 1_100_000, usdt: 1_100_000 },
      callsKey: callsShapeKey(calls),
    });
    env.node.state.execute = { ok: true, energy: 1_100_000 };
    const op = buildOp({
      calls,
      nonce: 0n,
      deadline: 1_790_000_000n,
      fee: trxFee(100_000_000n, COLLECTOR),
    });
    const r = await outcome(
      acceptAndBroadcast(env.rt, broadcastRequest(v, op)),
    );
    expect(r.ok).to.equal(false);
    expect(r.error.message).to.match(/cap for a vault that has not yet paid/);
    expect(env.node.state.broadcasts).to.have.length(0);
  });
});
