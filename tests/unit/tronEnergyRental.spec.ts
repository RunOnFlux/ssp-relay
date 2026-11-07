// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect } from 'chai';
import { createHmac } from 'crypto';
import {
  CATFEE_BASE_URLS,
  CatFeeClient,
  buildCatFeeOrderPath,
  catFeeSignature,
  rentalProviderFromEnv,
  withHourlyCap,
} from '../../src/services/tronEnergyRental';

const S = 'TDxtBDwocWMwXV6z1CWXJmT7p8bm14YoLY';
const FIXED_NOW = new Date('2026-09-29T12:34:56.789Z');

function mockFetch(replies: Array<Record<string, unknown> | Error>) {
  const calls: { url: string; init: Record<string, unknown> }[] = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const next = replies.shift();
    if (next === undefined) throw new Error('unexpected request');
    if (next instanceof Error) throw next;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(next),
    };
  };
  return { fetchImpl, calls };
}

function client(fetchImpl, extra = {}) {
  let t = FIXED_NOW.getTime();
  return new CatFeeClient({
    apiKey: 'key-1',
    apiSecret: 'secret-1',
    baseUrl: CATFEE_BASE_URLS.tron,
    fetchImpl,
    now: () => new Date(t),
    sleep: async (ms) => {
      t += ms;
    },
    pollIntervalMs: 1_000,
    timeoutMs: 5_000,
    ...extra,
  });
}

const order = (confirm = 'UNCONFIRMED', status = 'DELEGATE_SUCCESS') => ({
  code: 0,
  data: { id: 'ord-1', status, confirm_status: confirm },
});

describe('TRON energy rental — CatFee client', function () {
  it('signs base64(HMAC-SHA256(secret, timestamp + METHOD + path-with-query))', function () {
    const ts = '2023-08-26T12:34:56.789Z';
    const path = '/v1/order?quantity=65000&receiver=TRON_ADDRESS&duration=1h';
    const expected = createHmac('sha256', 'secret')
      .update(`${ts}POST${path}`)
      .digest('base64');
    expect(catFeeSignature('secret', ts, 'post', path)).to.equal(expected);
  });

  it('builds the order path in a fixed order, activate=false', function () {
    expect(
      buildCatFeeOrderPath({
        quantity: 65_000n,
        receiver: S,
        clientOrderId: 'ssp-abc-1',
      }),
    ).to.equal(
      `/v1/order?quantity=65000&receiver=${S}&duration=1h&client_order_id=ssp-abc-1&activate=false`,
    );
  });

  it('validates quantity, receiver and client_order_id', function () {
    const ok = { quantity: 65_000n, receiver: S, clientOrderId: 'x' };
    expect(() => buildCatFeeOrderPath({ ...ok, quantity: 64_999n })).to.throw();
    expect(() =>
      buildCatFeeOrderPath({ ...ok, quantity: 3_000_000n }),
    ).to.throw();
    expect(() => buildCatFeeOrderPath({ ...ok, receiver: '0xabc' })).to.throw();
    expect(() =>
      buildCatFeeOrderPath({ ...ok, clientOrderId: 'a'.repeat(65) }),
    ).to.throw();
    expect(() =>
      buildCatFeeOrderPath({ ...ok, clientOrderId: 'a&b=c' }),
    ).to.throw();
  });

  it('sends the CF-ACCESS-* headers and signs exactly the requested path', async function () {
    const { fetchImpl, calls } = mockFetch([order('DELEGATION_CONFIRMED')]);
    await client(fetchImpl).rent({
      receiver: S,
      quantity: 65_000n,
      clientOrderId: 'ssp-1',
    });
    const { url, init } = calls[0];
    const path = url.slice(CATFEE_BASE_URLS.tron.length);
    expect(init.method).to.equal('POST');
    expect(init.headers['CF-ACCESS-KEY']).to.equal('key-1');
    expect(init.headers['CF-ACCESS-TIMESTAMP']).to.equal(
      '2026-09-29T12:34:56.789Z',
    );
    expect(init.headers['CF-ACCESS-SIGN']).to.equal(
      catFeeSignature('secret-1', '2026-09-29T12:34:56.789Z', 'POST', path),
    );
    expect(init.headers['CF-ACCESS-SIGN']).to.not.include('secret-1');
  });

  it('polls GET /v1/order/{id} until DELEGATION_CONFIRMED', async function () {
    const { fetchImpl, calls } = mockFetch([
      order('UNCONFIRMED', 'PAYMENT_SUCCESS'),
      order('UNCONFIRMED'),
      order('DELEGATION_CONFIRMED'),
    ]);
    const r = await client(fetchImpl).rent({
      receiver: S,
      quantity: 70_000n,
      clientOrderId: 'ssp-2',
    });
    expect(r).to.deep.equal({ orderId: 'ord-1' });
    expect(calls.map((c) => c.init.method)).to.deep.equal([
      'POST',
      'GET',
      'GET',
    ]);
    expect(calls[1].url).to.equal(`${CATFEE_BASE_URLS.tron}/v1/order/ord-1`);
  });

  it('throws on a non-zero business code (HTTP 200)', async function () {
    const { fetchImpl } = mockFetch([
      { code: 201, msg: 'insufficient balance' },
    ]);
    let err;
    try {
      await client(fetchImpl).rent({
        receiver: S,
        quantity: 65_000n,
        clientOrderId: 'ssp-3',
      });
    } catch (e) {
      err = e;
    }
    expect(err.message).to.match(/code=201 insufficient balance/);
  });

  it('retries code 9999 and transport errors once with the SAME client_order_id', async function () {
    const { fetchImpl, calls } = mockFetch([
      { code: 9999, msg: 'unknown' },
      order('DELEGATION_CONFIRMED'),
    ]);
    await client(fetchImpl).rent({
      receiver: S,
      quantity: 65_000n,
      clientOrderId: 'ssp-4',
    });
    expect(calls).to.have.length(2);
    expect(calls[0].url).to.equal(calls[1].url);
    expect(calls[1].url).to.include('client_order_id=ssp-4');

    const t = mockFetch([
      new Error('ECONNRESET'),
      order('DELEGATION_CONFIRMED'),
    ]);
    await client(t.fetchImpl).rent({
      receiver: S,
      quantity: 65_000n,
      clientOrderId: 'ssp-5',
    });
    expect(t.calls).to.have.length(2);
  });

  it('fails on a terminal order status', async function () {
    const { fetchImpl } = mockFetch([order('UNCONFIRMED', 'DELEGATE_FAIL')]);
    let err;
    try {
      await client(fetchImpl).rent({
        receiver: S,
        quantity: 65_000n,
        clientOrderId: 'ssp-6',
      });
    } catch (e) {
      err = e;
    }
    expect(err.message).to.match(/ord-1 failed: DELEGATE_FAIL/);
  });

  it('fails on DELEGATION_CONFIRMED_FAIL', async function () {
    const { fetchImpl } = mockFetch([order('DELEGATION_CONFIRMED_FAIL')]);
    let err;
    try {
      await client(fetchImpl).rent({
        receiver: S,
        quantity: 65_000n,
        clientOrderId: 'ssp-7',
      });
    } catch (e) {
      err = e;
    }
    expect(err.message).to.match(/DELEGATION_CONFIRMED_FAIL/);
  });

  it('times out when the delegation never confirms', async function () {
    const replies = [order('UNCONFIRMED')];
    for (let i = 0; i < 10; i++) replies.push(order('UNCONFIRMED'));
    const { fetchImpl } = mockFetch(replies);
    let err;
    try {
      await client(fetchImpl).rent({
        receiver: S,
        quantity: 65_000n,
        clientOrderId: 'ssp-8',
      });
    } catch (e) {
      err = e;
    }
    expect(err.message).to.match(/not delegated within 5000 ms/);
  });

  it('caps rentals per rolling hour', async function () {
    let now = 0;
    let rented = 0;
    const capped = withHourlyCap(
      {
        name: 'x',
        rent: async () => {
          rented += 1;
          return { orderId: String(rented) };
        },
      },
      2,
      () => now,
    );
    const p = { receiver: S, quantity: 65_000n, clientOrderId: 'a' };
    await capped.rent(p);
    await capped.rent(p);
    let err;
    try {
      await capped.rent(p);
    } catch (e) {
      err = e;
    }
    expect(err.message).to.match(/rental cap reached/);
    now += 3_600_001;
    await capped.rent(p);
    expect(rented).to.equal(3);
  });

  describe('rentalProviderFromEnv', function () {
    it('is off by default', function () {
      expect(rentalProviderFromEnv('tron', {})).to.equal(null);
    });

    it('stays off when the CatFee credentials are missing', function () {
      expect(
        rentalProviderFromEnv('tron', { TRON_ENERGY_RENTAL: 'catfee' }),
      ).to.equal(null);
    });

    it('uses per-network credentials', function () {
      const env = {
        TRON_ENERGY_RENTAL: 'catfee',
        CATFEE_API_KEY: 'k',
        CATFEE_API_SECRET: 's',
      };
      expect(rentalProviderFromEnv('tron', env).name).to.equal('catfee');
      expect(rentalProviderFromEnv('tronNile', env)).to.equal(null);
      expect(
        rentalProviderFromEnv('tronNile', {
          TRON_ENERGY_RENTAL: 'catfee',
          CATFEE_NILE_API_KEY: 'k',
          CATFEE_NILE_API_SECRET: 's',
        }).name,
      ).to.equal('catfee');
    });

    it('uses the documented base URLs', function () {
      expect(CATFEE_BASE_URLS).to.deep.equal({
        tron: 'https://api.catfee.io',
        tronNile: 'https://nile.catfee.io',
      });
    });
  });
});
