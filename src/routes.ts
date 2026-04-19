import config from 'config';
import { rateLimit } from 'express-rate-limit';
import syncApi from './apiServices/syncApi';
import actionApi from './apiServices/actionApi';
import ratesApi from './apiServices/ratesApi';
import ticketsApi from './apiServices/ticketsApi';
import contactApi from './apiServices/contactApi';
import feeService from './services/networkFeesService';
import tokenApi from './apiServices/tokenApi';
import onramperApi from './apiServices/onramperApi';
import noncesApi from './apiServices/noncesApi';
import enterpriseNotificationApi from './apiServices/enterpriseNotificationApi';
import enterpriseApi from './apiServices/enterpriseApi';
import enterpriseHooks from './services/enterpriseHooks';
import log from './lib/log';
import {
  requireAuth,
  optionalWkIdentityAuth,
} from './middleware/authMiddleware';
import { startNonceCacheCleanup } from './lib/identityAuth';

// Tight rate limit for Stripe-calling billing MUTATION endpoints (checkout,
// portal, change-plan, cancel, resume). Each hit triggers a live Stripe API
// call (costs $, counts against Stripe rate limit, fills logs); the global
// 120/30s allows orders of magnitude more than any human UX needs. 10
// req/min per IP is ample for real use (user clicks through a confirmation
// flow) and cheap protection against hijacked sessions or automation abuse.
const billingMutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    status: 'error',
    data: {
      message: 'Too many billing requests. Please wait a minute and try again.',
    },
  },
});

// Read-side limit for preview-plan-change + downgrade-impact. PlanChangeModal
// fetches a fresh preview every time the user picks a different plan in the
// modal, so 10/min would hit the cap during plan exploration and lock the
// user out of their actual change. 30/min is enough for any reasonable UI
// flow while still protecting Stripe's createPreview from abuse.
const billingReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    status: 'error',
    data: { message: 'Too many preview requests. Please wait a moment.' },
  },
});

// Unauthenticated /stripe/prices — purely static data (env vars + tier
// presets, no Stripe API call). Cached aggressively at the HTTP layer so
// in-memory rate limiting is mostly belt-and-suspenders. Higher cap so a
// single proxy IP behind nginx/ALB doesn't saturate the global pool.
const pricingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

// Start nonce cache cleanup on module load
startNonceCacheCleanup();

export default (app) => {
  // return sync data (no auth needed for GET)
  app.get('/v1/sync{/:id}', (req, res) => {
    syncApi.getSync(req, res);
  });
  app.get('/v1/action{/:id}', (req, res) => {
    actionApi.getAction(req, res);
  });

  // post sync data - requires walletIdentity auth (from SSP Key)
  // Note: Using optional auth during transition period
  // TODO: Change to requireAuth('walletIdentity') after clients are updated
  app.post(
    '/v1/sync',
    requireAuth('wkIdentity', { required: false }),
    (req, res) => {
      syncApi.postSync(req, res);
    },
  );

  // post token - requires wkIdentity auth
  // Note: Using optional auth during transition period
  app.post('/v1/token', optionalWkIdentityAuth, (req, res) => {
    syncApi.postToken(req, res);
  });

  // post action data - requires wkIdentity auth
  // Note: Using optional auth during transition period
  app.post('/v1/action', optionalWkIdentityAuth, (req, res) => {
    actionApi.postAction(req, res);
  });

  // post nonces - periodic sync of public nonces from wallet/key
  // Note: Using optional auth during transition period
  app.post('/v1/nonces', optionalWkIdentityAuth, (req, res) => {
    noncesApi.postNonces(req, res);
  });

  // get nonce pool status (no auth — identity is in URL, validation in enterprise module)
  app.get('/v1/nonces/status/:wkIdentity', (req, res) => {
    noncesApi.getNonceStatus(req, res);
  });

  // validate nonces - check if submitted nonces are stored correctly
  app.post('/v1/nonces/validate', optionalWkIdentityAuth, (req, res) => {
    noncesApi.validateNonces(req, res);
  });

  // reconcile nonces - purge server-side orphans not present on device
  app.post('/v1/nonces/reconcile', optionalWkIdentityAuth, (req, res) => {
    noncesApi.reconcileNonces(req, res);
  });

  // rates endpoint
  app.get('/v1/rates', (req, res) => {
    enterpriseHooks.onRates(req).catch((e) => log.error(e));
    ratesApi.getRates(req, res);
  });
  // fees endpoint
  app.get('/v1/networkfees', (req, res) => {
    enterpriseHooks.onNetworkFees(req).catch((e) => log.error(e));
    feeService.networkFees(res);
  });
  // freshdesk ticket
  app.post('/v1/ticket', (req, res) => {
    ticketsApi.postTicket(req, res);
  });
  // contact form
  app.post('/v1/contact', (req, res) => {
    contactApi.postContact(req, res);
  });
  // get known tokens list per chain
  app.get('/v1/known-tokens{/:network}', (req, res) => {
    tokenApi.getKnownTokens(req, res);
  });
  // get token information endpoint
  app.get('/v1/tokeninfo{/:network}{/:address}', (req, res) => {
    enterpriseHooks.onTokenInfo(req).catch((e) => log.error(e));
    tokenApi.getTokenInfo(req, res);
  });
  // get enabled services, used to toggle off on third party features in the app
  app.get('/v1/services', (req, res) => {
    enterpriseHooks.onServices(req).catch((e) => log.error(e));
    res.json(config.services);
  });
  // onramper signing endpoint
  app.post('/v1/sign/onramper', (req, res) => {
    onramperApi.postDataToSign(req, res);
  });

  // SSP Enterprise - notification subscription (requires wkIdentity auth)
  app.post(
    '/v1/enterprise/subscribe',
    requireAuth('wkIdentity'),
    (req, res) => {
      enterpriseNotificationApi.postSubscribe(req, res);
    },
  );
  app.post(
    '/v1/enterprise/unsubscribe',
    requireAuth('wkIdentity'),
    (req, res) => {
      enterpriseNotificationApi.postUnsubscribe(req, res);
    },
  );
  app.post(
    '/v1/enterprise/subscription',
    requireAuth('wkIdentity'),
    (req, res) => {
      enterpriseNotificationApi.getStatus(req, res);
    },
  );

  // SSP Enterprise - Authentication endpoints
  app.get('/v1/enterprise/auth/challenge', (req, res) => {
    enterpriseApi.getChallenge(req, res);
  });
  app.post('/v1/enterprise/auth/wk', (req, res) => {
    enterpriseApi.postLoginWK(req, res);
  });
  app.post('/v1/enterprise/auth/link-wk', (req, res) => {
    enterpriseApi.postLinkWk(req, res);
  });
  app.get('/v1/enterprise/auth/session', (req, res) => {
    enterpriseApi.getSession(req, res);
  });
  app.post('/v1/enterprise/auth/logout', (req, res) => {
    enterpriseApi.postLogout(req, res);
  });
  // Email login endpoints
  app.post('/v1/enterprise/auth/email/request', (req, res) => {
    enterpriseApi.postEmailLoginRequest(req, res);
  });
  app.post('/v1/enterprise/auth/email/verify', (req, res) => {
    enterpriseApi.postEmailLoginVerify(req, res);
  });
  // Google login endpoint
  app.post('/v1/enterprise/auth/google', (req, res) => {
    enterpriseApi.postGoogleLogin(req, res);
  });
  app.post('/v1/enterprise/critical-action/challenge', (req, res) => {
    enterpriseApi.postCriticalActionChallenge(req, res);
  });
  app.post('/v1/enterprise/email', (req, res) => {
    enterpriseApi.postEnterpriseEmail(req, res);
  });
  app.delete('/v1/enterprise/email', (req, res) => {
    enterpriseApi.deleteEnterpriseEmail(req, res);
  });

  // SSP Enterprise - Email verification endpoints
  app.post('/v1/enterprise/email/verify/request', (req, res) => {
    enterpriseApi.postEmailVerifyRequest(req, res);
  });
  app.post('/v1/enterprise/email/verify/confirm', (req, res) => {
    enterpriseApi.postEmailVerifyConfirm(req, res);
  });

  // SSP Enterprise - Profile endpoints
  app.patch('/v1/enterprise/profile', (req, res) => {
    enterpriseApi.patchProfile(req, res);
  });

  // SSP Enterprise - Organization endpoints
  app.post('/v1/enterprise/organizations', (req, res) => {
    enterpriseApi.postOrganization(req, res);
  });
  app.get('/v1/enterprise/organizations', (req, res) => {
    enterpriseApi.getOrganizations(req, res);
  });
  app.get('/v1/enterprise/organizations/:id', (req, res) => {
    enterpriseApi.getOrganization(req, res);
  });
  app.patch('/v1/enterprise/organizations/:id', (req, res) => {
    enterpriseApi.patchOrganization(req, res);
  });
  app.delete('/v1/enterprise/organizations/:id', (req, res) => {
    enterpriseApi.deleteOrganization(req, res);
  });

  // SSP Enterprise - Member endpoints
  app.get('/v1/enterprise/organizations/:id/members', (req, res) => {
    enterpriseApi.getMembers(req, res);
  });
  app.patch('/v1/enterprise/organizations/:id/members/:wkId', (req, res) => {
    enterpriseApi.patchMember(req, res);
  });
  app.delete('/v1/enterprise/organizations/:id/members/:wkId', (req, res) => {
    enterpriseApi.deleteMember(req, res);
  });
  app.get(
    '/v1/enterprise/organizations/:id/members/:memberId/vault-roles',
    (req, res) => {
      enterpriseApi.getMemberVaultRoles(req, res);
    },
  );
  app.post('/v1/enterprise/organizations/:id/leave', (req, res) => {
    enterpriseApi.postLeave(req, res);
  });

  // SSP Enterprise - Organization Invitation endpoints
  app.post('/v1/enterprise/organizations/:id/invitations', (req, res) => {
    enterpriseApi.postOrgInvitation(req, res);
  });
  app.get('/v1/enterprise/organizations/:id/invitations', (req, res) => {
    enterpriseApi.getOrgInvitations(req, res);
  });
  app.delete(
    '/v1/enterprise/organizations/:id/invitations/:invId',
    (req, res) => {
      enterpriseApi.deleteOrgInvitation(req, res);
    },
  );

  // SSP Enterprise - Organization Activity endpoints
  app.get('/v1/enterprise/organizations/:id/audit-logs', (req, res) => {
    enterpriseApi.getOrgAuditLogs(req, res);
  });
  app.get('/v1/enterprise/organizations/:id/audit-logs/stats', (req, res) => {
    enterpriseApi.getOrgAuditStats(req, res);
  });
  app.get('/v1/enterprise/organizations/:id/critical-actions', (req, res) => {
    enterpriseApi.getOrgCriticalActions(req, res);
  });
  app.get('/v1/enterprise/organizations/:id/login-activity', (req, res) => {
    enterpriseApi.getOrgLoginActivity(req, res);
  });

  // SSP Enterprise - User Invitation endpoints
  app.get('/v1/enterprise/invitations', (req, res) => {
    enterpriseApi.getMyInvitations(req, res);
  });
  app.post('/v1/enterprise/invitations/:invId/accept', (req, res) => {
    enterpriseApi.postAcceptInvitation(req, res);
  });
  app.post('/v1/enterprise/invitations/:invId/reject', (req, res) => {
    enterpriseApi.postRejectInvitation(req, res);
  });

  // SSP Enterprise - Contact endpoints
  app.get('/v1/enterprise/organizations/:id/contacts', (req, res) => {
    enterpriseApi.getOrgContacts(req, res);
  });
  app.post('/v1/enterprise/organizations/:id/contacts', (req, res) => {
    enterpriseApi.postOrgContact(req, res);
  });
  app.put(
    '/v1/enterprise/organizations/:id/contacts/:contactId',
    (req, res) => {
      enterpriseApi.putOrgContact(req, res);
    },
  );
  app.delete(
    '/v1/enterprise/organizations/:id/contacts/:contactId',
    (req, res) => {
      enterpriseApi.deleteOrgContact(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/contacts/record-usage',
    (req, res) => {
      enterpriseApi.postOrgContactRecordUsage(req, res);
    },
  );

  // SSP Enterprise - Vault endpoints
  app.post('/v1/enterprise/organizations/:id/vaults', (req, res) => {
    enterpriseApi.postVault(req, res);
  });
  app.get('/v1/enterprise/organizations/:id/vaults', (req, res) => {
    enterpriseApi.getVaults(req, res);
  });
  app.get('/v1/enterprise/organizations/:id/vault-tags', (req, res) => {
    enterpriseApi.getVaultTags(req, res);
  });
  app.post('/v1/enterprise/organizations/:id/vault-tags', (req, res) => {
    enterpriseApi.postVaultTag(req, res);
  });
  app.patch(
    '/v1/enterprise/organizations/:id/vault-tags/:tagId',
    (req, res) => {
      enterpriseApi.patchVaultTag(req, res);
    },
  );
  app.delete(
    '/v1/enterprise/organizations/:id/vault-tags/:tagId',
    (req, res) => {
      enterpriseApi.deleteVaultTag(req, res);
    },
  );
  app.get('/v1/enterprise/organizations/:id/vaults/search', (req, res) => {
    enterpriseApi.getVaultSearch(req, res);
  });
  app.get('/v1/enterprise/organizations/:id/vaults/:vaultId', (req, res) => {
    enterpriseApi.getVault(req, res);
  });
  app.patch('/v1/enterprise/organizations/:id/vaults/:vaultId', (req, res) => {
    enterpriseApi.patchVault(req, res);
  });
  app.delete('/v1/enterprise/organizations/:id/vaults/:vaultId', (req, res) => {
    enterpriseApi.deleteVault(req, res);
  });
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/unarchive',
    (req, res) => {
      enterpriseApi.unarchiveVault(req, res);
    },
  );

  // Vault members
  app.get(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/members',
    (req, res) => {
      enterpriseApi.getVaultMembers(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/members',
    (req, res) => {
      enterpriseApi.postVaultMember(req, res);
    },
  );
  app.delete(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/members/:memberId',
    (req, res) => {
      enterpriseApi.deleteVaultMember(req, res);
    },
  );

  // Vault xpub provisioning
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/xpub',
    (req, res) => {
      enterpriseApi.postVaultXpub(req, res);
    },
  );
  app.get('/v1/enterprise/vaults/pending-setup', (req, res) => {
    enterpriseApi.getVaultPendingSetups(req, res);
  });

  // Vault addresses
  app.get(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/addresses',
    (req, res) => {
      enterpriseApi.getVaultAddresses(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/addresses',
    (req, res) => {
      enterpriseApi.postVaultAddress(req, res);
    },
  );
  app.patch(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/addresses/:idx',
    (req, res) => {
      enterpriseApi.patchVaultAddress(req, res);
    },
  );

  // Vault balances & transactions
  app.get(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/balances',
    (req, res) => {
      enterpriseApi.getVaultBalances(req, res);
    },
  );
  app.get(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/transactions',
    (req, res) => {
      enterpriseApi.getVaultTransactions(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/sync',
    (req, res) => {
      enterpriseApi.postVaultSync(req, res);
    },
  );
  app.get(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/balance-history',
    (req, res) => {
      enterpriseApi.getVaultBalanceHistory(req, res);
    },
  );

  // Vault proposals
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/proposals/estimate-fee',
    (req, res) => {
      enterpriseApi.postVaultProposalEstimateFee(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/proposals/preview-policy',
    (req, res) => {
      enterpriseApi.postVaultProposalPreviewPolicy(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/proposals',
    (req, res) => {
      enterpriseApi.postVaultProposal(req, res);
    },
  );
  app.get(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/proposals',
    (req, res) => {
      enterpriseApi.getVaultProposals(req, res);
    },
  );
  app.get(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/proposals/:proposalId',
    (req, res) => {
      enterpriseApi.getVaultProposal(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/proposals/:proposalId/sign',
    (req, res) => {
      enterpriseApi.postVaultProposalSign(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/proposals/:proposalId/reject',
    (req, res) => {
      enterpriseApi.postVaultProposalReject(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/proposals/:proposalId/cancel',
    (req, res) => {
      enterpriseApi.postVaultProposalCancel(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/proposals/:proposalId/retry-broadcast',
    (req, res) => {
      enterpriseApi.postVaultProposalRetryBroadcast(req, res);
    },
  );

  // Vault audit
  app.get(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/audit',
    (req, res) => {
      enterpriseApi.getVaultAuditLog(req, res);
    },
  );

  // Organization-wide vault audit
  app.get('/v1/enterprise/organizations/:id/vault-audit', (req, res) => {
    enterpriseApi.getOrgVaultAuditLog(req, res);
  });

  // Vault watched tokens
  app.get(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/tokens',
    (req, res) => {
      enterpriseApi.getVaultWatchedTokens(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/tokens',
    (req, res) => {
      enterpriseApi.postVaultWatchedToken(req, res);
    },
  );
  app.delete(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/tokens/:contract',
    (req, res) => {
      enterpriseApi.deleteVaultWatchedToken(req, res);
    },
  );

  // Token threat detection
  app.get('/v1/enterprise/organizations/:id/token-threats', (req, res) => {
    enterpriseApi.getOrgTokenThreats(req, res);
  });
  app.get(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/token-threats',
    (req, res) => {
      enterpriseApi.getTokenThreats(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/token-threats/override',
    (req, res) => {
      enterpriseApi.postTokenThreatOverride(req, res);
    },
  );
  app.delete(
    '/v1/enterprise/organizations/:id/token-threats/override/:chain/:contract',
    (req, res) => {
      enterpriseApi.deleteTokenThreatOverride(req, res);
    },
  );
  // Token threat backfill is triggered automatically on startup and by background job.
  // Admin dashboard can call tokenThreatBackfill directly if manual trigger is needed.

  // Transaction spam flagging
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/transactions/:txId/spam-flag',
    (req, res) => {
      enterpriseApi.postTxFlagSpam(req, res);
    },
  );
  app.delete(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/transactions/:txId/spam-flag',
    (req, res) => {
      enterpriseApi.deleteTxFlagSpam(req, res);
    },
  );
  app.get(
    '/v1/enterprise/organizations/:id/flagged-transactions',
    (req, res) => {
      enterpriseApi.getFlaggedTransactions(req, res);
    },
  );

  // Address flagging
  app.post('/v1/enterprise/organizations/:id/flagged-addresses', (req, res) => {
    enterpriseApi.postAddressFlag(req, res);
  });
  app.delete(
    '/v1/enterprise/organizations/:id/flagged-addresses/:address',
    (req, res) => {
      enterpriseApi.deleteAddressFlag(req, res);
    },
  );
  app.get('/v1/enterprise/organizations/:id/flagged-addresses', (req, res) => {
    enterpriseApi.getAddressFlags(req, res);
  });

  // Vault proposal admin approval
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/proposals/:proposalId/admin-approve',
    (req, res) => {
      enterpriseApi.postVaultProposalAdminApprove(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/proposals/:proposalId/admin-reject',
    (req, res) => {
      enterpriseApi.postVaultProposalAdminReject(req, res);
    },
  );

  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/proposals/:proposalId/cancel-timelock',
    (req, res) => {
      enterpriseApi.postVaultProposalCancelTimeLock(req, res);
    },
  );

  // Vault freeze/unfreeze (critical actions)
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/freeze',
    (req, res) => {
      enterpriseApi.postVaultFreeze(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/unfreeze',
    (req, res) => {
      enterpriseApi.postVaultUnfreeze(req, res);
    },
  );

  // Vault member role management (critical actions)
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/members/:wkIdentity/promote',
    (req, res) => {
      enterpriseApi.postVaultMemberPromote(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/members/:wkIdentity/demote',
    (req, res) => {
      enterpriseApi.postVaultMemberDemote(req, res);
    },
  );

  // Vault spending policies
  app.get(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/policy',
    (req, res) => {
      enterpriseApi.getVaultPolicy(req, res);
    },
  );
  app.put(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/policy',
    (req, res) => {
      enterpriseApi.putVaultPolicy(req, res);
    },
  );
  app.put(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/policy/whitelist-mode',
    (req, res) => {
      enterpriseApi.putVaultPolicyWhitelistMode(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/policy/whitelist',
    (req, res) => {
      enterpriseApi.postVaultPolicyWhitelist(req, res);
    },
  );
  app.delete(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/policy/whitelist/:address',
    (req, res) => {
      enterpriseApi.deleteVaultPolicyWhitelist(req, res);
    },
  );
  app.get(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/policy/velocity',
    (req, res) => {
      enterpriseApi.getVaultPolicyVelocity(req, res);
    },
  );
  app.get(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/effective-limits',
    (req, res) => {
      enterpriseApi.getVaultEffectiveLimits(req, res);
    },
  );

  // Organization-level default policies
  app.get('/v1/enterprise/organizations/:id/policy', (req, res) => {
    enterpriseApi.getOrgPolicy(req, res);
  });
  app.put('/v1/enterprise/organizations/:id/policy', (req, res) => {
    enterpriseApi.putOrgPolicy(req, res);
  });
  app.get(
    '/v1/enterprise/organizations/:id/policy/chain/:chain',
    (req, res) => {
      enterpriseApi.getOrgChainPolicy(req, res);
    },
  );
  app.put(
    '/v1/enterprise/organizations/:id/policy/chain/:chain',
    (req, res) => {
      enterpriseApi.putOrgChainPolicy(req, res);
    },
  );
  app.delete(
    '/v1/enterprise/organizations/:id/policy/chain/:chain',
    (req, res) => {
      enterpriseApi.deleteOrgChainPolicy(req, res);
    },
  );

  // SSP Enterprise - Signing Requests
  app.get('/v1/enterprise/organizations/:id/signing-requests', (req, res) => {
    enterpriseApi.getSigningRequests(req, res);
  });

  // SSP Enterprise - Analytics
  app.get('/v1/enterprise/organizations/:id/analytics/summary', (req, res) => {
    enterpriseApi.getAnalyticsSummary(req, res);
  });
  app.get(
    '/v1/enterprise/organizations/:id/analytics/performance',
    (req, res) => {
      enterpriseApi.getAnalyticsPerformance(req, res);
    },
  );
  app.get('/v1/enterprise/organizations/:id/analytics/risk', (req, res) => {
    enterpriseApi.getAnalyticsRisk(req, res);
  });
  app.get('/v1/enterprise/organizations/:id/analytics/flows', (req, res) => {
    enterpriseApi.getAnalyticsFlows(req, res);
  });
  app.get(
    '/v1/enterprise/organizations/:id/analytics/cost-basis',
    (req, res) => {
      enterpriseApi.getAnalyticsCostBasis(req, res);
    },
  );
  // SSP Enterprise - Price History
  app.get('/v1/enterprise/rates/history', (req, res) => {
    enterpriseApi.getPriceHistory(req, res);
  });

  // SSP Enterprise - Flux Nodes
  app.get('/v1/enterprise/organizations/:id/flux-nodes', (req, res) => {
    enterpriseApi.getFluxNodes(req, res);
  });
  app.get('/v1/enterprise/organizations/:id/flux-nodes/summary', (req, res) => {
    enterpriseApi.getFluxNodeSummary(req, res);
  });
  app.post('/v1/enterprise/organizations/:id/flux-nodes', (req, res) => {
    enterpriseApi.postFluxNode(req, res);
  });
  app.post(
    '/v1/enterprise/organizations/:id/flux-nodes/refresh',
    (req, res) => {
      enterpriseApi.postFluxNodeRefresh(req, res);
    },
  );
  app.get('/v1/enterprise/organizations/:id/flux-nodes/:nodeId', (req, res) => {
    enterpriseApi.getFluxNode(req, res);
  });
  app.patch(
    '/v1/enterprise/organizations/:id/flux-nodes/:nodeId',
    (req, res) => {
      enterpriseApi.patchFluxNode(req, res);
    },
  );
  app.delete(
    '/v1/enterprise/organizations/:id/flux-nodes/:nodeId',
    (req, res) => {
      enterpriseApi.deleteFluxNode(req, res);
    },
  );
  app.get(
    '/v1/enterprise/organizations/:id/flux-nodes/:nodeId/start-params',
    (req, res) => {
      enterpriseApi.getFluxNodeStartParams(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/flux-nodes/:nodeId/started',
    (req, res) => {
      enterpriseApi.postFluxNodeStarted(req, res);
    },
  );

  // Vault UTXOs for node registration
  app.get(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/node-utxos',
    (req, res) => {
      enterpriseApi.getFluxNodeVaultUtxos(req, res);
    },
  );

  // Vault-level delegates
  app.get(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/delegates',
    (req, res) => {
      enterpriseApi.getVaultDelegates(req, res);
    },
  );
  app.put(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/delegates',
    (req, res) => {
      enterpriseApi.putVaultDelegates(req, res);
    },
  );

  // Subscription & Entitlements
  app.get('/v1/enterprise/organizations/:id/entitlements', (req, res) => {
    enterpriseApi.getOrgEntitlements(req, res);
  });
  app.get('/v1/enterprise/organizations/:id/subscription', (req, res) => {
    enterpriseApi.getOrgSubscription(req, res);
  });
  app.get('/v1/enterprise/organizations/:id/invoices', (req, res) => {
    enterpriseApi.getOrgInvoices(req, res);
  });
  app.get(
    '/v1/enterprise/organizations/:id/invoices/:invoiceId',
    (req, res) => {
      enterpriseApi.getOrgInvoice(req, res);
    },
  );

  // Stripe — pricing (public, no auth). Static data (env vars + tier
  // presets); set HTTP cache so CDN / browser absorbs most reads and the
  // origin only sees fresh fetches every 5 min.
  app.get('/v1/enterprise/stripe/prices', pricingLimiter, (req, res) => {
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    enterpriseApi.getStripePrices(req, res);
  });

  // Stripe — checkout & portal (authenticated, owner only)
  app.post(
    '/v1/enterprise/organizations/:id/checkout',
    billingMutationLimiter,
    (req, res) => {
      enterpriseApi.postStripeCheckout(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/portal',
    billingMutationLimiter,
    (req, res) => {
      enterpriseApi.postStripePortal(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/change-plan',
    billingMutationLimiter,
    (req, res) => {
      enterpriseApi.postStripeChangePlan(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/preview-plan-change',
    billingReadLimiter,
    (req, res) => {
      enterpriseApi.postStripePreviewPlanChange(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/cancel-subscription',
    billingMutationLimiter,
    (req, res) => {
      enterpriseApi.postStripeCancelSubscription(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/resume-subscription',
    billingMutationLimiter,
    (req, res) => {
      enterpriseApi.postStripeResumeSubscription(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/cancel-pending-downgrade',
    billingMutationLimiter,
    (req, res) => {
      enterpriseApi.postStripeCancelPendingDowngrade(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/downgrade-impact',
    billingReadLimiter,
    (req, res) => {
      enterpriseApi.postDowngradeImpact(req, res);
    },
  );

  // Stripe webhook is registered in server.ts BEFORE JSON body parser
  // (Stripe needs raw body for signature verification)
};
