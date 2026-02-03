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
  verifyBitcoinSignature: (
    message: string,
    signature: string,
    address: string,
  ) => boolean;
  deriveP2PKHAddress: (
    publicKeyHex: string,
    network: 'mainnet' | 'testnet',
  ) => string;
  deriveP2WSHAddress: (
    witnessScriptHex: string,
    network: 'mainnet' | 'testnet',
  ) => string;
  parseWitnessScript: (witnessScriptHex: string) => {
    m: number;
    n: number;
    publicKeys: string[];
  };
}

// Account status
// pending_wk = invited via email, needs to set up WK identity (limited access)
// pending_email = has WK identity, no email linked yet (full access)
// complete = has both WK identity and email linked
type AccountStatus = 'pending_wk' | 'pending_email' | 'complete';

// Enterprise auth response types
interface LoginResponse {
  success: boolean;
  sessionToken?: string;
  expiresAt?: string;
  user?: {
    wkIdentity?: string;        // Source of truth - required for complete users
    enterpriseEmail?: string;   // Optional - convenience for login
    displayName?: string;
    accountStatus: AccountStatus;
  };
  error?: string;
  errorCode?: string;
}

interface SessionResponse {
  valid: boolean;
  user?: {
    wkIdentity?: string;
    enterpriseEmail?: string;
    displayName?: string;
    accountStatus: AccountStatus;
  };
  expiresAt?: string;
}

interface ChallengeResponse {
  message: string;
  expiresAt: string;
}

interface CriticalActionChallengeResponse {
  success: boolean;
  message?: string;
  expiresAt?: string;
  error?: string;
  errorCode?: string;
}

// Organization response types
interface OrganizationResponse {
  success: boolean;
  organization?: unknown;
  error?: string;
  errorCode?: string;
}

interface OrganizationsListResponse {
  success: boolean;
  organizations?: unknown[];
  error?: string;
}

interface MembersListResponse {
  success: boolean;
  members?: unknown[];
  error?: string;
}

interface InvitationsListResponse {
  success: boolean;
  invitations?: unknown[];
  error?: string;
}

interface MembershipResponse {
  success: boolean;
  membership?: unknown;
  error?: string;
  errorCode?: string;
}

interface SimpleResponse {
  success: boolean;
  error?: string;
  errorCode?: string;
}

interface EmailVerificationResponse {
  success: boolean;
  message?: string;
  expiresInMinutes?: number;
  remainingCodes?: number;
  remainingAttempts?: number;
  error?: string;
}

interface EmailLoginCodeResponse {
  success: boolean;
  message?: string;
  expiresInMinutes?: number;
  remainingCodes?: number;
  retryAfterSeconds?: number;
  error?: string;
  errorCode?: string;
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
  // SSP Enterprise notification functions (all processing handled in enterprise module)
  enterpriseSubscribe?: (req: unknown, data: unknown) => Promise<unknown>;
  enterpriseUnsubscribe?: (req: unknown, data: unknown) => Promise<unknown>;
  enterpriseGetStatus?: (req: unknown, wkIdentity: string) => Promise<unknown>;
  // Enterprise auth functions (all processing handled in enterprise module)
  enterpriseGetChallenge?: (req: unknown) => Promise<ChallengeResponse>;
  enterpriseLogin?: (req: unknown) => Promise<LoginResponse>;
  enterpriseValidateSession?: (req: unknown) => Promise<SessionResponse>;
  enterpriseLogout?: (req: unknown) => Promise<{ success: boolean }>;
  enterpriseGetUser?: (wkIdentity: string) => Promise<unknown>;
  enterpriseGetCriticalActionChallenge?: (
    req: unknown,
  ) => Promise<CriticalActionChallengeResponse>;
  enterpriseUpdateEmail?: (
    req: unknown,
  ) => Promise<{
    success: boolean;
    email?: string;
    error?: string;
    errorCode?: string;
  }>;
  // Organization functions - all processing in enterprise module
  organizationCreate?: (req: unknown) => Promise<OrganizationResponse>;
  organizationList?: (req: unknown) => Promise<OrganizationsListResponse>;
  organizationGet?: (req: unknown) => Promise<OrganizationResponse>;
  organizationUpdate?: (req: unknown) => Promise<OrganizationResponse>;
  organizationDelete?: (req: unknown) => Promise<SimpleResponse>;
  organizationMembers?: (req: unknown) => Promise<MembersListResponse>;
  organizationMemberUpdate?: (req: unknown) => Promise<MembershipResponse>;
  organizationMemberRemove?: (req: unknown) => Promise<SimpleResponse>;
  organizationLeave?: (req: unknown) => Promise<SimpleResponse>;
  organizationInvitationCreate?: (req: unknown) => Promise<unknown>;
  organizationInvitationList?: (
    req: unknown,
  ) => Promise<InvitationsListResponse>;
  organizationInvitationRevoke?: (req: unknown) => Promise<SimpleResponse>;
  invitationList?: (req: unknown) => Promise<InvitationsListResponse>;
  invitationAccept?: (req: unknown) => Promise<MembershipResponse>;
  invitationReject?: (req: unknown) => Promise<SimpleResponse>;
  // Email verification functions
  emailVerificationRequest?: (
    req: unknown,
  ) => Promise<EmailVerificationResponse>;
  emailVerificationConfirm?: (
    req: unknown,
  ) => Promise<EmailVerificationResponse>;
  // Profile functions
  profileUpdate?: (
    req: unknown,
  ) => Promise<{ success: boolean; displayName?: string; error?: string; errorCode?: string }>;
  // Email login functions
  emailLoginRequest?: (req: unknown) => Promise<EmailLoginCodeResponse>;
  emailLoginVerify?: (req: unknown) => Promise<LoginResponse>;
  // Google login functions
  googleLogin?: (req: unknown) => Promise<LoginResponse>;
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
  enterpriseSubscribe: async () => null,
  enterpriseUnsubscribe: async () => null,
  enterpriseGetStatus: async () => null,
  enterpriseGetChallenge: async () => {
    throw new Error('Enterprise not available');
  },
  enterpriseLogin: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  enterpriseValidateSession: async () => ({ valid: false }),
  enterpriseLogout: async () => ({ success: false }),
  enterpriseGetUser: async () => null,
  enterpriseGetCriticalActionChallenge: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  enterpriseUpdateEmail: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  // Organization no-ops
  organizationCreate: async () => ({
    success: false,
    error: 'Enterprise not available',
  }),
  organizationList: async () => ({
    success: false,
    error: 'Enterprise not available',
  }),
  organizationGet: async () => ({
    success: false,
    error: 'Enterprise not available',
  }),
  organizationUpdate: async () => ({
    success: false,
    error: 'Enterprise not available',
  }),
  organizationDelete: async () => ({
    success: false,
    error: 'Enterprise not available',
  }),
  organizationMembers: async () => ({
    success: false,
    error: 'Enterprise not available',
  }),
  organizationMemberUpdate: async () => ({
    success: false,
    error: 'Enterprise not available',
  }),
  organizationMemberRemove: async () => ({
    success: false,
    error: 'Enterprise not available',
  }),
  organizationLeave: async () => ({
    success: false,
    error: 'Enterprise not available',
  }),
  organizationInvitationCreate: async () => ({
    success: false,
    error: 'Enterprise not available',
  }),
  organizationInvitationList: async () => ({
    success: false,
    error: 'Enterprise not available',
  }),
  organizationInvitationRevoke: async () => ({
    success: false,
    error: 'Enterprise not available',
  }),
  invitationList: async () => ({
    success: false,
    error: 'Enterprise not available',
  }),
  invitationAccept: async () => ({
    success: false,
    error: 'Enterprise not available',
  }),
  invitationReject: async () => ({
    success: false,
    error: 'Enterprise not available',
  }),
  // Email verification no-ops
  emailVerificationRequest: async () => ({
    success: false,
    error: 'Enterprise not available',
  }),
  emailVerificationConfirm: async () => ({
    success: false,
    error: 'Enterprise not available',
  }),
  // Profile no-ops
  profileUpdate: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  // Email login no-ops
  emailLoginRequest: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  emailLoginVerify: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  // Google login no-ops
  googleLogin: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
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

// SSP Enterprise notification functions (all processing handled in enterprise module)
const enterpriseSubscribe = (req: unknown, data: unknown) =>
  hooksModule.enterpriseSubscribe?.(req, data) ?? Promise.resolve(null);

const enterpriseUnsubscribe = (req: unknown, data: unknown) =>
  hooksModule.enterpriseUnsubscribe?.(req, data) ?? Promise.resolve(null);

const enterpriseGetStatus = (req: unknown, wkIdentity: string) =>
  hooksModule.enterpriseGetStatus?.(req, wkIdentity) ?? Promise.resolve(null);

// Enterprise auth functions (all processing handled in enterprise module)
const enterpriseGetChallenge = (req: unknown) =>
  hooksModule.enterpriseGetChallenge?.(req) ??
  Promise.reject(new Error('Enterprise not available'));

const enterpriseLogin = (req: unknown) =>
  hooksModule.enterpriseLogin?.(req) ??
  Promise.resolve({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  });

const enterpriseValidateSession = (req: unknown) =>
  hooksModule.enterpriseValidateSession?.(req) ??
  Promise.resolve({ valid: false });

const enterpriseLogout = (req: unknown) =>
  hooksModule.enterpriseLogout?.(req) ?? Promise.resolve({ success: false });

const enterpriseGetUser = (wkIdentity: string) =>
  hooksModule.enterpriseGetUser?.(wkIdentity) ?? Promise.resolve(null);

const enterpriseGetCriticalActionChallenge = (req: unknown) =>
  hooksModule.enterpriseGetCriticalActionChallenge?.(req) ??
  Promise.resolve({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  });

const enterpriseUpdateEmail = (req: unknown) =>
  hooksModule.enterpriseUpdateEmail?.(req) ??
  Promise.resolve({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  });

// Organization functions - just pass req, all processing in enterprise module
const organizationCreate = (req: unknown) =>
  hooksModule.organizationCreate?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });

const organizationList = (req: unknown) =>
  hooksModule.organizationList?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });

const organizationGet = (req: unknown) =>
  hooksModule.organizationGet?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });

const organizationUpdate = (req: unknown) =>
  hooksModule.organizationUpdate?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });

const organizationDelete = (req: unknown) =>
  hooksModule.organizationDelete?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });

const organizationMembers = (req: unknown) =>
  hooksModule.organizationMembers?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });

const organizationMemberUpdate = (req: unknown) =>
  hooksModule.organizationMemberUpdate?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });

const organizationMemberRemove = (req: unknown) =>
  hooksModule.organizationMemberRemove?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });

const organizationLeave = (req: unknown) =>
  hooksModule.organizationLeave?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });

const organizationInvitationCreate = (req: unknown) =>
  hooksModule.organizationInvitationCreate?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });

const organizationInvitationList = (req: unknown) =>
  hooksModule.organizationInvitationList?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });

const organizationInvitationRevoke = (req: unknown) =>
  hooksModule.organizationInvitationRevoke?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });

const invitationList = (req: unknown) =>
  hooksModule.invitationList?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });

const invitationAccept = (req: unknown) =>
  hooksModule.invitationAccept?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });

const invitationReject = (req: unknown) =>
  hooksModule.invitationReject?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });

// Email verification functions
const emailVerificationRequest = (req: unknown) =>
  hooksModule.emailVerificationRequest?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });

const emailVerificationConfirm = (req: unknown) =>
  hooksModule.emailVerificationConfirm?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });

// Profile functions
const profileUpdate = (req: unknown) =>
  hooksModule.profileUpdate?.(req) ??
  Promise.resolve({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  });

// Email login functions
const emailLoginRequest = (req: unknown) =>
  hooksModule.emailLoginRequest?.(req) ??
  Promise.resolve({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  });

const emailLoginVerify = (req: unknown) =>
  hooksModule.emailLoginVerify?.(req) ??
  Promise.resolve({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  });

const googleLogin = (req: unknown) =>
  hooksModule.googleLogin?.(req) ??
  Promise.resolve({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  });

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
  // Enterprise notification
  enterpriseSubscribe,
  enterpriseUnsubscribe,
  enterpriseGetStatus,
  // Enterprise auth
  enterpriseGetChallenge,
  enterpriseLogin,
  enterpriseValidateSession,
  enterpriseLogout,
  enterpriseGetUser,
  enterpriseGetCriticalActionChallenge,
  enterpriseUpdateEmail,
  // Organization API
  organizationCreate,
  organizationList,
  organizationGet,
  organizationUpdate,
  organizationDelete,
  organizationMembers,
  organizationMemberUpdate,
  organizationMemberRemove,
  organizationLeave,
  organizationInvitationCreate,
  organizationInvitationList,
  organizationInvitationRevoke,
  invitationList,
  invitationAccept,
  invitationReject,
  // Email verification
  emailVerificationRequest,
  emailVerificationConfirm,
  // Profile
  profileUpdate,
  // Email login
  emailLoginRequest,
  emailLoginVerify,
  // Google login
  googleLogin,
};
