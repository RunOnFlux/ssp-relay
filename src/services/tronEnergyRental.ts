/**
 * Optional 1-hour energy rental for the TRON sponsor origin account S
 * (phase 1 of plan §6.5). Off unless `TRON_ENERGY_RENTAL=catfee`.
 *
 * CatFee REST API (https://docs.catfee.io, "API概览" + OpenAPI api.json,
 * checked 2026-09-29):
 *   - base URL: mainnet https://api.catfee.io, Nile https://nile.catfee.io
 *     (separate accounts and keys per environment);
 *   - every request carries CF-ACCESS-KEY, CF-ACCESS-SIGN and
 *     CF-ACCESS-TIMESTAMP (ISO 8601 UTC with ms, ±30 s);
 *   - CF-ACCESS-SIGN = base64(HMAC-SHA256(secret, timestamp + METHOD +
 *     requestPath)), where requestPath INCLUDES the query string exactly as
 *     sent (one older doc page says otherwise; the overview, the Node example
 *     and the OpenAPI spec all include it, so we do);
 *   - POST /v1/order?quantity&receiver&duration=1h&client_order_id&activate
 *     (quantity ≥ 65,000, duration only "1h", client_order_id ≤ 64 chars and
 *     idempotent: a repeat returns the original order instead of buying again);
 *   - GET /v1/order/{id}; success once confirm_status = DELEGATION_CONFIRMED;
 *   - the body `code` decides success (HTTP is usually 200): 0 ok, 9999 =
 *     unknown, retry with the SAME client_order_id.
 *
 * S is always an activated account, so orders go out with activate=false:
 * CatFee must never charge an activation fee on our behalf.
 */
import { createHmac } from 'crypto';
import log from '../lib/log';
import type { TronChain } from '../types/tron';

export const CATFEE_MIN_QUANTITY = 65_000n;
export const CATFEE_MAX_QUANTITY = 2_000_000n;
export const CATFEE_BASE_URLS: Record<TronChain, string> = {
  tron: 'https://api.catfee.io',
  tronNile: 'https://nile.catfee.io',
};

/** Order states that can never turn into a delegation. */
const CATFEE_FAILED_STATUSES = new Set([
  'DELEGATE_FAIL',
  'INSUFFICIENT_BALANCE',
  'QUANTITY_TOO_HIGH',
  'QUANTITY_TOO_LOW',
  'ADDRESS_NOT_ACTIVATED',
  'INVALID_ADDRESS',
]);

export interface EnergyRentalProvider {
  readonly name: string;
  /**
   * Rent at least `quantity` energy delegated to `receiver` for one hour.
   * Resolves once the delegation is confirmed on-chain; throws otherwise.
   * `clientOrderId` makes retries idempotent.
   */
  rent(p: {
    receiver: string;
    quantity: bigint;
    clientOrderId: string;
  }): Promise<{ orderId: string }>;
}

export type HttpFetch = (
  url: string,
  init: {
    method: 'GET' | 'POST';
    headers: Record<string, string>;
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface CatFeeOptions {
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
  fetchImpl?: HttpFetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface CatFeeOrder {
  id: string;
  status: string | null;
  confirmStatus: string | null;
}

/** base64(HMAC-SHA256(secret, timestamp + METHOD + requestPath)). */
export function catFeeSignature(
  secret: string,
  timestamp: string,
  method: string,
  requestPath: string,
): string {
  return createHmac('sha256', secret)
    .update(timestamp + method.toUpperCase() + requestPath, 'utf8')
    .digest('base64');
}

export function isValidClientOrderId(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);
}

/** The exact path (and query order) that is both signed and requested. */
export function buildCatFeeOrderPath(p: {
  quantity: bigint;
  receiver: string;
  clientOrderId: string;
}): string {
  if (p.quantity < CATFEE_MIN_QUANTITY || p.quantity > CATFEE_MAX_QUANTITY) {
    throw new Error(
      `CatFee quantity must be in [${CATFEE_MIN_QUANTITY}, ${CATFEE_MAX_QUANTITY}]`,
    );
  }
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(p.receiver)) {
    throw new Error('CatFee receiver must be a base58 TRON address');
  }
  if (!isValidClientOrderId(p.clientOrderId)) {
    throw new Error('CatFee client_order_id must be ≤ 64 chars [A-Za-z0-9_-]');
  }
  const query = new URLSearchParams([
    ['quantity', p.quantity.toString()],
    ['receiver', p.receiver],
    ['duration', '1h'],
    ['client_order_id', p.clientOrderId],
    ['activate', 'false'],
  ]);
  return `/v1/order?${query.toString()}`;
}

function parseOrder(data: unknown): CatFeeOrder {
  if (!data || typeof data !== 'object') {
    throw new Error('CatFee response has no order data');
  }
  const d = data as Record<string, unknown>;
  if (typeof d.id !== 'string' || d.id.length === 0) {
    throw new Error('CatFee order has no id');
  }
  return {
    id: d.id,
    status: typeof d.status === 'string' ? d.status : null,
    confirmStatus:
      typeof d.confirm_status === 'string' ? d.confirm_status : null,
  };
}

export class CatFeeClient implements EnergyRentalProvider {
  readonly name = 'catfee';
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: HttpFetch;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;

  constructor(o: CatFeeOptions) {
    if (!o.apiKey || !o.apiSecret) {
      throw new Error('CatFee API key and secret are required');
    }
    if (!/^https:\/\/[^\s/]+$/.test(o.baseUrl)) {
      throw new Error('CatFee base URL must be https://host');
    }
    this.apiKey = o.apiKey;
    this.apiSecret = o.apiSecret;
    this.baseUrl = o.baseUrl;
    this.fetchImpl =
      o.fetchImpl ??
      ((url, init) =>
        fetch(url, {
          ...init,
          signal: init.signal ?? AbortSignal.timeout(15_000),
        }));
    this.now = o.now ?? (() => new Date());
    this.sleep =
      o.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.pollIntervalMs = o.pollIntervalMs ?? 1_500;
    this.timeoutMs = o.timeoutMs ?? 15_000;
  }

  private async request(
    method: 'GET' | 'POST',
    requestPath: string,
  ): Promise<{ code: number; msg: string; data: unknown }> {
    const timestamp = this.now().toISOString();
    const headers = {
      'Content-Type': 'application/json',
      'CF-ACCESS-KEY': this.apiKey,
      'CF-ACCESS-SIGN': catFeeSignature(
        this.apiSecret,
        timestamp,
        method,
        requestPath,
      ),
      'CF-ACCESS-TIMESTAMP': timestamp,
    };
    const res = await this.fetchImpl(this.baseUrl + requestPath, {
      method,
      headers,
    });
    const text = await res.text();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`CatFee HTTP ${res.status}: response is not JSON`);
    }
    const code = typeof body.code === 'number' ? body.code : Number(body.code);
    const msg =
      (typeof body.msg === 'string' && body.msg) ||
      (typeof body.sub_msg === 'string' && body.sub_msg) ||
      '';
    return { code, msg, data: body.data };
  }

  /** POST /v1/order. Retries once on code 9999 / transport errors (same id). */
  async createOrder(p: {
    receiver: string;
    quantity: bigint;
    clientOrderId: string;
  }): Promise<CatFeeOrder> {
    const path = buildCatFeeOrderPath(p);
    let lastError: Error = new Error('CatFee order failed');
    for (let attempt = 0; attempt < 2; attempt++) {
      let r: { code: number; msg: string; data: unknown };
      try {
        r = await this.request('POST', path);
      } catch (e) {
        // Transport error: the order may or may not exist. Retrying with the
        // same client_order_id is safe (idempotent).
        lastError = e as Error;
        continue;
      }
      if (r.code === 0) return parseOrder(r.data);
      lastError = new Error(`CatFee order refused: code=${r.code} ${r.msg}`);
      if (r.code !== 9999) throw lastError;
    }
    throw lastError;
  }

  async getOrder(id: string): Promise<CatFeeOrder> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
      throw new Error('invalid CatFee order id');
    }
    const r = await this.request('GET', `/v1/order/${id}`);
    if (r.code !== 0) {
      throw new Error(`CatFee order lookup failed: code=${r.code} ${r.msg}`);
    }
    return parseOrder(r.data);
  }

  /** Create the order, then poll until the delegation is confirmed. */
  async rent(p: {
    receiver: string;
    quantity: bigint;
    clientOrderId: string;
  }): Promise<{ orderId: string }> {
    let order = await this.createOrder(p);
    const deadline = this.now().getTime() + this.timeoutMs;
    for (;;) {
      if (order.confirmStatus === 'DELEGATION_CONFIRMED') {
        return { orderId: order.id };
      }
      if (
        order.confirmStatus === 'DELEGATION_CONFIRMED_FAIL' ||
        (order.status !== null && CATFEE_FAILED_STATUSES.has(order.status))
      ) {
        throw new Error(
          `CatFee order ${order.id} failed: ${order.status ?? '?'} / ${order.confirmStatus ?? '?'}`,
        );
      }
      if (this.now().getTime() >= deadline) {
        throw new Error(
          `CatFee order ${order.id} not delegated within ${this.timeoutMs} ms (${order.status ?? '?'} / ${order.confirmStatus ?? '?'})`,
        );
      }
      await this.sleep(this.pollIntervalMs);
      order = await this.getOrder(order.id);
    }
  }
}

/**
 * Circuit breaker around any provider: at most `maxPerHour` rentals in a
 * rolling hour per process, so a bug or an abuse pattern can never turn into
 * an unbounded rental bill.
 */
export function withHourlyCap(
  provider: EnergyRentalProvider,
  maxPerHour: number,
  now: () => number = () => Date.now(),
): EnergyRentalProvider {
  const stamps: number[] = [];
  return {
    name: provider.name,
    async rent(p) {
      const t = now();
      while (stamps.length > 0 && stamps[0] <= t - 3_600_000) stamps.shift();
      if (stamps.length >= maxPerHour) {
        throw new Error(
          `energy rental cap reached (${maxPerHour} per hour); refusing to rent more`,
        );
      }
      stamps.push(t);
      return provider.rent(p);
    },
  };
}

/**
 * Provider from the environment, or null (the default: no rentals; the
 * sponsor then refuses when S is short of energy).
 *   TRON_ENERGY_RENTAL=catfee
 *   CATFEE_API_KEY / CATFEE_API_SECRET            (mainnet, api.catfee.io)
 *   CATFEE_NILE_API_KEY / CATFEE_NILE_API_SECRET  (Nile, nile.catfee.io)
 *   TRON_ENERGY_RENTAL_MAX_PER_HOUR (default 30)
 */
export function rentalProviderFromEnv(
  chain: TronChain,
  env: NodeJS.ProcessEnv = process.env,
): EnergyRentalProvider | null {
  const kind = (env.TRON_ENERGY_RENTAL ?? '').trim().toLowerCase();
  if (kind === '' || kind === 'none' || kind === 'off') return null;
  if (kind !== 'catfee') {
    log.warn(`[tronSponsor] unknown TRON_ENERGY_RENTAL "${kind}", rentals off`);
    return null;
  }
  const prefix = chain === 'tron' ? 'CATFEE_' : 'CATFEE_NILE_';
  const apiKey = env[`${prefix}API_KEY`];
  const apiSecret = env[`${prefix}API_SECRET`];
  if (!apiKey || !apiSecret) {
    log.warn(
      `[tronSponsor] ${chain}: TRON_ENERGY_RENTAL=catfee but ${prefix}API_KEY / ${prefix}API_SECRET are not set, rentals off`,
    );
    return null;
  }
  const cap = Number(env.TRON_ENERGY_RENTAL_MAX_PER_HOUR ?? 30);
  return withHourlyCap(
    new CatFeeClient({ apiKey, apiSecret, baseUrl: CATFEE_BASE_URLS[chain] }),
    Number.isInteger(cap) && cap > 0 ? cap : 30,
  );
}
