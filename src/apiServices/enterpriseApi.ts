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
 * GET /v1/enterprise/organizations/:id/members/:memberId/vault-roles
 */
async function getMemberVaultRoles(req: Request, res: Response): Promise<void> {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.memberVaultRoles(req);
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
const getVaultTags = vaultHandler('vaultTags');
const postVaultTag = vaultHandler('vaultTagCreate');
const patchVaultTag = vaultHandler('vaultTagUpdate');
const deleteVaultTag = vaultHandler('vaultTagDelete');
const getVaultSearch = vaultHandler('vaultSearch');
const getVault = vaultHandler('vaultGet');
const patchVault = vaultHandler('vaultUpdate');
const deleteVault = vaultHandler('vaultArchive');
const unarchiveVault = vaultHandler('vaultUnarchive');
const getVaultMembers = vaultHandler('vaultMembersList');
const postVaultMember = vaultHandler('vaultMemberAdd');
const deleteVaultMember = vaultHandler('vaultMemberRemove');
const postVaultXpub = vaultHandler('vaultXpubSubmit');
const getVaultPendingSetups = vaultHandler('vaultPendingSetups');
const getVaultAddresses = vaultHandler('vaultAddressList');
const postVaultAddress = vaultHandler('vaultAddressGenerate');
const postVaultSolanaSetup = vaultHandler('vaultSolanaSetup');
const patchVaultAddress = vaultHandler('vaultAddressUpdateLabel');
const getVaultBalances = vaultHandler('vaultBalances');
const getVaultTransactions = vaultHandler('vaultTransactions');
const postVaultSync = vaultHandler('vaultSync');
const getVaultBalanceHistory = vaultHandler('vaultBalanceHistory');
const postVaultProposal = vaultHandler('vaultProposalCreate');
const postVaultProposalEstimateFee = vaultHandler('vaultProposalEstimateFee');
const postVaultProposalPreviewPolicy = vaultHandler(
  'vaultProposalPreviewPolicy',
);
// Advisory transaction simulation (TX_SIMULATION_DESIGN §6). Read-only — never
// gates signing. Thin pass-throughs identical in shape to the other vault hooks.
const postVaultProposalSimulate = vaultHandler('vaultProposalSimulate');
const postVaultProposalPreviewSimulate = vaultHandler(
  'vaultProposalPreviewSimulate',
);
const getVaultProposals = vaultHandler('vaultProposalList');
const getVaultProposal = vaultHandler('vaultProposalGet');
const postVaultProposalSign = vaultHandler('vaultProposalSign');
const postVaultProposalSolanaSigningPayload = vaultHandler(
  'vaultProposalSolanaSigningPayload',
);
const postVaultProposalReject = vaultHandler('vaultProposalReject');
const postVaultProposalCancel = vaultHandler('vaultProposalCancel');
const postVaultProposalRetryBroadcast = vaultHandler(
  'vaultProposalRetryBroadcast',
);
const getVaultAuditLog = vaultHandler('vaultAuditLog');
const getOrgVaultAuditLog = vaultHandler('orgVaultAuditLog');
const getVaultWatchedTokens = vaultHandler('vaultWatchedTokensList');
const postVaultWatchedToken = vaultHandler('vaultWatchedTokenAdd');
const deleteVaultWatchedToken = vaultHandler('vaultWatchedTokenRemove');
const getOrgTokenThreats = vaultHandler('tokenThreatOrgList');
const getTokenThreats = vaultHandler('tokenThreatList');
const postTokenThreatOverride = vaultHandler('tokenThreatOverrideSet');
const deleteTokenThreatOverride = vaultHandler('tokenThreatOverrideRemove');
const postTokenThreatBackfill = vaultHandler('tokenThreatBackfill');

// Transaction & Address Flagging
const postTxFlagSpam = vaultHandler('vaultTxFlagSpam');
const deleteTxFlagSpam = vaultHandler('vaultTxUnflagSpam');
const getFlaggedTransactions = vaultHandler('flaggedTransactionsList');
const postAddressFlag = vaultHandler('addressFlagSet');
const deleteAddressFlag = vaultHandler('addressFlagRemove');
const getAddressFlags = vaultHandler('addressFlagList');

// Vault Proposal Admin Approval
const postVaultProposalAdminApprove = vaultHandler('vaultProposalAdminApprove');
const postVaultProposalAdminReject = vaultHandler('vaultProposalAdminReject');
const postVaultProposalCancelTimeLock = vaultHandler(
  'vaultProposalCancelTimeLock',
);

// Multi-Round Approval Workflow actions (Advanced Policy Engine Phase 2)
const postVaultProposalWorkflowApprove = vaultHandler(
  'vaultProposalWorkflowApprove',
);
const postVaultProposalWorkflowReject = vaultHandler(
  'vaultProposalWorkflowReject',
);

// Vault Freeze/Unfreeze
const postVaultFreeze = vaultHandler('vaultFreeze');
const postVaultUnfreeze = vaultHandler('vaultUnfreeze');

// Vault Member Role (promote/demote)
const postVaultMemberPromote = vaultHandler('vaultMemberPromote');
const postVaultMemberDemote = vaultHandler('vaultMemberDemote');

// Vault Policy
const getVaultPolicy = vaultHandler('vaultPolicyGet');
const putVaultPolicy = vaultHandler('vaultPolicyUpdate');
const putVaultPolicyWhitelistMode = vaultHandler(
  'vaultPolicyWhitelistModeUpdate',
);
const postVaultPolicyWhitelist = vaultHandler('vaultPolicyWhitelistAdd');
const deleteVaultPolicyWhitelist = vaultHandler('vaultPolicyWhitelistRemove');
const getVaultPolicyVelocity = vaultHandler('vaultPolicyVelocityGet');
const getVaultEffectiveLimits = vaultHandler('vaultGetEffectiveLimits');

// Vault Policy Rules (Advanced Policy Engine Phase 1)
const getVaultPolicyRules = vaultHandler('vaultPolicyRulesList');
const postVaultPolicyRule = vaultHandler('vaultPolicyRuleCreate');
const putVaultPolicyRule = vaultHandler('vaultPolicyRuleUpdate');
const deleteVaultPolicyRule = vaultHandler('vaultPolicyRuleDelete');
const putVaultPolicyRulesReorder = vaultHandler('vaultPolicyRulesReorder');

// Policy Templates (Advanced Policy Engine Phase 5)
const getPolicyTemplates = vaultHandler('policyTemplatesList');
const postVaultApplyTemplate = vaultHandler('vaultApplyTemplate');

// Approval Groups (Advanced Policy Engine Phase 2)
const getApprovalGroups = vaultHandler('approvalGroupsList');
const postApprovalGroup = vaultHandler('approvalGroupCreate');
const putApprovalGroup = vaultHandler('approvalGroupUpdate');
const deleteApprovalGroup = vaultHandler('approvalGroupDelete');

// Org-Level Policy Rules (Advanced Policy Engine Phase 4)
const getOrgPolicyRules = vaultHandler('orgPolicyRulesList');
const postOrgPolicyRule = vaultHandler('orgPolicyRuleCreate');
const putOrgPolicyRule = vaultHandler('orgPolicyRuleUpdate');
const deleteOrgPolicyRule = vaultHandler('orgPolicyRuleDelete');
const putOrgPolicyRulesReorder = vaultHandler('orgPolicyRulesReorder');
const postOrgPolicyRulesTest = vaultHandler('orgPolicyRulesTest');

// Compliance / Webhook Policy Decisions (Advanced Policy Engine Phase 6)
const getOrgComplianceConfig = vaultHandler('orgComplianceConfigGet');
const postOrgComplianceConfig = vaultHandler('orgComplianceConfigSet');
const postOrgComplianceScreen = vaultHandler('orgComplianceScreen');
const getOrgPolicyDecisionLogs = vaultHandler('orgPolicyDecisionLogsList');
const postVaultPolicyWebhookTest = vaultHandler('vaultPolicyWebhookTest');

// Policy Change Governance (Advanced Policy Engine Phase 4)
const getPolicyChanges = vaultHandler('policyChangesList');
const postPolicyChangeApprove = vaultHandler('policyChangeApprove');
const postPolicyChangeReject = vaultHandler('policyChangeReject');

// Org Policy
const getOrgPolicy = vaultHandler('orgPolicyGet');
const putOrgPolicy = vaultHandler('orgPolicyUpdate');
const getOrgChainPolicy = vaultHandler('orgChainPolicyGet');
const putOrgChainPolicy = vaultHandler('orgChainPolicyUpdate');
const deleteOrgChainPolicy = vaultHandler('orgChainPolicyDelete');

// Signing Requests
const getSigningRequests = vaultHandler('signingRequestsList');

// Analytics
const getAnalyticsSummary = vaultHandler('analyticsSummary');
const getAnalyticsPerformance = vaultHandler('analyticsPerformance');
const getAnalyticsRisk = vaultHandler('analyticsRisk');
const getAnalyticsFlows = vaultHandler('analyticsFlows');
const getAnalyticsCostBasis = vaultHandler('analyticsCostBasis');
// Price History
const getPriceHistory = vaultHandler('priceHistory');

// Flux Nodes
const getFluxNodes = vaultHandler('fluxNodeList');
const getFluxNode = vaultHandler('fluxNodeGet');
const postFluxNode = vaultHandler('fluxNodeRegister');
const patchFluxNode = vaultHandler('fluxNodeUpdate');
const deleteFluxNode = vaultHandler('fluxNodeUnregister');
const postFluxNodeRefresh = vaultHandler('fluxNodeRefreshStatus');
const getFluxNodeStartParams = vaultHandler('fluxNodeGetStartParams');
const postFluxNodeStarted = vaultHandler('fluxNodeRecordStart');
const getFluxNodeSummary = vaultHandler('fluxNodeSummary');
const getVaultDelegates = vaultHandler('fluxNodeGetVaultDelegates');
const putVaultDelegates = vaultHandler('fluxNodeUpdateVaultDelegates');
const getFluxNodeVaultUtxos = vaultHandler('fluxNodeGetVaultUtxos');

// Contacts
const getOrgContacts = vaultHandler('contactList');
const postOrgContact = vaultHandler('contactCreate');
const putOrgContact = vaultHandler('contactUpdate');
const deleteOrgContact = vaultHandler('contactDelete');
const postOrgContactRecordUsage = vaultHandler('contactRecordUsage');

// Notification Preferences
const getOrgNotificationPrefs = vaultHandler('notificationPrefsGet');
const putOrgNotificationPrefs = vaultHandler('notificationPrefsUpdate');

// Notification Subscriptions (Slack — Phase 2)
const getOrgNotificationSubscriptions = vaultHandler(
  'notificationSubscriptionsList',
);
const postOrgNotificationSubscription = vaultHandler(
  'notificationSubscriptionCreate',
);
const patchOrgNotificationSubscription = vaultHandler(
  'notificationSubscriptionUpdate',
);
const deleteOrgNotificationSubscription = vaultHandler(
  'notificationSubscriptionDelete',
);
const postOrgNotificationSubscriptionTest = vaultHandler(
  'notificationSubscriptionTest',
);
const getOrgNotificationDeliveries = vaultHandler('notificationDeliveriesList');

// API Key management (session-auth, owner/admin, `integrations` entitlement)
const getOrgApiKeys = vaultHandler('apiKeysList');
const postOrgApiKey = vaultHandler('apiKeyCreate');
const deleteOrgApiKey = vaultHandler('apiKeyRevoke');
const getOrgApiKeyUsage = vaultHandler('apiKeyUsage');

// Customer READ API (api-key auth — org derived FROM THE KEY, read-only).
// These reuse the generic pass-through; the org is attached by apiKeyAuth, so
// the enterprise handler reads it from req.apiOrgId (never the URL).
const apiGetOrg = vaultHandler('apiGetOrg');
const apiGetVaults = vaultHandler('apiGetVaults');
const apiGetVault = vaultHandler('apiGetVault');
const apiGetVaultBalances = vaultHandler('apiGetVaultBalances');
const apiGetVaultTransactions = vaultHandler('apiGetVaultTransactions');
const apiGetVaultProposals = vaultHandler('apiGetVaultProposals');
const apiGetVaultProposal = vaultHandler('apiGetVaultProposal');
const apiGetPortfolioAnalytics = vaultHandler('apiGetPortfolioAnalytics');
const apiGetContacts = vaultHandler('apiGetContacts');
const apiGetVaultPolicy = vaultHandler('apiGetVaultPolicy');
const apiGetVaultPolicyRules = vaultHandler('apiGetVaultPolicyRules');
const apiGetOrgPolicy = vaultHandler('apiGetOrgPolicy');
const apiGetOrgPolicyRules = vaultHandler('apiGetOrgPolicyRules');
const apiGetApprovalGroups = vaultHandler('apiGetApprovalGroups');
const apiGetPolicyTemplates = vaultHandler('apiGetPolicyTemplates');
// WRITE scopes — proposals:write (create/cancel) + policies:write + contacts:write.
const apiCreateVaultProposal = vaultHandler('apiCreateVaultProposal');
const apiCancelVaultProposal = vaultHandler('apiCancelVaultProposal');
const apiUpdateVaultPolicy = vaultHandler('apiUpdateVaultPolicy');
const apiCreateVaultPolicyRule = vaultHandler('apiCreateVaultPolicyRule');
const apiUpdateVaultPolicyRule = vaultHandler('apiUpdateVaultPolicyRule');
const apiDeleteVaultPolicyRule = vaultHandler('apiDeleteVaultPolicyRule');
const apiReorderVaultPolicyRules = vaultHandler('apiReorderVaultPolicyRules');
const apiAddVaultWhitelistAddress = vaultHandler('apiAddVaultWhitelistAddress');
const apiRemoveVaultWhitelistAddress = vaultHandler(
  'apiRemoveVaultWhitelistAddress',
);
const apiUpdateVaultWhitelistMode = vaultHandler('apiUpdateVaultWhitelistMode');
const apiUpdateOrgPolicy = vaultHandler('apiUpdateOrgPolicy');
const apiCreateOrgPolicyRule = vaultHandler('apiCreateOrgPolicyRule');
const apiUpdateOrgPolicyRule = vaultHandler('apiUpdateOrgPolicyRule');
const apiDeleteOrgPolicyRule = vaultHandler('apiDeleteOrgPolicyRule');
const apiReorderOrgPolicyRules = vaultHandler('apiReorderOrgPolicyRules');
const apiUpdateOrgChainPolicy = vaultHandler('apiUpdateOrgChainPolicy');
const apiDeleteOrgChainPolicy = vaultHandler('apiDeleteOrgChainPolicy');
const apiCreateApprovalGroup = vaultHandler('apiCreateApprovalGroup');
const apiUpdateApprovalGroup = vaultHandler('apiUpdateApprovalGroup');
const apiDeleteApprovalGroup = vaultHandler('apiDeleteApprovalGroup');
const apiApplyPolicyTemplate = vaultHandler('apiApplyPolicyTemplate');
const apiCreateVault = vaultHandler('apiCreateVault');
const apiUpdateVault = vaultHandler('apiUpdateVault');
const apiCreateVaultTag = vaultHandler('apiCreateVaultTag');
const apiUpdateVaultTag = vaultHandler('apiUpdateVaultTag');
const apiDeleteVaultTag = vaultHandler('apiDeleteVaultTag');
const apiCreateContact = vaultHandler('apiCreateContact');
const apiUpdateContact = vaultHandler('apiUpdateContact');
const apiDeleteContact = vaultHandler('apiDeleteContact');

// Subscription & Entitlements
const getOrgEntitlements = vaultHandler('subscriptionEntitlements');
const getOrgSubscription = vaultHandler('subscriptionGet');
const getOrgInvoices = vaultHandler('invoiceList');
const getOrgInvoice = vaultHandler('invoiceGet');

// Stripe
const getStripePrices = vaultHandler('stripePrices');
const postStripeCheckout = vaultHandler('stripeCheckout');
const postStripePortal = vaultHandler('stripePortal');
const postStripeChangePlan = vaultHandler('stripeChangePlan');
const postStripePreviewPlanChange = vaultHandler('stripePreviewPlanChange');
const postStripeCancelSubscription = vaultHandler('stripeCancelSubscription');
const postStripeResumeSubscription = vaultHandler('stripeResumeSubscription');
const postStripeCancelPendingDowngrade = vaultHandler(
  'stripeCancelPendingDowngrade',
);
const postDowngradeImpact = vaultHandler('downgradeImpact');

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
  getMemberVaultRoles,
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
  getVaultTags,
  postVaultTag,
  patchVaultTag,
  deleteVaultTag,
  getVaultSearch,
  getVault,
  patchVault,
  deleteVault,
  unarchiveVault,
  getVaultMembers,
  postVaultMember,
  deleteVaultMember,
  postVaultXpub,
  getVaultPendingSetups,
  getVaultAddresses,
  postVaultAddress,
  postVaultSolanaSetup,
  patchVaultAddress,
  getVaultBalances,
  getVaultTransactions,
  postVaultSync,
  getVaultBalanceHistory,
  postVaultProposal,
  postVaultProposalEstimateFee,
  postVaultProposalPreviewPolicy,
  postVaultProposalSimulate,
  postVaultProposalPreviewSimulate,
  getVaultProposals,
  getVaultProposal,
  postVaultProposalSign,
  postVaultProposalSolanaSigningPayload,
  postVaultProposalReject,
  postVaultProposalCancel,
  postVaultProposalRetryBroadcast,
  getVaultAuditLog,
  getOrgVaultAuditLog,
  getVaultWatchedTokens,
  postVaultWatchedToken,
  deleteVaultWatchedToken,
  getOrgTokenThreats,
  getTokenThreats,
  postTokenThreatOverride,
  deleteTokenThreatOverride,
  postTokenThreatBackfill,
  // Transaction & Address Flagging
  postTxFlagSpam,
  deleteTxFlagSpam,
  getFlaggedTransactions,
  postAddressFlag,
  deleteAddressFlag,
  getAddressFlags,
  // Vault Proposal Admin Approval
  postVaultProposalAdminApprove,
  postVaultProposalAdminReject,
  postVaultProposalCancelTimeLock,
  // Multi-Round Approval Workflow (Advanced Policy Engine Phase 2)
  postVaultProposalWorkflowApprove,
  postVaultProposalWorkflowReject,
  // Vault Freeze/Unfreeze
  postVaultFreeze,
  postVaultUnfreeze,
  // Vault Member Role
  postVaultMemberPromote,
  postVaultMemberDemote,
  // Vault Policy
  getVaultPolicy,
  putVaultPolicy,
  putVaultPolicyWhitelistMode,
  postVaultPolicyWhitelist,
  deleteVaultPolicyWhitelist,
  getVaultPolicyVelocity,
  getVaultEffectiveLimits,
  // Vault Policy Rules (Advanced Policy Engine Phase 1)
  getVaultPolicyRules,
  postVaultPolicyRule,
  putVaultPolicyRule,
  deleteVaultPolicyRule,
  putVaultPolicyRulesReorder,
  // Policy Templates (Advanced Policy Engine Phase 5)
  getPolicyTemplates,
  postVaultApplyTemplate,
  // Approval Groups (Advanced Policy Engine Phase 2)
  getApprovalGroups,
  postApprovalGroup,
  putApprovalGroup,
  deleteApprovalGroup,
  // Org-Level Policy Rules (Advanced Policy Engine Phase 4)
  getOrgPolicyRules,
  postOrgPolicyRule,
  putOrgPolicyRule,
  deleteOrgPolicyRule,
  putOrgPolicyRulesReorder,
  postOrgPolicyRulesTest,
  // Compliance / Webhook Policy Decisions (Advanced Policy Engine Phase 6)
  getOrgComplianceConfig,
  postOrgComplianceConfig,
  postOrgComplianceScreen,
  getOrgPolicyDecisionLogs,
  postVaultPolicyWebhookTest,
  // Policy Change Governance (Advanced Policy Engine Phase 4)
  getPolicyChanges,
  postPolicyChangeApprove,
  postPolicyChangeReject,
  // Org Policy
  getOrgPolicy,
  putOrgPolicy,
  getOrgChainPolicy,
  putOrgChainPolicy,
  deleteOrgChainPolicy,
  // Flux Nodes
  getFluxNodes,
  getFluxNode,
  postFluxNode,
  patchFluxNode,
  deleteFluxNode,
  postFluxNodeRefresh,
  getFluxNodeStartParams,
  postFluxNodeStarted,
  getFluxNodeSummary,
  getVaultDelegates,
  putVaultDelegates,
  getFluxNodeVaultUtxos,
  // Analytics
  getAnalyticsSummary,
  getAnalyticsPerformance,
  getAnalyticsRisk,
  getAnalyticsFlows,
  getAnalyticsCostBasis,
  // Signing Requests
  getSigningRequests,
  // Price History
  getPriceHistory,
  // Contacts
  getOrgContacts,
  postOrgContact,
  putOrgContact,
  deleteOrgContact,
  postOrgContactRecordUsage,
  // Notification Preferences
  getOrgNotificationPrefs,
  putOrgNotificationPrefs,
  getOrgNotificationSubscriptions,
  postOrgNotificationSubscription,
  patchOrgNotificationSubscription,
  deleteOrgNotificationSubscription,
  postOrgNotificationSubscriptionTest,
  getOrgNotificationDeliveries,
  // API Key management
  getOrgApiKeys,
  postOrgApiKey,
  deleteOrgApiKey,
  getOrgApiKeyUsage,
  // Customer READ API
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
  // Subscription & Entitlements
  getOrgEntitlements,
  getOrgSubscription,
  getOrgInvoices,
  getOrgInvoice,
  // Stripe
  getStripePrices,
  postStripeCheckout,
  postStripePortal,
  postStripeChangePlan,
  postStripePreviewPlanChange,
  postStripeCancelSubscription,
  postStripeResumeSubscription,
  postStripeCancelPendingDowngrade,
  postDowngradeImpact,
};
