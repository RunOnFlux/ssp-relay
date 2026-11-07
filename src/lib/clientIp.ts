import type { NextFunction, Request, Response } from 'express';
import type { IncomingHttpHeaders } from 'node:http';
import { ipKeyGenerator } from 'express-rate-limit';
import net from 'node:net';

/**
 * Cloudflare's published edge ranges, from https://www.cloudflare.com/ips-v4
 * and https://www.cloudflare.com/ips-v6 (fetched 2026-10-12). Cloudflare
 * changes these rarely; override without a code change via
 * RELAY_CLOUDFLARE_IP_RANGES (comma-separated CIDRs, replaces this list).
 */
export const CLOUDFLARE_IP_RANGES: readonly string[] = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

let cachedRangesSource: string | undefined;
let cachedBlockList: net.BlockList | undefined;

function cloudflareBlockList(): net.BlockList {
  const override = process.env.RELAY_CLOUDFLARE_IP_RANGES?.trim();
  const source = override || '';
  if (cachedBlockList && cachedRangesSource === source) return cachedBlockList;
  const ranges = override
    ? override
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean)
    : CLOUDFLARE_IP_RANGES;
  const list = new net.BlockList();
  for (const cidr of ranges) {
    const [addr, prefixStr] = cidr.split('/');
    const family = net.isIP(addr);
    const prefix = Number(prefixStr);
    if (!family || !Number.isInteger(prefix)) continue; // skip malformed
    list.addSubnet(addr, prefix, family === 4 ? 'ipv4' : 'ipv6');
  }
  cachedRangesSource = source;
  cachedBlockList = list;
  return list;
}

/** Strip an IPv4-mapped IPv6 prefix (::ffff:1.2.3.4 → 1.2.3.4). */
function normalizeIp(address: string | undefined): string | undefined {
  if (!address) return undefined;
  const trimmed = address.trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed);
  const ip = mapped ? mapped[1] : trimmed;
  return net.isIP(ip) ? ip : undefined;
}

/** Whether an address belongs to Cloudflare's edge. */
export function isCloudflareIp(address: string | undefined): boolean {
  const ip = normalizeIp(address);
  if (!ip) return false;
  return cloudflareBlockList().check(ip, net.isIP(ip) === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Number of SSP-operated reverse proxies between Cloudflare and this process
 * (production: Cloudflare → FDM/HAProxy → relay = 1). Override with
 * RELAY_OWN_PROXY_HOPS (0 when the relay sits directly behind Cloudflare).
 */
function ownProxyHops(): number {
  const raw = process.env.RELAY_OWN_PROXY_HOPS;
  const n = raw === undefined || raw === '' ? 1 : Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 10 ? n : 1;
}

/**
 * The address of the peer that connected to the outermost SSP-operated
 * proxy — i.e. the "TCP peer" of our edge. Walks the hop chain
 * [socket peer, …X-Forwarded-For entries appended by our own proxies] and
 * skips exactly `ownProxyHops` hops; only entries appended by our own proxies
 * are read, never anything a client could prepend.
 */
export function edgePeerAddress(req: Request): string | undefined {
  return edgePeerFrom(req.socket?.remoteAddress, req.headers);
}

/** edgePeerAddress from a raw socket peer + headers (HTTP or socket.io). */
function edgePeerFrom(
  socketAddr: string | undefined,
  headers: IncomingHttpHeaders,
): string | undefined {
  const xffHeader = headers['x-forwarded-for'];
  const xff = (Array.isArray(xffHeader) ? xffHeader.join(',') : xffHeader || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // chain[0] = socket peer, chain[1] = last XFF entry (appended by the proxy
  // that is chain[0]), and so on outward.
  const chain = [socketAddr, ...xff.reverse()];
  const hops = ownProxyHops();
  const edge = hops < chain.length ? chain[hops] : chain[chain.length - 1];
  return normalizeIp(edge);
}

/**
 * Resolve the real client IP for rate-limit bucketing.
 *
 * `CF-Connecting-IP` is set authoritatively by Cloudflare, but anyone who
 * reaches the origin without going through Cloudflare can send it too — and
 * mint a fresh rate-limit bucket per request. So it is honoured ONLY when the
 * peer that connected to our edge proxy is a Cloudflare edge address
 * (CLOUDFLARE_IP_RANGES). Otherwise the request did not come through
 * Cloudflare, and the bucket key is that peer address itself — what our own
 * proxy observed — rather than req.ip, which with a hop-count `trust proxy`
 * would be a client-prepended X-Forwarded-For entry in exactly that case.
 *
 * Hard requirement for this to hold: the relay's own port must not be
 * reachable except through the SSP proxy (firewall the origin), otherwise a
 * direct client controls the X-Forwarded-For entries read here.
 *
 * IPv6 addresses are bucketed by subnet via ipKeyGenerator so a v6 client
 * can't rotate through its /64 for fresh buckets.
 */
export function clientIpKey(req: Request): string {
  const { ip } = resolveClientIp(req.socket?.remoteAddress, req.headers);
  if (ip) return ipKeyGenerator(ip);
  return req.ip ? ipKeyGenerator(req.ip) : 'unknown';
}

/**
 * The real client address (a plain normalised IP, never a rate-limit bucket
 * key) and whether the request verifiably came through Cloudflare:
 *   - edge peer is a Cloudflare address → CF-Connecting-IP (falling back to
 *     the edge address if the header is missing or malformed), viaCloudflare;
 *   - otherwise → the edge peer address itself; a CF-Connecting-IP header is
 *     ignored (anyone reaching the origin directly can forge it).
 */
export function resolveClientIp(
  socketAddress: string | undefined,
  headers: IncomingHttpHeaders,
): { ip: string | undefined; viaCloudflare: boolean } {
  const edge = edgePeerFrom(socketAddress, headers);
  if (edge && isCloudflareIp(edge)) {
    const cfIp = headers['cf-connecting-ip'];
    const cf = typeof cfIp === 'string' ? normalizeIp(cfIp) : undefined;
    return { ip: cf ?? edge, viaCloudflare: true };
  }
  return { ip: edge, viaCloudflare: false };
}

/** Fields the relay sets on every request for the enterprise module. */
export interface SspClientIpFields {
  /** Real client IP (see resolveClientIp); undefined if unknown. */
  sspClientIp?: string;
  /** true only when the edge peer was a verified Cloudflare address. */
  sspViaCloudflare?: boolean;
}

/**
 * Early global middleware: stamps `req.sspClientIp` / `req.sspViaCloudflare`
 * so every handler (and the private enterprise module, which never reads raw
 * forwarding headers) sees the verified client address. Always overwrites.
 */
export function attachClientIp(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const { ip, viaCloudflare } = resolveClientIp(
    req.socket?.remoteAddress,
    req.headers,
  );
  const target = req as Request & SspClientIpFields;
  target.sspClientIp = ip;
  target.sspViaCloudflare = viaCloudflare;
  next();
}

/**
 * The same two fields for a socket.io handshake (socket peer = the
 * handshake's `address`, headers = the handshake headers).
 */
export function handshakeClientIp(handshake: {
  address?: string;
  headers?: IncomingHttpHeaders;
}): Required<Pick<SspClientIpFields, 'sspViaCloudflare'>> & SspClientIpFields {
  const { ip, viaCloudflare } = resolveClientIp(
    handshake.address,
    handshake.headers ?? {},
  );
  return { sspClientIp: ip, sspViaCloudflare: viaCloudflare };
}

export default {
  clientIpKey,
  isCloudflareIp,
  edgePeerAddress,
  resolveClientIp,
  attachClientIp,
  handshakeClientIp,
};
