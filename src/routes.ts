import config from 'config';
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
  app.get('/v1/enterprise/organizations/:id/vaults/:vaultId', (req, res) => {
    enterpriseApi.getVault(req, res);
  });
  app.patch('/v1/enterprise/organizations/:id/vaults/:vaultId', (req, res) => {
    enterpriseApi.patchVault(req, res);
  });
  app.delete('/v1/enterprise/organizations/:id/vaults/:vaultId', (req, res) => {
    enterpriseApi.deleteVault(req, res);
  });

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
};
