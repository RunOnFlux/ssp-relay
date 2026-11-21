// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect } from 'chai';
import sinon from 'sinon';
import axios from 'axios';
import ratesService from '../../src/services/ratesService';

const MIXIN_URL = 'https://api.mixin.one/external/fiats';
const COINBASE_URL = 'https://api.coinbase.com/v2/exchange-rates';

const CODES = [
  'USD', 'EUR', 'GBP', 'CZK', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'SEK',
  'NOK', 'DKK', 'PLN', 'HUF', 'TRY', 'RUB', 'UAH', 'INR', 'CNY', 'HKD',
  'SGD', 'KRW', 'TWD', 'THB', 'MYR', 'IDR', 'PHP', 'VND', 'BRL', 'MXN',
  'ARS', 'CLP', 'ZAR', 'AED', 'SAR', 'ILS',
]; // prettier-ignore

function rate(code: string, scale: number): number {
  return code === 'USD' ? 1 : (CODES.indexOf(code) + 1) * scale;
}

function mixinBody(scale: number) {
  return { data: CODES.map((code) => ({ code, rate: rate(code, scale) })) };
}

function coinbaseBody(scale: number) {
  const rates: Record<string, string> = {
    // Coinbase mixes crypto into the same map; these must be dropped.
    BTC: '0.0000169',
    ETH: '0.00062',
    DOGE: '18.4',
  };
  for (const code of CODES) {
    rates[code] = String(rate(code, scale));
  }
  return { data: { currency: 'USD', rates } };
}

function stubSources(mixin: () => unknown, coinbase: () => unknown) {
  return sinon.stub(axios, 'get').callsFake(async (url: string) => {
    if (url === MIXIN_URL) return { data: mixin() };
    if (url === COINBASE_URL) return { data: coinbase() };
    throw new Error(`unexpected url ${url}`);
  });
}

const fail = (message: string) => () => {
  throw new Error(message);
};

describe('Rate Service: fiat sources', function () {
  afterEach(function () {
    sinon.restore();
  });

  it('always reports USD as 1', function () {
    expect(ratesService.getRates().fiat.USD).to.equal(1);
  });

  it('uses Mixin when it answers', async function () {
    const get = stubSources(
      () => mixinBody(2),
      fail('coinbase must not be called'),
    );
    await ratesService.fetchFiatRates();
    const { fiat } = ratesService.getRates();
    expect(fiat.USD).to.equal(1);
    expect(fiat.EUR).to.equal(rate('EUR', 2));
    expect(get.callCount).to.equal(1);
    expect(get.firstCall.args[1].timeout).to.be.a('number');
  });

  it('falls back to Coinbase when Mixin fails', async function () {
    stubSources(fail('mixin down'), () => coinbaseBody(3));
    await ratesService.fetchFiatRates();
    const { fiat } = ratesService.getRates();
    expect(fiat.USD).to.equal(1);
    expect(fiat.EUR).to.equal(rate('EUR', 3));
    expect(fiat.CZK).to.equal(rate('CZK', 3));
    // BTC and ETH come from the crypto table, never from the fiat source.
    expect(fiat.BTC).to.not.equal(0.0000169);
    expect(fiat).to.not.have.property('DOGE');
  });

  it('falls back to Coinbase when Mixin answers with something unusable', async function () {
    stubSources(
      () => ({ data: [{ code: 'USD', rate: 1 }] }),
      () => coinbaseBody(4),
    );
    await ratesService.fetchFiatRates();
    expect(ratesService.getRates().fiat.EUR).to.equal(rate('EUR', 4));

    sinon.restore();
    stubSources(
      () => ({ error: 'blocked' }),
      () => coinbaseBody(5),
    );
    await ratesService.fetchFiatRates();
    expect(ratesService.getRates().fiat.EUR).to.equal(rate('EUR', 5));
  });

  it('rejects a table that is not USD-based', async function () {
    stubSources(
      () => ({
        data: CODES.map((code) => ({
          code,
          rate: code === 'USD' ? 2 : rate(code, 6),
        })),
      }),
      () => coinbaseBody(7),
    );
    await ratesService.fetchFiatRates();
    expect(ratesService.getRates().fiat.EUR).to.equal(rate('EUR', 7));
  });

  it('keeps the last good table when every source fails', async function () {
    stubSources(() => mixinBody(8), fail('coinbase must not be called'));
    await ratesService.fetchFiatRates();

    sinon.restore();
    stubSources(fail('mixin down'), fail('coinbase down'));
    await ratesService.fetchFiatRates();
    const { fiat } = ratesService.getRates();
    expect(fiat.USD).to.equal(1);
    expect(fiat.EUR).to.equal(rate('EUR', 8));
  });

  it('drops non-positive and non-numeric rates', async function () {
    const body = mixinBody(9);
    body.data.push({ code: 'XAU', rate: -1 }, { code: 'XAG', rate: 'abc' });
    stubSources(() => body, fail('coinbase must not be called'));
    await ratesService.fetchFiatRates();
    const { fiat } = ratesService.getRates();
    expect(fiat).to.not.have.property('XAU');
    expect(fiat).to.not.have.property('XAG');
    expect(fiat.EUR).to.equal(rate('EUR', 9));
  });
});
