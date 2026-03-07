/**
 * Enterprise Nonce API Endpoints
 *
 * Minimal routing layer - all validation and processing handled by enterprise module.
 *
 * These endpoints manage ENTERPRISE nonces for multi-party signing,
 * NOT the regular SSP Key<->Wallet nonces (those are ephemeral via /v1/action).
 */

import enterpriseHooks from '../services/enterpriseHooks';
import serviceHelper from '../services/serviceHelper';
import log from '../lib/log';

/**
 * POST /v1/nonces
 * Store enterprise public nonces from wallet or key.
 */
async function postNonces(req, res) {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.handlePostNonces(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

/**
 * GET /v1/nonces/status/:wkIdentity
 * Get nonce pool status for an enterprise identity.
 */
async function getNonceStatus(req, res) {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.handleGetNonceStatus(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

/**
 * POST /v1/nonces/validate
 * Validate that nonces exist and are in the expected state.
 */
async function validateNonces(req, res) {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.handleValidateNonces(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

/**
 * POST /v1/nonces/reconcile
 * Reconcile device nonces with server pool.
 */
async function reconcileNonces(req, res) {
  try {
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise features not available');
    }
    const result = await enterpriseHooks.handleReconcileNonces(req);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(error.message, error.name, error.code),
    );
  }
}

export default {
  postNonces,
  getNonceStatus,
  validateNonces,
  reconcileNonces,
};
