// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect } from 'chai';
import sinon from 'sinon';
import log from '../../src/lib/log';
import {
  reserveSetup,
  resetSetupGuard,
  setupBudgetUsage,
  setupGuardLimits,
  SETUP_DAY_MS,
  SETUP_GUARD_DEFAULTS,
  SETUP_GUARD_ENV,
  SETUP_HOUR_MS,
} from '../../src/services/solPaymasterSetupGuard';

const EST = 3_200_000;
const T0 = 1_800_000_000_000;
const MIN = 60 * 1000;

function expectRefused(fn: () => unknown, pattern: RegExp): void {
  let threw: Error | null = null;
  try {
    fn();
  } catch (e) {
    threw = e as Error;
  }
  expect(threw, 'expected a refusal').to.not.equal(null);
  expect(threw!.message).to.match(pattern);
}

function alertLines(spy: sinon.SinonSpy): string[] {
  return spy
    .getCalls()
    .map((c) => String(c.args[0]))
    .filter((l) => l.startsWith('[solPaymaster] ALERT'));
}

describe('Solana paymaster setup guard (SOL-6 rent grind)', function () {
  const saved: Record<string, string | undefined> = {};

  beforeEach(function () {
    for (const name of Object.values(SETUP_GUARD_ENV)) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
    resetSetupGuard();
  });

  afterEach(function () {
    for (const name of Object.values(SETUP_GUARD_ENV)) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    sinon.restore();
    resetSetupGuard();
  });

  describe('configuration', function () {
    it('defaults to 3/hour and 10/day per IP, 20 setups and 0.075 SOL per hour globally', function () {
      expect(setupGuardLimits()).to.deep.equal({ ...SETUP_GUARD_DEFAULTS });
      expect(SETUP_GUARD_DEFAULTS).to.deep.equal({
        perIpHourly: 3,
        perIpDaily: 10,
        globalHourly: 20,
        globalHourlyLamports: 75_000_000,
      });
    });

    it('reads the limits from env and ignores invalid values (with one warning)', function () {
      const warn = sinon.spy(log, 'warn');
      process.env.SSP_SOLANA_SETUP_PER_IP_HOURLY = '5';
      process.env.SSP_SOLANA_SETUP_PER_IP_DAILY = ' 50 ';
      process.env.SSP_SOLANA_SETUP_GLOBAL_HOURLY = '-1';
      process.env.SSP_SOLANA_SETUP_GLOBAL_HOURLY_LAMPORTS = 'lots';
      expect(setupGuardLimits()).to.deep.equal({
        perIpHourly: 5,
        perIpDaily: 50,
        globalHourly: SETUP_GUARD_DEFAULTS.globalHourly,
        globalHourlyLamports: SETUP_GUARD_DEFAULTS.globalHourlyLamports,
      });
      setupGuardLimits();
      expect(warn.callCount).to.equal(2); // once per invalid value
    });
  });

  describe('per-IP limiter windows', function () {
    it('allows 3 paid setups per IP per hour, then refuses only that IP', function () {
      for (let i = 0; i < 3; i++) {
        reserveSetup({
          clientKey: '203.0.113.10',
          estimateLamports: EST,
          now: T0 + i * MIN,
        });
      }
      expectRefused(
        () =>
          reserveSetup({
            clientKey: '203.0.113.10',
            estimateLamports: EST,
            now: T0 + 10 * MIN,
          }),
        /from your network in the last hour.*try again in 50 minutes/,
      );
      // a different IP is unaffected
      reserveSetup({
        clientKey: '198.51.100.10',
        estimateLamports: EST,
        now: T0 + 10 * MIN,
      });
      // the refused attempt was not charged
      expect(setupBudgetUsage(T0 + 10 * MIN).count).to.equal(4);
    });

    it('frees an hourly slot once the oldest setup leaves the rolling hour', function () {
      for (let i = 0; i < 3; i++) {
        reserveSetup({
          clientKey: 'ip-a',
          estimateLamports: EST,
          now: T0 + i * MIN,
        });
      }
      expectRefused(
        () =>
          reserveSetup({
            clientKey: 'ip-a',
            estimateLamports: EST,
            now: T0 + SETUP_HOUR_MS - 1,
          }),
        /last hour/,
      );
      reserveSetup({
        clientKey: 'ip-a',
        estimateLamports: EST,
        now: T0 + SETUP_HOUR_MS + 1,
      });
    });

    it('caps an IP at 10 paid setups per rolling 24 hours even when spread out', function () {
      // 21-minute spacing never puts 3 setups in the same rolling hour.
      for (let i = 0; i < 10; i++) {
        reserveSetup({
          clientKey: 'ip-b',
          estimateLamports: EST,
          now: T0 + i * 21 * MIN,
        });
      }
      const eleventh = T0 + 10 * 21 * MIN;
      expectRefused(
        () =>
          reserveSetup({
            clientKey: 'ip-b',
            estimateLamports: EST,
            now: eleventh,
          }),
        /from your network today/,
      );
      // 24 hours after the first one, a slot is free again
      reserveSetup({
        clientKey: 'ip-b',
        estimateLamports: EST,
        now: T0 + SETUP_DAY_MS + 1,
      });
    });

    it('release() uncounts a setup that never reached the chain', function () {
      const r = [0, 1, 2].map((i) =>
        reserveSetup({
          clientKey: 'ip-c',
          estimateLamports: EST,
          now: T0 + i,
        }),
      );
      r[2].release();
      r[2].release(); // idempotent
      r[2].settle(1); // ignored after release
      expect(setupBudgetUsage(T0 + 3)).to.deep.equal({
        count: 2,
        lamports: 2 * EST,
      });
      reserveSetup({ clientKey: 'ip-c', estimateLamports: EST, now: T0 + 3 });
    });

    it('applies only the global budget when there is no client key', function () {
      for (let i = 0; i < 5; i++) {
        reserveSetup({ estimateLamports: EST, now: T0 + i });
      }
      expect(setupBudgetUsage(T0 + 5).count).to.equal(5);
    });
  });

  describe('global hourly budget', function () {
    it('refuses every client once the hourly count is used up and alerts once per window', function () {
      const error = sinon.spy(log, 'error');
      process.env.SSP_SOLANA_SETUP_GLOBAL_HOURLY = '4';
      for (let i = 0; i < 4; i++) {
        reserveSetup({
          clientKey: `ip-${i}`,
          estimateLamports: EST,
          now: T0 + i * MIN,
        });
      }
      for (let i = 0; i < 3; i++) {
        expectRefused(
          () =>
            reserveSetup({
              clientKey: `fresh-${i}`,
              estimateLamports: EST,
              now: T0 + (10 + i) * MIN,
            }),
          new RegExp(`temporarily unavailable.*try again in ${50 - i} minutes`),
        );
      }
      const alerts = alertLines(error);
      expect(alerts).to.have.length(1);
      expect(alerts[0]).to.contain('global Solana setup budget exhausted');
      expect(alerts[0]).to.contain('4 paid setups');

      // the window frees up: setups resume
      const later = T0 + SETUP_HOUR_MS + 15 * MIN;
      for (let i = 0; i < 4; i++) {
        reserveSetup({
          clientKey: `ip2-${i}`,
          estimateLamports: EST,
          now: later + i,
        });
      }
      // exhausted again more than an hour after the first alert → one more
      expectRefused(
        () =>
          reserveSetup({
            clientKey: 'x',
            estimateLamports: EST,
            now: later + 10,
          }),
        /temporarily unavailable/,
      );
      expectRefused(
        () =>
          reserveSetup({
            clientKey: 'y',
            estimateLamports: EST,
            now: later + 11,
          }),
        /temporarily unavailable/,
      );
      expect(alertLines(error)).to.have.length(2);
    });

    it('enforces the hourly lamport budget using measured costs (settle)', function () {
      sinon.stub(log, 'error');
      process.env.SSP_SOLANA_SETUP_GLOBAL_HOURLY_LAMPORTS = '12100000';
      const r = [0, 1, 2].map((i) =>
        reserveSetup({
          clientKey: `ip-l${i}`,
          estimateLamports: EST,
          now: T0 + i,
        }),
      );
      // 3 × 3.2M estimated + 3.2M > 12.1M
      expectRefused(
        () =>
          reserveSetup({
            clientKey: 'ip-l3',
            estimateLamports: EST,
            now: T0 + 3,
          }),
        /temporarily unavailable/,
      );
      // measured: each setup cost ~2.94M → room for one more
      r.forEach((x) => x.settle(2_942_600));
      expect(setupBudgetUsage(T0 + 4).lamports).to.equal(3 * 2_942_600);
      reserveSetup({ clientKey: 'ip-l3', estimateLamports: EST, now: T0 + 4 });
    });

    it('0 disables paymaster-funded setups (emergency stop)', function () {
      const error = sinon.spy(log, 'error');
      process.env.SSP_SOLANA_SETUP_GLOBAL_HOURLY = '0';
      expectRefused(
        () => reserveSetup({ clientKey: 'ip', estimateLamports: EST, now: T0 }),
        /temporarily unavailable.*1 minute\./,
      );
      expect(alertLines(error)).to.have.length(1);
    });

    it('per-IP refusals do not consume or alert on the global budget', function () {
      const error = sinon.spy(log, 'error');
      for (let i = 0; i < 3; i++) {
        reserveSetup({ clientKey: 'ip-z', estimateLamports: EST, now: T0 + i });
      }
      for (let i = 0; i < 20; i++) {
        expectRefused(
          () =>
            reserveSetup({
              clientKey: 'ip-z',
              estimateLamports: EST,
              now: T0 + 10 + i,
            }),
          /last hour/,
        );
      }
      expect(setupBudgetUsage(T0 + 100).count).to.equal(3);
      expect(alertLines(error)).to.have.length(0);
    });
  });
});
