/**
 * Authentication Middleware for SSP Relay
 *
 * Provides Express middleware for verifying Bitcoin signature-based
 * authentication on protected endpoints.
 *
 * Two flavours:
 * - requireAuth(identityField): body-signed POSTs. The signed payload carries
 *   a hash of the body (minus the auth envelope) so the signature binds the
 *   request content.
 * - requireReadAuth(paramName): header-signed GET reads (action 'read'). The
 *   signed payload carries sha256("GET <path>") so a read signature binds the
 *   exact resource and cannot be spent on any other request.
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import {
  verifySingleSigAuth,
  verifyMultisigAuth,
  isMultisigIdentity,
  detectNetworkFromAddress,
  READ_ACTIONS,
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
 * The `data` hash a client signs for a header-authenticated GET: sha256 hex of
 * the UTF-8 string `GET <path>`, where <path> is the request path without the
 * query string (e.g. `GET /v1/action/bc1q…`).
 */
export function computeReadPathHash(path: string): string {
  return crypto
    .createHash('sha256')
    .update(`GET ${path}`, 'utf8')
    .digest('hex');
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
  /**
   * Set when an unsigned request was let through ONLY because the operator
   * enabled RELAY_LEGACY_UNAUTH_MODE=log (or, for reads, because
   * RELAY_READ_AUTH_MODE is still 'log'). Downstream code must treat the
   * request as unauthenticated: verifiedIdentity is not set.
   */
  legacyUnauthenticated?: boolean;
  /**
   * Set by requireReadAuth (with allowUnsignedRecoveryRead) for an UNSIGNED
   * read under RELAY_READ_AUTH_MODE=enforce: the handler may only return a
   * wallet-recovery answer (recoveryresponse / recoverydenied), whose payload
   * is encrypted to the recovering wallet's ephemeral key.
   */
  recoveryOnlyRead?: boolean;
}

/**
 * RELAY_LEGACY_UNAUTH_MODE: what to do with UNSIGNED requests on the POST
 * endpoints that released clients (wallet 2.1.3 / Key 2.1.1) do not always
 * sign yet (POST /v1/sync, /v1/nonces*, /v1/sol/broadcast, /v1/sol/setup).
 *   - 'log' (default while the released clients are in use): let the request
 *     through unauthenticated and log it. Without it, pairing, chain sync,
 *     enterprise nonce replenish and consumer Solana sends break for every
 *     released wallet/Key.
 *   - 'deny': refuse with 401. Flip to this once the new wallet and Key have
 *     reached adoption.
 *   - any other non-empty value: treated as 'deny' (a typo fails closed).
 * Read per request so the operator can flip it without a code change.
 */
export type LegacyUnauthMode = 'deny' | 'log';
export function legacyUnauthMode(): LegacyUnauthMode {
  const raw = process.env.RELAY_LEGACY_UNAUTH_MODE;
  if (raw === undefined || raw === '' || raw === 'log') return 'log';
  return 'deny';
}

/**
 * Startup banner for the transitional auth modes. 'log' modes keep released
 * clients working but leave the gated endpoints open to unsigned callers, so
 * they are announced loudly at boot (each unsigned request is also logged).
 */
export function logAuthModeBanner(): void {
  if (legacyUnauthMode() === 'log') {
    log.warn(
      '[AUTH] WARNING: RELAY_LEGACY_UNAUTH_MODE=log — UNSIGNED requests to POST /v1/sync, /v1/nonces, /v1/nonces/validate, /v1/nonces/reconcile, /v1/sol/broadcast and /v1/sol/setup are ACCEPTED (unauthenticated) for released wallet/Key compatibility. Set RELAY_LEGACY_UNAUTH_MODE=deny once the new SSP Wallet and SSP Key have reached adoption.',
    );
  } else {
    log.info(
      '[AUTH] RELAY_LEGACY_UNAUTH_MODE=deny — unsigned requests to the legacy-gated POST endpoints are refused',
    );
  }
  if (readAuthMode() === 'log') {
    log.warn(
      '[AUTH] WARNING: RELAY_READ_AUTH_MODE=log — UNSIGNED reads of GET /v1/action/:id, /v1/sync/:id and /v1/nonces/status/:id are served. Set RELAY_READ_AUTH_MODE=enforce once the new SSP Wallet and SSP Key have reached adoption.',
    );
  }
}

/**
 * RELAY_READ_AUTH_MODE: what to do with UNSIGNED GET reads (requireReadAuth).
 *   - 'log' (default until the new apps reach adoption): serve and log.
 *   - 'enforce': refuse with 401.
 * Bad (present but invalid) read auth is refused in both modes.
 */
export type ReadAuthMode = 'log' | 'enforce';
export function readAuthMode(): ReadAuthMode {
  return process.env.RELAY_READ_AUTH_MODE === 'enforce' ? 'enforce' : 'log';
}

/**
 * How an endpoint treats requests that carry NO auth fields at all.
 *   - 'deny': always refused (401). The endpoint is signed by every released
 *     client whenever it can sign at all.
 *   - 'legacy': governed by RELAY_LEGACY_UNAUTH_MODE (log by default).
 */
type UnauthenticatedPolicy = 'deny' | 'legacy';

/**
 * Configuration options for the auth middleware.
 */
interface AuthMiddlewareOptions {
  /**
   * The signed payload actions this endpoint accepts. A signature made for one
   * endpoint (e.g. a /v1/token 'token' payload) can then never be spent on
   * another (e.g. /v1/action). Required: every route states its own.
   */
  actions: readonly SignaturePayload['action'][];
  /** Policy for requests without any auth fields. Default 'deny'. */
  unauthenticated?: UnauthenticatedPolicy;
  /**
   * A narrow, by-design exception: when this returns true for an unsigned
   * request, the request is let through unauthenticated regardless of the
   * policy (e.g. the wallet-recovery request, which is sent by a wallet that
   * has no keys yet). Must only match requests that cannot be signed.
   */
  allowUnauthenticated?: (req: AuthenticatedRequest) => boolean;
  /** Custom error message for auth failures */
  errorMessage?: string;
}

function sendAuthError(
  res: Response,
  status: number,
  message: string,
  code: string,
  name = 'AuthenticationError',
) {
  return res
    .status(status)
    .json(serviceHelper.createErrorMessage(message, name, code));
}

function resetAuthState(req: AuthenticatedRequest): void {
  // Never trust flags a previous middleware or the client left behind.
  req.verifiedIdentity = undefined;
  req.signerPublicKey = undefined;
  req.isAuthenticated = false;
  req.legacyUnauthenticated = false;
  req.recoveryOnlyRead = false;
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
  options: AuthMiddlewareOptions,
) {
  const {
    actions,
    unauthenticated = 'deny',
    allowUnauthenticated,
    errorMessage = 'Authentication failed',
  } = options;
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error('requireAuth: the accepted signed actions must be listed');
  }
  if (actions.includes('read')) {
    throw new Error("requireAuth: 'read' is only valid for requireReadAuth");
  }

  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      resetAuthState(req);

      const body =
        req.body && typeof req.body === 'object' && !Array.isArray(req.body)
          ? req.body
          : {};
      const { signature, message, publicKey, witnessScript } = body;
      const identity = body[identityField];

      // Check if auth fields are present
      const hasAuthFields = Boolean(signature && message && publicKey);
      // Partial credentials are never something a real client sends: the
      // helpers that build these attach all three together. Treating a partial
      // set as "unauthenticated" would let anyone turn a signed request into an
      // unsigned one just by dropping a field, so it is refused rather than
      // waved through.
      const hasPartialAuthFields =
        !hasAuthFields && Boolean(signature || message || publicKey);

      log.info(
        `[AUTH] ${req.method} ${req.path} - identity: ${identity || 'none'}, hasAuth: ${hasAuthFields}`,
      );

      if (hasPartialAuthFields) {
        log.warn(
          `[AUTH] INCOMPLETE - Partial credentials on ${req.path} for ${identity || 'unknown identity'}`,
        );
        return sendAuthError(
          res,
          401,
          'Incomplete authentication fields',
          'AUTH_INCOMPLETE',
        );
      }

      if (!hasAuthFields) {
        if (allowUnauthenticated && allowUnauthenticated(req)) {
          log.warn(
            `[AUTH] UNSIGNED (by design) - ${req.path} for ${identity || 'unknown identity'}`,
          );
          return next();
        }
        if (unauthenticated === 'legacy' && legacyUnauthMode() === 'log') {
          log.warn(
            `[AUTH] LEGACY UNSIGNED ALLOWED (RELAY_LEGACY_UNAUTH_MODE=log) - ${req.path} for ${identity || 'unknown identity'}`,
          );
          req.legacyUnauthenticated = true;
          return next();
        }
        log.warn(
          `[AUTH] REFUSED - Unsigned request to ${req.path} for ${identity || 'unknown identity'}`,
        );
        return sendAuthError(
          res,
          401,
          'Authentication required',
          'AUTH_REQUIRED',
        );
      }

      // Validate required fields
      if (typeof signature !== 'string') {
        return sendAuthError(
          res,
          401,
          'Missing or invalid signature field',
          'AUTH_MISSING_SIGNATURE',
        );
      }

      if (typeof message !== 'string') {
        return sendAuthError(
          res,
          401,
          'Missing or invalid message field',
          'AUTH_MISSING_MESSAGE',
        );
      }

      if (typeof publicKey !== 'string') {
        return sendAuthError(
          res,
          401,
          'Missing or invalid publicKey field',
          'AUTH_MISSING_PUBLIC_KEY',
        );
      }

      if (!identity || typeof identity !== 'string') {
        return sendAuthError(
          res,
          400,
          `Missing or invalid ${identityField}`,
          'MISSING_IDENTITY',
          'ValidationError',
        );
      }

      // Validate publicKey format (should be 66 hex characters for compressed key)
      if (!/^[a-fA-F0-9]{66}$/.test(publicKey)) {
        return sendAuthError(
          res,
          401,
          'Invalid publicKey format: expected 66 hex characters (33-byte compressed key)',
          'AUTH_INVALID_PUBLIC_KEY',
        );
      }

      // Bind the signed payload to THIS endpoint and THIS body before the
      // signature is verified (and its nonce spent): a payload signed for
      // another endpoint, or a body that differs from the signed hash, is
      // refused without consuming the nonce, so the honest request carrying
      // it still goes through.
      let signedPayload: SignaturePayload;
      try {
        signedPayload = JSON.parse(message);
      } catch {
        return sendAuthError(
          res,
          401,
          'Invalid signed message format',
          'AUTH_INVALID_MESSAGE',
        );
      }
      if (
        !signedPayload ||
        typeof signedPayload !== 'object' ||
        Array.isArray(signedPayload)
      ) {
        return sendAuthError(
          res,
          401,
          'Invalid signed message format',
          'AUTH_INVALID_MESSAGE',
        );
      }
      if (!actions.includes(signedPayload.action)) {
        log.warn(
          `[AUTH] ACTION MISMATCH - ${identity} on ${req.path}: signed '${String(signedPayload.action).slice(0, 32)}', accepted ${actions.join('|')}`,
        );
        return sendAuthError(
          res,
          401,
          `Signed action is not valid for this endpoint (expected ${actions.join(' or ')})`,
          'AUTH_ACTION_MISMATCH',
        );
      }
      // Every signed POST must carry the body hash. Every client that signs
      // (wallet 2.1.3+, Key 2.1.1+) always sends it.
      if (typeof signedPayload.data !== 'string' || !signedPayload.data) {
        log.warn(
          `[AUTH] NO BODY HASH - ${identity} on ${req.path} (refused: signed requests must bind the body)`,
        );
        return sendAuthError(
          res,
          401,
          'Signed payload must bind the request body (data hash missing)',
          'AUTH_BODY_HASH_REQUIRED',
        );
      }
      const actualBodyHash = computeBodyHash(body);
      if (signedPayload.data !== actualBodyHash) {
        log.warn(
          `Body hash mismatch for ${identity} on ${req.path}: signed=${signedPayload.data.substring(0, 16)}... actual=${actualBodyHash.substring(0, 16)}...`,
        );
        return sendAuthError(
          res,
          401,
          'Request body does not match signed data hash (possible tampering)',
          'AUTH_BODY_HASH_MISMATCH',
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
          return sendAuthError(
            res,
            401,
            'witnessScript required for multisig identity authentication',
            'AUTH_MISSING_WITNESS_SCRIPT',
          );
        }

        // Validate witnessScript format (should be hex)
        if (!/^[a-fA-F0-9]+$/.test(witnessScript)) {
          return sendAuthError(
            res,
            401,
            'Invalid witnessScript format: expected hex string',
            'AUTH_INVALID_WITNESS_SCRIPT',
          );
        }

        // allowIdenticalReplay: mobile transport layers sometimes resend a
        // POST whose response was lost, carrying the same signed payload —
        // such byte-identical duplicates are acknowledged below instead of
        // being refused as replays.
        result = verifyMultisigAuth(authData, identity, network, {
          allowIdenticalReplay: true,
          allowedActions: actions,
        });
      } else {
        // Single-sig (walletIdentity, keyIdentity)
        result = verifySingleSigAuth(authData, identity, network, {
          allowIdenticalReplay: true,
          allowedActions: actions,
        });
      }

      if (!result.valid) {
        log.warn(`[AUTH] FAILED - ${identity} on ${req.path}: ${result.error}`);
        if (result.unavailable) {
          return sendAuthError(
            res,
            503,
            result.error || 'Authentication temporarily unavailable',
            'AUTH_UNAVAILABLE',
            'ServiceUnavailable',
          );
        }
        return sendAuthError(
          res,
          401,
          result.error || errorMessage,
          'AUTH_FAILED',
        );
      }

      log.info(
        `[AUTH] SIGNATURE VALID - ${identity} signed by ${result.signerPublicKey?.substring(0, 16)}... (body hash bound)`,
      );

      // A byte-identical resend of an already-accepted request: acknowledge
      // it without running the handler again, so the retrying client gets a
      // success instead of a nonce-replay 401 while the request's effects
      // still apply exactly once. Safe because the body hash (checked above)
      // binds the signature to this exact body.
      if (result.duplicate) {
        log.info(
          `[AUTH] DUPLICATE ACKNOWLEDGED - ${identity} on ${req.path} (identical resend of an accepted request)`,
        );
        return res.status(200).json(
          serviceHelper.createDataMessage({
            message: 'Request already processed',
            duplicate: true,
          }),
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
      return sendAuthError(
        res,
        500,
        'Authentication verification failed due to internal error',
        'AUTH_INTERNAL_ERROR',
        'InternalError',
      );
    }
  };
}

/** Header names for authenticated GET reads (lower-case, as Node exposes them). */
export const READ_AUTH_HEADERS = {
  signature: 'x-ssp-signature',
  message: 'x-ssp-message',
  publicKey: 'x-ssp-publickey',
  witnessScript: 'x-ssp-witnessscript',
} as const;

function headerValue(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
}

// Unsigned reads are expected in bulk while RELAY_READ_AUTH_MODE=log (every
// released client polls unsigned). Log each resource at most once per window
// so the log records who still polls unsigned without flooding it.
const UNSIGNED_READ_LOG_WINDOW_MS = 10 * 60 * 1000;
const UNSIGNED_READ_LOG_MAX_ENTRIES = 5000;
const unsignedReadLogged = new Map<string, number>();
function logUnsignedRead(path: string): void {
  const now = Date.now();
  const last = unsignedReadLogged.get(path);
  if (last !== undefined && now - last < UNSIGNED_READ_LOG_WINDOW_MS) return;
  if (unsignedReadLogged.size >= UNSIGNED_READ_LOG_MAX_ENTRIES) {
    unsignedReadLogged.clear();
  }
  unsignedReadLogged.set(path, now);
  log.info(`[READ AUTH] UNSIGNED read served (log mode) - ${path}`);
}

/**
 * Header-based authentication for GET reads (RA-4).
 *
 * The client sends, all together or not at all:
 *   x-ssp-signature      base64 Bitcoin message signature
 *   x-ssp-message        JSON SignaturePayload: action 'read', identity = the
 *                        identity in the URL, timestamp (ms), nonce (64 hex),
 *                        data = sha256 hex of `GET <path>` (path without query)
 *   x-ssp-publickey      66-hex compressed public key of the signer
 *   x-ssp-witnessscript  hex witness script (required for multisig identities)
 *
 * Verification is the same as requireAuth's (identity-derived address, signer
 * in the 2-of-2 script, signature, timestamp drift, single-use nonce) plus the
 * path-hash binding. Reads are strictly at-most-once per nonce: an identical
 * replay is refused; polling clients sign each poll afresh.
 *
 * RELAY_READ_AUTH_MODE decides what happens to UNSIGNED reads (see
 * readAuthMode). Bad auth is refused in every mode.
 *
 * @param paramName - The route param holding the identity (falls back to
 *   `?id=` for routes that also accept the identity as a query parameter)
 */
export function requireReadAuth(
  paramName: string,
  options: {
    /**
     * Under 'enforce', still let an UNSIGNED read through with
     * req.recoveryOnlyRead = true; the handler must then return nothing but a
     * wallet-recovery answer. Only for GET /v1/action/:id, which a recovering
     * wallet (no keys) polls.
     */
    allowUnsignedRecoveryRead?: boolean;
  } = {},
) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      resetAuthState(req);

      const paramValue = req.params?.[paramName];
      const queryId = req.query?.id;
      const identity =
        typeof paramValue === 'string' && paramValue
          ? paramValue
          : typeof queryId === 'string'
            ? queryId
            : undefined;
      const path = (req.originalUrl || req.url || '').split('?')[0];

      const headerNames = Object.values(READ_AUTH_HEADERS);
      const anyAuthHeader = headerNames.some(
        (h) => req.headers[h] !== undefined,
      );

      if (!anyAuthHeader) {
        if (readAuthMode() === 'enforce') {
          if (options.allowUnsignedRecoveryRead) {
            req.recoveryOnlyRead = true;
            return next();
          }
          log.warn(`[READ AUTH] REFUSED - unsigned read of ${path}`);
          return sendAuthError(
            res,
            401,
            'Authentication required',
            'AUTH_REQUIRED',
          );
        }
        logUnsignedRead(path);
        req.legacyUnauthenticated = true;
        return next();
      }

      // Repeated headers arrive as arrays (or comma-joined): refuse anything
      // that is not exactly one string value.
      const signature = headerValue(req, READ_AUTH_HEADERS.signature);
      const message = headerValue(req, READ_AUTH_HEADERS.message);
      const publicKey = headerValue(req, READ_AUTH_HEADERS.publicKey);
      const witnessScript = headerValue(req, READ_AUTH_HEADERS.witnessScript);

      if (!signature || !message || !publicKey) {
        log.warn(`[READ AUTH] INCOMPLETE - partial read auth on ${path}`);
        return sendAuthError(
          res,
          401,
          'Incomplete authentication headers',
          'AUTH_INCOMPLETE',
        );
      }

      if (!identity) {
        return sendAuthError(
          res,
          401,
          'Missing identity for authenticated read',
          'AUTH_FAILED',
        );
      }

      if (!/^[a-fA-F0-9]{66}$/.test(publicKey)) {
        return sendAuthError(
          res,
          401,
          'Invalid publicKey format: expected 66 hex characters (33-byte compressed key)',
          'AUTH_INVALID_PUBLIC_KEY',
        );
      }

      // Bind the signature to this exact resource BEFORE verifying it, so a
      // signature for one path never consumes its nonce on another.
      let signedPayload: SignaturePayload;
      try {
        signedPayload = JSON.parse(message);
      } catch {
        return sendAuthError(
          res,
          401,
          'Invalid signed message format',
          'AUTH_INVALID_MESSAGE',
        );
      }
      if (
        !signedPayload ||
        typeof signedPayload !== 'object' ||
        signedPayload.action !== 'read'
      ) {
        return sendAuthError(
          res,
          401,
          "Signed read payload must have action 'read'",
          'AUTH_FAILED',
        );
      }
      if (signedPayload.identity !== identity) {
        return sendAuthError(
          res,
          401,
          'Signed identity does not match the requested identity',
          'AUTH_FAILED',
        );
      }
      if (signedPayload.data !== computeReadPathHash(path)) {
        log.warn(`[READ AUTH] PATH HASH MISMATCH - ${path}`);
        return sendAuthError(
          res,
          401,
          'Signed path hash does not match the request path',
          'AUTH_PATH_HASH_MISMATCH',
        );
      }

      const network = detectNetworkFromAddress(identity);
      const authData: AuthFields = {
        signature,
        message,
        publicKey,
        ...(witnessScript && { witnessScript }),
      };

      let result: VerificationResult;
      if (isMultisigIdentity(identity)) {
        if (!witnessScript || !/^[a-fA-F0-9]+$/.test(witnessScript)) {
          return sendAuthError(
            res,
            401,
            'x-ssp-witnessscript required for multisig identity authentication',
            'AUTH_MISSING_WITNESS_SCRIPT',
          );
        }
        result = verifyMultisigAuth(authData, identity, network, {
          allowedActions: READ_ACTIONS,
        });
      } else {
        result = verifySingleSigAuth(authData, identity, network, {
          allowedActions: READ_ACTIONS,
        });
      }

      if (!result.valid) {
        log.warn(
          `[READ AUTH] FAILED - ${identity} on ${path}: ${result.error}`,
        );
        if (result.unavailable) {
          return sendAuthError(
            res,
            503,
            result.error || 'Authentication temporarily unavailable',
            'AUTH_UNAVAILABLE',
            'ServiceUnavailable',
          );
        }
        return sendAuthError(
          res,
          401,
          result.error || 'Authentication failed',
          'AUTH_FAILED',
        );
      }

      req.verifiedIdentity = identity;
      req.signerPublicKey = result.signerPublicKey;
      req.isAuthenticated = true;
      next();
    } catch (err) {
      log.error(
        `Read auth middleware error: ${err instanceof Error ? err.message : err}`,
      );
      return sendAuthError(
        res,
        500,
        'Authentication verification failed due to internal error',
        'AUTH_INTERNAL_ERROR',
        'InternalError',
      );
    }
  };
}

/**
 * wkIdentity (multisig) auth for always-signed endpoints whose clients sign
 * the payload action 'action' (POST /v1/action, enterprise notification
 * endpoints). Unsigned requests are refused. Endpoints signed with another
 * action use requireAuth directly (/v1/token: 'token', /v1/recoverypub:
 * 'sync' — what SSP Key 2.1.1+ sends).
 */
export const requireWkIdentityAuth = requireAuth('wkIdentity', {
  actions: ['action'],
});

/**
 * wkIdentity auth (payload action 'action') for endpoints released clients do
 * not always sign yet (POST /v1/nonces*, /v1/sol/*). Unsigned requests follow
 * RELAY_LEGACY_UNAUTH_MODE (log by default; deny after client adoption).
 * POST /v1/sync is legacy-gated too but signed with action 'sync'.
 */
export const requireWkIdentityAuthLegacyGated = requireAuth('wkIdentity', {
  actions: ['action'],
  unauthenticated: 'legacy',
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
