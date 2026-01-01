/**
 * Validation utilities for wk_sign message format.
 *
 * Messages must be:
 * - Plain text string
 * - Start with a 13-digit millisecond timestamp
 * - Valid for ~15 minutes from timestamp
 * - Not more than 5 minutes in the future
 */

// Message validity window in milliseconds (15 minutes)
const MESSAGE_VALIDITY_MS = 15 * 60 * 1000;

// Maximum future timestamp drift allowed (5 minutes)
const MAX_FUTURE_DRIFT_MS = 5 * 60 * 1000;

// Minimum message length: 13 (timestamp) + 32 (16 bytes random as hex) = 45 chars for proper security
const MIN_MESSAGE_LENGTH = 45;

// Maximum message length to prevent abuse
const MAX_MESSAGE_LENGTH = 500;

export interface WkSignMessageValidation {
  valid: boolean;
  error?: string;
  timestamp?: number;
  validTill?: number;
}

/**
 * Validates a wk_sign message format.
 * Message should start with a 13-digit millisecond timestamp followed by random data.
 *
 * @param message - The plain text message to validate
 * @returns Validation result with timestamp info if valid
 */
export function validateWkSignMessage(message: string): WkSignMessageValidation {
  // Check if message exists and is a string
  if (!message || typeof message !== 'string') {
    return {
      valid: false,
      error: 'Message is required and must be a string',
    };
  }

  // Check minimum length (13 timestamp + 32 random hex = 45 chars minimum for security)
  if (message.length < MIN_MESSAGE_LENGTH) {
    return {
      valid: false,
      error: `Message is too short (minimum ${MIN_MESSAGE_LENGTH} characters)`,
    };
  }

  // Check maximum length
  if (message.length > MAX_MESSAGE_LENGTH) {
    return {
      valid: false,
      error: `Message is too long (maximum ${MAX_MESSAGE_LENGTH} characters)`,
    };
  }

  // Extract timestamp (first 13 characters = milliseconds)
  const timestampStr = message.substring(0, 13);
  const timestamp = parseInt(timestampStr, 10);

  if (isNaN(timestamp)) {
    return {
      valid: false,
      error: 'Invalid timestamp in message',
    };
  }

  // Validate timestamp is reasonable (not year 3000 or year 1970)
  const now = Date.now();
  const minReasonableTimestamp = 1577836800000; // Jan 1, 2020
  const maxReasonableTimestamp = 4102444800000; // Jan 1, 2100

  if (
    timestamp < minReasonableTimestamp ||
    timestamp > maxReasonableTimestamp
  ) {
    return {
      valid: false,
      error: 'Timestamp is out of reasonable range',
    };
  }

  // Calculate validity window
  const validTill = timestamp + MESSAGE_VALIDITY_MS;

  // Check if message has expired
  if (now > validTill) {
    return {
      valid: false,
      error: 'Message has expired',
    };
  }

  // Check if timestamp is too far in the future
  if (timestamp > now + MAX_FUTURE_DRIFT_MS) {
    return {
      valid: false,
      error: 'Message timestamp is too far in the future',
    };
  }

  return {
    valid: true,
    timestamp,
    validTill,
  };
}

/**
 * Validates the wksigningrequest payload structure.
 *
 * @param payload - The parsed JSON payload
 * @returns Validation result
 */
export function validateWkSigningRequestPayload(payload: unknown): {
  valid: boolean;
  error?: string;
} {
  if (!payload || typeof payload !== 'object') {
    return {
      valid: false,
      error: 'Payload must be a valid JSON object',
    };
  }

  const p = payload as Record<string, unknown>;

  // Validate message field
  if (!p.message || typeof p.message !== 'string') {
    return {
      valid: false,
      error: 'Payload must include message field',
    };
  }

  // Validate the message format
  const messageValidation = validateWkSignMessage(p.message);
  if (!messageValidation.valid) {
    return {
      valid: false,
      error: `Invalid message: ${messageValidation.error}`,
    };
  }

  // Validate walletSignature
  if (!p.walletSignature || typeof p.walletSignature !== 'string') {
    return {
      valid: false,
      error: 'Payload must include walletSignature field',
    };
  }

  // Validate walletPubKey (66 hex chars for compressed public key)
  if (
    !p.walletPubKey ||
    typeof p.walletPubKey !== 'string' ||
    !/^[0-9a-fA-F]{66}$/.test(p.walletPubKey)
  ) {
    return {
      valid: false,
      error: 'Payload must include valid walletPubKey (66 hex characters)',
    };
  }

  // Validate witnessScript (hex string)
  if (
    !p.witnessScript ||
    typeof p.witnessScript !== 'string' ||
    !/^[0-9a-fA-F]+$/.test(p.witnessScript)
  ) {
    return {
      valid: false,
      error: 'Payload must include valid witnessScript (hex)',
    };
  }

  // Validate wkIdentity
  if (!p.wkIdentity || typeof p.wkIdentity !== 'string') {
    return {
      valid: false,
      error: 'Payload must include wkIdentity field',
    };
  }

  // Validate requestId
  if (!p.requestId || typeof p.requestId !== 'string') {
    return {
      valid: false,
      error: 'Payload must include requestId field',
    };
  }

  // Validate optional requesterInfo if present
  if (p.requesterInfo !== undefined) {
    if (typeof p.requesterInfo !== 'object' || p.requesterInfo === null) {
      return {
        valid: false,
        error: 'requesterInfo must be an object',
      };
    }

    const ri = p.requesterInfo as Record<string, unknown>;

    // origin is required in requesterInfo
    if (!ri.origin || typeof ri.origin !== 'string') {
      return {
        valid: false,
        error: 'requesterInfo.origin is required and must be a string',
      };
    }

    // Validate origin length
    if (ri.origin.length > 100) {
      return {
        valid: false,
        error: 'requesterInfo.origin must be 100 characters or less',
      };
    }

    // Validate optional siteName
    if (ri.siteName !== undefined && typeof ri.siteName !== 'string') {
      return {
        valid: false,
        error: 'requesterInfo.siteName must be a string',
      };
    }
    if (typeof ri.siteName === 'string' && ri.siteName.length > 100) {
      return {
        valid: false,
        error: 'requesterInfo.siteName must be 100 characters or less',
      };
    }

    // Validate optional description
    if (ri.description !== undefined && typeof ri.description !== 'string') {
      return {
        valid: false,
        error: 'requesterInfo.description must be a string',
      };
    }
    if (typeof ri.description === 'string' && ri.description.length > 500) {
      return {
        valid: false,
        error: 'requesterInfo.description must be 500 characters or less',
      };
    }

    // Validate optional iconUrl - must be HTTPS
    if (ri.iconUrl !== undefined) {
      if (typeof ri.iconUrl !== 'string') {
        return {
          valid: false,
          error: 'requesterInfo.iconUrl must be a string',
        };
      }
      if (ri.iconUrl.length > 500) {
        return {
          valid: false,
          error: 'requesterInfo.iconUrl must be 500 characters or less',
        };
      }
      try {
        const url = new URL(ri.iconUrl);
        if (url.protocol !== 'https:') {
          return {
            valid: false,
            error: 'requesterInfo.iconUrl must use HTTPS',
          };
        }
      } catch {
        return {
          valid: false,
          error: 'requesterInfo.iconUrl must be a valid URL',
        };
      }
    }
  }

  return { valid: true };
}

export default {
  validateWkSignMessage,
  validateWkSigningRequestPayload,
};
