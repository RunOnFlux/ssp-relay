import config from 'config';
import { rateLimit } from 'express-rate-limit';
import { clientIpKey } from './lib/clientIp';
import syncApi from './apiServices/syncApi';
import actionApi from './apiServices/actionApi';
import recoveryPubApi from './apiServices/recoveryPubApi';
import ratesApi from './apiServices/ratesApi';
import solPaymasterApi from './apiServices/solPaymasterApi';
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
  requireReadAuth,
  requireWkIdentityAuth,
  requireWkIdentityAuthLegacyGated,
} from './middleware/authMiddleware';
import { isUnsignedRecoveryRequest } from './apiServices/actionApi';
import { apiKeyAuth } from './middleware/apiKeyAuth';
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
  keyGenerator: clientIpKey,
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
  keyGenerator: clientIpKey,
  message: {
    status: 'error',
    data: { message: 'Too many preview requests. Please wait a moment.' },
  },
});

// Notification-subscription TEST endpoint. This triggers an immediate outbound
// POST to a customer-configured webhook/Slack URL, so it is an SSRF / egress
// probe vector (an attacker who can call it repeatedly could use the relay to
// scan or hammer hosts, even though the webhook delivery layer SSRF-guards the
// target). 3/min/IP is far above any legitimate "click Send test" cadence while
// neutering it as an abuse primitive. Mirrors billingMutationLimiter's shape.
const webhookTestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: clientIpKey,
  message: {
    status: 'error',
    data: {
      message: 'Too many test requests. Please wait a minute and try again.',
    },
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
  keyGenerator: clientIpKey,
});

// Solana paymaster broadcast — each request triggers an on-chain Solana
// tx that costs the relay-operator real SOL (paymaster fee). 10/min/IP keeps
// any single user well under the per-tx cost ceiling while allowing normal
// back-to-back sends. The paymaster's real protection is the positive
// instruction allowlist + balance-delta simulation in broadcastWithPaymaster;
// WK auth on the route (RELAY_LEGACY_UNAUTH_MODE-gated) adds attribution.
const solBroadcastLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: clientIpKey,
  message: {
    status: 'error',
    data: {
      message:
        'Too many Solana broadcast requests. Please wait a minute and try again.',
    },
  },
});

// Wallet-recovery requests are the one action posted UNSIGNED (the recovering
// wallet has no keys). Each one pushes an approval prompt to the target's
// SSP Key, so cap them hard per IP. Signed actions skip this limiter.
const unsignedRecoveryLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: clientIpKey,
  skip: (req) => {
    const body = req.body as Record<string, unknown> | undefined;
    return !(
      body &&
      typeof body === 'object' &&
      !body.signature &&
      !body.message &&
      !body.publicKey &&
      body.action === 'recoveryrequest'
    );
  },
  message: {
    status: 'error',
    data: {
      message: 'Too many recovery requests. Please wait and try again.',
    },
  },
});

// …and per target identity, so many IPs cannot flood one person's Key with
// recovery prompts (or keep its action slot busy).
const unsignedRecoveryIdentityLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => {
    const wk = (req.body as Record<string, unknown> | undefined)?.wkIdentity;
    return `recovery:${typeof wk === 'string' ? wk.slice(0, 200) : 'none'}`;
  },
  skip: (req) => {
    const body = req.body as Record<string, unknown> | undefined;
    return !(
      body &&
      typeof body === 'object' &&
      !body.signature &&
      !body.message &&
      !body.publicKey &&
      body.action === 'recoveryrequest'
    );
  },
  message: {
    status: 'error',
    data: {
      message: 'Too many recovery requests for this identity. Please wait.',
    },
  },
});

// Customer READ API (/v1/api/*) — per-KEY token bucket. Keyed by the validated
// `apiKeyId` (attached by apiKeyAuth) so each key gets its own budget rather
// than sharing a per-IP pool (many keys can sit behind one NAT). 60/min sustained
// with a 120 burst matches the design (§5.6) for a read-only polling API. Falls
// back to IP only for the rare pre-auth path (apiKeyAuth runs first, so by here
// apiKeyId is set).
const apiReadKeyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => {
    const keyId = (req as { apiKeyId?: string }).apiKeyId;
    // clientIpKey resolves the real client IP (CF-Connecting-IP first) and
    // normalizes IPv6 to a subnet so v6 clients can't bypass the fallback
    // bucket by rotating addresses within their /64.
    return keyId ? `apikey:${keyId}` : `ip:${clientIpKey(req)}`;
  },
  message: {
    status: 'error',
    data: {
      message: 'API rate limit exceeded. Slow down (60 req/min sustained).',
    },
  },
});

// Customer READ API — global per-IP safety net (independent of the per-key
// bucket) so a single host cannot saturate the relay by rotating many keys.
const apiReadIpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: clientIpKey,
  message: {
    status: 'error',
    data: { message: 'Too many API requests from this IP. Please slow down.' },
  },
});

// Customer WRITE API — per-key limiter, tighter than reads: creating a proposal
// builds an unsigned tx and reserves nonces, so cap it at 30/min per key.
const apiWriteKeyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => {
    const keyId = (req as { apiKeyId?: string }).apiKeyId;
    return keyId ? `apikey:write:${keyId}` : `ip:${clientIpKey(req)}`;
  },
  message: {
    status: 'error',
    data: { message: 'API write rate limit exceeded (30 req/min).' },
  },
});

// Advisory transaction re-simulation (TX_SIMULATION_DESIGN §6, §7.7). Each
// re-simulate may hit an external/self-hosted RPC, so cap it tightly: 6/min,
// keyed by vault + session (Bearer token) so one signer's bursts can't starve
// another, with IP fallback for the rare unauthenticated path. Advisory only —
// hitting the limit never blocks signing (the GET still serves the cached sim).
const simulateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 6,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => {
    const vaultId =
      (req.params as Record<string, string> | undefined)?.vaultId ?? 'unknown';
    const auth = req.headers?.authorization;
    const session =
      typeof auth === 'string' && auth.startsWith('Bearer ')
        ? auth.slice(7)
        : undefined;
    return session
      ? `sim:${vaultId}:${session}`
      : `sim:${vaultId}:ip:${clientIpKey(req)}`;
  },
  message: {
    status: 'error',
    data: {
      message: 'Too many simulation requests. Please wait a minute and retry.',
    },
  },
});

// Pre-create dry-run simulation (preview-simulate). Read-style — no proposal is
// created — so a looser per-vault/session budget than the per-proposal
// re-simulate, matching the debounced NewProposalPage usage.
const previewSimulateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => {
    const vaultId =
      (req.params as Record<string, string> | undefined)?.vaultId ?? 'unknown';
    const auth = req.headers?.authorization;
    const session =
      typeof auth === 'string' && auth.startsWith('Bearer ')
        ? auth.slice(7)
        : undefined;
    return session
      ? `simprev:${vaultId}:${session}`
      : `simprev:${vaultId}:ip:${clientIpKey(req)}`;
  },
  message: {
    status: 'error',
    data: {
      message:
        'Too many preview-simulation requests. Please slow down and retry.',
    },
  },
});

// Public, unauthenticated read of a proposal share link (payment status for
// the payee). The token is a 256-bit secret, so this only bounds scraping and
// load: 60/min per IP is far above a person refreshing a status page (the page
// itself polls every 15-30s).
const publicShareLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: clientIpKey,
  message: {
    status: 'error',
    data: { message: 'Too many requests. Please wait a minute and retry.' },
  },
});

// Start nonce cache cleanup on module load
startNonceCacheCleanup();

// Route-bound signed actions (the `action` inside the signed payload), as the
// clients send them: wallet 2.1.3+/Key 2.1.1+ sign /v1/action, /v1/nonces*,
// /v1/sol/* and /v1/enterprise/* with 'action'; the Key signs /v1/sync with
// 'sync', /v1/token with 'token' and /v1/recoverypub with 'sync'.
const requireSyncAuth = requireAuth('wkIdentity', {
  actions: ['sync'],
  unauthenticated: 'legacy',
});
const requireTokenAuth = requireAuth('wkIdentity', { actions: ['token'] });
const requireRecoveryPubAuth = requireAuth('wkIdentity', {
  actions: ['sync'],
});

export default (app) => {
  // Reads of pending coordination state. Header-signed by the clients
  // (requireReadAuth, action 'read', path-hash bound). RELAY_READ_AUTH_MODE
  // decides whether UNSIGNED reads are still served ('log', default until the
  // new apps reach adoption) or refused ('enforce'). Bad auth is always 401.
  //   /v1/sync/<walletIdentity>  signed by the wallet's identity key
  //   /v1/action/<wkIdentity>    signed by wallet or Key as wkIdentity
  app.get('/v1/sync{/:id}', requireReadAuth('id'), (req, res) => {
    syncApi.getSync(req, res);
  });
  // Under 'enforce' an unsigned read of /v1/action may only return a wallet
  // recovery answer (the recovering wallet has no keys; the answer is
  // encrypted to its ephemeral key). See actionApi.getAction.
  app.get(
    '/v1/action{/:id}',
    requireReadAuth('id', { allowUnsignedRecoveryRead: true }),
    (req, res) => {
      actionApi.getAction(req, res);
    },
  );
  // TRANSITIONAL — remove once adoption allows; see recoveryPubApi.ts.
  // SSP Key's recovery account xpub. Public data (signed by the Key), so the
  // GET stays open; the wallet verifies the stored signature itself.
  app.get('/v1/recoverypub{/:id}', (req, res) => {
    recoveryPubApi.getRecoveryPub(req, res);
  });

  // post sync data — SSP Key signs as wkIdentity; the handler binds the
  // record's walletIdentity to the WK pair. Key 2.1.1 does not sign this yet,
  // so unsigned posts follow RELAY_LEGACY_UNAUTH_MODE (log by default).
  // Signed payload action: 'sync'.
  app.post('/v1/sync', requireSyncAuth, (req, res) => {
    syncApi.postSync(req, res);
  });

  // post FCM token — always signed by SSP Key as wkIdentity (action 'token').
  app.post('/v1/token', requireTokenAuth, (req, res) => {
    syncApi.postToken(req, res);
  });

  // post action data — signed as wkIdentity by wallet and Key. The single
  // by-design exception is the wallet-recovery request (the recovering wallet
  // has no keys); it must match its exact payload shape and is rate-limited.
  app.post(
    '/v1/action',
    unsignedRecoveryLimiter,
    unsignedRecoveryIdentityLimiter,
    requireAuth('wkIdentity', {
      actions: ['action'],
      allowUnauthenticated: isUnsignedRecoveryRequest,
    }),
    (req, res) => {
      actionApi.postAction(req, res);
    },
  );

  // post recovery account xpub (from SSP Key)
  // TRANSITIONAL — remove once adoption allows; see recoveryPubApi.ts.
  // Writes are authenticated: the record is keyed by wkIdentity and only the
  // paired Key may write its own.
  // SSP Key (2.1.1 and later) signs this with payload action 'sync'.
  app.post('/v1/recoverypub', requireRecoveryPubAuth, (req, res) => {
    recoveryPubApi.postRecoveryPub(req, res);
  });

  // Enterprise nonce pools. Signed as wkIdentity; the enterprise module binds
  // body.wkIdentity to req.verifiedIdentity. Released clients do not sign
  // these yet, so unsigned posts follow RELAY_LEGACY_UNAUTH_MODE.
  app.post('/v1/nonces', requireWkIdentityAuthLegacyGated, (req, res) => {
    noncesApi.postNonces(req, res);
  });

  // nonce pool status — header-signed read (RELAY_READ_AUTH_MODE)
  app.get(
    '/v1/nonces/status/:wkIdentity',
    requireReadAuth('wkIdentity'),
    (req, res) => {
      noncesApi.getNonceStatus(req, res);
    },
  );

  // validate nonces - check if submitted nonces are stored correctly
  app.post(
    '/v1/nonces/validate',
    requireWkIdentityAuthLegacyGated,
    (req, res) => {
      noncesApi.validateNonces(req, res);
    },
  );

  // reconcile nonces - purge server-side orphans not present on device
  app.post(
    '/v1/nonces/reconcile',
    requireWkIdentityAuthLegacyGated,
    (req, res) => {
      noncesApi.reconcileNonces(req, res);
    },
  );

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
  // Solana paymaster — relay sponsors tx fees so users don't need SOL in
  // their leaf keypair (since SSP shows the multisig vault PDA as the
  // deposit address, not the leaf address).
  app.get('/v1/sol/paymaster', (req, res) => {
    solPaymasterApi.getPaymaster(req, res);
  });
  // Consumer Solana broadcast (SSP Key) and vault setup (wallet). WK auth;
  // released clients do not sign these yet, so unsigned posts follow
  // RELAY_LEGACY_UNAUTH_MODE (log by default).
  app.post(
    '/v1/sol/broadcast',
    solBroadcastLimiter,
    requireWkIdentityAuthLegacyGated,
    (req, res) => {
      solPaymasterApi.postBroadcast(req, res);
    },
  );
  // One-shot pre-provision for a new Solana vault: paymaster atomically
  // initializes the multisig + provisions its durable nonce account so the
  // wallet's first send can use the durable-nonce flow (no blockhash race).
  // wkIdentity-authed + balance-gated to prevent griefing the paymaster.
  app.post(
    '/v1/sol/setup',
    solBroadcastLimiter,
    requireWkIdentityAuthLegacyGated,
    (req, res) => {
      solPaymasterApi.postSetup(req, res);
    },
  );

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
  app.post('/v1/enterprise/subscribe', requireWkIdentityAuth, (req, res) => {
    enterpriseNotificationApi.postSubscribe(req, res);
  });
  app.post('/v1/enterprise/unsubscribe', requireWkIdentityAuth, (req, res) => {
    enterpriseNotificationApi.postUnsubscribe(req, res);
  });
  app.post('/v1/enterprise/subscription', requireWkIdentityAuth, (req, res) => {
    enterpriseNotificationApi.getStatus(req, res);
  });
  // Update notification preferences from SSP Wallet (partial update; incl.
  // the minimum-USD tx email filter). Same wkIdentity signature auth as
  // subscribe/unsubscribe.
  app.post('/v1/enterprise/preferences', requireWkIdentityAuth, (req, res) => {
    enterpriseNotificationApi.postUpdatePreferences(req, res);
  });

  // SSP Enterprise - wallet tx notification preferences (session auth, used
  // by the Enterprise App; distinct from the org-scoped /notification-prefs
  // proposal-lifecycle routes)
  app.get('/v1/enterprise/wallet-notification-preferences', (req, res) => {
    enterpriseNotificationApi.getWalletNotificationPreferences(req, res);
  });
  app.put('/v1/enterprise/wallet-notification-preferences', (req, res) => {
    enterpriseNotificationApi.putWalletNotificationPreferences(req, res);
  });

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

  // SSP Enterprise - Notification preference endpoints
  app.get('/v1/enterprise/organizations/:id/notification-prefs', (req, res) => {
    enterpriseApi.getOrgNotificationPrefs(req, res);
  });
  app.put('/v1/enterprise/organizations/:id/notification-prefs', (req, res) => {
    enterpriseApi.putOrgNotificationPrefs(req, res);
  });

  // SSP Enterprise - Notification subscription endpoints (Slack — Phase 2)
  app.get(
    '/v1/enterprise/organizations/:id/notification-subscriptions',
    (req, res) => {
      enterpriseApi.getOrgNotificationSubscriptions(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/notification-subscriptions',
    (req, res) => {
      enterpriseApi.postOrgNotificationSubscription(req, res);
    },
  );
  app.patch(
    '/v1/enterprise/organizations/:id/notification-subscriptions/:subId',
    (req, res) => {
      enterpriseApi.patchOrgNotificationSubscription(req, res);
    },
  );
  app.delete(
    '/v1/enterprise/organizations/:id/notification-subscriptions/:subId',
    (req, res) => {
      enterpriseApi.deleteOrgNotificationSubscription(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/notification-subscriptions/:subId/test',
    webhookTestLimiter,
    (req, res) => {
      enterpriseApi.postOrgNotificationSubscriptionTest(req, res);
    },
  );
  app.get(
    '/v1/enterprise/organizations/:id/notification-deliveries',
    (req, res) => {
      enterpriseApi.getOrgNotificationDeliveries(req, res);
    },
  );

  // SSP Enterprise - API Key management (session-auth, owner/admin, integrations
  // entitlement). Mutations use the tight billing-style limiter; the full key is
  // returned EXACTLY ONCE on create.
  app.get(
    '/v1/enterprise/organizations/:id/api-keys',
    billingReadLimiter,
    (req, res) => {
      enterpriseApi.getOrgApiKeys(req, res);
    },
  );
  app.get(
    '/v1/enterprise/organizations/:id/api-keys/usage',
    billingReadLimiter,
    (req, res) => {
      enterpriseApi.getOrgApiKeyUsage(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/api-keys',
    billingMutationLimiter,
    (req, res) => {
      enterpriseApi.postOrgApiKey(req, res);
    },
  );
  app.delete(
    '/v1/enterprise/organizations/:id/api-keys/:keyId',
    billingMutationLimiter,
    (req, res) => {
      enterpriseApi.deleteOrgApiKey(req, res);
    },
  );

  // ============================================================
  // SSP Customer API (/v1/api/*) — api-key auth.
  // ============================================================
  // SECURITY: reads are GET, gated by apiKeyAuth(scope). The one WRITE route
  // (POST .../proposals, scope `proposals:write`) creates a PENDING proposal
  // ONLY — it never signs, reserves-then-signs, or broadcasts; execution still
  // requires the vault's M-of-N device signatures. The org is derived FROM THE
  // KEY (req.apiOrgId), never the URL. Rate limited per-key (token bucket) and
  // per-IP (global safety net); writes get a tighter per-key bucket.
  app.get(
    '/v1/api/org',
    apiReadIpLimiter,
    apiKeyAuth('org:read'),
    apiReadKeyLimiter,
    (req, res) => {
      enterpriseApi.apiGetOrg(req, res);
    },
  );
  app.get(
    '/v1/api/vaults',
    apiReadIpLimiter,
    apiKeyAuth('vaults:read'),
    apiReadKeyLimiter,
    (req, res) => {
      enterpriseApi.apiGetVaults(req, res);
    },
  );
  app.get(
    '/v1/api/vaults/:vaultId',
    apiReadIpLimiter,
    apiKeyAuth('vaults:read'),
    apiReadKeyLimiter,
    (req, res) => {
      enterpriseApi.apiGetVault(req, res);
    },
  );
  app.get(
    '/v1/api/vaults/:vaultId/balances',
    apiReadIpLimiter,
    apiKeyAuth('balances:read'),
    apiReadKeyLimiter,
    (req, res) => {
      enterpriseApi.apiGetVaultBalances(req, res);
    },
  );
  app.get(
    '/v1/api/vaults/:vaultId/transactions',
    apiReadIpLimiter,
    apiKeyAuth('transactions:read'),
    apiReadKeyLimiter,
    (req, res) => {
      enterpriseApi.apiGetVaultTransactions(req, res);
    },
  );
  app.get(
    '/v1/api/vaults/:vaultId/proposals',
    apiReadIpLimiter,
    apiKeyAuth('proposals:read'),
    apiReadKeyLimiter,
    (req, res) => {
      enterpriseApi.apiGetVaultProposals(req, res);
    },
  );
  app.get(
    '/v1/api/vaults/:vaultId/proposals/:proposalId',
    apiReadIpLimiter,
    apiKeyAuth('proposals:read'),
    apiReadKeyLimiter,
    (req, res) => {
      enterpriseApi.apiGetVaultProposal(req, res);
    },
  );
  app.get(
    '/v1/api/analytics/portfolio',
    apiReadIpLimiter,
    apiKeyAuth('analytics:read'),
    apiReadKeyLimiter,
    (req, res) => {
      enterpriseApi.apiGetPortfolioAnalytics(req, res);
    },
  );
  app.get(
    '/v1/api/contacts',
    apiReadIpLimiter,
    apiKeyAuth('contacts:read'),
    apiReadKeyLimiter,
    (req, res) => {
      enterpriseApi.apiGetContacts(req, res);
    },
  );
  // READ — policy config (policies:read). Read back what the policies:write
  // endpoints manage. Org-scoped; exposes no signing material.
  app.get(
    '/v1/api/vaults/:vaultId/policy',
    apiReadIpLimiter,
    apiKeyAuth('policies:read'),
    apiReadKeyLimiter,
    (req, res) => {
      enterpriseApi.apiGetVaultPolicy(req, res);
    },
  );
  app.get(
    '/v1/api/vaults/:vaultId/policy-rules',
    apiReadIpLimiter,
    apiKeyAuth('policies:read'),
    apiReadKeyLimiter,
    (req, res) => {
      enterpriseApi.apiGetVaultPolicyRules(req, res);
    },
  );
  app.get(
    '/v1/api/org/policy',
    apiReadIpLimiter,
    apiKeyAuth('policies:read'),
    apiReadKeyLimiter,
    (req, res) => {
      enterpriseApi.apiGetOrgPolicy(req, res);
    },
  );
  app.get(
    '/v1/api/org/policy-rules',
    apiReadIpLimiter,
    apiKeyAuth('policies:read'),
    apiReadKeyLimiter,
    (req, res) => {
      enterpriseApi.apiGetOrgPolicyRules(req, res);
    },
  );
  app.get(
    '/v1/api/approval-groups',
    apiReadIpLimiter,
    apiKeyAuth('policies:read'),
    apiReadKeyLimiter,
    (req, res) => {
      enterpriseApi.apiGetApprovalGroups(req, res);
    },
  );
  app.get(
    '/v1/api/policy-templates',
    apiReadIpLimiter,
    apiKeyAuth('policies:read'),
    apiReadKeyLimiter,
    (req, res) => {
      enterpriseApi.apiGetPolicyTemplates(req, res);
    },
  );
  // WRITE — create a PENDING proposal (a mutating /v1/api route). Gated on
  // `proposals:write`; proposedBy = the key's creator (must be a vault signer);
  // runs the full policy engine; never signs or broadcasts.
  app.post(
    '/v1/api/vaults/:vaultId/proposals',
    apiReadIpLimiter,
    apiKeyAuth('proposals:write'),
    apiWriteKeyLimiter,
    (req, res) => {
      enterpriseApi.apiCreateVaultProposal(req, res);
    },
  );
  // WRITE — cancel a pending proposal (withdraws only; the inner service checks
  // creator/admin; no funds move).
  app.post(
    '/v1/api/vaults/:vaultId/proposals/:proposalId/cancel',
    apiReadIpLimiter,
    apiKeyAuth('proposals:write'),
    apiWriteKeyLimiter,
    (req, res) => {
      enterpriseApi.apiCancelVaultProposal(req, res);
    },
  );
  // WRITE — update a vault's spending policy (policies:write). Policy is a
  // CONTROL, not a fund movement; the key creator must be a vault admin (the
  // check runs inside the enterprise service). Never signs or broadcasts.
  app.put(
    '/v1/api/vaults/:vaultId/policy',
    apiReadIpLimiter,
    apiKeyAuth('policies:write'),
    apiWriteKeyLimiter,
    (req, res) => {
      enterpriseApi.apiUpdateVaultPolicy(req, res);
    },
  );
  // WRITE — vault policy RULES (policies:write). The programmable policy-as-code
  // surface. Rules gate/route proposals; they never sign or move funds. Vault-admin
  // authorization is enforced inside the enterprise service (CC3).
  app.post(
    '/v1/api/vaults/:vaultId/policy-rules',
    apiReadIpLimiter,
    apiKeyAuth('policies:write'),
    apiWriteKeyLimiter,
    (req, res) => {
      enterpriseApi.apiCreateVaultPolicyRule(req, res);
    },
  );
  // Reorder is a distinct sub-path (POST) — declared before :ruleId so it is
  // never shadowed by a same-method rule route.
  app.post(
    '/v1/api/vaults/:vaultId/policy-rules/reorder',
    apiReadIpLimiter,
    apiKeyAuth('policies:write'),
    apiWriteKeyLimiter,
    (req, res) => {
      enterpriseApi.apiReorderVaultPolicyRules(req, res);
    },
  );
  app.put(
    '/v1/api/vaults/:vaultId/policy-rules/:ruleId',
    apiReadIpLimiter,
    apiKeyAuth('policies:write'),
    apiWriteKeyLimiter,
    (req, res) => {
      enterpriseApi.apiUpdateVaultPolicyRule(req, res);
    },
  );
  app.delete(
    '/v1/api/vaults/:vaultId/policy-rules/:ruleId',
    apiReadIpLimiter,
    apiKeyAuth('policies:write'),
    apiWriteKeyLimiter,
    (req, res) => {
      enterpriseApi.apiDeleteVaultPolicyRule(req, res);
    },
  );
  // WRITE — vault whitelist (policies:write). Controls WHERE funds may go; never
  // moves funds. Mode sub-path declared before the add/remove collection route.
  app.put(
    '/v1/api/vaults/:vaultId/policy/whitelist/mode',
    apiReadIpLimiter,
    apiKeyAuth('policies:write'),
    apiWriteKeyLimiter,
    (req, res) => {
      enterpriseApi.apiUpdateVaultWhitelistMode(req, res);
    },
  );
  app.post(
    '/v1/api/vaults/:vaultId/policy/whitelist',
    apiReadIpLimiter,
    apiKeyAuth('policies:write'),
    apiWriteKeyLimiter,
    (req, res) => {
      enterpriseApi.apiAddVaultWhitelistAddress(req, res);
    },
  );
  app.delete(
    '/v1/api/vaults/:vaultId/policy/whitelist',
    apiReadIpLimiter,
    apiKeyAuth('policies:write'),
    apiWriteKeyLimiter,
    (req, res) => {
      enterpriseApi.apiRemoveVaultWhitelistAddress(req, res);
    },
  );
  // WRITE — org-level default policy (policies:write). Org admin only (enforced
  // in the enterprise service). A control, not a fund movement.
  app.put(
    '/v1/api/org/policy',
    apiReadIpLimiter,
    apiKeyAuth('policies:write'),
    apiWriteKeyLimiter,
    (req, res) => {
      enterpriseApi.apiUpdateOrgPolicy(req, res);
    },
  );
  // WRITE — org-level policy rules (policies:write). Org admin only (enforced in
  // the enterprise service). Reorder declared before :ruleId.
  app.post(
    '/v1/api/org/policy-rules',
    apiReadIpLimiter,
    apiKeyAuth('policies:write'),
    apiWriteKeyLimiter,
    (req, res) => {
      enterpriseApi.apiCreateOrgPolicyRule(req, res);
    },
  );
  app.post(
    '/v1/api/org/policy-rules/reorder',
    apiReadIpLimiter,
    apiKeyAuth('policies:write'),
    apiWriteKeyLimiter,
    (req, res) => {
      enterpriseApi.apiReorderOrgPolicyRules(req, res);
    },
  );
  app.put(
    '/v1/api/org/policy-rules/:ruleId',
    apiReadIpLimiter,
    apiKeyAuth('policies:write'),
    apiWriteKeyLimiter,
    (req, res) => {
      enterpriseApi.apiUpdateOrgPolicyRule(req, res);
    },
  );
  app.delete(
    '/v1/api/org/policy-rules/:ruleId',
    apiReadIpLimiter,
    apiKeyAuth('policies:write'),
    apiWriteKeyLimiter,
    (req, res) => {
      enterpriseApi.apiDeleteOrgPolicyRule(req, res);
    },
  );
  // WRITE — org per-chain policy override (policies:write). Org admin only.
  app.put(
    '/v1/api/org/chain-policy/:chain',
    apiReadIpLimiter,
    apiKeyAuth('policies:write'),
    apiWriteKeyLimiter,
    (req, res) => {
      enterpriseApi.apiUpdateOrgChainPolicy(req, res);
    },
  );
  app.delete(
    '/v1/api/org/chain-policy/:chain',
    apiReadIpLimiter,
    apiKeyAuth('policies:write'),
    apiWriteKeyLimiter,
    (req, res) => {
      enterpriseApi.apiDeleteOrgChainPolicy(req, res);
    },
  );
  // WRITE — approval groups (policies:write). Named signer quorums referenced by
  // policy rules. Org admin only (enforced in the enterprise service). Defines
  // WHO approves; never signs or moves funds.
  app.post(
    '/v1/api/approval-groups',
    apiReadIpLimiter,
    apiKeyAuth('policies:write'),
    apiWriteKeyLimiter,
    (req, res) => {
      enterpriseApi.apiCreateApprovalGroup(req, res);
    },
  );
  app.put(
    '/v1/api/approval-groups/:groupId',
    apiReadIpLimiter,
    apiKeyAuth('policies:write'),
    apiWriteKeyLimiter,
    (req, res) => {
      enterpriseApi.apiUpdateApprovalGroup(req, res);
    },
  );
  app.delete(
    '/v1/api/approval-groups/:groupId',
    apiReadIpLimiter,
    apiKeyAuth('policies:write'),
    apiWriteKeyLimiter,
    (req, res) => {
      enterpriseApi.apiDeleteApprovalGroup(req, res);
    },
  );
  // WRITE — apply a policy template to a vault (policies:write). Materializes the
  // template's rules/flat fields via the CC3-gated policy writers.
  app.post(
    '/v1/api/vaults/:vaultId/apply-template',
    apiReadIpLimiter,
    apiKeyAuth('policies:write'),
    apiWriteKeyLimiter,
    (req, res) => {
      enterpriseApi.apiApplyPolicyTemplate(req, res);
    },
  );
  // WRITE — vaults + vault tags (vaults:write). Org admin only (enforced in the
  // enterprise service). Creating/configuring a vault never signs or moves funds.
  app.post(
    '/v1/api/vaults',
    apiReadIpLimiter,
    apiKeyAuth('vaults:write'),
    apiWriteKeyLimiter,
    (req, res) => {
      enterpriseApi.apiCreateVault(req, res);
    },
  );
  app.post(
    '/v1/api/vault-tags',
    apiReadIpLimiter,
    apiKeyAuth('vaults:write'),
    apiWriteKeyLimiter,
    (req, res) => {
      enterpriseApi.apiCreateVaultTag(req, res);
    },
  );
  app.put(
    '/v1/api/vault-tags/:tagId',
    apiReadIpLimiter,
    apiKeyAuth('vaults:write'),
    apiWriteKeyLimiter,
    (req, res) => {
      enterpriseApi.apiUpdateVaultTag(req, res);
    },
  );
  app.delete(
    '/v1/api/vault-tags/:tagId',
    apiReadIpLimiter,
    apiKeyAuth('vaults:write'),
    apiWriteKeyLimiter,
    (req, res) => {
      enterpriseApi.apiDeleteVaultTag(req, res);
    },
  );
  // NOTE: declared AFTER the more specific vault sub-paths (policy, policy-rules,
  // whitelist) so `:vaultId` never shadows them; PUT here updates vault config.
  app.put(
    '/v1/api/vaults/:vaultId',
    apiReadIpLimiter,
    apiKeyAuth('vaults:write'),
    apiWriteKeyLimiter,
    (req, res) => {
      enterpriseApi.apiUpdateVault(req, res);
    },
  );
  // WRITE — org address book (contacts:write). Decoupled from policy/whitelist,
  // so these never affect fund movement.
  app.post(
    '/v1/api/contacts',
    apiReadIpLimiter,
    apiKeyAuth('contacts:write'),
    apiWriteKeyLimiter,
    (req, res) => {
      enterpriseApi.apiCreateContact(req, res);
    },
  );
  app.put(
    '/v1/api/contacts/:id',
    apiReadIpLimiter,
    apiKeyAuth('contacts:write'),
    apiWriteKeyLimiter,
    (req, res) => {
      enterpriseApi.apiUpdateContact(req, res);
    },
  );
  app.delete(
    '/v1/api/contacts/:id',
    apiReadIpLimiter,
    apiKeyAuth('contacts:write'),
    apiWriteKeyLimiter,
    (req, res) => {
      enterpriseApi.apiDeleteContact(req, res);
    },
  );

  // SSP Enterprise - Vault endpoints
  app.post('/v1/enterprise/organizations/:id/vaults', (req, res) => {
    enterpriseApi.postVault(req, res);
  });
  app.get('/v1/enterprise/organizations/:id/vaults', (req, res) => {
    enterpriseApi.getVaults(req, res);
  });
  // Aggregated portfolio (all active vaults' balances, recent transactions,
  // pending proposals, compact balance history) in a single response —
  // replaces the enterprise app's per-vault 4-request fan-out.
  app.get('/v1/enterprise/organizations/:id/portfolio', (req, res) => {
    enterpriseApi.getOrgPortfolio(req, res);
  });
  // Org-wide proposal activity: pending + recently signed/sent across vaults.
  app.get('/v1/enterprise/organizations/:id/proposal-activity', (req, res) => {
    enterpriseApi.getOrgProposalActivity(req, res);
  });
  // Recurring payments: schedules that create pending proposals on due dates
  // (never sign or move funds — signing stays manual M-of-N).
  app.get('/v1/enterprise/organizations/:id/recurring-payments', (req, res) => {
    enterpriseApi.getRecurringPayments(req, res);
  });
  app.post(
    '/v1/enterprise/organizations/:id/recurring-payments',
    (req, res) => {
      enterpriseApi.postRecurringPayment(req, res);
    },
  );
  app.get(
    '/v1/enterprise/organizations/:id/recurring-payments/:paymentId',
    (req, res) => {
      enterpriseApi.getRecurringPayment(req, res);
    },
  );
  app.put(
    '/v1/enterprise/organizations/:id/recurring-payments/:paymentId',
    (req, res) => {
      enterpriseApi.putRecurringPayment(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/recurring-payments/:paymentId/pause',
    (req, res) => {
      enterpriseApi.postRecurringPaymentPause(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/recurring-payments/:paymentId/resume',
    (req, res) => {
      enterpriseApi.postRecurringPaymentResume(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/recurring-payments/:paymentId/cancel',
    (req, res) => {
      enterpriseApi.postRecurringPaymentCancel(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/recurring-payments/:paymentId/run',
    (req, res) => {
      enterpriseApi.postRecurringPaymentRun(req, res);
    },
  );
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

  // Vault descriptor (signer set the wallet and Key verify and pin)
  app.get(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/descriptor',
    (req, res) => {
      enterpriseApi.getVaultDescriptor(req, res);
    },
  );

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
  // Solana enterprise: bundle initialize_multisig + provision_nonce in a
  // single paymaster-signed tx for the multisig PDA at the given addressIndex.
  // Required once per (vault, addressIndex) before the first proposal.
  // Body: { addressIndex: number }
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/sol/setup',
    (req, res) => {
      enterpriseApi.postVaultSolanaSetup(req, res);
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
  // Advisory pre-create dry-run simulation (TX_SIMULATION_DESIGN §6). No
  // proposal is created. Read-style rate limit, keyed by vault + session.
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/proposals/preview-simulate',
    previewSimulateLimiter,
    (req, res) => {
      enterpriseApi.postVaultProposalPreviewSimulate(req, res);
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
  // Advisory on-demand re-simulation of an existing proposal
  // (TX_SIMULATION_DESIGN §6). Read-only — only patches the proposal's embedded
  // simulation subdoc; never signs or gates. Tightly rate-limited (6/min/vault).
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/proposals/:proposalId/simulate',
    simulateLimiter,
    (req, res) => {
      enterpriseApi.postVaultProposalSimulate(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/proposals/:proposalId/sign',
    (req, res) => {
      enterpriseApi.postVaultProposalSign(req, res);
    },
  );
  // Solana split-approval flow: per-signer signing payload. Returns the
  // unsigned per-signer tx (create/approve kind) for the requesting signer to
  // stamp with their wallet [+ key] ed25519 sigs. All orchestration (creator
  // claim, claim TTL reassignment, index re-prediction, supersede) lives in
  // the enterprise module. Error codes surfaced to the app: 409 CREATE_PENDING,
  // 409 ALREADY_SIGNING, 410 PAYLOAD_SUPERSEDED.
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/proposals/:proposalId/solana-signing-payload',
    (req, res) => {
      enterpriseApi.postVaultProposalSolanaSigningPayload(req, res);
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
  // Read-only share links for a proposal (payment status for the payee).
  // Pass-through only; permissions and validation live in the enterprise module.
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/proposals/:proposalId/shares',
    (req, res) => {
      enterpriseApi.postVaultProposalShare(req, res);
    },
  );
  app.get(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/proposals/:proposalId/shares',
    (req, res) => {
      enterpriseApi.getVaultProposalShares(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/proposals/:proposalId/shares/:shareId/revoke',
    (req, res) => {
      enterpriseApi.postVaultProposalShareRevoke(req, res);
    },
  );
  // PUBLIC (no session): the view behind a share link. Token in the body so it
  // never lands in URL access logs.
  app.post(
    '/v1/enterprise/public/proposal-share',
    publicShareLimiter,
    (req, res) => {
      enterpriseApi.postPublicProposalShare(req, res);
    },
  );

  // Vault signature requests (WalletConnect Phase 2 — vault message signing).
  // A NON-broadcasting M-of-N signature over a dApp message (personal_sign);
  // pass-through only, all logic in ssp-relay-enterprise.
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/signature-requests',
    (req, res) => {
      enterpriseApi.postVaultSignatureRequest(req, res);
    },
  );
  app.get(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/signature-requests',
    (req, res) => {
      enterpriseApi.getVaultSignatureRequests(req, res);
    },
  );
  app.get(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/signature-requests/deployment-status',
    (req, res) => {
      enterpriseApi.getVaultSignatureDeploymentStatus(req, res);
    },
  );
  app.get(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/signature-requests/:requestId',
    (req, res) => {
      enterpriseApi.getVaultSignatureRequest(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/signature-requests/:requestId/sign',
    (req, res) => {
      enterpriseApi.postVaultSignatureRequestSign(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/signature-requests/:requestId/reject',
    (req, res) => {
      enterpriseApi.postVaultSignatureRequestReject(req, res);
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

  // Multi-round approval workflow actions (Advanced Policy Engine Phase 2)
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/proposals/:proposalId/workflow-approve',
    (req, res) => {
      enterpriseApi.postVaultProposalWorkflowApprove(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/proposals/:proposalId/workflow-reject',
    (req, res) => {
      enterpriseApi.postVaultProposalWorkflowReject(req, res);
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

  // Policy templates (code-resident presets, Advanced Policy Engine Phase 5)
  // — NOT org-scoped; any authenticated identity may list them.
  app.get('/v1/enterprise/policy-templates', (req, res) => {
    enterpriseApi.getPolicyTemplates(req, res);
  });

  // Vault policy rules (ordered rules engine) — reorder MUST be registered
  // before the :ruleId route so 'reorder' is not captured as a rule id
  app.get(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/policy-rules',
    (req, res) => {
      enterpriseApi.getVaultPolicyRules(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/policy-rules',
    (req, res) => {
      enterpriseApi.postVaultPolicyRule(req, res);
    },
  );
  app.put(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/policy-rules/reorder',
    (req, res) => {
      enterpriseApi.putVaultPolicyRulesReorder(req, res);
    },
  );
  app.put(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/policy-rules/:ruleId',
    (req, res) => {
      enterpriseApi.putVaultPolicyRule(req, res);
    },
  );
  app.delete(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/policy-rules/:ruleId',
    (req, res) => {
      enterpriseApi.deleteVaultPolicyRule(req, res);
    },
  );

  // Apply a policy template to a vault (Advanced Policy Engine Phase 5).
  // A `preview: true` body returns the rules/flat-fields that WOULD apply
  // without persisting.
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/apply-template',
    (req, res) => {
      enterpriseApi.postVaultApplyTemplate(req, res);
    },
  );

  // Approval groups (org-scoped, Advanced Policy Engine Phase 2)
  app.get('/v1/enterprise/organizations/:id/approval-groups', (req, res) => {
    enterpriseApi.getApprovalGroups(req, res);
  });
  app.post('/v1/enterprise/organizations/:id/approval-groups', (req, res) => {
    enterpriseApi.postApprovalGroup(req, res);
  });
  app.put(
    '/v1/enterprise/organizations/:id/approval-groups/:groupId',
    (req, res) => {
      enterpriseApi.putApprovalGroup(req, res);
    },
  );
  app.delete(
    '/v1/enterprise/organizations/:id/approval-groups/:groupId',
    (req, res) => {
      enterpriseApi.deleteApprovalGroup(req, res);
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

  // Org-level policy rules (ordered rules engine, Advanced Policy Engine
  // Phase 4) — reorder/test MUST be registered before the :ruleId route so
  // 'reorder'/'test' are not captured as a rule id
  app.get('/v1/enterprise/organizations/:id/policy-rules', (req, res) => {
    enterpriseApi.getOrgPolicyRules(req, res);
  });
  app.post('/v1/enterprise/organizations/:id/policy-rules', (req, res) => {
    enterpriseApi.postOrgPolicyRule(req, res);
  });
  app.put(
    '/v1/enterprise/organizations/:id/policy-rules/reorder',
    (req, res) => {
      enterpriseApi.putOrgPolicyRulesReorder(req, res);
    },
  );
  app.post('/v1/enterprise/organizations/:id/policy-rules/test', (req, res) => {
    enterpriseApi.postOrgPolicyRulesTest(req, res);
  });
  app.put(
    '/v1/enterprise/organizations/:id/policy-rules/:ruleId',
    (req, res) => {
      enterpriseApi.putOrgPolicyRule(req, res);
    },
  );
  app.delete(
    '/v1/enterprise/organizations/:id/policy-rules/:ruleId',
    (req, res) => {
      enterpriseApi.deleteOrgPolicyRule(req, res);
    },
  );

  // Compliance config + manual screen + synchronous policy-decision logs, and
  // the vault-scoped webhook health-check test (Advanced Policy Engine Phase 6).
  // Logic-free pass-throughs; all role/entitlement/governance checks live in
  // the ssp-relay-enterprise hooks.
  app.get(
    '/v1/enterprise/organizations/:orgId/compliance/config',
    (req, res) => {
      enterpriseApi.getOrgComplianceConfig(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:orgId/compliance/config',
    (req, res) => {
      enterpriseApi.postOrgComplianceConfig(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:orgId/compliance/screen',
    (req, res) => {
      enterpriseApi.postOrgComplianceScreen(req, res);
    },
  );
  app.get(
    '/v1/enterprise/organizations/:orgId/policy-decision-logs',
    (req, res) => {
      enterpriseApi.getOrgPolicyDecisionLogs(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/vaults/:vaultId/policy-webhooks/test',
    (req, res) => {
      enterpriseApi.postVaultPolicyWebhookTest(req, res);
    },
  );

  // Policy change governance (org-scoped, Advanced Policy Engine Phase 4)
  app.get('/v1/enterprise/organizations/:id/policy-changes', (req, res) => {
    enterpriseApi.getPolicyChanges(req, res);
  });
  app.post(
    '/v1/enterprise/organizations/:id/policy-changes/:requestId/approve',
    (req, res) => {
      enterpriseApi.postPolicyChangeApprove(req, res);
    },
  );
  app.post(
    '/v1/enterprise/organizations/:id/policy-changes/:requestId/reject',
    (req, res) => {
      enterpriseApi.postPolicyChangeReject(req, res);
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
