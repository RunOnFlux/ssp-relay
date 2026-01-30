import serviceHelper from '../services/serviceHelper';
import enterpriseHooks from '../services/enterpriseHooks';
import log from '../lib/log';
import {
  stripAuthFields,
  AuthenticatedRequest,
} from '../middleware/authMiddleware';

/**
 * POST /v1/pulse/subscribe
 * Subscribe user to SSP Pulse notification service
 * All validation and processing is handled by the enterprise module
 */
async function postSubscribe(req: AuthenticatedRequest, res) {
  try {
    // Enterprise module required for pulse subscription
    if (!enterpriseHooks.isLoaded()) {
      throw new Error(
        'Enterprise module not available. Pulse subscription not possible.',
      );
    }

    // Strip auth fields and pass to enterprise module for processing
    const data = stripAuthFields(req.body);

    // Subscribe via enterprise hook (validation and tracking handled in enterprise module)
    const result = await enterpriseHooks.pulseSubscribe(req, data);
    const response = serviceHelper.createDataMessage(result);
    res.json(response);
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code,
    );
    res.json(errMessage);
  }
}

/**
 * POST /v1/pulse/unsubscribe
 * Unsubscribe user from SSP Pulse notification service
 * All validation and processing is handled by the enterprise module
 */
async function postUnsubscribe(req: AuthenticatedRequest, res) {
  try {
    // Enterprise module required
    if (!enterpriseHooks.isLoaded()) {
      throw new Error(
        'Enterprise module not available. Pulse unsubscription not possible.',
      );
    }

    // Strip auth fields and pass to enterprise module for processing
    const data = stripAuthFields(req.body);

    // Unsubscribe via enterprise hook (validation and tracking handled in enterprise module)
    const result = await enterpriseHooks.pulseUnsubscribe(req, data);
    const response = serviceHelper.createDataMessage(result);
    res.json(response);
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code,
    );
    res.json(errMessage);
  }
}

/**
 * POST /v1/pulse/status
 * Get pulse subscription status for authenticated user
 */
async function getStatus(req: AuthenticatedRequest, res) {
  try {
    // Enterprise module required
    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise module not available.');
    }

    // Get wkIdentity from authenticated request
    const wkIdentity = req.verifiedIdentity;
    if (!wkIdentity) {
      throw new Error('Authentication required');
    }

    // Get status via enterprise hook (tracking handled in enterprise module)
    const result = await enterpriseHooks.pulseGetStatus(req, wkIdentity);

    const response = serviceHelper.createDataMessage(result);
    res.json(response);
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code,
    );
    res.json(errMessage);
  }
}

export default {
  postSubscribe,
  postUnsubscribe,
  getStatus,
};
