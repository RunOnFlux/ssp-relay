/**
 * Authentication Types for SSP Relay
 *
 * Defines the types used for Bitcoin signature-based authentication
 * of identities (wkIdentity, walletIdentity, keyIdentity).
 */

/**
 * Signature payload that must be signed by the client.
 * This structure ensures replay attack prevention and action binding.
 */
export interface SignaturePayload {
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** The action being performed: sync, action, token, or join */
  action: 'sync' | 'action' | 'token' | 'join';
  /** The identity being authenticated (wkIdentity, walletIdentity, etc.) */
  identity: string;
  /** Random 32-byte hex string to prevent replay attacks */
  nonce: string;
  /** Optional: SHA256 hash of request body for POST request binding */
  data?: string;
}

/**
 * Authentication fields that must be included in authenticated requests.
 */
export interface AuthFields {
  /** Base64-encoded Bitcoin signed message */
  signature: string;
  /** JSON string of SignaturePayload that was signed */
  message: string;
  /** Hex-encoded 33-byte compressed public key of the signer */
  publicKey: string;
  /** Hex-encoded witness script (required for multisig wkIdentity) */
  witnessScript?: string;
}

/**
 * Result of signature verification.
 */
export interface VerificationResult {
  /** Whether the verification was successful */
  valid: boolean;
  /** Error message if verification failed */
  error?: string;
  /** The verified identity */
  identity?: string;
  /** The public key that signed the message (hex) */
  signerPublicKey?: string;
}

/**
 * Parsed witness script information for multisig addresses.
 */
export interface ParsedWitnessScript {
  /** Number of required signatures (m in m-of-n) */
  m: number;
  /** Total number of public keys (n in m-of-n) */
  n: number;
  /** Array of public keys in the multisig (hex-encoded) */
  publicKeys: string[];
}

/**
 * Supported Bitcoin networks for address derivation.
 */
export type BitcoinNetwork = 'mainnet' | 'testnet';
