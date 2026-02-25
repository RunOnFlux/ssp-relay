/**
 * Enterprise API Endpoints
 *
 * Minimal routing layer - all processing handled by enterprise module.
 */

import { Request, Response } from 'express';
import enterpriseHooks from '../services/enterpriseHooks';
import serviceHelper from '../services/serviceHelper';
import log from '../lib/log';

/**
 * GET /v1/enterprise/auth/challenge
 */
async function getChallenge(req: Request, res: Response): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.enterpriseGetChallenge(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

/**
 * POST /v1/enterprise/auth/wk
 */
async function postLoginWK(req: Request, res: Response): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.enterpriseLogin(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

/**
 * POST /v1/enterprise/auth/link-wk
 */
async function postLinkWk(req: Request, res: Response): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.enterpriseLinkWk(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

/**
 * GET /v1/enterprise/auth/session
 */
async function getSession(req: Request, res: Response): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.enterpriseValidateSession(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

/**
 * POST /v1/enterprise/auth/logout
 */
async function postLogout(req: Request, res: Response): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.enterpriseLogout(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

/**
 * POST /v1/enterprise/auth/email/request
 * Request email login code
 */
async function postEmailLoginRequest(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.emailLoginRequest(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

/**
 * POST /v1/enterprise/auth/email/verify
 * Verify email login code and get session
 */
async function postEmailLoginVerify(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.emailLoginVerify(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

/**
 * POST /v1/enterprise/auth/google
 * Login with Google OAuth
 */
async function postGoogleLogin(req: Request, res: Response): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.googleLogin(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

/**
 * POST /v1/enterprise/critical-action/challenge
 * Generate a challenge for critical actions (delete org, transfer ownership, remove member, change email)
 */
async function postCriticalActionChallenge(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result =
      await enterpriseHooks.enterpriseGetCriticalActionChallenge(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

/**
 * POST /v1/enterprise/email
 * Update enterprise email - REQUIRES WK SIGNATURE
 */
async function postEnterpriseEmail(req: Request, res: Response): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.enterpriseUpdateEmail(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

/**
 * DELETE /v1/enterprise/email
 * Remove enterprise email - REQUIRES WK SIGNATURE
 */
async function deleteEnterpriseEmail(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.enterpriseRemoveEmail(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

// ============================================================
// Email Verification Endpoints
// ============================================================

/**
 * POST /v1/enterprise/email/verify/request
 * Request a verification code for an email address
 */
async function postEmailVerifyRequest(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.emailVerificationRequest(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

/**
 * POST /v1/enterprise/email/verify/confirm
 * Verify an email with the code
 */
async function postEmailVerifyConfirm(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.emailVerificationConfirm(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

// ============================================================
// Profile Endpoints
// ============================================================

/**
 * PATCH /v1/enterprise/profile
 * Update user profile (displayName)
 */
async function patchProfile(req: Request, res: Response): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.profileUpdate(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

// ============================================================
// Organization Endpoints
// ============================================================

/**
 * POST /v1/enterprise/organizations
 */
async function postOrganization(req: Request, res: Response): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.organizationCreate(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

/**
 * GET /v1/enterprise/organizations
 */
async function getOrganizations(req: Request, res: Response): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.organizationList(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

/**
 * GET /v1/enterprise/organizations/:id
 */
async function getOrganization(req: Request, res: Response): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.organizationGet(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

/**
 * PATCH /v1/enterprise/organizations/:id
 */
async function patchOrganization(req: Request, res: Response): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.organizationUpdate(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

/**
 * DELETE /v1/enterprise/organizations/:id
 */
async function deleteOrganization(req: Request, res: Response): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.organizationDelete(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

/**
 * GET /v1/enterprise/organizations/:id/members
 */
async function getMembers(req: Request, res: Response): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.organizationMembers(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

/**
 * PATCH /v1/enterprise/organizations/:id/members/:wkId
 */
async function patchMember(req: Request, res: Response): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.organizationMemberUpdate(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

/**
 * DELETE /v1/enterprise/organizations/:id/members/:wkId
 */
async function deleteMember(req: Request, res: Response): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.organizationMemberRemove(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

/**
 * POST /v1/enterprise/organizations/:id/leave
 */
async function postLeave(req: Request, res: Response): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.organizationLeave(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

/**
 * POST /v1/enterprise/organizations/:id/invitations
 */
async function postOrgInvitation(req: Request, res: Response): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.organizationInvitationCreate(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

/**
 * GET /v1/enterprise/organizations/:id/invitations
 */
async function getOrgInvitations(req: Request, res: Response): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.organizationInvitationList(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

/**
 * DELETE /v1/enterprise/organizations/:id/invitations/:invId
 */
async function deleteOrgInvitation(req: Request, res: Response): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.organizationInvitationRevoke(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

/**
 * GET /v1/enterprise/invitations
 */
async function getMyInvitations(req: Request, res: Response): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.invitationList(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

/**
 * POST /v1/enterprise/invitations/:invId/accept
 */
async function postAcceptInvitation(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.invitationAccept(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

/**
 * POST /v1/enterprise/invitations/:invId/reject
 */
async function postRejectInvitation(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.invitationReject(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

/**
 * GET /v1/enterprise/organizations/:id/audit-logs
 */
async function getOrgAuditLogs(req: Request, res: Response): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.organizationAuditLogs(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

/**
 * GET /v1/enterprise/organizations/:id/audit-logs/stats
 */
async function getOrgAuditStats(req: Request, res: Response): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.organizationAuditStats(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

/**
 * GET /v1/enterprise/organizations/:id/critical-actions
 */
async function getOrgCriticalActions(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.organizationCriticalActions(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

/**
 * GET /v1/enterprise/organizations/:id/login-activity
 */
async function getOrgLoginActivity(req: Request, res: Response): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.organizationLoginActivity(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

// ============================================================
// Vaults
// ============================================================

function vaultHandler(hookName: string) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      if (!enterpriseHooks.isLoaded()) {
        throw new Error('Enterprise features not available');
      }
      const hook = enterpriseHooks.getHook(hookName);
      if (typeof hook !== 'function') {
        throw new Error(`Enterprise hook ${hookName} not available`);
      }
      const result = await (hook as (req: Request) => Promise<unknown>)(req);
      res.json(serviceHelper.createDataMessage(result));
    } catch (error) {
      log.error(error);
      res.json(
        serviceHelper.createErrorMessage(error.message, error.name, error.code),
      );
    }
  };
}

const postVault = vaultHandler('vaultCreate');
const getVaults = vaultHandler('vaultList');
const getVault = vaultHandler('vaultGet');
const patchVault = vaultHandler('vaultUpdate');
const deleteVault = vaultHandler('vaultArchive');
const getVaultMembers = vaultHandler('vaultMembersList');
const postVaultMember = vaultHandler('vaultMemberAdd');
const deleteVaultMember = vaultHandler('vaultMemberRemove');
const postVaultXpub = vaultHandler('vaultXpubSubmit');
const getVaultPendingSetups = vaultHandler('vaultPendingSetups');
const getVaultAddresses = vaultHandler('vaultAddressList');
const postVaultAddress = vaultHandler('vaultAddressGenerate');
const patchVaultAddress = vaultHandler('vaultAddressUpdateLabel');
const getVaultBalances = vaultHandler('vaultBalances');
const getVaultTransactions = vaultHandler('vaultTransactions');
const postVaultSync = vaultHandler('vaultSync');
const getVaultBalanceHistory = vaultHandler('vaultBalanceHistory');
const postVaultProposal = vaultHandler('vaultProposalCreate');
const postVaultProposalEstimateFee = vaultHandler('vaultProposalEstimateFee');
const getVaultProposals = vaultHandler('vaultProposalList');
const getVaultProposal = vaultHandler('vaultProposalGet');
const postVaultProposalSign = vaultHandler('vaultProposalSign');
const postVaultProposalReject = vaultHandler('vaultProposalReject');
const postVaultProposalCancel = vaultHandler('vaultProposalCancel');
const postVaultProposalRetryBroadcast = vaultHandler('vaultProposalRetryBroadcast');
const getVaultAuditLog = vaultHandler('vaultAuditLog');
const getOrgVaultAuditLog = vaultHandler('orgVaultAuditLog');
const getVaultWatchedTokens = vaultHandler('vaultWatchedTokensList');
const postVaultWatchedToken = vaultHandler('vaultWatchedTokenAdd');
const deleteVaultWatchedToken = vaultHandler('vaultWatchedTokenRemove');

export default {
  // Auth
  getChallenge,
  postLoginWK,
  postLinkWk,
  getSession,
  postLogout,
  postCriticalActionChallenge,
  postEnterpriseEmail,
  deleteEnterpriseEmail,
  // Email Login
  postEmailLoginRequest,
  postEmailLoginVerify,
  // Google Login
  postGoogleLogin,
  // Email Verification
  postEmailVerifyRequest,
  postEmailVerifyConfirm,
  // Profile
  patchProfile,
  // Organizations
  postOrganization,
  getOrganizations,
  getOrganization,
  patchOrganization,
  deleteOrganization,
  // Members
  getMembers,
  patchMember,
  deleteMember,
  postLeave,
  // Organization Invitations
  postOrgInvitation,
  getOrgInvitations,
  deleteOrgInvitation,
  // User Invitations
  getMyInvitations,
  postAcceptInvitation,
  postRejectInvitation,
  // Organization Activity
  getOrgAuditLogs,
  getOrgAuditStats,
  getOrgCriticalActions,
  getOrgLoginActivity,
  // Vaults
  postVault,
  getVaults,
  getVault,
  patchVault,
  deleteVault,
  getVaultMembers,
  postVaultMember,
  deleteVaultMember,
  postVaultXpub,
  getVaultPendingSetups,
  getVaultAddresses,
  postVaultAddress,
  patchVaultAddress,
  getVaultBalances,
  getVaultTransactions,
  postVaultSync,
  getVaultBalanceHistory,
  postVaultProposal,
  postVaultProposalEstimateFee,
  getVaultProposals,
  getVaultProposal,
  postVaultProposalSign,
  postVaultProposalReject,
  postVaultProposalCancel,
  postVaultProposalRetryBroadcast,
  getVaultAuditLog,
  getOrgVaultAuditLog,
  getVaultWatchedTokens,
  postVaultWatchedToken,
  deleteVaultWatchedToken,
};
