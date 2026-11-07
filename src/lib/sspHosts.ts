/**
 * SSP-owned upstream hosts.
 *
 * The relay identifies itself to SSP's own Cloudflare Worker proxies (e.g.
 * node-solana.sspwallet.io) with the `X-SSP-Relay-Key` header so it lands in
 * the fleet-wide rate-limit bucket. That key must never travel to a third
 * party (api.devnet.solana.com, a paid RPC configured by an operator, a
 * provider an SSP host redirects to, …): anyone holding it gets the relay's
 * elevated proxy allowance.
 */

/** https + host equal to, or a subdomain of, sspwallet.io. */
export function isSspOwnedHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'sspwallet.io' || host.endsWith('.sspwallet.io');
  } catch {
    return false;
  }
}

/**
 * Headers identifying the relay to an SSP-owned proxy. Empty for any other
 * host, and when SSP_RELAY_PROXY_KEY is unset.
 */
export function sspRelayKeyHeaders(url: string): Record<string, string> {
  const key = process.env.SSP_RELAY_PROXY_KEY;
  return key && isSspOwnedHost(url) ? { 'X-SSP-Relay-Key': key } : {};
}

export default { isSspOwnedHost, sspRelayKeyHeaders };
