// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect } from 'chai';
import {
  buildExecuteTransaction,
  opFromJson,
  buildConfig,
  hexToBytes,
  localSigner,
  serializeTransaction,
  signTransaction,
} from '@runonflux/tron-multisig';
import {
  ENERGY,
  FLOOR_TRX_SUN,
  FLOOR_USDT_UNITS,
  applyMarkup,
  baseEnergy,
  costSun,
  executeBandwidthBytes,
  minimumFee,
  priceFee,
  signedTxBandwidthBytes,
  sunToUsdtUnits,
  validateMarkup,
} from '../../src/services/tronSponsorPricing';
import { SPONSOR, vectors } from '../helpers/tronRuntime';

const RATES = { trxUsd: 0.338, usdtUsd: 1 };

describe('TRON sponsor pricing', function () {
  describe('energy constants (tron-spike RESULTS.md T6/T7)', function () {
    it('pins the measured overheads', function () {
      expect(ENERGY.VAULT_BASE_2SIG).to.equal(21_000n);
      expect(ENERGY.PER_EXTRA_SIGNATURE).to.equal(4_650n);
      expect(ENERGY.SPONSOR_WRAPPER).to.equal(7_600n);
      expect(ENERGY.DEPLOY).to.equal(50_500n);
      expect(ENERGY.TRX_FEE).to.equal(9_400n);
      expect(ENERGY.TRX_CALL).to.equal(7_000n);
      expect(ENERGY.NEW_ACCOUNT).to.equal(25_000n);
      expect(ENERGY.COLD_NONCE_WORD).to.equal(15_000n);
    });

    it('base energy of a warm, deployed 2-of-2 single call = wrapper + vault', function () {
      expect(
        baseEnergy({
          threshold: 2,
          deployed: true,
          coldNonceWord: false,
          callCount: 1,
        }),
      ).to.equal(28_600n);
    });

    it('adds deploy, cold word, extra signatures and extra calls', function () {
      expect(
        baseEnergy({
          threshold: 6,
          deployed: false,
          coldNonceWord: true,
          callCount: 3,
        }),
      ).to.equal(28_600n + 4n * 4_650n + 2n * 2_000n + 50_500n + 15_000n);
    });

    it('reproduces the spike projection for a sponsored 2-of-2 USDT send (≈92.8k + TRX fee)', function () {
      // warm vault + mainnet USDT transfer (64,285) + TRX fee
      const e =
        baseEnergy({
          threshold: 2,
          deployed: true,
          coldNonceWord: false,
          callCount: 1,
        }) +
        64_285n +
        ENERGY.TRX_FEE;
      expect(Number(e)).to.be.within(100_000, 104_000); // plan §6.2: ≈102k
    });
  });

  describe('fee math', function () {
    it('cost = energy × price + bytes × 1000', function () {
      expect(costSun(100_000n, 1_200n, 45n)).to.equal(4_500_000n + 1_200_000n);
    });

    it('rejects nonsense cost inputs', function () {
      expect(() => costSun(-1n, 0n, 45n)).to.throw();
      expect(() => costSun(1n, 0n, 0n)).to.throw();
    });

    it('applies the markup rounding UP', function () {
      expect(applyMarkup(1_000_001n, 1.15)).to.equal(1_150_002n);
      expect(applyMarkup(5_700_000n, 1.5)).to.equal(8_550_000n);
      expect(applyMarkup(7n, 1)).to.equal(7n);
    });

    it('refuses a markup below 1 or absurd', function () {
      expect(() => validateMarkup(0.99)).to.throw(/markup/);
      expect(() => validateMarkup(10)).to.throw(/markup/);
      expect(() => validateMarkup('1.2')).to.throw(/markup/);
      expect(() => validateMarkup(NaN)).to.throw(/markup/);
    });

    it('converts sun to USDT units through the TRX rate, rounding up', function () {
      expect(sunToUsdtUnits(10_000_000n, RATES)).to.equal(3_380_000n);
      expect(sunToUsdtUnits(1n, RATES)).to.equal(1n);
    });

    it('refuses USDT pricing without a sane TRX rate (fail closed)', function () {
      expect(() =>
        sunToUsdtUnits(1_000n, { trxUsd: null, usdtUsd: 1 }),
      ).to.throw(/rate unavailable/);
      expect(() =>
        sunToUsdtUnits(1_000n, { trxUsd: 0, usdtUsd: 1 }),
      ).to.throw();
      expect(() =>
        sunToUsdtUnits(1_000n, { trxUsd: 1e9, usdtUsd: 1 }),
      ).to.throw();
    });

    it('prices a typical TRX fee at ≈6.5 TRX (plan §6.4)', function () {
      const fee = priceFee({
        token: 'TRX',
        energy: 102_000n,
        bandwidthBytes: 1_200n,
        energyPriceSun: 45n,
        markup: 1.15,
        rates: RATES,
      });
      // (102,000 × 45 + 1,200,000) × 1.15 = 6,658,500
      expect(fee).to.equal(6_658_500n);
    });

    it('applies the floors: 2 TRX / 1 USDT', function () {
      const common = {
        energy: 1_000n,
        bandwidthBytes: 100n,
        energyPriceSun: 45n,
        markup: 1.15,
        rates: RATES,
      };
      expect(priceFee({ token: 'TRX', ...common })).to.equal(FLOOR_TRX_SUN);
      expect(priceFee({ token: 'USDT', ...common })).to.equal(FLOOR_USDT_UNITS);
    });

    it('prices USDT from the same sun cost', function () {
      const fee = priceFee({
        token: 'USDT',
        energy: 177_000n,
        bandwidthBytes: 1_200n,
        energyPriceSun: 45n,
        markup: 1.15,
        rates: RATES,
      });
      // (177,000 × 45 + 1,200,000) × 1.15 = 10,539,750 sun → × 0.338
      expect(fee).to.equal(3_562_436n);
    });

    it('minimumFee is the cost with NO markup and no floor', function () {
      const p = {
        energy: 1_000n,
        bandwidthBytes: 100n,
        energyPriceSun: 45n,
        rates: RATES,
      };
      expect(minimumFee({ token: 'TRX', ...p })).to.equal(145_000n);
      expect(minimumFee({ token: 'USDT', ...p })).to.equal(49_010n);
    });
  });

  describe('bandwidth', function () {
    it('equals the serialized size of the real signed execute tx + 64', async function () {
      const op = opFromJson(vectors.consumerOp.op);
      const cfg = buildConfig(vectors.consumer.leaves['0-0'].signers, 2);
      const relayer = localSigner(new Uint8Array(32).fill(0x11));
      const est = executeBandwidthBytes({
        owner: relayer.address,
        sponsor: SPONSOR,
        config: cfg,
        op,
        nowMs: 1_789_999_000_000n,
      });
      const raw = buildExecuteTransaction({
        owner: relayer.address,
        target: SPONSOR,
        config: cfg,
        op,
        signaturesPacked: hexToBytes(vectors.consumerOp.signaturesPacked),
        feeLimit: 0n,
        ref: {
          refBlockBytes: new Uint8Array([1, 2]),
          refBlockHash: new Uint8Array(8).fill(3),
        },
        expiration: 1_789_999_060_000n,
        timestamp: 1_789_999_000_000n,
      });
      const hex = serializeTransaction(await signTransaction(raw, relayer));
      expect(est).to.equal(signedTxBandwidthBytes(hex));
      expect(Number(est)).to.be.within(1_000, 1_400); // spike: 1,339 B
    });
  });
});
