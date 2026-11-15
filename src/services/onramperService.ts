import crypto from 'crypto';
import net from 'net';
import config from 'config';
import log from '../lib/log';

const secretKey = config.keys.onramper;

/**
 * Signature V1 (legacy HMAC-SHA256 over a caller-supplied string). Backs
 * POST /v1/sign/onramper, which wallets released before the widget URL
 * endpoint still call. Never reuse this pattern for the V2 key.
 */
export function generateSignature(data: string): string {
  try {
    if (data.length < 30) {
      throw new Error('Data is too short');
    }
    const hmac = crypto.createHmac('sha256', secretKey);
    hmac.update(data);
    return hmac.digest('hex');
  } catch (error) {
    log.error(error);
    throw error;
  }
}

/*
 * Onramper widget URL for SSP Wallet's buy/sell iframe.
 *
 * The relay builds the whole URL from four validated inputs and signs it; it
 * never signs a caller-supplied string with the Signature V2 key. That key is
 * shared with ZelCore (same Onramper API key), so an endpoint that signed
 * arbitrary content would let anyone sign anything as us.
 *
 * Signature scheme (config.onramper.signatureVersion, env
 * ONRAMPER_SIGNATURE_VERSION wins):
 *  - 'v1': exactly the URL SSP Wallet used to build itself, HMAC over
 *    `networkWallets=<network>:<address>` in `signature`.
 *  - 'v2': Ed25519 over every parameter in the URL (all listed in sigV2Fields,
 *    so Onramper strips nothing), plus endUserIpHash binding the checkout to
 *    the caller's IP. https://docs.onramper.com/docs/widget-sign-a-url-v2
 *    A V2 URL is single-use (the nonce burns on first load) and expires after
 *    15 minutes, so the wallet asks for a fresh one per iframe load.
 */

export type OnramperSignatureVersion = 'v1' | 'v2';

export interface OnramperWidgetInput {
  /** Onramper network id, e.g. 'bitcoin', 'polygon'. */
  network: string;
  /** Asset ticker, e.g. 'BTC'. */
  asset: string;
  /** Receiving address (Bitcoin Cash keeps its `bitcoincash:` prefix). */
  address: string;
  theme: 'dark' | 'light';
}

export interface WidgetUrlOptions {
  version?: OnramperSignatureVersion;
  /** The caller's IP; only pass it when it is verifiably the user's own. */
  endUserIp?: string;
  now?: Date;
  nonce?: string;
}

const WIDGET_INPUT_KEYS = ['network', 'asset', 'address', 'theme'];
const NETWORK_RE = /^[a-z0-9_-]{1,32}$/;
const ASSET_RE = /^[A-Za-z0-9_-]{1,20}$/;
const ADDRESS_RE = /^(?:[a-z]{1,20}:)?[A-Za-z0-9]{20,100}$/;

const SIG_V2_VERSION = 'ONRAMPER-SIG-V2';
const EMPTY_BODY_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
// Onramper's recommended window; the most they accept for sigV2Expiry is 30.
const WIDGET_SIG_V2_TTL_MS = 15 * 60 * 1000;

const SUCCESS_REDIRECT = 'https://sspwallet.io/checkout_success';
const FAILURE_REDIRECT = 'https://sspwallet.io/checkout_failure';

function onramperConfig(): {
  apiKey: string;
  widgetEndpoint: string;
  signatureVersion?: string;
  bindEndUserIp?: boolean;
} {
  return config.onramper;
}

/**
 * Validates the wallet's request body. Only the four known fields, each
 * against a strict charset, so nothing else can reach the signed URL.
 */
export function parseWidgetInput(body: unknown): OnramperWidgetInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Invalid request body');
  }
  const record = body as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter(
    (key) => !WIDGET_INPUT_KEYS.includes(key),
  );
  if (unknownKeys.length) {
    throw new Error('Unknown field in request body');
  }
  const { network, asset, address, theme } = record;
  if (typeof network !== 'string' || !NETWORK_RE.test(network)) {
    throw new Error('Invalid network');
  }
  if (typeof asset !== 'string' || !ASSET_RE.test(asset)) {
    throw new Error('Invalid asset');
  }
  if (typeof address !== 'string' || !ADDRESS_RE.test(address)) {
    throw new Error('Invalid address');
  }
  if (theme !== 'dark' && theme !== 'light') {
    throw new Error('Invalid theme');
  }
  return { network, asset, address, theme };
}

/** Configured scheme; ONRAMPER_SIGNATURE_VERSION overrides config. */
export function configuredSignatureVersion(): OnramperSignatureVersion {
  const value =
    process.env.ONRAMPER_SIGNATURE_VERSION ||
    onramperConfig()?.signatureVersion;
  return value === 'v2' ? 'v2' : 'v1';
}

/** Whether V2 URLs bind the session to the caller's IP (kill switch). */
export function bindEndUserIpEnabled(): boolean {
  const env = process.env.ONRAMPER_BIND_END_USER_IP;
  if (env !== undefined && env !== '') return env !== 'false';
  return onramperConfig()?.bindEndUserIp !== false;
}

function sha256Hex(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Canonical textual form of an IP, as Onramper hashes it: dotted-quad IPv4;
 * IPv6 in RFC 5952 form (lowercase, longest zero run compressed, no leading
 * zeros); IPv4-mapped IPv6 unmapped to plain IPv4. Undefined for anything that
 * is not a single IP. The hash is an exact string match on Onramper's side, so
 * a formatting difference is a mismatch. Same rules as ZelCore's backend.
 */
export function canonicalIp(ip?: string | null): string | undefined {
  if (!ip) return undefined;
  const candidate = String(ip).trim();
  const family = net.isIP(candidate);
  if (family === 4) return candidate;
  if (family !== 6) return undefined;
  // The WHATWG URL serializer writes RFC 5952 form for IPv6 hosts.
  const v6 = new URL(`http://[${candidate}]`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v6);
  if (mapped) {
    const hi = parseInt(mapped[1], 16);
    const lo = parseInt(mapped[2], 16);
    return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.');
  }
  return v6;
}

/** SHA256 (lowercase hex) of the canonical IP, for Onramper's endUserIpHash. */
export function hashEndUserIp(ip?: string | null): string | undefined {
  const canonical = canonicalIp(ip);
  return canonical ? sha256Hex(canonical) : undefined;
}

let cachedSignV2Key: { pem: string; key: crypto.KeyObject } | undefined;

/**
 * The Ed25519 private key, from ONRAMPER_SIGN_V2_PRIVATE_KEY or
 * config.keys.onramperSignV2 (config/onrampersecrets.ts). PEM; literal "\n"
 * sequences are accepted so it fits in a single-line env var.
 */
function signV2Key(): crypto.KeyObject {
  const pem = (
    process.env.ONRAMPER_SIGN_V2_PRIVATE_KEY ||
    config.keys.onramperSignV2 ||
    ''
  )
    .replace(/\\n/g, '\n')
    .trim();
  if (!pem) {
    throw new Error('Onramper Signature V2 private key is not configured');
  }
  if (cachedSignV2Key?.pem !== pem) {
    cachedSignV2Key = { pem, key: crypto.createPrivateKey(pem) };
  }
  return cachedSignV2Key.key;
}

/** Signature V2 parameters for a widget URL whose parameters are `fields`. */
function signWidgetFieldsV2(
  fields: Record<string, string>,
  now: Date,
  nonce: string,
): Record<string, string> {
  const canonical = new URLSearchParams(fields);
  canonical.sort();
  const timestamp = now.toISOString();
  const content = [
    SIG_V2_VERSION,
    timestamp,
    nonce,
    'GET', // always GET for widget URLs
    '/', // always the root path for widget URLs
    canonical.toString(),
    '', // no signed headers for widget URLs
    EMPTY_BODY_SHA256, // no body for widget URLs
  ].join('\n');
  const signature = crypto.sign(null, Buffer.from(content), signV2Key());
  return {
    sigV2: `v2:${signature.toString('base64')}`,
    sigV2Timestamp: timestamp,
    sigV2Nonce: nonce,
    sigV2Expiry: new Date(now.getTime() + WIDGET_SIG_V2_TTL_MS).toISOString(),
    sigV2Fields: Object.keys(fields).sort().join(','),
  };
}

/** Builds the signed Onramper widget URL for SSP Wallet's iframe. */
export function buildWidgetUrl(
  input: OnramperWidgetInput,
  options: WidgetUrlOptions = {},
): string {
  const { apiKey, widgetEndpoint } = onramperConfig();
  const { network, asset, address, theme } = input;
  const isDark = theme === 'dark';
  const themeName = isDark ? 'dark' : 'light';
  const containerColor = isDark ? '1a1918' : 'ffffff';
  const networkWallets = `${network}:${address}`;
  const version = options.version ?? configuredSignatureVersion();

  if (version === 'v2') {
    const fields: Record<string, string> = {
      onlyCryptoNetworks: network,
      mode: 'buy,sell',
      defaultCrypto: asset,
      sell_onlyCryptoNetworks: network,
      sell_defaultCrypto: asset,
      apiKey,
      successRedirectUrl: SUCCESS_REDIRECT,
      failureRedirectUrl: FAILURE_REDIRECT,
      themeName,
      containerColor,
      borderRadius: '0',
      wgBorderRadius: '0',
      networkWallets,
    };
    const endUserIpHash = hashEndUserIp(options.endUserIp);
    if (endUserIpHash) {
      fields.endUserIpHash = endUserIpHash;
    }
    const signed = signWidgetFieldsV2(
      fields,
      options.now ?? new Date(),
      options.nonce ?? crypto.randomUUID(),
    );
    return `${widgetEndpoint}?${new URLSearchParams({ ...fields, ...signed }).toString()}`;
  }

  // V1: byte-for-byte the URL SSP Wallet built itself before this endpoint.
  const signature = generateSignature(`networkWallets=${networkWallets}`);
  return (
    `${widgetEndpoint}?onlyCryptoNetworks=${network}&mode=buy,sell&defaultCrypto=${asset}` +
    `&sell_onlyCryptoNetworks=${network}&sell_defaultCrypto=${asset}&apiKey=${apiKey}` +
    `&successRedirectUrl=${encodeURIComponent(SUCCESS_REDIRECT)}&failureRedirectUrl=${encodeURIComponent(FAILURE_REDIRECT)}` +
    `&themeName=${themeName}&containerColor=${containerColor}&borderRadius=0&wgBorderRadius=0` +
    `&networkWallets=${networkWallets}&signature=${signature}`
  );
}
