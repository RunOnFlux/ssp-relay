/**
 * Enterprise Hooks for SSP Relay
 *
 * Provides extension points for optional enterprise module.
 * If no enterprise module is installed, all hooks are no-ops.
 */

import log from '../lib/log';

// Rates service interface (from ssp-relay)
interface RatesService {
  getRates: () => { fiat: Record<string, number>; crypto: Record<string, number> };
}

// Generic hook interface
interface HooksModule {
  init: (deps: { db: unknown; config: unknown; logger: unknown; ratesService: RatesService }) => void;
  onGetSync?: (req: unknown, id: string) => Promise<void>;
  onGetAction?: (req: unknown, id: string) => Promise<void>;
  onSync?: (req: unknown, data: unknown) => Promise<void>;
  onAction?: (req: unknown, data: unknown) => Promise<void>;
  onToken?: (req: unknown, data: unknown) => Promise<void>;
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
}

// No-op implementation
const noopHooks: HooksModule = {
  init: () => {},
  onGetSync: async () => {},
  onGetAction: async () => {},
  onSync: async () => {},
  onAction: async () => {},
  onToken: async () => {},
  onSocketJoin: async () => {},
  onSocketLeave: async () => {},
};

let hooksModule: HooksModule = noopHooks;
let loaded = false;

/**
 * Initialize hooks system. Called during startup.
 */
async function init(deps: { db: unknown; config: unknown; ratesService: RatesService }): Promise<void> {
  if (loaded) return;
  loaded = true;

  try {
    // Try to load optional extension module
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ext = require('ssp-relay-enterprise').default;
    if (ext && typeof ext.init === 'function') {
      hooksModule = ext;
      hooksModule.init({ ...deps, logger: log });
      log.info('[HOOKS] Extension module loaded');
    }
  } catch (e) {
    // No extension module - this is normal for community edition
    if ((e as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') {
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

const onSocketJoin = (
  wkIdentity: string,
  socketType: 'key' | 'wallet',
  socketId: string,
  handshake?: { headers?: Record<string, unknown>; address?: string },
) => hooksModule.onSocketJoin?.(wkIdentity, socketType, socketId, handshake) ?? Promise.resolve();

const onSocketLeave = (
  wkIdentity: string,
  socketType: 'key' | 'wallet',
  socketId: string,
  handshake?: { headers?: Record<string, unknown>; address?: string },
) => hooksModule.onSocketLeave?.(wkIdentity, socketType, socketId, handshake) ?? Promise.resolve();

export default {
  init,
  onGetSync,
  onGetAction,
  onSync,
  onAction,
  onToken,
  onSocketJoin,
  onSocketLeave,
};
