/**
 * Authentication Middleware for SSP Relay
 *
 * Provides Express middleware for verifying Bitcoin signature-based
 * authentication on protected endpoints.
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import {
  verifySingleSigAuth,
  verifyMultisigAuth,
  isMultisigIdentity,
  detectNetworkFromAddress,
  AuthFields,
  SignaturePayload,
  VerificationResult,
} from '../lib/identityAuth';
import log from '../lib/log';
import serviceHelper from '../services/serviceHelper';

/**
 * Compute SHA256 hash of request body (excluding auth fields).
 */
function computeBodyHash(body: Record<string, unknown>): string {
  // Strip auth fields before hashing
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { signature, message, publicKey, witnessScript, ...dataToHash } = body;
  const jsonString = JSON.stringify(dataToHash);
  return crypto.createHash('sha256').update(jsonString).digest('hex');
}

/**
 * Extended Express Request with authentication properties.
 */
export interface AuthenticatedRequest extends Request {
  /** The verified identity after successful authentication */
  verifiedIdentity?: string;
  /** The public key that signed the authentication message */
  signerPublicKey?: string;
  /** Whether authentication was performed */
  isAuthenticated?: boolean;
}

/**
 * Configuration options for the auth middleware.
 */
interface AuthMiddlewareOptions {
  /** Whether authentication is required (false allows requests without auth) */
  required?: boolean;
  /** Custom error message for auth failures */
  errorMessage?: string;
}

/**
 * Create authentication middleware for a specific identity field.
 *
 * @param identityField - The field name in req.body containing the identity to verify
 * @param options - Configuration options
 * @returns Express middleware function
 */
export function requireAuth(
  identityField: string,
  options: AuthMiddlewareOptions = {},
) {
  const { required = true, errorMessage = 'Authentication failed' } = options;

  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { signature, message, publicKey, witnessScript } = req.body;
      const identity = req.body[identityField];

      // Check if auth fields are present
      const hasAuthFields = signature && message && publicKey;

      log.info(
        `[AUTH] ${req.method} ${req.path} - identity: ${identity || 'none'}, hasAuth: ${hasAuthFields}`,
      );

      // If auth is not required and no auth fields provided, continue
      if (!required && !hasAuthFields) {
        log.warn(
          `[AUTH] SKIPPED - Unauthenticated request to ${req.path} for ${identity || 'unknown identity'} (auth optional)`,
        );
        req.isAuthenticated = false;
        return next();
      }

      // Validate required fields
      if (!signature || typeof signature !== 'string') {
        return res
          .status(401)
          .json(
            serviceHelper.createErrorMessage(
              'Missing or invalid signature field',
              'AuthenticationError',
              'AUTH_MISSING_SIGNATURE',
            ),
          );
      }

      if (!message || typeof message !== 'string') {
        return res
          .status(401)
          .json(
            serviceHelper.createErrorMessage(
              'Missing or invalid message field',
              'AuthenticationError',
              'AUTH_MISSING_MESSAGE',
            ),
          );
      }

      if (!publicKey || typeof publicKey !== 'string') {
        return res
          .status(401)
          .json(
            serviceHelper.createErrorMessage(
              'Missing or invalid publicKey field',
              'AuthenticationError',
              'AUTH_MISSING_PUBLIC_KEY',
            ),
          );
      }

      if (!identity || typeof identity !== 'string') {
        return res
          .status(400)
          .json(
            serviceHelper.createErrorMessage(
              `Missing or invalid ${identityField}`,
              'ValidationError',
              'MISSING_IDENTITY',
            ),
          );
      }

      // Validate publicKey format (should be 66 hex characters for compressed key)
      if (!/^[a-fA-F0-9]{66}$/.test(publicKey)) {
        return res
          .status(401)
          .json(
            serviceHelper.createErrorMessage(
              'Invalid publicKey format: expected 66 hex characters (33-byte compressed key)',
              'AuthenticationError',
              'AUTH_INVALID_PUBLIC_KEY',
            ),
          );
      }

      // Detect network from identity address
      const network = detectNetworkFromAddress(identity);

      // Prepare auth data
      const authData: AuthFields = {
        signature,
        message,
        publicKey,
        ...(witnessScript && { witnessScript }),
      };

      // Verify based on identity type
      let result: VerificationResult;
      if (isMultisigIdentity(identity)) {
        // Multisig (wkIdentity) - requires witness script
        if (!witnessScript || typeof witnessScript !== 'string') {
          return res
            .status(401)
            .json(
              serviceHelper.createErrorMessage(
                'witnessScript required for multisig identity authentication',
                'AuthenticationError',
                'AUTH_MISSING_WITNESS_SCRIPT',
              ),
            );
        }

        // Validate witnessScript format (should be hex)
        if (!/^[a-fA-F0-9]+$/.test(witnessScript)) {
          return res
            .status(401)
            .json(
              serviceHelper.createErrorMessage(
                'Invalid witnessScript format: expected hex string',
                'AuthenticationError',
                'AUTH_INVALID_WITNESS_SCRIPT',
              ),
            );
        }

        result = verifyMultisigAuth(authData, identity, network);
      } else {
        // Single-sig (walletIdentity, keyIdentity)
        result = verifySingleSigAuth(authData, identity, network);
      }

      if (!result.valid) {
        log.warn(
          `[AUTH] FAILED - ${identity} on ${req.path}: ${result.error}`,
        );
        return res
          .status(401)
          .json(
            serviceHelper.createErrorMessage(
              result.error || errorMessage,
              'AuthenticationError',
              'AUTH_FAILED',
            ),
          );
      }

      log.info(
        `[AUTH] SIGNATURE VALID - ${identity} signed by ${result.signerPublicKey?.substring(0, 16)}...`,
      );

      // Verify request body hash matches signed data hash
      let signedPayload: SignaturePayload;
      try {
        signedPayload = JSON.parse(message);
      } catch {
        return res
          .status(401)
          .json(
            serviceHelper.createErrorMessage(
              'Invalid signed message format',
              'AuthenticationError',
              'AUTH_INVALID_MESSAGE',
            ),
          );
      }

      // If the signed payload includes a data hash, verify it matches the request body
      if (signedPayload.data) {
        const actualBodyHash = computeBodyHash(req.body);
        if (signedPayload.data !== actualBodyHash) {
          log.warn(
            `Body hash mismatch for ${identity} on ${req.path}: signed=${signedPayload.data.substring(0, 16)}... actual=${actualBodyHash.substring(0, 16)}...`,
          );
          return res
            .status(401)
            .json(
              serviceHelper.createErrorMessage(
                'Request body does not match signed data hash (possible tampering)',
                'AuthenticationError',
                'AUTH_BODY_HASH_MISMATCH',
              ),
            );
        }
        log.info(`[AUTH] BODY HASH VERIFIED - ${identity} on ${req.path}`);
      } else {
        // No data hash in signature - log warning but allow during transition period
        log.warn(
          `[AUTH] NO BODY HASH - ${identity} on ${req.path} (legacy client, signature valid but no data binding)`,
        );
      }

      // Attach verified identity to request for downstream use
      req.verifiedIdentity = identity;
      req.signerPublicKey = result.signerPublicKey;
      req.isAuthenticated = true;

      log.info(
        `[AUTH] SUCCESS - ${identity} on ${req.path} fully authenticated`,
      );

      next();
    } catch (err) {
      log.error(
        `Auth middleware error: ${err instanceof Error ? err.message : err}`,
      );
      return res
        .status(500)
        .json(
          serviceHelper.createErrorMessage(
            'Authentication verification failed due to internal error',
            'InternalError',
            'AUTH_INTERNAL_ERROR',
          ),
        );
    }
  };
}

/**
 * Middleware for authenticating wkIdentity (multisig) requests.
 * Used for: POST /v1/action, POST /v1/token
 */
export const requireWkIdentityAuth = requireAuth('wkIdentity');

/**
 * Middleware for authenticating walletIdentity (single-sig) requests.
 * Used for: POST /v1/sync (from SSP Key)
 */
export const requireWalletIdentityAuth = requireAuth('walletIdentity');

/**
 * Optional authentication middleware for backward compatibility.
 * Allows unauthenticated requests but logs warnings.
 */
export const optionalWkIdentityAuth = requireAuth('wkIdentity', {
  required: false,
});

export const optionalWalletIdentityAuth = requireAuth('walletIdentity', {
  required: false,
});

/**
 * Strip authentication fields from request body before storage.
 * This should be called after authentication to remove sensitive fields.
 *
 * @param body - The request body
 * @returns Body without authentication fields
 */
export function stripAuthFields<T extends Record<string, unknown>>(
  body: T,
): Omit<T, 'signature' | 'message' | 'publicKey' | 'witnessScript'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { signature, message, publicKey, witnessScript, ...rest } = body;
  return rest as Omit<
    T,
    'signature' | 'message' | 'publicKey' | 'witnessScript'
  >;
}
