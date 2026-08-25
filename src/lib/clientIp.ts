import type { Request } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';
import net from 'node:net';

/**
 * Resolve the real client IP for rate-limit bucketing.
 *
 * All production traffic reaches the relay through Cloudflare, which sets
 * `CF-Connecting-IP` authoritatively (a client-supplied value is overwritten at
 * the edge). `X-Forwarded-For`, by contrast, is APPENDED to — a client can
 * prepend arbitrary entries, and with `trust proxy` covering more hops than
 * actually exist Express resolves `req.ip` to that client-controlled entry,
 * letting an attacker mint a fresh rate-limit bucket per request. Preferring
 * CF-Connecting-IP closes that bypass without depending on the exact proxy-hop
 * count (Cloudflare → FDM/haproxy → relay) being configured correctly.
 *
 * Traffic that bypasses Cloudflare and hits the origin directly could still
 * spoof this header, so origin firewalls should restrict ingress to Cloudflare
 * ranges — but even unfirewalled this is strictly safer than trusting XFF.
 *
 * IPv6 addresses are bucketed by subnet via ipKeyGenerator so a v6 client
 * can't rotate through its /64 for fresh buckets.
 */
export function clientIpKey(req: Request): string {
  const cfIp = req.headers['cf-connecting-ip'];
  if (typeof cfIp === 'string' && net.isIP(cfIp.trim())) {
    return ipKeyGenerator(cfIp.trim());
  }
  return req.ip ? ipKeyGenerator(req.ip) : 'unknown';
}

export default { clientIpKey };
