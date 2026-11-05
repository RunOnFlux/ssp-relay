import axios from 'axios';
import log from '../lib/log';

/**
 * Which Onramper networks can actually be bought, so the wallet can grey out
 * Buy/Sell instead of opening a widget with an empty currency list.
 *
 * Onramper's catalogue is not enough: it still lists coins (e.g. flux_flux)
 * that no provider will quote. So we ask for a real buy quote per network and
 * treat a network as available when at least one provider returns a payout.
 *
 * Results are cached per country (the widget geolocates the user, so the
 * answer differs by country) for 24 hours. A baseline over a few countries is
 * kept for requests whose country is unknown or not yet probed. Any network we
 * could not determine is simply omitted, and the wallet treats omitted as
 * available — Onramper being down must never hide Buy/Sell.
 */

// The public widget key (same one shipped in the wallet), not a secret.
const ONRAMPER_API_KEY = 'pk_prod_01JDMCZ0ZRZ14VBRW20B4HC04V';

// wallet `onramperNetwork` -> Onramper id of that network's native coin
export const NATIVE_ASSETS: Record<string, string> = {
  bitcoin: 'btc',
  litecoin: 'ltc_litecoin',
  dogecoin: 'doge_dogecoin',
  ravencoin: 'rvn_ravencoin',
  zcash: 'zec_zcash',
  bitcoincash: 'bch_bitcoincash',
  flux: 'flux_flux',
  ethereum: 'eth',
  polygon: 'pol_polygon',
  base: 'eth_base',
  bsc: 'bnb_bsc',
  avaxc: 'avax_avaxc',
  solana: 'sol',
};

const BASELINE_COUNTRIES = ['us', 'de'];
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_COUNTRIES = 300;
const REQUEST_TIMEOUT_MS = 10000;

export type NetworkAvailability = Record<string, boolean>;

interface CacheEntry {
  networks: NetworkAvailability;
  checkedAt: number;
}

const countryCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CacheEntry | null>>();
let baseline: CacheEntry | null = null;

/** true = some provider quotes it, false = none does, null = unknown */
export async function probeNetwork(
  assetId: string,
  country: string,
): Promise<boolean | null> {
  try {
    const url = `https://api.onramper.com/quotes/usd/${assetId}`;
    const res = await axios.get(url, {
      params: { amount: 200, country, type: 'buy' },
      headers: { Authorization: ONRAMPER_API_KEY },
      timeout: REQUEST_TIMEOUT_MS,
    });
    // A non-list body is Onramper saying something else entirely (e.g. "not
    // available in your country"); the widget explains that itself.
    if (!Array.isArray(res.data)) return null;
    return res.data.some(
      (q) =>
        q &&
        Number(q.payout) > 0 &&
        !(Array.isArray(q.errors) && q.errors.length),
    );
  } catch (error) {
    log.warn(
      `[ONRAMP] quote ${assetId}/${country} failed: ${error?.message ?? error}`,
    );
    return null;
  }
}

export async function probeCountry(
  country: string,
): Promise<NetworkAvailability> {
  const networks: NetworkAvailability = {};
  for (const [network, assetId] of Object.entries(NATIVE_ASSETS)) {
    const ok = await probeNetwork(assetId, country);
    if (ok !== null) networks[network] = ok;
  }
  return networks;
}

function isValidCountry(country: unknown): country is string {
  // ISO 3166-1 alpha-2 only; Cloudflare uses XX (unknown) and T1 (Tor).
  return (
    typeof country === 'string' &&
    /^[a-z]{2}$/.test(country) &&
    country !== 'xx' &&
    country !== 't1'
  );
}

function refreshCountry(country: string): Promise<CacheEntry | null> {
  const pending = inFlight.get(country);
  if (pending) return pending;
  const p = probeCountry(country)
    .then((networks) => {
      if (Object.keys(networks).length === 0) return null;
      const entry = { networks, checkedAt: Date.now() };
      if (!countryCache.has(country) && countryCache.size >= MAX_COUNTRIES) {
        const oldest = countryCache.keys().next().value;
        if (oldest) countryCache.delete(oldest);
      }
      countryCache.set(country, entry);
      return entry;
    })
    .catch((error) => {
      log.error(error);
      return null;
    })
    .finally(() => inFlight.delete(country));
  inFlight.set(country, p);
  return p;
}

/** Baseline: available if any baseline country has a provider. */
export async function refreshBaseline(): Promise<void> {
  const merged: NetworkAvailability = {};
  for (const country of BASELINE_COUNTRIES) {
    const entry = await refreshCountry(country);
    if (!entry) continue;
    for (const [network, ok] of Object.entries(entry.networks)) {
      merged[network] = Boolean(merged[network]) || ok;
    }
  }
  if (Object.keys(merged).length > 0) {
    baseline = { networks: merged, checkedAt: Date.now() };
    const off = Object.keys(merged).filter((n) => !merged[n]);
    log.info(
      `[ONRAMP] availability refreshed, unavailable: ${off.join(', ') || 'none'}`,
    );
  }
}

let started = false;
export function startOnrampAvailability(): void {
  if (started) return;
  started = true;
  const run = () => {
    refreshBaseline().catch((error) => log.error(error));
  };
  run();
  setInterval(run, TTL_MS).unref();
}

/**
 * Availability for a request's country. Never waits on Onramper: a missing or
 * stale country entry is refreshed in the background and the baseline is
 * returned meanwhile.
 */
export function getOnrampNetworks(
  rawCountry: unknown,
): NetworkAvailability | undefined {
  const country =
    typeof rawCountry === 'string' ? rawCountry.toLowerCase() : rawCountry;
  if (isValidCountry(country)) {
    const entry = countryCache.get(country);
    const fresh = entry && Date.now() - entry.checkedAt < TTL_MS;
    if (!fresh) void refreshCountry(country);
    if (entry) return entry.networks;
  }
  return baseline?.networks;
}

/** test helper */
export function _resetOnrampAvailability(): void {
  countryCache.clear();
  inFlight.clear();
  baseline = null;
  started = false;
}

export default {
  startOnrampAvailability,
  getOnrampNetworks,
  refreshBaseline,
  probeNetwork,
  probeCountry,
};
