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
    res.json(serviceHelper.createErrorMessage(error.message, error.name, error.code));
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
    res.json(serviceHelper.createErrorMessage(error.message, error.name, error.code));
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
    res.json(serviceHelper.createErrorMessage(error.message, error.name, error.code));
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
    res.json(serviceHelper.createErrorMessage(error.message, error.name, error.code));
  }
}

export default {
  getChallenge,
  postLoginWK,
  getSession,
  postLogout,
};
