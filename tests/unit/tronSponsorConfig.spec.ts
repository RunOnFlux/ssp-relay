// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'fs';
import os from 'os';
import path from 'path';
import config from 'config';
import { NETWORKS, getNetwork, localSigner } from '@runonflux/tron-multisig';
import defaultConfig from '../../config/default';
import {
  DEFAULT_NEW_VAULT_MAX_SPONSORED_ENERGY,
  DEFAULT_NEW_VAULT_PAID_OPS,
  __setRuntimeForTests,
  assertTronConfig,
  configuredNewVaultMaxEnergy,
  configuredNewVaultPaidOps,
  getRuntime,
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

  describe('new-vault energy cap settings (TRX-1)', function () {
    const ENV = [
      'TRON_NEW_VAULT_MAX_ENERGY',
      'TRON_NEW_VAULT_PAID_OPS',
      relayerEnvVar('tron'),
    ];
    const saved: Record<string, string | undefined> = {};
    let tmpHome: string;

    /** A config source holding only `values` (node-config itself is frozen). */
    function source(values: Record<string, unknown>) {
      return {
        has: (key: string) => key in values,
        get: <T>(key: string): T => {
          if (!(key in values)) throw new Error(`no ${key}`);
          return values[key] as T;
        },
      };
    }

    beforeEach(function () {
      tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ssp-relay-tron-'));
      // getRuntime() must never read a real relayer key file.
      sinon.stub(os, 'homedir').returns(tmpHome);
      for (const k of ENV) {
        saved[k] = process.env[k];
        delete process.env[k];
      }
    });

    afterEach(function () {
      sinon.restore();
      __setRuntimeForTests('tron', null);
      fs.rmSync(tmpHome, { recursive: true, force: true });
      for (const k of ENV) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });

    it('config/default.ts ships 350k energy until 3 paid ops', function () {
      expect(defaultConfig.tron.newVaultMaxSponsoredEnergy).to.equal(
        DEFAULT_NEW_VAULT_MAX_SPONSORED_ENERGY,
      );
      expect(defaultConfig.tron.newVaultPaidOps).to.equal(
        DEFAULT_NEW_VAULT_PAID_OPS,
      );
      expect(DEFAULT_NEW_VAULT_MAX_SPONSORED_ENERGY).to.equal(350_000);
      expect(DEFAULT_NEW_VAULT_PAID_OPS).to.equal(3);
      // The loaded node-config carries them, and the parsers read them.
      expect(config.get('tron.newVaultMaxSponsoredEnergy')).to.equal(350_000);
      expect(config.get('tron.newVaultPaidOps')).to.equal(3);
      expect(configuredNewVaultMaxEnergy({})).to.equal(350_000n);
      expect(configuredNewVaultPaidOps({})).to.equal(3);
    });

    it('reads the config value when the env var is unset', function () {
      const cfg = source({
        'tron.newVaultMaxSponsoredEnergy': 200_000,
        'tron.newVaultPaidOps': 5,
      });
      expect(configuredNewVaultMaxEnergy({}, cfg)).to.equal(200_000n);
      expect(configuredNewVaultPaidOps({}, cfg)).to.equal(5);
    });

    it('the env var wins over the config value', function () {
      const cfg = source({
        'tron.newVaultMaxSponsoredEnergy': 200_000,
        'tron.newVaultPaidOps': 5,
      });
      expect(
        configuredNewVaultMaxEnergy(
          { TRON_NEW_VAULT_MAX_ENERGY: '400000' },
          cfg,
        ),
      ).to.equal(400_000n);
      expect(
        configuredNewVaultPaidOps({ TRON_NEW_VAULT_PAID_OPS: '1' }, cfg),
      ).to.equal(1);
    });

    it('falls back to the built-in defaults when config has no value', function () {
      const cfg = source({});
      expect(configuredNewVaultMaxEnergy({}, cfg)).to.equal(350_000n);
      expect(configuredNewVaultPaidOps({}, cfg)).to.equal(3);
    });

    it('an out-of-range config value stops the relay at startup (fail closed)', function () {
      for (const bad of [0, 49_999, 1_200_001, 300_000.5, -1, '1e6', null]) {
        const cfg = source({ 'tron.newVaultMaxSponsoredEnergy': bad });
        expect(
          () => configuredNewVaultMaxEnergy({}, cfg),
          String(bad),
        ).to.throw(/tron\.newVaultMaxSponsoredEnergy/);
        expect(() => assertTronConfig({}, cfg), String(bad)).to.throw(
          /tron\.newVaultMaxSponsoredEnergy/,
        );
      }
      for (const bad of [-1, 1001, 2.5, 'many', null]) {
        const cfg = source({ 'tron.newVaultPaidOps': bad });
        expect(() => configuredNewVaultPaidOps({}, cfg), String(bad)).to.throw(
          /tron\.newVaultPaidOps/,
        );
        expect(() => assertTronConfig({}, cfg), String(bad)).to.throw(
          /tron\.newVaultPaidOps/,
        );
      }
      // The shipped config passes.
      expect(() => assertTronConfig({})).to.not.throw();
    });

    it('the live runtime takes both values from config, env overriding', function () {
      __setRuntimeForTests('tron', null);
      let rt = getRuntime('tron');
      expect(rt.newVaultMaxSponsoredEnergy).to.equal(350_000n);
      expect(rt.newVaultPaidOps).to.equal(3);

      process.env.TRON_NEW_VAULT_MAX_ENERGY = '600000';
      process.env.TRON_NEW_VAULT_PAID_OPS = '0';
      __setRuntimeForTests('tron', null);
      rt = getRuntime('tron');
      expect(rt.newVaultMaxSponsoredEnergy).to.equal(600_000n);
      expect(rt.newVaultPaidOps).to.equal(0);
    });

    it('documents the failed-energy breaker as Mongo-backed, not per process', function () {
      const src = fs.readFileSync(
        path.join(__dirname, '../../config/default.ts'),
        'utf8',
      );
      expect(src).to.not.match(/per relay\s*(?:\/\/\s*)?process/);
      expect(src).to.match(/shared by every relay process/);
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
