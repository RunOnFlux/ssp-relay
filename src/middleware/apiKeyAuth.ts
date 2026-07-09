/**
 * API Key Auth Middleware for SSP Relay (Phase 4 — read-first customer API)
 *
 * Authenticates the READ-ONLY customer API mounted at
 * relay.sspwallet.com/v1/api. Extracts a `Bearer ssp_live_...` key, validates it
 * via the enterprise module (`enterpriseHooks.validateApiKey`), enforces the
 * per-route required scope, and attaches the key's OWN org + scopes + keyId to
 * the request.
 *
 * SECURITY (this surface exposes customer data — see NOTIFICATIONS_API_DESIGN §5):
 *  - ORG FROM KEY: the org is taken from `req.apiOrgId` (set here from the
 *    validated key), NEVER from the URL/query/body. A key for org A can never
 *    read org B.
 *  - REVOCATION / EXPIRY are enforced inside `validateApiKey` on EVERY request.
 *  - SCOPE: a 403 is returned when the key lacks the route's required scope.
 *  - The presented key is NEVER logged.
 */

import { Request, Response, NextFunction } from 'express';
import enterpriseHooks from '../services/enterpriseHooks';
import serviceHelper from '../services/serviceHelper';
import log from '../lib/log';

/**
 * Express request augmented by `apiKeyAuth` after a successful key validation.
 */
export interface ApiKeyAuthenticatedRequest extends Request {
  /** Org id derived FROM THE KEY (never from the URL). */
  apiOrgId?: string;
  /** Scopes granted to the validated key. */
  apiScopes?: string[];
  /** The validated key's id (for throttled lastUsed touch + rate-limit keying). */
  apiKeyId?: string;
  /** Alias consumed by enterpriseHooks.apiKeyTouch. */
  keyId?: string;
  /** wkIdentity that created the key — `proposedBy` for write-scope routes. */
  apiKeyCreatedBy?: string;
}

const BEARER_PREFIX = 'Bearer ';
const KEY_LITERAL = 'ssp_live_';

function extractBearerKey(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader !== 'string' || !authHeader.startsWith(BEARER_PREFIX)) {
    return null;
  }
  const token = authHeader.slice(BEARER_PREFIX.length).trim();
  if (!token.startsWith(KEY_LITERAL)) return null;
  return token;
}

/**
 * Create middleware enforcing that the presented key is valid and carries
 * `requiredScope`. On success attaches `apiOrgId`/`apiScopes`/`apiKeyId` and
 * fires a throttled `lastUsed` touch (fire-and-forget).
 */
export function apiKeyAuth(requiredScope: string) {
  return async (
    req: ApiKeyAuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      if (!enterpriseHooks.isLoaded()) {
        return res
          .status(503)
          .json(
            serviceHelper.createErrorMessage(
              'Enterprise features not available',
              'ServiceUnavailable',
              'ENTERPRISE_NOT_LOADED',
            ),
          );
      }

      const presentedKey = extractBearerKey(req);
      if (!presentedKey) {
        return res
          .status(401)
          .json(
            serviceHelper.createErrorMessage(
              'Missing or malformed API key',
              'AuthenticationError',
              'API_KEY_MISSING',
            ),
          );
      }

      const result = await enterpriseHooks.validateApiKey(presentedKey);
      if (!result || !result.ok) {
        // Covers invalid, revoked, and expired keys — never reveal which.
        return res
          .status(401)
          .json(
            serviceHelper.createErrorMessage(
              'Invalid or expired API key',
              'AuthenticationError',
              'API_KEY_INVALID',
            ),
          );
      }

      // Enforce scope (403 — authenticated but not authorized for this route).
      if (!result.scopes.includes(requiredScope)) {
        return res
          .status(403)
          .json(
            serviceHelper.createErrorMessage(
              `API key missing required scope: ${requiredScope}`,
              'ForbiddenError',
              'API_KEY_SCOPE_MISSING',
            ),
          );
      }

      // Attach the key's OWN org (never the URL) + scopes + id + creator.
      req.apiOrgId = result.organizationId;
      req.apiScopes = result.scopes;
      req.apiKeyId = result.keyId;
      req.keyId = result.keyId;
      req.apiKeyCreatedBy = result.createdBy;

      // Throttled best-effort lastUsed touch — never blocks the request.
      void enterpriseHooks.apiKeyTouch(req).catch((err: unknown) => {
        log.warn(
          `[API-KEY] touch failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

      // Sampled, fire-and-forget request telemetry written AFTER the response
      // is sent (so we capture the final status code). Never blocks the request
      // and never throws into it.
      const keyId = result.keyId;
      const orgId = result.organizationId;
      const ip =
        (typeof req.headers['x-forwarded-for'] === 'string'
          ? req.headers['x-forwarded-for'].split(',')[0].trim()
          : undefined) || req.socket?.remoteAddress;
      res.on('finish', () => {
        try {
          enterpriseHooks.apiKeyLog({
            keyId,
            organizationId: orgId,
            method: req.method,
            // Route template path (no query string, bounded by the enterprise layer).
            path: req.originalUrl.split('?')[0],
            status: res.statusCode,
            ip,
          });
        } catch (err) {
          log.warn(
            `[API-KEY] request log failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      });

      next();
    } catch (err) {
      log.error(
        `[API-KEY] auth middleware error: ${err instanceof Error ? err.message : err}`,
      );
      return res
        .status(500)
        .json(
          serviceHelper.createErrorMessage(
            'API key verification failed',
            'InternalError',
            'API_KEY_INTERNAL_ERROR',
          ),
        );
    }
  };
}

export default { apiKeyAuth };
