/**
 * Enterprise Hooks for SSP Relay
 *
 * Provides extension points for optional enterprise module.
 * If no enterprise module is installed, all hooks are no-ops.
 */

import log from '../lib/log';
import {
  verifyBitcoinSignature,
  deriveP2PKHAddress,
  deriveP2WSHAddress,
  parseWitnessScript,
} from '../lib/identityAuth';

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

// Auth functions interface
interface AuthFunctions {
  verifyBitcoinSignature: (message: string, signature: string, address: string) => boolean;
  deriveP2PKHAddress: (publicKeyHex: string, network: 'mainnet' | 'testnet') => string;
  deriveP2WSHAddress: (witnessScriptHex: string, network: 'mainnet' | 'testnet') => string;
  parseWitnessScript: (witnessScriptHex: string) => { m: number; n: number; publicKeys: string[] };
}

// Enterprise auth response types
interface LoginResponse {
  success: boolean;
  sessionToken?: string;
  expiresAt?: string;
  user?: { wkIdentity: string; pulseEmail?: string };
  error?: string;
  errorCode?: string;
}

interface SessionResponse {
  valid: boolean;
  user?: { wkIdentity: string; pulseEmail?: string };
  expiresAt?: string;
}

interface ChallengeResponse {
  message: string;
  expiresAt: string;
}

// Generic hook interface
interface HooksModule {
  init: (deps: {
    db: unknown;
    config: unknown;
    logger: unknown;
    ratesService: RatesService;
    authFunctions?: AuthFunctions;
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
  // SSP Pulse functions (all processing handled in enterprise module)
  pulseSubscribe?: (req: unknown, data: unknown) => Promise<unknown>;
  pulseUnsubscribe?: (req: unknown, data: unknown) => Promise<unknown>;
  pulseGetStatus?: (req: unknown, wkIdentity: string) => Promise<unknown>;
  // Enterprise auth functions (all processing handled in enterprise module)
  enterpriseGetChallenge?: (req: unknown) => Promise<ChallengeResponse>;
  enterpriseLogin?: (req: unknown) => Promise<LoginResponse>;
  enterpriseValidateSession?: (req: unknown) => Promise<SessionResponse>;
  enterpriseLogout?: (req: unknown) => Promise<{ success: boolean }>;
  enterpriseGetUser?: (wkIdentity: string) => Promise<unknown>;
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
  pulseSubscribe: async () => null,
  pulseUnsubscribe: async () => null,
  pulseGetStatus: async () => null,
  enterpriseGetChallenge: async () => { throw new Error('Enterprise not available'); },
  enterpriseLogin: async () => ({ success: false, error: 'Enterprise not available', errorCode: 'ENTERPRISE_NOT_LOADED' }),
  enterpriseValidateSession: async () => ({ valid: false }),
  enterpriseLogout: async () => ({ success: false }),
  enterpriseGetUser: async () => null,
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
    // @ts-expect-error - module is optional and may not exist
    const ext = await import('../../ssp-relay-enterprise/src/index.ts');
    const module = ext.default;
    if (module && typeof module.init === 'function') {
      hooksModule = module;
      hooksModule.init({
        ...deps,
        logger: log,
        authFunctions: {
          verifyBitcoinSignature,
          deriveP2PKHAddress,
          deriveP2WSHAddress,
          parseWitnessScript,
        },
      });
      log.info('[HOOKS] Extension module loaded');
    }
  } catch (e) {
    // No extension module - this is normal for community edition
    const errCode = (e as NodeJS.ErrnoException).code;
    const errMsg = String(e);
    if (
      errCode !== 'ERR_MODULE_NOT_FOUND' &&
      !errMsg.includes('Cannot find module')
    ) {
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

// SSP Pulse functions (all processing handled in enterprise module)
const pulseSubscribe = (req: unknown, data: unknown) =>
  hooksModule.pulseSubscribe?.(req, data) ?? Promise.resolve(null);

const pulseUnsubscribe = (req: unknown, data: unknown) =>
  hooksModule.pulseUnsubscribe?.(req, data) ?? Promise.resolve(null);

const pulseGetStatus = (req: unknown, wkIdentity: string) =>
  hooksModule.pulseGetStatus?.(req, wkIdentity) ?? Promise.resolve(null);

// Enterprise auth functions (all processing handled in enterprise module)
const enterpriseGetChallenge = (req: unknown) =>
  hooksModule.enterpriseGetChallenge?.(req) ??
  Promise.reject(new Error('Enterprise not available'));

const enterpriseLogin = (req: unknown) =>
  hooksModule.enterpriseLogin?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available', errorCode: 'ENTERPRISE_NOT_LOADED' });

const enterpriseValidateSession = (req: unknown) =>
  hooksModule.enterpriseValidateSession?.(req) ??
  Promise.resolve({ valid: false });

const enterpriseLogout = (req: unknown) =>
  hooksModule.enterpriseLogout?.(req) ??
  Promise.resolve({ success: false });

const enterpriseGetUser = (wkIdentity: string) =>
  hooksModule.enterpriseGetUser?.(wkIdentity) ?? Promise.resolve(null);

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
  pulseSubscribe,
  pulseUnsubscribe,
  pulseGetStatus,
  // Enterprise auth
  enterpriseGetChallenge,
  enterpriseLogin,
  enterpriseValidateSession,
  enterpriseLogout,
  enterpriseGetUser,
};
