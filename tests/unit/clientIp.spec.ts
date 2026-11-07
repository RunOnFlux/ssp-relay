// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
/**
 * RLY-4: CF-Connecting-IP is honoured only when the peer that connected to
 * our edge proxy is a Cloudflare address.
 */
import { expect } from 'chai';
import {
  clientIpKey,
  edgePeerAddress,
  isCloudflareIp,
  attachClientIp,
  handshakeClientIp,
} from '../../src/lib/clientIp';

const CF_EDGE = '172.70.10.20'; // inside 172.64.0.0/13
const CF_EDGE_V6 = '2606:4700:10::1';
const HAPROXY = '10.0.0.5';

function req({ socket = HAPROXY, xff, cf, ip } = {}) {
  const headers = {};
  if (xff !== undefined) headers['x-forwarded-for'] = xff;
  if (cf !== undefined) headers['cf-connecting-ip'] = cf;
  return { headers, socket: { remoteAddress: socket }, ip };
}

describe('clientIpKey (RLY-4)', function () {
  afterEach(function () {
    delete process.env.RELAY_OWN_PROXY_HOPS;
    delete process.env.RELAY_CLOUDFLARE_IP_RANGES;
  });

  it('recognises Cloudflare ranges (v4, v6, v4-mapped) and nothing else', function () {
    expect(isCloudflareIp(CF_EDGE)).to.equal(true);
    expect(isCloudflareIp(`::ffff:${CF_EDGE}`)).to.equal(true);
    expect(isCloudflareIp(CF_EDGE_V6)).to.equal(true);
    expect(isCloudflareIp('8.8.8.8')).to.equal(false);
    expect(isCloudflareIp('10.0.0.1')).to.equal(false);
    expect(isCloudflareIp('not-an-ip')).to.equal(false);
    expect(isCloudflareIp(undefined)).to.equal(false);
  });

  it('honours CF-Connecting-IP when our proxy saw a Cloudflare edge peer', function () {
    const r = req({ xff: `198.51.100.7, ${CF_EDGE}`, cf: '203.0.113.9' });
    expect(edgePeerAddress(r)).to.equal(CF_EDGE);
    expect(clientIpKey(r)).to.equal('203.0.113.9');
  });

  it('ignores a spoofed CF-Connecting-IP from a client that bypassed Cloudflare', function () {
    // attacker → HAProxy directly: HAProxy appends the attacker's real IP;
    // the attacker controls the forged XFF prefix and the CF header.
    const attacker = '192.0.2.66';
    const keys = new Set();
    for (let i = 0; i < 5; i++) {
      keys.add(
        clientIpKey(req({ xff: `1.2.3.${i}, ${attacker}`, cf: `9.9.9.${i}` })),
      );
    }
    expect([...keys]).to.deep.equal([attacker]);
  });

  it('does not trust a client-prepended Cloudflare address in XFF', function () {
    // forged "CF edge" entry is not the hop our proxy appended
    const r = req({ xff: `${CF_EDGE}, 192.0.2.66`, cf: '9.9.9.9' });
    expect(clientIpKey(r)).to.equal('192.0.2.66');
  });

  it('uses the socket peer when there is no proxy chain (dev / tests)', function () {
    const r = req({ socket: '127.0.0.1', cf: '9.9.9.9' });
    expect(clientIpKey(r)).to.equal('127.0.0.1');
  });

  it('supports a relay directly behind Cloudflare (RELAY_OWN_PROXY_HOPS=0)', function () {
    process.env.RELAY_OWN_PROXY_HOPS = '0';
    expect(clientIpKey(req({ socket: CF_EDGE, cf: '203.0.113.9' }))).to.equal(
      '203.0.113.9',
    );
    expect(
      clientIpKey(req({ socket: '192.0.2.66', cf: '203.0.113.9' })),
    ).to.equal('192.0.2.66');
  });

  it('honours the RELAY_CLOUDFLARE_IP_RANGES override', function () {
    process.env.RELAY_CLOUDFLARE_IP_RANGES = '192.0.2.0/24';
    expect(isCloudflareIp('192.0.2.66')).to.equal(true);
    expect(isCloudflareIp(CF_EDGE)).to.equal(false);
  });

  it('buckets IPv6 clients by subnet', function () {
    const a = clientIpKey(req({ xff: CF_EDGE, cf: '2001:db8:1:2::1' }));
    const b = clientIpKey(req({ xff: CF_EDGE, cf: '2001:db8:1:2::ffff' }));
    expect(a).to.equal(b);
  });
});

describe('req.sspClientIp / req.sspViaCloudflare (enterprise pass-through)', function () {
  afterEach(function () {
    delete process.env.RELAY_OWN_PROXY_HOPS;
  });

  function stamp(r) {
    let nextCalled = false;
    attachClientIp(r, {}, () => {
      nextCalled = true;
    });
    expect(nextCalled).to.equal(true);
    return r;
  }

  it('uses CF-Connecting-IP (a plain IP, not a bucket key) behind a verified Cloudflare edge', function () {
    const r = stamp(
      req({ xff: `198.51.100.7, ${CF_EDGE}`, cf: '2001:db8:1:2::1' }),
    );
    expect(r.sspClientIp).to.equal('2001:db8:1:2::1');
    expect(r.sspViaCloudflare).to.equal(true);
    // the rate-limit key for the same request is the /56 subnet bucket
    expect(clientIpKey(r)).to.not.equal(r.sspClientIp);
  });

  it('ignores a forged CF-Connecting-IP from a non-Cloudflare peer', function () {
    const r = stamp(req({ xff: '1.2.3.4, 192.0.2.66', cf: '9.9.9.9' }));
    expect(r.sspClientIp).to.equal('192.0.2.66');
    expect(r.sspViaCloudflare).to.equal(false);
  });

  it('falls back to the edge address when Cloudflare sent no usable header', function () {
    const r = stamp(req({ xff: CF_EDGE, cf: 'garbage' }));
    expect(r.sspClientIp).to.equal(CF_EDGE);
    expect(r.sspViaCloudflare).to.equal(true);
  });

  it('normalises IPv4-mapped peers and overwrites anything already on the request', function () {
    process.env.RELAY_OWN_PROXY_HOPS = '0';
    const r = req({ socket: '::ffff:192.0.2.66' });
    r.sspClientIp = '6.6.6.6';
    r.sspViaCloudflare = true;
    stamp(r);
    expect(r.sspClientIp).to.equal('192.0.2.66');
    expect(r.sspViaCloudflare).to.equal(false);
  });

  it('computes the same fields for a socket.io handshake', function () {
    expect(
      handshakeClientIp({
        address: HAPROXY,
        headers: {
          'x-forwarded-for': `198.51.100.7, ${CF_EDGE}`,
          'cf-connecting-ip': '203.0.113.9',
        },
      }),
    ).to.deep.equal({ sspClientIp: '203.0.113.9', sspViaCloudflare: true });
    expect(
      handshakeClientIp({
        address: HAPROXY,
        headers: {
          'x-forwarded-for': '192.0.2.66',
          'cf-connecting-ip': '203.0.113.9',
        },
      }),
    ).to.deep.equal({ sspClientIp: '192.0.2.66', sspViaCloudflare: false });
  });

  it('is registered before every route and the body parsers', function () {
    const { readFileSync } = require('node:fs');
    const server = readFileSync(
      new URL('../../src/lib/server.ts', import.meta.url),
      'utf8',
    );
    const at = server.indexOf('app.use(attachClientIp)');
    expect(at).to.be.greaterThan(0);
    for (const later of [
      "app.post(\n  '/v1/enterprise/stripe/webhook'",
      'app.use(express.json',
      'routes(app)',
    ]) {
      expect(server.indexOf(later), later).to.be.greaterThan(at);
    }
  });
});
