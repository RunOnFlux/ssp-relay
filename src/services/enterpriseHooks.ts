/**
 * Enterprise Hooks for SSP Relay
 *
 * Provides extension points for optional enterprise module.
 * If no enterprise module is installed, all hooks are no-ops.
 */

import log from '../lib/log';

// Rates service interface (from ssp-relay)
interface RatesService {
  getRates: () => {
    fiat: Record<string, number>;
    crypto: Record<string, number>;
  };
}

// Nonce submission data
interface NonceSubmission {
  wkIdentity: string;
  source: 'wallet' | 'key';
  chain?: string;
  nonces: Array<{ kPublic: string; kTwoPublic: string }>;
}

// Generic hook interface
interface HooksModule {
  init: (deps: {
    db: unknown;
    config: unknown;
    logger: unknown;
    ratesService: RatesService;
  }) => void;
  onGetSync?: (req: unknown, id: string) => Promise<void>;
  onGetAction?: (req: unknown, id: string) => Promise<void>;
  onSync?: (req: unknown, data: unknown) => Promise<void>;
  onAction?: (req: unknown, data: unknown) => Promise<void>;
  onToken?: (req: unknown, data: unknown) => Promise<void>;
  onNonces?: (req: unknown, data: NonceSubmission) => Promise<void>;
  onSocketJoin?: (
    wkIdentity: string,
    socketType: 'key' | 'wallet',
    socketId: string,
    handshake?: { headers?: Record<string, unknown>; address?: string },
  ) => Promise<void>;
  onSocketLeave?: (
    wkIdentity: string,
    socketType: 'key' | 'wallet',
    socketId: string,
    handshake?: { headers?: Record<string, unknown>; address?: string },
  ) => Promise<void>;
  // Public endpoint hooks (wkIdentity extracted from sspwkid header in enterprise module)
  onRates?: (req: unknown) => Promise<void>;
  onNetworkFees?: (req: unknown) => Promise<void>;
  onTokenInfo?: (req: unknown) => Promise<void>;
  onServices?: (req: unknown) => Promise<void>;
}

// No-op implementation
const noopHooks: HooksModule = {
  init: () => {},
  onGetSync: async () => {},
  onGetAction: async () => {},
  onSync: async () => {},
  onAction: async () => {},
  onToken: async () => {},
  onNonces: async () => {},
  onSocketJoin: async () => {},
  onSocketLeave: async () => {},
  onRates: async () => {},
  onNetworkFees: async () => {},
  onTokenInfo: async () => {},
  onServices: async () => {},
};

let hooksModule: HooksModule = noopHooks;
let loaded = false;

/**
 * Initialize hooks system. Called during startup.
 */
async function init(deps: {
  db: unknown;
  config: unknown;
  ratesService: RatesService;
}): Promise<void> {
  if (loaded) return;
  loaded = true;

  try {
    // Try to load optional extension module directly from submodule path
    // @ts-ignore - module is optional and may not exist
    const ext = await import('../../ssp-relay-enterprise/src/index.ts');
    const module = ext.default;
    if (module && typeof module.init === 'function') {
      hooksModule = module;
      hooksModule.init({ ...deps, logger: log });
      log.info('[HOOKS] Extension module loaded');
    }
  } catch (e) {
    // No extension module - this is normal for community edition
    const errCode = (e as NodeJS.ErrnoException).code;
    const errMsg = String(e);
    if (errCode !== 'ERR_MODULE_NOT_FOUND' && !errMsg.includes('Cannot find module')) {
      log.warn(`[HOOKS] Failed to load extension: ${e}`);
    }
  }
}

// Hook functions - safe to call, will no-op if no extension
const onGetSync = (req: unknown, id: string) =>
  hooksModule.onGetSync?.(req, id) ?? Promise.resolve();

const onGetAction = (req: unknown, id: string) =>
  hooksModule.onGetAction?.(req, id) ?? Promise.resolve();

const onSync = (req: unknown, data: unknown) =>
  hooksModule.onSync?.(req, data) ?? Promise.resolve();

const onAction = (req: unknown, data: unknown) =>
  hooksModule.onAction?.(req, data) ?? Promise.resolve();

const onToken = (req: unknown, data: unknown) =>
  hooksModule.onToken?.(req, data) ?? Promise.resolve();

const onNonces = (req: unknown, data: NonceSubmission) =>
  hooksModule.onNonces?.(req, data) ?? Promise.resolve();

const isLoaded = () => hooksModule !== noopHooks;

const onSocketJoin = (
  wkIdentity: string,
  socketType: 'key' | 'wallet',
  socketId: string,
  handshake?: { headers?: Record<string, unknown>; address?: string },
) =>
  hooksModule.onSocketJoin?.(wkIdentity, socketType, socketId, handshake) ??
  Promise.resolve();

const onSocketLeave = (
  wkIdentity: string,
  socketType: 'key' | 'wallet',
  socketId: string,
  handshake?: { headers?: Record<string, unknown>; address?: string },
) =>
  hooksModule.onSocketLeave?.(wkIdentity, socketType, socketId, handshake) ??
  Promise.resolve();

// Public endpoint hooks (wkIdentity extracted from sspwkid header in enterprise module)
const onRates = (req: unknown) =>
  hooksModule.onRates?.(req) ?? Promise.resolve();

const onNetworkFees = (req: unknown) =>
  hooksModule.onNetworkFees?.(req) ?? Promise.resolve();

const onTokenInfo = (req: unknown) =>
  hooksModule.onTokenInfo?.(req) ?? Promise.resolve();

const onServices = (req: unknown) =>
  hooksModule.onServices?.(req) ?? Promise.resolve();

export default {
  init,
  isLoaded,
  onGetSync,
  onGetAction,
  onSync,
  onAction,
  onToken,
  onNonces,
  onSocketJoin,
  onSocketLeave,
  onRates,
  onNetworkFees,
  onTokenInfo,
  onServices,
};
