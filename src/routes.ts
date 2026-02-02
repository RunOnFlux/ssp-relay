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
  app.get('/v1/enterprise/auth/session', (req, res) => {
    enterpriseApi.getSession(req, res);
  });
  app.post('/v1/enterprise/auth/logout', (req, res) => {
    enterpriseApi.postLogout(req, res);
  });
  app.post('/v1/enterprise/critical-action/challenge', (req, res) => {
    enterpriseApi.postCriticalActionChallenge(req, res);
  });
  app.post('/v1/enterprise/email', (req, res) => {
    enterpriseApi.postEnterpriseEmail(req, res);
  });

  // SSP Enterprise - Email verification endpoints
  app.post('/v1/enterprise/email/verify/request', (req, res) => {
    enterpriseApi.postEmailVerifyRequest(req, res);
  });
  app.post('/v1/enterprise/email/verify/confirm', (req, res) => {
    enterpriseApi.postEmailVerifyConfirm(req, res);
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
};
