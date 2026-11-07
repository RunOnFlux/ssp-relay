// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
/**
 * networkFeesService.getNetworkFeeRate: the cached fee rate the enterprise
 * module uses as the reference for its proposer fee cap
 * (deps.getNetworkFeeRate).
 */
import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import networkFeesService, {
  getNetworkFeeRate,
  setCachedFeesForTests,
} from '../../src/services/networkFeesService';

describe('getNetworkFeeRate', function () {
  afterEach(function () {
    setCachedFeesForTests([]);
  });

  it('returns recommended, else fast, for the chain', function () {
    setCachedFeesForTests([
      { coin: 'btc', economy: 2, normal: 5, fast: 9, recommended: 8 },
      { coin: 'ltc', economy: 1, normal: 2, fast: 3, recommended: null },
      { coin: 'doge', fast: 1100, recommended: 0 },
    ]);
    expect(getNetworkFeeRate('btc')).to.equal(8);
    expect(getNetworkFeeRate('ltc')).to.equal(3);
    expect(getNetworkFeeRate('doge')).to.equal(1100);
    expect(networkFeesService.getNetworkFeeRate('btc')).to.equal(8);
  });

  it('returns null for unknown chains, an empty cache or unusable rates', function () {
    expect(getNetworkFeeRate('btc')).to.equal(null);
    setCachedFeesForTests([
      { coin: 'btc', fast: Number.NaN, recommended: -1 },
      { coin: 'ltc', fast: '5', recommended: '5' },
    ]);
    expect(getNetworkFeeRate('btc')).to.equal(null);
    expect(getNetworkFeeRate('ltc')).to.equal(null);
    expect(getNetworkFeeRate('zzz')).to.equal(null);
    expect(getNetworkFeeRate(undefined)).to.equal(null);
  });

  it('is passed to the enterprise module as deps.getNetworkFeeRate', function () {
    const hooks = readFileSync(
      new URL('../../src/services/enterpriseHooks.ts', import.meta.url),
      'utf8',
    );
    expect(hooks).to.match(
      /import \{ getNetworkFeeRate \} from '\.\/networkFeesService';/,
    );
    const initCall = hooks.slice(hooks.indexOf('hooksModule.init({'));
    expect(initCall.slice(0, 1500)).to.match(/\n\s+getNetworkFeeRate,\n/);
  });
});
