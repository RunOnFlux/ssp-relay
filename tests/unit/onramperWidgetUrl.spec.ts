// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect } from 'chai';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import httpMocks from 'node-mocks-http';
import onramperApi from '../../src/apiServices/onramperApi';
import {
  buildWidgetUrl,
  canonicalIp,
  configuredSignatureVersion,
  generateSignature,
  hashEndUserIp,
  parseWidgetInput,
} from '../../src/services/onramperService';

// Throwaway key pair: the real Signature V2 key never lives in this repo.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const EMPTY_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const API_KEY = 'pk_prod_01JDMCZ0ZRZ14VBRW20B4HC04V';

const input = {
  network: 'flux',
  asset: 'FLUX',
  address: 't3TRUNKvgywghL1vU5bsGQqs9eVC17XcUnV',
  theme: 'dark',
};

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** What SSP Wallet built itself before /v1/onramper/url (PurchaseCrypto.tsx). */
function walletBuiltUrl({ network, asset, address, theme }) {
  const isDark = theme === 'dark';
  const payloadToSign = `networkWallets=${network}:${address}`;
  const signature = generateSignature(payloadToSign);
  return `https://buy.onramper.com?onlyCryptoNetworks=${network}&mode=buy,sell&defaultCrypto=${asset}&sell_onlyCryptoNetworks=${network}&sell_defaultCrypto=${asset}&apiKey=pk_prod_01JDMCZ0ZRZ14VBRW20B4HC04V&successRedirectUrl=https%3A%2F%2Fsspwallet.io%2Fcheckout_success&failureRedirectUrl=https%3A%2F%2Fsspwallet.io%2Fcheckout_failure&themeName=${isDark ? 'dark' : 'light'}&containerColor=${isDark ? '1a1918' : 'ffffff'}&borderRadius=0&wgBorderRadius=0&${payloadToSign}&signature=${signature}`;
}

/**
 * Verifies a V2 URL the way Onramper documents their check: take the fields
 * named in sigV2Fields, rebuild the 8-line canonical string, verify Ed25519.
 */
function verifyV2(url) {
  const params = new URL(url).searchParams;
  const fields = new URLSearchParams();
  params
    .get('sigV2Fields')
    .split(',')
    .forEach((key) => {
      expect(params.has(key), `signed field ${key} present`).to.equal(true);
      fields.append(key, params.get(key));
    });
  fields.sort();
  const content = [
    'ONRAMPER-SIG-V2',
    params.get('sigV2Timestamp'),
    params.get('sigV2Nonce'),
    'GET',
    '/',
    fields.toString(),
    '',
    EMPTY_SHA256,
  ].join('\n');
  const sig = params.get('sigV2');
  expect(sig.startsWith('v2:')).to.equal(true);
  expect(
    crypto.verify(
      null,
      Buffer.from(content),
      publicKey,
      Buffer.from(sig.slice(3), 'base64'),
    ),
  ).to.equal(true);
  return params;
}

function call(handler, req) {
  const res = httpMocks.createResponse({ eventEmitter: EventEmitter, req });
  return handler(req, res).then(() => ({
    status: res.statusCode,
    body: JSON.parse(res._getData()),
  }));
}

describe('Onramper widget URL', function () {
  beforeEach(function () {
    process.env.ONRAMPER_SIGN_V2_PRIVATE_KEY = privateKey;
  });
  afterEach(function () {
    delete process.env.ONRAMPER_SIGN_V2_PRIVATE_KEY;
    delete process.env.ONRAMPER_SIGNATURE_VERSION;
    delete process.env.ONRAMPER_BIND_END_USER_IP;
  });

  describe('parseWidgetInput', function () {
    it('accepts the four fields, including a prefixed BCH address', function () {
      expect(parseWidgetInput(input)).to.deep.equal(input);
      const bch = {
        network: 'bitcoincash',
        asset: 'BCH',
        address: 'bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a',
        theme: 'light',
      };
      expect(parseWidgetInput(bch)).to.deep.equal(bch);
    });

    it('rejects anything else', function () {
      const bad = [
        null,
        'networkWallets=flux:t3TRUNKvgywghL1vU5bsGQqs9eVC17XcUnV',
        [input],
        { ...input, extra: '1' },
        { ...input, apiKey: 'pk_prod_other' },
        { ...input, network: 'Flux' },
        { ...input, network: 'flux&mode=sell' },
        { ...input, asset: 'FLUX&wallets=x' },
        { ...input, address: 'short' },
        { ...input, address: 't3TRUNKvgywghL1vU5bsGQqs9eVC17XcUnV&x=1' },
        { ...input, address: 'evil:evil:t3TRUNKvgywghL1vU5bsGQqs9eVC17XcUnV' },
        { ...input, address: 't3TRUNKvgywghL1vU5bsGQqs9eVC17XcUnV ' },
        { ...input, address: 1 },
        { ...input, theme: 'bluey' },
        { network: 'flux', asset: 'FLUX', address: input.address },
      ];
      bad.forEach((body) => {
        expect(() => parseWidgetInput(body), JSON.stringify(body)).to.throw();
      });
    });
  });

  describe('canonicalIp / hashEndUserIp', function () {
    it('normalises before hashing', function () {
      expect(canonicalIp('203.0.113.7')).to.equal('203.0.113.7');
      expect(canonicalIp(' ::ffff:203.0.113.7 ')).to.equal('203.0.113.7');
      expect(canonicalIp('::ffff:c000:280')).to.equal('192.0.2.128');
      expect(canonicalIp('2001:0DB8:0000:0000:0000:0000:0000:0001')).to.equal(
        '2001:db8::1',
      );
      expect(canonicalIp('not-an-ip')).to.equal(undefined);
      expect(canonicalIp('1.2.3.4, 5.6.7.8')).to.equal(undefined);
      expect(hashEndUserIp('2001:DB8::1')).to.equal(sha256('2001:db8::1'));
      expect(hashEndUserIp(undefined)).to.equal(undefined);
    });
  });

  describe('buildWidgetUrl', function () {
    it('defaults to v2; ONRAMPER_SIGNATURE_VERSION=v1 rolls back', function () {
      expect(configuredSignatureVersion()).to.equal('v2');
      process.env.ONRAMPER_SIGNATURE_VERSION = 'v1';
      expect(configuredSignatureVersion()).to.equal('v1');
    });

    it('v1 is byte-identical to the URL the wallet used to build', function () {
      expect(buildWidgetUrl(input, { version: 'v1' })).to.equal(
        walletBuiltUrl(input),
      );
      const light = { ...input, theme: 'light' };
      expect(buildWidgetUrl(light, { version: 'v1' })).to.equal(
        walletBuiltUrl(light),
      );
      const bch = {
        network: 'bitcoincash',
        asset: 'BCH',
        address: 'bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a',
        theme: 'dark',
      };
      expect(buildWidgetUrl(bch, { version: 'v1' })).to.equal(
        walletBuiltUrl(bch),
      );
    });

    it('v2 signs every parameter and binds the IP', function () {
      const url = buildWidgetUrl(input, {
        version: 'v2',
        endUserIp: '203.0.113.7',
      });
      expect(url.startsWith('https://buy.onramper.com?')).to.equal(true);
      const params = verifyV2(url);
      const signed = params.get('sigV2Fields').split(',');
      const sent = [...params.keys()].filter((k) => !k.startsWith('sigV2'));
      expect([...signed].sort()).to.deep.equal([...sent].sort());
      expect(params.get('apiKey')).to.equal(API_KEY);
      expect(params.get('networkWallets')).to.equal(
        'flux:t3TRUNKvgywghL1vU5bsGQqs9eVC17XcUnV',
      );
      expect(params.get('mode')).to.equal('buy,sell');
      expect(params.get('successRedirectUrl')).to.equal(
        'https://sspwallet.io/checkout_success',
      );
      expect(params.get('endUserIpHash')).to.equal(sha256('203.0.113.7'));
      expect(params.has('signature')).to.equal(false);
      expect(params.get('sigV2Nonce')).to.match(UUID_V4);
      const ttl =
        Date.parse(params.get('sigV2Expiry')) -
        Date.parse(params.get('sigV2Timestamp'));
      expect(ttl).to.equal(15 * 60 * 1000);
    });

    it('v2 without a usable IP leaves the session unbound', function () {
      const params = verifyV2(buildWidgetUrl(input, { version: 'v2' }));
      expect(params.has('endUserIpHash')).to.equal(false);
      const garbage = verifyV2(
        buildWidgetUrl(input, { version: 'v2', endUserIp: 'unknown' }),
      );
      expect(garbage.has('endUserIpHash')).to.equal(false);
    });

    it('v2 uses a fresh nonce per URL and is deterministic for a fixed one', function () {
      const a = new URL(buildWidgetUrl(input, { version: 'v2' })).searchParams;
      const b = new URL(buildWidgetUrl(input, { version: 'v2' })).searchParams;
      expect(a.get('sigV2Nonce')).to.not.equal(b.get('sigV2Nonce'));
      const fixed = {
        version: 'v2',
        now: new Date('2026-11-15T10:00:00.000Z'),
        nonce: '550e8400-e29b-41d4-a716-446655440000',
      };
      expect(buildWidgetUrl(input, fixed)).to.equal(
        buildWidgetUrl(input, fixed),
      );
    });

    it('v2 accepts a single-line key with literal \\n', function () {
      process.env.ONRAMPER_SIGN_V2_PRIVATE_KEY = privateKey.replace(
        /\n/g,
        '\\n',
      );
      verifyV2(buildWidgetUrl(input, { version: 'v2' }));
    });

    it('v2 refuses to build without a key', function () {
      delete process.env.ONRAMPER_SIGN_V2_PRIVATE_KEY;
      expect(() => buildWidgetUrl(input, { version: 'v2' })).to.throw(
        'not configured',
      );
    });
  });

  describe('POST /v1/onramper/url', function () {
    it('400 on invalid input, without signing anything', async function () {
      const req = httpMocks.createRequest({
        method: 'POST',
        url: '/v1/onramper/url',
        body: { ...input, address: 'x' },
      });
      const { status, body } = await call(onramperApi.postWidgetUrl, req);
      expect(status).to.equal(400);
      expect(body.status).to.equal('error');
    });

    it('v2 by default: a signed URL in the standard envelope', async function () {
      const req = httpMocks.createRequest({
        method: 'POST',
        url: '/v1/onramper/url',
        body: input,
      });
      req.sspClientIp = '203.0.113.7';
      req.sspViaCloudflare = true;
      const { status, body } = await call(onramperApi.postWidgetUrl, req);
      expect(status).to.equal(200);
      expect(body.status).to.equal('success');
      expect(verifyV2(body.data.url).get('endUserIpHash')).to.equal(
        sha256('203.0.113.7'),
      );
    });

    it('v1 via ONRAMPER_SIGNATURE_VERSION=v1: the legacy URL', async function () {
      process.env.ONRAMPER_SIGNATURE_VERSION = 'v1';
      const req = httpMocks.createRequest({
        method: 'POST',
        url: '/v1/onramper/url',
        body: input,
      });
      const { status, body } = await call(onramperApi.postWidgetUrl, req);
      expect(status).to.equal(200);
      expect(body.status).to.equal('success');
      expect(body.data.url).to.equal(walletBuiltUrl(input));
    });

    it('accepts a JSON text body', async function () {
      process.env.ONRAMPER_SIGNATURE_VERSION = 'v1';
      const req = httpMocks.createRequest({
        method: 'POST',
        url: '/v1/onramper/url',
        body: JSON.stringify(input),
      });
      const { status, body } = await call(onramperApi.postWidgetUrl, req);
      expect(status).to.equal(200);
      expect(body.data.url).to.equal(walletBuiltUrl(input));
    });

    it('v2 binds the IP only for verified Cloudflare traffic', async function () {
      process.env.ONRAMPER_SIGNATURE_VERSION = 'v2';
      const viaCf = httpMocks.createRequest({
        method: 'POST',
        url: '/v1/onramper/url',
        body: input,
      });
      viaCf.sspClientIp = '203.0.113.7';
      viaCf.sspViaCloudflare = true;
      const bound = await call(onramperApi.postWidgetUrl, viaCf);
      expect(bound.status).to.equal(200);
      expect(verifyV2(bound.body.data.url).get('endUserIpHash')).to.equal(
        sha256('203.0.113.7'),
      );

      const direct = httpMocks.createRequest({
        method: 'POST',
        url: '/v1/onramper/url',
        body: input,
      });
      direct.sspClientIp = '198.51.100.4';
      direct.sspViaCloudflare = false;
      const unbound = await call(onramperApi.postWidgetUrl, direct);
      expect(verifyV2(unbound.body.data.url).has('endUserIpHash')).to.equal(
        false,
      );
    });

    it('v2 kill switch: ONRAMPER_BIND_END_USER_IP=false', async function () {
      process.env.ONRAMPER_SIGNATURE_VERSION = 'v2';
      process.env.ONRAMPER_BIND_END_USER_IP = 'false';
      const req = httpMocks.createRequest({
        method: 'POST',
        url: '/v1/onramper/url',
        body: input,
      });
      req.sspClientIp = '203.0.113.7';
      req.sspViaCloudflare = true;
      const { body } = await call(onramperApi.postWidgetUrl, req);
      expect(verifyV2(body.data.url).has('endUserIpHash')).to.equal(false);
    });

    it('500 when v2 is on but the key is missing', async function () {
      process.env.ONRAMPER_SIGNATURE_VERSION = 'v2';
      delete process.env.ONRAMPER_SIGN_V2_PRIVATE_KEY;
      const req = httpMocks.createRequest({
        method: 'POST',
        url: '/v1/onramper/url',
        body: input,
      });
      const { status, body } = await call(onramperApi.postWidgetUrl, req);
      expect(status).to.equal(500);
      expect(body.status).to.equal('error');
    });
  });
});
