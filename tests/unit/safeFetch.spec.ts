// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
/**
 * RLY-7 (SSRF via Solana token metadata uri) and DEP-13 (relay key only to
 * SSP hosts).
 */
import { expect } from 'chai';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import {
  fetchPublicJson,
  isPublicIpAddress,
  resolvePublicHttpsUrl,
} from '../../src/lib/safeFetch';
import { isSspOwnedHost, sspRelayKeyHeaders } from '../../src/lib/sspHosts';
import { sanitizeLogoUrl } from '../../src/services/tokenServices';
import { solanaConnectionConfig } from '../../src/services/solPaymasterService';

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

// A fake https.request: records options and answers with the given response.
function fakeRequest({ status = 200, headers = {}, body = '{}', chunks } = {}) {
  const calls = [];
  const request = (options) => {
    calls.push(options);
    const req = new EventEmitter();
    req.destroy = () => {};
    req.end = () => {
      setImmediate(() => {
        const res = new PassThrough();
        res.statusCode = status;
        res.headers = headers;
        req.emit('response', res);
        for (const c of chunks ?? [body]) res.write(c);
        res.end();
      });
    };
    return req;
  };
  return { request, calls };
}

async function rejects(p, pattern) {
  let err = null;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err, 'expected rejection').to.not.equal(null);
  if (pattern) expect(err.message).to.match(pattern);
}

describe('safeFetch (RLY-7)', function () {
  it('classifies public vs internal addresses (v4, v6, mapped)', function () {
    for (const ip of ['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111']) {
      expect(isPublicIpAddress(ip), ip).to.equal(true);
    }
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254', // cloud metadata
      '100.100.100.200', // alibaba metadata (CGNAT)
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
      '::1',
      '::',
      'fe80::1',
      'fd00:ec2::254', // AWS IMDS v6
      'fc00::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '::ffff:169.254.169.254',
      '64:ff9b::7f00:1',
      '2002:7f00:1::1',
      'not-an-ip',
    ]) {
      expect(isPublicIpAddress(ip), ip).to.equal(false);
    }
  });

  it('accepts only https on the default port without credentials', async function () {
    await rejects(
      resolvePublicHttpsUrl('http://example.com/x', { lookup: publicLookup }),
      /https/,
    );
    await rejects(
      resolvePublicHttpsUrl('ftp://example.com/x', { lookup: publicLookup }),
      /https/,
    );
    await rejects(
      resolvePublicHttpsUrl('https://example.com:8443/x', {
        lookup: publicLookup,
      }),
      /port/,
    );
    await rejects(
      resolvePublicHttpsUrl('https://u:p@example.com/x', {
        lookup: publicLookup,
      }),
      /credentials/,
    );
    await rejects(
      resolvePublicHttpsUrl('https://localhost/x', { lookup: publicLookup }),
      /host/,
    );
    await rejects(
      resolvePublicHttpsUrl('https://example.com/' + 'a'.repeat(3000), {
        lookup: publicLookup,
      }),
      /too long/,
    );
    const ok = await resolvePublicHttpsUrl('https://example.com/meta.json', {
      lookup: publicLookup,
    });
    expect(ok.address).to.equal('93.184.216.34');
  });

  it('refuses hosts that resolve to internal addresses (any of them)', async function () {
    await rejects(
      resolvePublicHttpsUrl('https://metadata.attacker.example/', {
        lookup: async () => [{ address: '169.254.169.254', family: 4 }],
      }),
      /non-public/,
    );
    await rejects(
      resolvePublicHttpsUrl('https://rebind.attacker.example/', {
        lookup: async () => [
          { address: '93.184.216.34', family: 4 },
          { address: '127.0.0.1', family: 4 },
        ],
      }),
      /non-public/,
    );
    await rejects(
      resolvePublicHttpsUrl('https://127.0.0.1/', { lookup: publicLookup }),
      /non-public/,
    );
    await rejects(
      resolvePublicHttpsUrl('https://[::1]/', { lookup: publicLookup }),
      /non-public/,
    );
  });

  it('pins the connection to the checked address and parses JSON', async function () {
    const { request, calls } = fakeRequest({
      body: '{"image":"https://cdn.example/x.png"}',
    });
    const json = await fetchPublicJson(
      'https://example.com/meta.json',
      {},
      { lookup: publicLookup, request },
    );
    expect(json.image).to.equal('https://cdn.example/x.png');
    expect(calls[0].hostname).to.equal('example.com');
    expect(calls[0].port).to.equal(443);
    // the custom lookup always answers with the pre-validated address
    await new Promise((resolve) =>
      calls[0].lookup('example.com', {}, (err, address) => {
        expect(address).to.equal('93.184.216.34');
        resolve();
      }),
    );
    await new Promise((resolve) =>
      calls[0].lookup('example.com', { all: true }, (err, list) => {
        expect(list).to.deep.equal([{ address: '93.184.216.34', family: 4 }]);
        resolve();
      }),
    );
  });

  it('does not follow redirects', async function () {
    const { request } = fakeRequest({
      status: 302,
      headers: { location: 'http://169.254.169.254/' },
    });
    await rejects(
      fetchPublicJson(
        'https://example.com/x',
        {},
        { lookup: publicLookup, request },
      ),
      /Redirects/,
    );
  });

  it('caps the response size (declared and streamed)', async function () {
    const declared = fakeRequest({ headers: { 'content-length': '999999' } });
    await rejects(
      fetchPublicJson(
        'https://example.com/x',
        { maxBytes: 1024 },
        { lookup: publicLookup, request: declared.request },
      ),
      /too large/,
    );
    const streamed = fakeRequest({
      chunks: ['x'.repeat(800), 'x'.repeat(800)],
    });
    await rejects(
      fetchPublicJson(
        'https://example.com/x',
        { maxBytes: 1024 },
        { lookup: publicLookup, request: streamed.request },
      ),
      /too large/,
    );
  });

  it('times out', async function () {
    const request = () => {
      const req = new EventEmitter();
      req.destroy = () => {};
      req.end = () => {};
      return req;
    };
    await rejects(
      fetchPublicJson(
        'https://example.com/x',
        { timeoutMs: 20 },
        { lookup: publicLookup, request },
      ),
      /timed out/,
    );
  });

  it('only relays an https logo URL', function () {
    expect(sanitizeLogoUrl('https://cdn.example/x.png')).to.equal(
      'https://cdn.example/x.png',
    );
    for (const bad of [
      'javascript:alert(1)',
      'data:image/png;base64,AAA',
      'http://x/y.png',
      42,
      null,
      'https://x/' + 'a'.repeat(3000),
    ]) {
      expect(sanitizeLogoUrl(bad), String(bad)).to.equal(null);
    }
  });
});

describe('SSP relay key header (DEP-13)', function () {
  const prev = process.env.SSP_RELAY_PROXY_KEY;
  beforeEach(function () {
    process.env.SSP_RELAY_PROXY_KEY = 'secret-relay-key';
  });
  after(function () {
    if (prev === undefined) delete process.env.SSP_RELAY_PROXY_KEY;
    else process.env.SSP_RELAY_PROXY_KEY = prev;
  });

  it('is attached only for https *.sspwallet.io hosts', function () {
    expect(isSspOwnedHost('https://node-solana.sspwallet.io')).to.equal(true);
    expect(
      sspRelayKeyHeaders('https://node-solana.sspwallet.io'),
    ).to.deep.equal({
      'X-SSP-Relay-Key': 'secret-relay-key',
    });
    for (const url of [
      'https://api.devnet.solana.com',
      'https://mainnet.helius-rpc.com/?api-key=x',
      'http://node-solana.sspwallet.io',
      'https://sspwallet.io.evil.example',
      'https://evilsspwallet.io',
      'not a url',
    ]) {
      expect(sspRelayKeyHeaders(url), url).to.deep.equal({});
    }
  });

  it('the paymaster Connection only sends the key to SSP hosts and refuses redirects there', function () {
    const devnet = solanaConnectionConfig('https://api.devnet.solana.com');
    expect(devnet.httpHeaders).to.equal(undefined);
    expect(devnet.fetch).to.equal(undefined);
    const ssp = solanaConnectionConfig('https://node-solana.sspwallet.io');
    expect(ssp.httpHeaders).to.deep.equal({
      'X-SSP-Relay-Key': 'secret-relay-key',
    });
    expect(typeof ssp.fetch).to.equal('function');
  });

  it('sends nothing when the key is unset', function () {
    delete process.env.SSP_RELAY_PROXY_KEY;
    expect(
      sspRelayKeyHeaders('https://node-solana.sspwallet.io'),
    ).to.deep.equal({});
    expect(
      solanaConnectionConfig('https://node-solana.sspwallet.io').httpHeaders,
    ).to.equal(undefined);
  });
});
