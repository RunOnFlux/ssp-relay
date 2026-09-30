// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { NETWORKS, getNetwork, localSigner } from '@runonflux/tron-multisig';
import {
  __setRuntimeForTests,
  getSponsorContext,
  isKillSwitchOn,
  parseRelayerKeys,
  relayerEnvVar,
  relayerFilePath,
  resolveRelayers,
  resolveTronNetwork,
} from '../../src/services/tronSponsorService';
import {
  COLLECTOR,
  FACTORY,
  IMPLEMENTATION,
  SPONSOR,
  makeRuntime,
} from '../helpers/tronRuntime';

const KEY_A = 'a1'.repeat(32);
const KEY_B = 'b2'.repeat(32);
const ADDR_A = localSigner(new Uint8Array(32).fill(0xa1)).address;
const ADDR_B = localSigner(new Uint8Array(32).fill(0xb2)).address;

describe('TRON sponsor configuration', function () {
  describe('resolveTronNetwork — the override rule', function () {
    it('keeps the SDK pinned table when there are no overrides', function () {
      const n = resolveTronNetwork('tron', {});
      expect(n.chainId).to.equal(728126428n);
      expect(n.usdt).to.equal(NETWORKS.mainnet.usdt);
      expect(n.factory).to.equal(NETWORKS.mainnet.factory);
      expect(n.sponsor).to.equal(NETWORKS.mainnet.sponsor);
    });

    it('fills values the SDK has as null (Nile / local testing)', function () {
      const n = resolveTronNetwork('tronNile', {
        factory: FACTORY,
        implementation: IMPLEMENTATION,
        sponsor: SPONSOR,
        feeCollector: COLLECTOR,
      });
      expect(n.chainId).to.equal(3448148188n);
      expect(n.factory).to.equal(FACTORY);
      expect(n.feeCollector).to.equal(COLLECTOR);
    });

    it('treats null / empty overrides as absent', function () {
      const n = resolveTronNetwork('tron', { factory: null, sponsor: '' });
      expect(n.factory).to.equal(NETWORKS.mainnet.factory);
    });

    it('accepts an override equal to a pinned value', function () {
      const pinned = getNetwork({ ...NETWORKS.mainnet, factory: FACTORY });
      const n = resolveTronNetwork('tron', { factory: FACTORY }, pinned);
      expect(n.factory).to.equal(FACTORY);
    });

    it('THROWS when an override conflicts with a pinned value', function () {
      const pinned = getNetwork({ ...NETWORKS.mainnet, sponsor: SPONSOR });
      expect(() =>
        resolveTronNetwork('tron', { sponsor: COLLECTOR }, pinned),
      ).to.throw(/conflicts with the SDK's pinned/);
    });

    it('rejects an override that is not a TRON address (case-sensitive base58)', function () {
      expect(() =>
        resolveTronNetwork('tron', { factory: FACTORY.toLowerCase() }),
      ).to.throw(/not a valid TRON address/);
      expect(() =>
        resolveTronNetwork('tron', { feeCollector: '0x1234' }),
      ).to.throw(/not a valid TRON address/);
    });

    it('never lets config move the chain id or USDT', function () {
      const n = resolveTronNetwork('tron', {
        chainId: 1,
        usdt: COLLECTOR,
      } as never);
      expect(n.chainId).to.equal(728126428n);
      expect(n.usdt).to.equal(NETWORKS.mainnet.usdt);
    });
  });

  describe('relayer keys', function () {
    let tmpHome: string;
    let homedirStub: sinon.SinonStub;
    const saved: Record<string, string | undefined> = {};
    const ENV = [relayerEnvVar('tron'), relayerEnvVar('tronNile')];

    beforeEach(function () {
      tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ssp-relay-tron-'));
      homedirStub = sinon.stub(os, 'homedir').returns(tmpHome);
      for (const k of ENV) {
        saved[k] = process.env[k];
        delete process.env[k];
      }
    });

    afterEach(function () {
      homedirStub.restore();
      fs.rmSync(tmpHome, { recursive: true, force: true });
      for (const k of ENV) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });

    it('uses the documented env var names', function () {
      expect(relayerEnvVar('tron')).to.equal('SSP_TRON_MAINNET_RELAYER_KEYS');
      expect(relayerEnvVar('tronNile')).to.equal('SSP_TRON_NILE_RELAYER_KEYS');
    });

    it('parses a comma-separated env list (0x optional, deduped)', function () {
      process.env.SSP_TRON_MAINNET_RELAYER_KEYS = ` ${KEY_A}, 0x${KEY_B} ,${KEY_A}`;
      const { relayers, source } = resolveRelayers('tron');
      expect(source).to.equal('env');
      expect(relayers.map((r) => r.address)).to.deep.equal([ADDR_A, ADDR_B]);
    });

    it('MAINNET never auto-generates: no env, no file → no relayers', function () {
      const { relayers, source } = resolveRelayers('tron');
      expect(source).to.equal('none');
      expect(relayers).to.have.length(0);
      expect(fs.existsSync(relayerFilePath('tron'))).to.equal(false);
    });

    it('reads the relayer file when env is unset', function () {
      const file = relayerFilePath('tron');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${KEY_B}\n`);
      const { relayers, source } = resolveRelayers('tron');
      expect(source).to.equal('file');
      expect(relayers[0].address).to.equal(ADDR_B);
    });

    it('env wins over the file', function () {
      const file = relayerFilePath('tron');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, KEY_B);
      process.env.SSP_TRON_MAINNET_RELAYER_KEYS = KEY_A;
      expect(resolveRelayers('tron').relayers[0].address).to.equal(ADDR_A);
    });

    it('Nile auto-generates one key into a 0600 file, then reuses it', function () {
      const first = resolveRelayers('tronNile');
      expect(first.source).to.equal('generated');
      expect(first.relayers).to.have.length(1);
      const file = relayerFilePath('tronNile');
      expect(fs.statSync(file).mode & 0o777).to.equal(0o600);
      const second = resolveRelayers('tronNile');
      expect(second.source).to.equal('file');
      expect(second.relayers[0].address).to.equal(first.relayers[0].address);
    });

    it('rejects malformed keys without echoing the key material', function () {
      const bad = 'zz'.repeat(32);
      process.env.SSP_TRON_MAINNET_RELAYER_KEYS = `${KEY_A},${bad}`;
      let message = '';
      try {
        resolveRelayers('tron');
      } catch (e) {
        message = e.message;
      }
      expect(message).to.match(/relayer key #2 is not 32-byte hex/);
      expect(message).to.not.include(bad);
      expect(message).to.not.include(KEY_A);
    });

    it('rejects an out-of-range secp256k1 scalar without echoing it', function () {
      const zero = '00'.repeat(32);
      expect(() => parseRelayerKeys(zero, 'X')).to.throw(
        /relayer key #1 is not a valid secp256k1 key/,
      );
      try {
        parseRelayerKeys(`ff`.repeat(32), 'X');
      } catch (e) {
        expect(e.message).to.not.include('ff'.repeat(32));
      }
    });
  });

  describe('kill switch', function () {
    it('is off by default and only on for explicit truthy values', function () {
      expect(isKillSwitchOn({})).to.equal(false);
      expect(isKillSwitchOn({ TRON_SPONSOR_ENABLED: 'false' })).to.equal(false);
      expect(isKillSwitchOn({ TRON_SPONSOR_ENABLED: '0' })).to.equal(false);
      expect(isKillSwitchOn({ TRON_SPONSOR_ENABLED: 'true' })).to.equal(true);
      expect(isKillSwitchOn({ TRON_SPONSOR_ENABLED: '1' })).to.equal(true);
    });
  });

  describe('getSponsorContext', function () {
    afterEach(function () {
      __setRuntimeForTests('tron', null);
    });

    it('returns the brief shape, enabled when switch + deployment + relayers', function () {
      const { rt } = makeRuntime();
      __setRuntimeForTests('tron', rt);
      expect(getSponsorContext('tron')).to.deep.equal({
        enabled: true,
        chain: 'tron',
        chainId: '728126428',
        factory: FACTORY,
        implementation: IMPLEMENTATION,
        sponsor: SPONSOR,
        feeCollector: COLLECTOR,
        ceilings: { trx: '30000000', usdt: '8000000' },
      });
    });

    it('is disabled when the kill switch is off', function () {
      const { rt } = makeRuntime({ killSwitchOn: () => false });
      __setRuntimeForTests('tron', rt);
      expect(getSponsorContext('tron').enabled).to.equal(false);
    });

    it('is disabled when there are no relayer keys', function () {
      const { rt } = makeRuntime({ relayers: [] });
      __setRuntimeForTests('tron', rt);
      expect(getSponsorContext('tron').enabled).to.equal(false);
    });

    it('is disabled (with nulls) while the SDK has no deployment', function () {
      const { rt } = makeRuntime({ network: resolveTronNetwork('tron', {}) });
      __setRuntimeForTests('tron', rt);
      const ctx = getSponsorContext('tron');
      expect(ctx.enabled).to.equal(false);
      expect(ctx.sponsor).to.equal(null);
      expect(ctx.feeCollector).to.equal(null);
    });
  });
});
