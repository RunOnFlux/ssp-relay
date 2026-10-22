/**
 * SSRF-hardened fetch for URLs that come from untrusted data (e.g. the
 * Metaplex `uri` of an arbitrary SPL mint, which anyone can deploy).
 *
 * - https only, default port (443) only, no credentials in the URL
 * - the hostname is resolved once and EVERY resolved address must be public
 *   (no loopback, private, CGNAT, link-local / cloud metadata, multicast,
 *   reserved, documentation, ULA, IPv4-mapped/NAT64/6to4 wrappers of those)
 * - the connection is pinned to the address that was checked (no DNS
 *   rebinding between the check and the connect)
 * - redirects are not followed (a 3xx is a failure)
 * - hard timeout and response size cap
 */
import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';
import type { IncomingMessage, RequestOptions, ClientRequest } from 'node:http';

const BLOCKED_V4 = new net.BlockList();
[
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT (also Alibaba metadata 100.100.100.200)
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, incl. 169.254.169.254 cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
].forEach(([addr, prefix]) =>
  BLOCKED_V4.addSubnet(addr as string, prefix as number, 'ipv4'),
);

const BLOCKED_V6 = new net.BlockList();
[
  ['::', 96], // unspecified, loopback, deprecated IPv4-compatible
  ['::ffff:0:0', 96], // IPv4-mapped (checked separately against the v4 list)
  ['64:ff9b::', 96], // NAT64
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard-only
  ['2001::', 23], // IETF protocol assignments (incl. Teredo 2001::/32)
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4
  ['fc00::', 7], // unique local (incl. AWS IMDS fd00:ec2::254)
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
].forEach(([addr, prefix]) =>
  BLOCKED_V6.addSubnet(addr as string, prefix as number, 'ipv6'),
);

/** Extract the IPv4 address embedded in an IPv4-mapped IPv6 address. */
function mappedV4(address: string): string | null {
  const m = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (m) return m[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  }
  return null;
}

/** Whether an IP literal is a publicly routable unicast address. */
export function isPublicIpAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return !BLOCKED_V4.check(address, 'ipv4');
  if (family === 6) {
    const v4 = mappedV4(address);
    if (v4) return net.isIPv4(v4) && !BLOCKED_V4.check(v4, 'ipv4');
    return !BLOCKED_V6.check(address, 'ipv6');
  }
  return false;
}

export interface SafeFetchDeps {
  lookup: (
    hostname: string,
  ) => Promise<Array<{ address: string; family: number }>>;
  request: (options: RequestOptions) => ClientRequest;
}

const defaultDeps: SafeFetchDeps = {
  lookup: (hostname) => dns.lookup(hostname, { all: true, verbatim: true }),
  request: (options) => https.request(options),
};

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxUrlLength?: number;
}

/**
 * Validate an untrusted URL and resolve it to a single public address.
 * Throws if the URL or any resolved address is not acceptable.
 */
export async function resolvePublicHttpsUrl(
  rawUrl: string,
  deps: Pick<SafeFetchDeps, 'lookup'> = defaultDeps,
  maxUrlLength = 2048,
): Promise<{ url: URL; address: string; family: 4 | 6 }> {
  if (typeof rawUrl !== 'string' || rawUrl.length > maxUrlLength) {
    throw new Error('URL rejected: missing or too long');
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('URL rejected: unparsable');
  }
  if (url.protocol !== 'https:') {
    throw new Error('URL rejected: only https is allowed');
  }
  if (url.port && url.port !== '443') {
    throw new Error('URL rejected: only the default https port is allowed');
  }
  if (url.username || url.password) {
    throw new Error('URL rejected: credentials are not allowed');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (!hostname || hostname.toLowerCase() === 'localhost') {
    throw new Error('URL rejected: invalid host');
  }

  let addresses: Array<{ address: string; family: number }>;
  if (net.isIP(hostname)) {
    addresses = [{ address: hostname, family: net.isIP(hostname) }];
  } else {
    addresses = await deps.lookup(hostname);
  }
  if (!addresses.length) {
    throw new Error('URL rejected: host does not resolve');
  }
  for (const { address } of addresses) {
    if (!isPublicIpAddress(address)) {
      throw new Error('URL rejected: host resolves to a non-public address');
    }
  }
  const chosen = addresses[0];
  return {
    url,
    address: chosen.address,
    family: chosen.family === 6 ? 6 : 4,
  };
}

/**
 * GET an untrusted https URL and parse the body as JSON, under the rules
 * listed at the top of this file. Rejects on any violation.
 */
export async function fetchPublicJson<T = unknown>(
  rawUrl: string,
  options: SafeFetchOptions = {},
  deps: SafeFetchDeps = defaultDeps,
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const maxBytes = options.maxBytes ?? 256 * 1024;
  const { url, address, family } = await resolvePublicHttpsUrl(
    rawUrl,
    deps,
    options.maxUrlLength,
  );

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (err: Error | null, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value as T);
    };

    const req = deps.request({
      protocol: 'https:',
      hostname: url.hostname.replace(/^\[|\]$/g, ''),
      port: 443,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': 'ssp-relay' },
      // Pin the connection to the address that passed the public-IP check.
      lookup: ((_host, lookupOpts, cb) => {
        const opts = lookupOpts as { all?: boolean } | undefined;
        if (opts && opts.all) {
          (cb as (e: Error | null, a: unknown) => void)(null, [
            { address, family },
          ]);
        } else {
          (cb as (e: Error | null, a: string, f: number) => void)(
            null,
            address,
            family,
          );
        }
      }) as RequestOptions['lookup'],
      agent: false,
    });

    const timer = setTimeout(() => {
      req.destroy(new Error('Request timed out'));
      finish(new Error('Request timed out'));
    }, timeoutMs);

    req.on('error', (err: Error) => finish(err));
    req.on('response', (res: IncomingMessage) => {
      const status = res.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        res.resume();
        req.destroy();
        finish(
          new Error(
            status >= 300 && status < 400
              ? 'Redirects are not followed'
              : `Unexpected status ${status}`,
          ),
        );
        return;
      }
      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBytes) {
        req.destroy();
        finish(new Error('Response too large'));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy();
          finish(new Error('Response too large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('error', (err: Error) => finish(err));
      res.on('end', () => {
        try {
          finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          finish(new Error('Response is not valid JSON'));
        }
      });
    });
    req.end();
  });
}

export default { fetchPublicJson, isPublicIpAddress, resolvePublicHttpsUrl };
