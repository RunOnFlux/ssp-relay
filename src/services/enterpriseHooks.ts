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
import { getKnownTokensForNetwork } from './knownTokens';
import solPaymasterService from './solPaymasterService';

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
    wkIdentity?: string; // Source of truth - required for complete users
    enterpriseEmail?: string; // Optional - convenience for login
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

// Enterprise notification response types
interface EnterpriseSubscribeResponse {
  success: boolean;
  message?: string;
  error?: string;
  errorCode?: string;
}

interface EnterpriseUnsubscribeResponse {
  success: boolean;
  message?: string;
  error?: string;
  errorCode?: string;
}

interface EnterpriseUpdateEmailResponse {
  success: boolean;
  email?: string;
  error?: string;
  errorCode?: string;
}

interface EnterpriseRemoveEmailResponse {
  success: boolean;
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
    getKnownTokens?: (network: string) => Array<{ contract: string }> | null;
    solanaPaymasterBroadcast?: (params: {
      chain: string;
      partialSignedTxBase64: string;
    }) => Promise<{ txid?: string; error?: string }>;
    getSolanaPaymasterContext?: (chain: string) => {
      paymasterPubkey: string;
      minPaymasterFeeLamports: string;
      firstSendLamports: string;
      subsequentSendLamports: string;
      splFeeBumpLamports: string;
      splitPerTxLamports: string;
    } | null;
    solanaCheckAtaExists?: (
      chain: string,
      ataPubkeyBase58: string,
    ) => Promise<boolean>;
    solanaPaymasterSubmitSetupTx?: (params: {
      chain: string;
      partialSignedTxBase64: string;
    }) => Promise<{ signature?: string; error?: string }>;
    // Split-approval flow (§4, §5). Enterprise owns lease state + orchestration;
    // the public layer owns the paymaster keypair + per-kind allowlist.
    solanaPaymasterSubmitSplitTx?: (params: {
      chain: string;
      partialSignedTxBase64: string;
      kind: 'create' | 'approve' | 'execute';
      // Number of member-signed signer txs (designatedSigners.length). The
      // enterprise layer passes this on kind='create' so the public layer can
      // enforce the M-aware reimbursement floor: minReimbursementLamports +
      // splitPerTxLamports × (expectedSignerTxCount + 1). Absent for non-create
      // kinds (and falls back to a conservative minimum when absent).
      expectedSignerTxCount?: number;
    }) => Promise<{
      txid?: string;
      error?: string;
      landed?: boolean;
      // True only when kind='execute' "failed" solely because the on-chain tx
      // was already executed (front-run). close runs separately (§5).
      alreadyExecuted?: boolean;
    }>;
    solanaPaymasterCreatePoolNonce?: (
      chain: string,
    ) => Promise<{ nonceAccount?: string; error?: string }>;
    solanaPaymasterGetNonceValue?: (
      chain: string,
      nonceAccount: string,
    ) => Promise<{ nonceValue?: string; error?: string }>;
  }) => void;
  onGetSync?: (req: unknown, id: string) => Promise<void>;
  onGetAction?: (req: unknown, id: string) => Promise<void>;
  onSync?: (req: unknown, data: unknown) => Promise<void>;
  onAction?: (req: unknown, data: unknown) => Promise<void>;
  onToken?: (req: unknown, data: unknown) => Promise<void>;
  /** @deprecated Use handlePostNonces instead — kept for backwards compat */
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
  enterpriseGetStatus?: (req: unknown, wkIdentity: string) => Promise<unknown>;
  // Enterprise auth functions (all processing handled in enterprise module)
  enterpriseGetChallenge?: (req: unknown) => Promise<ChallengeResponse>;
  enterpriseLogin?: (req: unknown) => Promise<LoginResponse>;
  enterpriseLinkWk?: (req: unknown) => Promise<SimpleResponse>;
  enterpriseValidateSession?: (req: unknown) => Promise<SessionResponse>;
  enterpriseLogout?: (req: unknown) => Promise<{ success: boolean }>;
  enterpriseGetUser?: (wkIdentity: string) => Promise<unknown>;
  enterpriseGetCriticalActionChallenge?: (
    req: unknown,
  ) => Promise<CriticalActionChallengeResponse>;
  // Organization functions - all processing in enterprise module
  organizationCreate?: (req: unknown) => Promise<OrganizationResponse>;
  organizationList?: (req: unknown) => Promise<OrganizationsListResponse>;
  organizationGet?: (req: unknown) => Promise<OrganizationResponse>;
  organizationUpdate?: (req: unknown) => Promise<OrganizationResponse>;
  organizationDelete?: (req: unknown) => Promise<SimpleResponse>;
  organizationMembers?: (req: unknown) => Promise<MembersListResponse>;
  organizationMemberUpdate?: (req: unknown) => Promise<MembershipResponse>;
  organizationMemberRemove?: (req: unknown) => Promise<SimpleResponse>;
  memberVaultRoles?: (req: unknown) => Promise<unknown>;
  organizationLeave?: (req: unknown) => Promise<SimpleResponse>;
  organizationInvitationCreate?: (req: unknown) => Promise<unknown>;
  organizationInvitationList?: (
    req: unknown,
  ) => Promise<InvitationsListResponse>;
  organizationInvitationRevoke?: (req: unknown) => Promise<SimpleResponse>;
  organizationAuditLogs?: (req: unknown) => Promise<SimpleResponse>;
  organizationAuditStats?: (req: unknown) => Promise<SimpleResponse>;
  organizationCriticalActions?: (req: unknown) => Promise<SimpleResponse>;
  organizationLoginActivity?: (req: unknown) => Promise<SimpleResponse>;
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
  profileUpdate?: (req: unknown) => Promise<{
    success: boolean;
    displayName?: string;
    error?: string;
    errorCode?: string;
  }>;
  // Email login functions
  emailLoginRequest?: (req: unknown) => Promise<EmailLoginCodeResponse>;
  emailLoginVerify?: (req: unknown) => Promise<LoginResponse>;
  // Google login functions
  googleLogin?: (req: unknown) => Promise<LoginResponse>;
  // Stripe webhook
  stripeWebhook?: (
    req: unknown,
  ) => Promise<{ success: boolean; error?: string }>;
  // Enterprise notification functions (subscribe/unsubscribe/email with WK signatures)
  enterpriseSubscribe?: (
    req: unknown,
    data: unknown,
  ) => Promise<EnterpriseSubscribeResponse>;
  enterpriseUnsubscribe?: (
    req: unknown,
    data: unknown,
  ) => Promise<EnterpriseUnsubscribeResponse>;
  enterpriseUpdateEmail?: (
    req: unknown,
  ) => Promise<EnterpriseUpdateEmailResponse>;
  enterpriseRemoveEmail?: (
    req: unknown,
  ) => Promise<EnterpriseRemoveEmailResponse>;
  // Nonce pool status for sync enrichment (used by actionApi/syncApi)
  getNoncePoolStatus?: (
    wkIdentity: string,
    source?: 'wallet' | 'key',
  ) => Promise<
    Array<{ source: string; available: number; used: number; total: number }>
  >;
  // Nonce request-level handlers (all validation + logic in enterprise module)
  handlePostNonces?: (req: unknown) => Promise<unknown>;
  handleGetNonceStatus?: (req: unknown) => Promise<unknown>;
  handleValidateNonces?: (req: unknown) => Promise<unknown>;
  handleReconcileNonces?: (req: unknown) => Promise<unknown>;
  // Customer API key management (session-auth, owner/admin)
  apiKeysList?: (req: unknown) => Promise<unknown>;
  apiKeyCreate?: (req: unknown) => Promise<unknown>;
  apiKeyRevoke?: (req: unknown) => Promise<unknown>;
  // Customer READ API key validation (used by the public apiKeyAuth middleware)
  validateApiKey?: (presentedKey: unknown) => Promise<
    | {
        ok: true;
        organizationId: string;
        scopes: string[];
        keyId: string;
        createdBy: string;
      }
    | { ok: false }
  >;
  apiKeyTouch?: (req: unknown) => Promise<{ ok: boolean }>;
  // Sampled, fire-and-forget read-API request telemetry (never blocks request).
  apiKeyLog?: (entry: {
    keyId: string;
    organizationId: string;
    method: string;
    path: string;
    status: number;
    ip?: string;
  }) => void;
  // Per-key usage rollup for the Developers page (session-auth, owner/admin).
  apiKeyUsage?: (req: unknown) => Promise<unknown>;
  // Customer READ API handlers (org derived FROM THE KEY, read-only)
  apiGetOrg?: (req: unknown) => Promise<unknown>;
  apiGetVaults?: (req: unknown) => Promise<unknown>;
  apiGetVault?: (req: unknown) => Promise<unknown>;
  apiGetVaultBalances?: (req: unknown) => Promise<unknown>;
  apiGetVaultTransactions?: (req: unknown) => Promise<unknown>;
  apiGetVaultProposals?: (req: unknown) => Promise<unknown>;
  apiGetVaultProposal?: (req: unknown) => Promise<unknown>;
  apiGetPortfolioAnalytics?: (req: unknown) => Promise<unknown>;
  apiGetContacts?: (req: unknown) => Promise<unknown>;
  apiGetVaultPolicy?: (req: unknown) => Promise<unknown>;
  apiGetVaultPolicyRules?: (req: unknown) => Promise<unknown>;
  apiGetOrgPolicy?: (req: unknown) => Promise<unknown>;
  apiGetOrgPolicyRules?: (req: unknown) => Promise<unknown>;
  apiGetApprovalGroups?: (req: unknown) => Promise<unknown>;
  apiGetPolicyTemplates?: (req: unknown) => Promise<unknown>;
  // WRITE scopes — the only mutations reachable from an API key.
  apiCreateVaultProposal?: (req: unknown) => Promise<unknown>;
  apiCancelVaultProposal?: (req: unknown) => Promise<unknown>;
  apiUpdateVaultPolicy?: (req: unknown) => Promise<unknown>;
  apiCreateVaultPolicyRule?: (req: unknown) => Promise<unknown>;
  apiUpdateVaultPolicyRule?: (req: unknown) => Promise<unknown>;
  apiDeleteVaultPolicyRule?: (req: unknown) => Promise<unknown>;
  apiReorderVaultPolicyRules?: (req: unknown) => Promise<unknown>;
  apiAddVaultWhitelistAddress?: (req: unknown) => Promise<unknown>;
  apiRemoveVaultWhitelistAddress?: (req: unknown) => Promise<unknown>;
  apiUpdateVaultWhitelistMode?: (req: unknown) => Promise<unknown>;
  apiUpdateOrgPolicy?: (req: unknown) => Promise<unknown>;
  apiCreateOrgPolicyRule?: (req: unknown) => Promise<unknown>;
  apiUpdateOrgPolicyRule?: (req: unknown) => Promise<unknown>;
  apiDeleteOrgPolicyRule?: (req: unknown) => Promise<unknown>;
  apiReorderOrgPolicyRules?: (req: unknown) => Promise<unknown>;
  apiUpdateOrgChainPolicy?: (req: unknown) => Promise<unknown>;
  apiDeleteOrgChainPolicy?: (req: unknown) => Promise<unknown>;
  apiCreateApprovalGroup?: (req: unknown) => Promise<unknown>;
  apiUpdateApprovalGroup?: (req: unknown) => Promise<unknown>;
  apiDeleteApprovalGroup?: (req: unknown) => Promise<unknown>;
  apiApplyPolicyTemplate?: (req: unknown) => Promise<unknown>;
  apiCreateVault?: (req: unknown) => Promise<unknown>;
  apiUpdateVault?: (req: unknown) => Promise<unknown>;
  apiCreateVaultTag?: (req: unknown) => Promise<unknown>;
  apiUpdateVaultTag?: (req: unknown) => Promise<unknown>;
  apiDeleteVaultTag?: (req: unknown) => Promise<unknown>;
  apiCreateContact?: (req: unknown) => Promise<unknown>;
  apiUpdateContact?: (req: unknown) => Promise<unknown>;
  apiDeleteContact?: (req: unknown) => Promise<unknown>;
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
  enterpriseGetStatus: async () => null,
  enterpriseGetChallenge: async () => {
    throw new Error('Enterprise not available');
  },
  enterpriseLogin: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  enterpriseLinkWk: async () => ({
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
  memberVaultRoles: async () => ({
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
  // Enterprise notification no-ops
  enterpriseSubscribe: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  enterpriseUnsubscribe: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  enterpriseUpdateEmail: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  enterpriseRemoveEmail: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  getNoncePoolStatus: async () => [],
  // Customer API no-ops
  apiKeysList: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiKeyCreate: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiKeyRevoke: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  validateApiKey: async () => ({ ok: false }),
  apiKeyTouch: async () => ({ ok: false }),
  apiKeyLog: () => {
    /* no-op when enterprise not loaded */
  },
  apiKeyUsage: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiGetOrg: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiGetVaults: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiGetVault: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiGetVaultBalances: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiGetVaultTransactions: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiGetVaultProposals: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiGetVaultProposal: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiGetPortfolioAnalytics: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiGetContacts: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiGetVaultPolicy: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiGetVaultPolicyRules: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiGetOrgPolicy: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiGetOrgPolicyRules: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiGetApprovalGroups: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiGetPolicyTemplates: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiCreateVaultProposal: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiCancelVaultProposal: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiUpdateVaultPolicy: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiCreateVaultPolicyRule: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiUpdateVaultPolicyRule: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiDeleteVaultPolicyRule: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiReorderVaultPolicyRules: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiAddVaultWhitelistAddress: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiRemoveVaultWhitelistAddress: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiUpdateVaultWhitelistMode: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiUpdateOrgPolicy: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiCreateOrgPolicyRule: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiUpdateOrgPolicyRule: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiDeleteOrgPolicyRule: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiReorderOrgPolicyRules: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiUpdateOrgChainPolicy: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiDeleteOrgChainPolicy: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiCreateApprovalGroup: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiUpdateApprovalGroup: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiDeleteApprovalGroup: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiApplyPolicyTemplate: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiCreateVault: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiUpdateVault: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiCreateVaultTag: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiUpdateVaultTag: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiDeleteVaultTag: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiCreateContact: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiUpdateContact: async () => ({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  }),
  apiDeleteContact: async () => ({
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
  coingeckoApiKey?: string;
}): Promise<void> {
  if (loaded) return;
  loaded = true;

  try {
    // Try to load optional extension module directly from submodule path
    // @ts-expect-error - module is optional and may not exist
    const ext = await import('../../ssp-relay-enterprise/src/index.ts');
    // The optional submodule's exported types (e.g. its strict InitDeps.db: Db)
    // must not be imposed on the public HooksModule contract — the public layer
    // intentionally declares looser `unknown` deps. Decouple via an explicit
    // cast so the public type-check stays independent of the submodule's
    // internal signatures (which evolve in parallel).
    const module = ext.default as unknown as HooksModule;
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
        getKnownTokens: getKnownTokensForNetwork,
        // Bridge enterprise's bundled Solana broadcast into the public
        // paymaster service. Enterprise stamps all member ed25519 sigs;
        // here paymaster adds feePayer sig + submits to RPC.
        solanaPaymasterBroadcast: async ({
          chain,
          partialSignedTxBase64,
        }: {
          chain: string;
          partialSignedTxBase64: string;
        }) => {
          try {
            const txid = await solPaymasterService.broadcastWithPaymaster(
              chain,
              partialSignedTxBase64,
            );
            return { txid };
          } catch (e) {
            return { error: (e as Error).message };
          }
        },
        // Resolve paymaster pubkey + fee schedule for create/sign/setup
        // flows. Returns null if the chain has no paymaster configured (env
        // vars missing) so enterprise can surface a clean error.
        // firstSendLamports + buffer is the balance gate enterprise enforces
        // on its setup endpoint to prevent paymaster-drain via setup spam.
        getSolanaPaymasterContext: (chain: string) => {
          try {
            const paymasterPubkey =
              solPaymasterService.getPaymasterPubkey(chain);
            const fee = solPaymasterService.getFeeSchedule();
            return {
              paymasterPubkey,
              minPaymasterFeeLamports: String(fee.minReimbursementLamports),
              firstSendLamports: String(fee.firstSendLamports),
              subsequentSendLamports: String(fee.subsequentSendLamports),
              splFeeBumpLamports: String(fee.splFeeBumpLamports),
              splitPerTxLamports: String(fee.splitPerTxLamports),
            };
          } catch {
            return null;
          }
        },
        // Probe ATA existence on-chain. Enterprise uses this to decide
        // whether to add splFeeBumpLamports to the paymaster reimbursement
        // (when ATA missing, paymaster pays ~2.04M lamports in rent to
        // create it via the bundled outer create-ATA-idempotent ix).
        solanaCheckAtaExists: async (
          chain: string,
          ataPubkeyBase58: string,
        ) => {
          return solPaymasterService.checkAtaExists(chain, ataPubkeyBase58);
        },
        // Sign + submit an enterprise-built setup tx (initialize_multisig +
        // provision_nonce). Enterprise builds the tx, computes PDAs, runs
        // the balance gate, then hands the unsigned blob here. Paymaster
        // key never leaves this public layer. Mirrors
        // solanaPaymasterBroadcast but skips the reimbursement check —
        // setup costs are recovered on the first send via the proposal's
        // own reimbursement transfer.
        solanaPaymasterSubmitSetupTx: async (opts: {
          chain: string;
          partialSignedTxBase64: string;
        }) => {
          try {
            const signature = await solPaymasterService.signAndSubmitSetupTx(
              opts.chain,
              opts.partialSignedTxBase64,
            );
            return { signature };
          } catch (e) {
            return { error: (e as Error).message };
          }
        },
        // Split-approval flow (§5). Enterprise builds + stamps member sigs on
        // each per-signer split tx (create/approve/execute), then hands the
        // partial-signed blob here. The paymaster validates it against the
        // POSITIVE per-kind allowlist (programId + discriminator both bound),
        // adds its feePayer sig, submits + confirms. Returns landed:true on
        // confirmed-with-error so enterprise knows the durable nonce advanced
        // and must rebuild + re-sign. submitSplitTx never throws — it always
        // resolves to { txid } | { error, landed? }.
        solanaPaymasterSubmitSplitTx: async (opts: {
          chain: string;
          partialSignedTxBase64: string;
          kind: 'create' | 'approve' | 'execute';
          expectedSignerTxCount?: number;
        }) => {
          return solPaymasterService.submitSplitTx({
            chain: opts.chain,
            partialSignedTxBase64: opts.partialSignedTxBase64,
            kind: opts.kind,
            expectedSignerTxCount: opts.expectedSignerTxCount,
          });
        },
        // Provision a fresh paymaster-owned durable-nonce account for the pool
        // (§4). Enterprise owns lease state; this just creates the on-chain
        // account (lowest unused ssp-pool-<i> seed, authority = paymaster).
        solanaPaymasterCreatePoolNonce: async (chain: string) => {
          return solPaymasterService.createPoolNonce(chain);
        },
        // Read the current durable-nonce value for a pool account (§4).
        // Enterprise re-fetches this fresh on every (re)build — never reuses a
        // stored value.
        solanaPaymasterGetNonceValue: async (
          chain: string,
          nonceAccount: string,
        ) => {
          return solPaymasterService.getPoolNonceValue(chain, nonceAccount);
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

// Dynamic hook lookup — used by vaultHandler for vault API hooks
const getHook = (hookName: string): unknown =>
  (hooksModule as unknown as Record<string, unknown>)[hookName];

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

const enterpriseLinkWk = (req: unknown) =>
  hooksModule.enterpriseLinkWk?.(req) ??
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

const memberVaultRoles = (req: unknown) =>
  hooksModule.memberVaultRoles?.(req) ??
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

const organizationAuditLogs = (req: unknown) =>
  hooksModule.organizationAuditLogs?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });

const organizationAuditStats = (req: unknown) =>
  hooksModule.organizationAuditStats?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });

const organizationCriticalActions = (req: unknown) =>
  hooksModule.organizationCriticalActions?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });

const organizationLoginActivity = (req: unknown) =>
  hooksModule.organizationLoginActivity?.(req) ??
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

const stripeWebhook = (req: unknown) =>
  hooksModule.stripeWebhook?.(req) ??
  Promise.resolve({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  });

// Enterprise notification functions (subscribe/unsubscribe/email with WK signatures)
const enterpriseSubscribe = (req: unknown, data: unknown) =>
  hooksModule.enterpriseSubscribe?.(req, data) ??
  Promise.resolve({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  });

const enterpriseUnsubscribe = (req: unknown, data: unknown) =>
  hooksModule.enterpriseUnsubscribe?.(req, data) ??
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

const enterpriseRemoveEmail = (req: unknown) =>
  hooksModule.enterpriseRemoveEmail?.(req) ??
  Promise.resolve({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  });

// Nonce pool status
const getNoncePoolStatus = (wkIdentity: string, source?: 'wallet' | 'key') =>
  hooksModule.getNoncePoolStatus?.(wkIdentity, source) ?? Promise.resolve([]);

// Nonce request-level handlers
const handlePostNonces = (req: unknown) =>
  hooksModule.handlePostNonces?.(req) ?? Promise.resolve({ stored: 0 });
const handleGetNonceStatus = (req: unknown) =>
  hooksModule.handleGetNonceStatus?.(req) ?? Promise.resolve({});
const handleValidateNonces = (req: unknown) =>
  hooksModule.handleValidateNonces?.(req) ??
  Promise.resolve({ valid: 0, missing: 0, used: 0 });
const handleReconcileNonces = (req: unknown) =>
  hooksModule.handleReconcileNonces?.(req) ?? Promise.resolve({ purged: 0 });

// Customer API key management (session-auth, owner/admin)
const apiKeysList = (req: unknown) =>
  hooksModule.apiKeysList?.(req) ??
  Promise.resolve({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  });
const apiKeyCreate = (req: unknown) =>
  hooksModule.apiKeyCreate?.(req) ??
  Promise.resolve({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  });
const apiKeyRevoke = (req: unknown) =>
  hooksModule.apiKeyRevoke?.(req) ??
  Promise.resolve({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  });

// Customer READ API key validation + handlers
const validateApiKey = (presentedKey: unknown) =>
  hooksModule.validateApiKey?.(presentedKey) ?? Promise.resolve({ ok: false });
const apiKeyTouch = (req: unknown) =>
  hooksModule.apiKeyTouch?.(req) ?? Promise.resolve({ ok: false });
const apiKeyLog = (entry: {
  keyId: string;
  organizationId: string;
  method: string;
  path: string;
  status: number;
  ip?: string;
}): void => {
  // Fire-and-forget; no-op when enterprise not loaded.
  hooksModule.apiKeyLog?.(entry);
};
const apiKeyUsage = (req: unknown) =>
  hooksModule.apiKeyUsage?.(req) ??
  Promise.resolve({
    success: false,
    error: 'Enterprise not available',
    errorCode: 'ENTERPRISE_NOT_LOADED',
  });
const apiGetOrg = (req: unknown) =>
  hooksModule.apiGetOrg?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiGetVaults = (req: unknown) =>
  hooksModule.apiGetVaults?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiGetVault = (req: unknown) =>
  hooksModule.apiGetVault?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiGetVaultBalances = (req: unknown) =>
  hooksModule.apiGetVaultBalances?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiGetVaultTransactions = (req: unknown) =>
  hooksModule.apiGetVaultTransactions?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiGetVaultProposals = (req: unknown) =>
  hooksModule.apiGetVaultProposals?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiGetVaultProposal = (req: unknown) =>
  hooksModule.apiGetVaultProposal?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiGetPortfolioAnalytics = (req: unknown) =>
  hooksModule.apiGetPortfolioAnalytics?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiGetContacts = (req: unknown) =>
  hooksModule.apiGetContacts?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiGetVaultPolicy = (req: unknown) =>
  hooksModule.apiGetVaultPolicy?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiGetVaultPolicyRules = (req: unknown) =>
  hooksModule.apiGetVaultPolicyRules?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiGetOrgPolicy = (req: unknown) =>
  hooksModule.apiGetOrgPolicy?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiGetOrgPolicyRules = (req: unknown) =>
  hooksModule.apiGetOrgPolicyRules?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiGetApprovalGroups = (req: unknown) =>
  hooksModule.apiGetApprovalGroups?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiGetPolicyTemplates = (req: unknown) =>
  hooksModule.apiGetPolicyTemplates?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiCreateVaultProposal = (req: unknown) =>
  hooksModule.apiCreateVaultProposal?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiCancelVaultProposal = (req: unknown) =>
  hooksModule.apiCancelVaultProposal?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiUpdateVaultPolicy = (req: unknown) =>
  hooksModule.apiUpdateVaultPolicy?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiCreateVaultPolicyRule = (req: unknown) =>
  hooksModule.apiCreateVaultPolicyRule?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiUpdateVaultPolicyRule = (req: unknown) =>
  hooksModule.apiUpdateVaultPolicyRule?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiDeleteVaultPolicyRule = (req: unknown) =>
  hooksModule.apiDeleteVaultPolicyRule?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiReorderVaultPolicyRules = (req: unknown) =>
  hooksModule.apiReorderVaultPolicyRules?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiAddVaultWhitelistAddress = (req: unknown) =>
  hooksModule.apiAddVaultWhitelistAddress?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiRemoveVaultWhitelistAddress = (req: unknown) =>
  hooksModule.apiRemoveVaultWhitelistAddress?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiUpdateVaultWhitelistMode = (req: unknown) =>
  hooksModule.apiUpdateVaultWhitelistMode?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiUpdateOrgPolicy = (req: unknown) =>
  hooksModule.apiUpdateOrgPolicy?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiCreateOrgPolicyRule = (req: unknown) =>
  hooksModule.apiCreateOrgPolicyRule?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiUpdateOrgPolicyRule = (req: unknown) =>
  hooksModule.apiUpdateOrgPolicyRule?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiDeleteOrgPolicyRule = (req: unknown) =>
  hooksModule.apiDeleteOrgPolicyRule?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiReorderOrgPolicyRules = (req: unknown) =>
  hooksModule.apiReorderOrgPolicyRules?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiUpdateOrgChainPolicy = (req: unknown) =>
  hooksModule.apiUpdateOrgChainPolicy?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiDeleteOrgChainPolicy = (req: unknown) =>
  hooksModule.apiDeleteOrgChainPolicy?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiCreateApprovalGroup = (req: unknown) =>
  hooksModule.apiCreateApprovalGroup?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiUpdateApprovalGroup = (req: unknown) =>
  hooksModule.apiUpdateApprovalGroup?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiDeleteApprovalGroup = (req: unknown) =>
  hooksModule.apiDeleteApprovalGroup?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiApplyPolicyTemplate = (req: unknown) =>
  hooksModule.apiApplyPolicyTemplate?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiCreateVault = (req: unknown) =>
  hooksModule.apiCreateVault?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiUpdateVault = (req: unknown) =>
  hooksModule.apiUpdateVault?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiCreateVaultTag = (req: unknown) =>
  hooksModule.apiCreateVaultTag?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiUpdateVaultTag = (req: unknown) =>
  hooksModule.apiUpdateVaultTag?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiDeleteVaultTag = (req: unknown) =>
  hooksModule.apiDeleteVaultTag?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiCreateContact = (req: unknown) =>
  hooksModule.apiCreateContact?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiUpdateContact = (req: unknown) =>
  hooksModule.apiUpdateContact?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });
const apiDeleteContact = (req: unknown) =>
  hooksModule.apiDeleteContact?.(req) ??
  Promise.resolve({ success: false, error: 'Enterprise not available' });

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
  enterpriseGetStatus,
  // Enterprise auth
  enterpriseGetChallenge,
  enterpriseLogin,
  enterpriseLinkWk,
  enterpriseValidateSession,
  enterpriseLogout,
  enterpriseGetUser,
  enterpriseGetCriticalActionChallenge,
  // Organization API
  organizationCreate,
  organizationList,
  organizationGet,
  organizationUpdate,
  organizationDelete,
  organizationMembers,
  organizationMemberUpdate,
  organizationMemberRemove,
  memberVaultRoles,
  organizationLeave,
  organizationInvitationCreate,
  organizationInvitationList,
  organizationInvitationRevoke,
  organizationAuditLogs,
  organizationAuditStats,
  organizationCriticalActions,
  organizationLoginActivity,
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
  // Stripe
  stripeWebhook,
  // Enterprise notification (subscribe/unsubscribe/email)
  enterpriseSubscribe,
  enterpriseUnsubscribe,
  enterpriseUpdateEmail,
  enterpriseRemoveEmail,
  // Nonce pool status (used by actionApi/syncApi for enrichment)
  getNoncePoolStatus,
  // Nonce request-level handlers
  handlePostNonces,
  handleGetNonceStatus,
  handleValidateNonces,
  handleReconcileNonces,
  // Customer API key management
  apiKeysList,
  apiKeyCreate,
  apiKeyRevoke,
  apiKeyUsage,
  // Customer READ API
  validateApiKey,
  apiKeyTouch,
  apiKeyLog,
  apiGetOrg,
  apiGetVaults,
  apiGetVault,
  apiGetVaultBalances,
  apiGetVaultTransactions,
  apiGetVaultProposals,
  apiGetVaultProposal,
  apiGetPortfolioAnalytics,
  apiGetContacts,
  apiGetVaultPolicy,
  apiGetVaultPolicyRules,
  apiGetOrgPolicy,
  apiGetOrgPolicyRules,
  apiGetApprovalGroups,
  apiGetPolicyTemplates,
  apiCreateVaultProposal,
  apiCancelVaultProposal,
  apiUpdateVaultPolicy,
  apiCreateVaultPolicyRule,
  apiUpdateVaultPolicyRule,
  apiDeleteVaultPolicyRule,
  apiReorderVaultPolicyRules,
  apiAddVaultWhitelistAddress,
  apiRemoveVaultWhitelistAddress,
  apiUpdateVaultWhitelistMode,
  apiUpdateOrgPolicy,
  apiCreateOrgPolicyRule,
  apiUpdateOrgPolicyRule,
  apiDeleteOrgPolicyRule,
  apiReorderOrgPolicyRules,
  apiUpdateOrgChainPolicy,
  apiDeleteOrgChainPolicy,
  apiCreateApprovalGroup,
  apiUpdateApprovalGroup,
  apiDeleteApprovalGroup,
  apiApplyPolicyTemplate,
  apiCreateVault,
  apiUpdateVault,
  apiCreateVaultTag,
  apiUpdateVaultTag,
  apiDeleteVaultTag,
  apiCreateContact,
  apiUpdateContact,
  apiDeleteContact,
  // Dynamic hook lookup (used by vault API handlers)
  getHook,
};
