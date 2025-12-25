# SSP Relay Security Implementation Plan

## Overview

This document outlines the implementation plan for adding cryptographic authentication to the SSP Relay. The goal is to ensure that only the legitimate owner of an identity (wkIdentity, walletIdentity, or keyIdentity) can perform actions on their behalf.

---

## Current Security Issues

### Critical Vulnerabilities

1. **No Authentication on Identity-Critical Endpoints**
   - `POST /v1/sync` - Anyone can register/modify sync data for any identity
   - `POST /v1/action` - Anyone can inject actions for any wkIdentity
   - `POST /v1/token` - Anyone can register push tokens for any identity

2. **WebSocket Room Hijacking**
   - Any client can join any `wkIdentity` room without proof of ownership
   - Allows eavesdropping on all signing requests and responses

3. **No Bitcoin Address Validation**
   - Identities are validated only as strings matching `[a-zA-Z0-9_:-]+`
   - No verification that wkIdentity is actually a valid Bitcoin multisig address

> **Note**: `/v1/sign/onramper` is excluded from this security update as it uses HMAC-based authentication with a shared secret.

---

## Identity Types & Authentication Requirements

### 1. wkIdentity (Wallet-Key Identity)

- **Type**: P2WSH 2-of-2 multisig native segwit address (bc1q...)
- **Derivation**: BIP48 `m/48'/{coin}'/0'/2'/10/0` using both wallet and key xpubs
- **Authentication**: Signature from EITHER participant's public key
- **Required for verification**:
  - `signature` - Bitcoin signed message (base64)
  - `message` - The signed payload (JSON string)
  - `publicKey` - 33-byte compressed public key (hex) of the signer
  - `witnessScript` - The 2-of-2 multisig witness script (hex)

### 2. walletIdentity (Wallet External Identity)

- **Type**: P2PKH single-sig address (1... or legacy format)
- **Derivation**: BIP48 `m/48'/{coin}'/0'/2'/11/0` from wallet's xpub only
- **Authentication**: Signature from the wallet's identity keypair
- **Required for verification**:
  - `signature` - Bitcoin signed message (base64)
  - `message` - The signed payload (JSON string)
  - `publicKey` - 33-byte compressed public key (hex)

### 3. keyIdentity (Key Internal Identity)

- **Type**: P2PKH single-sig address (1... or legacy format)
- **Derivation**: BIP48 `m/48'/{coin}'/0'/2'/10/0` from key's xpub only
- **Authentication**: Signature from the key's identity keypair
- **Required for verification**:
  - `signature` - Bitcoin signed message (base64)
  - `message` - The signed payload (JSON string)
  - `publicKey` - 33-byte compressed public key (hex)

---

## Signature Payload Format

All authenticated requests must include a signed message with the following structure:

```typescript
interface SignaturePayload {
  timestamp: number;    // Unix timestamp in milliseconds
  action: string;       // "sync" | "action" | "token" | "join"
  identity: string;     // The identity being authenticated (wkIdentity, walletIdentity, etc.)
  nonce: string;        // Random 32-byte hex string (prevents replay attacks)
  data?: string;        // Optional: hash of request body for POST requests
}
```

### Validation Rules

1. **Timestamp**: Must be within 5 minutes of server time (±300,000ms)
2. **Nonce**: Must be unique (server should track recent nonces to prevent replay)
3. **Identity**: Must match the identity in the request
4. **Data hash**: If present, must match SHA256 of request body (excluding auth fields)

---

## Implementation Steps

### Phase 1: Core Authentication Library

#### Step 1.1: Install Dependencies

```bash
yarn add bitcoinjs-message
yarn add -D @types/bitcoinjs-message
```

#### Step 1.2: Create Bitcoin Authentication Module

**File**: `src/lib/bitcoinAuth.ts`

```typescript
import * as bitcoin from '@runonflux/utxo-lib';
import bitcoinMessage from 'bitcoinjs-message';
import crypto from 'crypto';

// Types
interface SignaturePayload {
  timestamp: number;
  action: string;
  identity: string;
  nonce: string;
  data?: string;
}

interface AuthData {
  signature: string;      // Base64 Bitcoin signed message
  message: string;        // JSON string of SignaturePayload
  publicKey: string;      // Hex-encoded 33-byte compressed public key
  witnessScript?: string; // Hex-encoded witness script (for multisig only)
}

interface VerificationResult {
  valid: boolean;
  error?: string;
  identity?: string;
  signerPublicKey?: string;
}

// Constants
const MESSAGE_PREFIX = '\x18Bitcoin Signed Message:\n';
const MAX_TIMESTAMP_DRIFT_MS = 5 * 60 * 1000; // 5 minutes
const NONCE_CACHE_SIZE = 10000;
const NONCE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Nonce cache to prevent replay attacks
const nonceCache = new Map<string, number>();

/**
 * Verify a Bitcoin signed message
 */
export function verifyBitcoinSignature(
  message: string,
  signature: string,
  publicKey: string
): boolean;

/**
 * Derive P2PKH address from compressed public key
 */
export function deriveP2PKHAddress(
  publicKey: string,
  network: bitcoin.Network
): string;

/**
 * Derive P2WSH address from witness script
 */
export function deriveP2WSHAddress(
  witnessScript: string,
  network: bitcoin.Network
): string;

/**
 * Parse witness script and extract public keys
 */
export function parseWitnessScript(
  witnessScriptHex: string
): { m: number; n: number; publicKeys: string[] };

/**
 * Validate signature payload (timestamp, nonce, etc.)
 */
export function validateSignaturePayload(
  payload: SignaturePayload
): { valid: boolean; error?: string };

/**
 * Full authentication verification for single-sig identity
 */
export function verifySingleSigAuth(
  authData: AuthData,
  expectedIdentity: string,
  network: bitcoin.Network
): VerificationResult;

/**
 * Full authentication verification for multisig identity (wkIdentity)
 */
export function verifyMultisigAuth(
  authData: AuthData,
  expectedWkIdentity: string,
  network: bitcoin.Network
): VerificationResult;

/**
 * Clean up expired nonces from cache
 */
export function cleanupNonceCache(): void;
```

#### Step 1.3: Create Authentication Types

**File**: `src/types/auth.ts`

```typescript
export interface SignaturePayload {
  timestamp: number;
  action: 'sync' | 'action' | 'token' | 'join';
  identity: string;
  nonce: string;
  data?: string;
}

export interface AuthFields {
  signature: string;
  message: string;
  publicKey: string;
  witnessScript?: string;
}

export interface AuthenticatedRequest {
  // Original request fields
  [key: string]: unknown;
  // Auth fields
  auth: AuthFields;
}
```

---

### Phase 2: Middleware Implementation

#### Step 2.1: Create Authentication Middleware

**File**: `src/middleware/authMiddleware.ts`

```typescript
import { Request, Response, NextFunction } from 'express';
import { verifySingleSigAuth, verifyMultisigAuth } from '../lib/bitcoinAuth';
import { networks } from '@runonflux/utxo-lib';
import log from '../lib/log';

/**
 * Determine if an identity is a multisig (P2WSH) address
 */
function isMultisigIdentity(identity: string): boolean {
  // P2WSH addresses start with bc1q (mainnet) or tb1q (testnet) and are 62 chars
  return identity.startsWith('bc1q') || identity.startsWith('tb1q');
}

/**
 * Middleware to verify authentication on identity-critical endpoints
 */
export function requireAuth(identityField: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { signature, message, publicKey, witnessScript } = req.body;
      const identity = req.body[identityField];

      // Validate required fields
      if (!signature || !message || !publicKey) {
        return res.status(401).json({
          status: 'error',
          data: { message: 'Missing authentication fields: signature, message, publicKey required' }
        });
      }

      if (!identity) {
        return res.status(400).json({
          status: 'error',
          data: { message: `Missing ${identityField}` }
        });
      }

      // Determine network (could be based on chain param or config)
      const network = networks.bitcoin; // TODO: support testnet

      // Verify based on identity type
      let result;
      if (isMultisigIdentity(identity)) {
        if (!witnessScript) {
          return res.status(401).json({
            status: 'error',
            data: { message: 'witnessScript required for multisig identity' }
          });
        }
        result = verifyMultisigAuth(
          { signature, message, publicKey, witnessScript },
          identity,
          network
        );
      } else {
        result = verifySingleSigAuth(
          { signature, message, publicKey },
          identity,
          network
        );
      }

      if (!result.valid) {
        log.warn(`Authentication failed for ${identity}: ${result.error}`);
        return res.status(401).json({
          status: 'error',
          data: { message: result.error || 'Authentication failed' }
        });
      }

      // Attach verified identity to request for downstream use
      req.verifiedIdentity = identity;
      req.signerPublicKey = result.signerPublicKey;

      next();
    } catch (error) {
      log.error('Auth middleware error:', error);
      return res.status(500).json({
        status: 'error',
        data: { message: 'Authentication verification failed' }
      });
    }
  };
}
```

#### Step 2.2: Extend Express Request Type

**File**: `src/types/express.d.ts`

```typescript
declare namespace Express {
  interface Request {
    verifiedIdentity?: string;
    signerPublicKey?: string;
  }
}
```

---

### Phase 3: Endpoint Updates

#### Step 3.1: Update Sync API

**File**: `src/apiServices/syncApi.ts`

Changes required:
1. Import and apply `requireAuth('walletIdentity')` middleware to POST `/v1/sync`
2. For the wkIdentity field, verify signature against either wallet or key public key
3. Remove auth fields from stored data

```typescript
// Before storing in database, strip auth fields
const { signature, message, publicKey, witnessScript, ...syncData } = processedBody;
```

#### Step 3.2: Update Action API

**File**: `src/apiServices/actionApi.ts`

Changes required:
1. Import and apply `requireAuth('wkIdentity')` middleware to POST `/v1/action`
2. Require witnessScript since wkIdentity is always multisig
3. Verify the signature is from one of the two multisig participants

#### Step 3.3: Update Token API

**File**: `src/apiServices/syncApi.ts` (postToken function)

Changes required:
1. Apply authentication for the wkIdentity
2. Verify signature matches one of the participants

#### Step 3.4: Update Routes

**File**: `src/routes.ts`

```typescript
import { requireAuth } from './middleware/authMiddleware';

// Apply middleware to protected routes
router.post('/v1/sync', requireAuth('walletIdentity'), syncApi.postSync);
router.post('/v1/action', requireAuth('wkIdentity'), actionApi.postAction);
router.post('/v1/token', requireAuth('wkIdentity'), syncApi.postToken);
```

---

### Phase 4: WebSocket Authentication

#### Step 4.1: Update Socket Handler

**File**: `src/lib/socket.ts`

```typescript
import { verifyMultisigAuth } from './bitcoinAuth';
import { networks } from '@runonflux/utxo-lib';

// In initIOKey and initIOWallet functions:
socket.on('join', async ({ wkIdentity, signature, message, publicKey, witnessScript }) => {
  // Validate required fields
  if (!wkIdentity || !signature || !message || !publicKey || !witnessScript) {
    log.warn('Missing authentication fields for socket join');
    socket.emit('error', { message: 'Authentication required' });
    socket.disconnect();
    return;
  }

  // Verify authentication
  const result = verifyMultisigAuth(
    { signature, message, publicKey, witnessScript },
    wkIdentity,
    networks.bitcoin
  );

  if (!result.valid) {
    log.warn(`Socket authentication failed for ${wkIdentity}: ${result.error}`);
    socket.emit('error', { message: 'Authentication failed' });
    socket.disconnect();
    return;
  }

  // Parse message to verify action type
  try {
    const payload = JSON.parse(message);
    if (payload.action !== 'join' || payload.identity !== wkIdentity) {
      log.warn('Invalid signature payload for socket join');
      socket.disconnect();
      return;
    }
  } catch (e) {
    log.warn('Failed to parse signature message');
    socket.disconnect();
    return;
  }

  // Authentication successful - join room
  socket.join(wkIdentity);
  log.info(`Authenticated socket joined room: ${wkIdentity}`);

  // Continue with existing logic...
});
```

---

### Phase 5: Client Updates (ssp-wallet & ssp-key)

#### Step 5.1: Create Authentication Utility

Both ssp-wallet and ssp-key need a utility to sign relay requests.

**File**: `src/lib/relayAuth.ts` (in both repos)

```typescript
import { signMessage } from './wallet'; // or appropriate signing function
import crypto from 'crypto';

interface SignaturePayload {
  timestamp: number;
  action: string;
  identity: string;
  nonce: string;
  data?: string;
}

export async function createAuthenticatedRequest(
  action: 'sync' | 'action' | 'token' | 'join',
  identity: string,
  privateKey: string,
  publicKey: string,
  requestBody?: object,
  witnessScript?: string
): Promise<{
  signature: string;
  message: string;
  publicKey: string;
  witnessScript?: string;
}> {
  const payload: SignaturePayload = {
    timestamp: Date.now(),
    action,
    identity,
    nonce: crypto.randomBytes(32).toString('hex'),
  };

  // Optionally include hash of request body
  if (requestBody) {
    const bodyString = JSON.stringify(requestBody);
    payload.data = crypto.createHash('sha256').update(bodyString).digest('hex');
  }

  const message = JSON.stringify(payload);
  const signature = await signMessage(message, privateKey);

  return {
    signature,
    message,
    publicKey,
    ...(witnessScript && { witnessScript }),
  };
}
```

#### Step 5.2: Update Relay Communication

All calls to the relay must include authentication:

```typescript
// Example: POST /v1/action
const auth = await createAuthenticatedRequest(
  'action',
  wkIdentity,
  privateKey,
  publicKey,
  actionPayload,
  witnessScript
);

await fetch(`${relayUrl}/v1/action`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    ...actionPayload,
    ...auth,
  }),
});
```

#### Step 5.3: Update WebSocket Connection

```typescript
// On socket connect, emit authenticated join
socket.emit('join', {
  wkIdentity,
  ...await createAuthenticatedRequest('join', wkIdentity, privateKey, publicKey, undefined, witnessScript),
});
```

---

## Testing Plan

### Unit Tests

1. **bitcoinAuth.ts**
   - Test signature verification with valid/invalid signatures
   - Test P2PKH address derivation
   - Test P2WSH address derivation
   - Test witness script parsing
   - Test timestamp validation
   - Test nonce uniqueness checking

2. **authMiddleware.ts**
   - Test with missing auth fields
   - Test with invalid signature
   - Test with expired timestamp
   - Test with valid single-sig auth
   - Test with valid multisig auth

### Integration Tests

1. **POST /v1/sync**
   - Without auth → 401
   - With invalid signature → 401
   - With valid auth → 200

2. **POST /v1/action**
   - Without auth → 401
   - With wrong wkIdentity signature → 401
   - With valid wallet signature → 200
   - With valid key signature → 200

3. **WebSocket join**
   - Without auth → disconnect
   - With valid auth → room joined

### End-to-End Tests

1. Full sync flow: Wallet → Relay → Key
2. Full action flow: Wallet sends tx request → Key receives and signs
3. Replay attack prevention test

---

## Migration Strategy

### Backward Compatibility Period

1. **Phase A** (2 weeks): Deploy with auth optional
   - Log warnings for unauthenticated requests
   - Accept both authenticated and unauthenticated requests
   - Monitor for issues

2. **Phase B** (2 weeks): Soft enforcement
   - Return deprecation warnings for unauthenticated requests
   - Continue accepting but log extensively

3. **Phase C**: Full enforcement
   - Reject all unauthenticated requests
   - Remove backward compatibility code

### Client Update Requirements

Both ssp-wallet and ssp-key must be updated to:
1. Include authentication on all relay requests
2. Store and provide witnessScript for multisig addresses
3. Handle 401 errors gracefully

---

## Security Considerations

### Replay Attack Prevention

- **Timestamp validation**: Reject messages older than 5 minutes
- **Nonce tracking**: Cache recent nonces, reject duplicates
- **Action binding**: Signature payload includes action type

### Man-in-the-Middle Protection

- **TLS required**: All relay communication over HTTPS
- **Data binding**: Optional hash of request body in signature

### Key Compromise Scenarios

- If wallet key compromised: Key app holder can still block transactions
- If key app compromised: Wallet holder can still block transactions
- If both compromised: Attacker has full control (inherent to 2-of-2)

### Witness Script Security

- Witness script reveals public keys (privacy consideration)
- Alternative: Server could derive witness script from stored xpubs
- Trade-off: Simplicity vs. privacy

---

## File Changes Summary

### New Files (ssp-relay)

| File | Description |
|------|-------------|
| `src/lib/bitcoinAuth.ts` | Core Bitcoin authentication library |
| `src/middleware/authMiddleware.ts` | Express authentication middleware |
| `src/types/auth.ts` | Authentication type definitions |
| `src/types/express.d.ts` | Express request type extensions |

### Modified Files (ssp-relay)

| File | Changes |
|------|---------|
| `src/routes.ts` | Add middleware to protected routes |
| `src/apiServices/syncApi.ts` | Handle auth fields, strip before storage |
| `src/apiServices/actionApi.ts` | Handle auth fields, strip before storage |
| `src/lib/socket.ts` | Add authentication to join handler |
| `package.json` | Add bitcoinjs-message dependency |

### New Files (ssp-wallet & ssp-key)

| File | Description |
|------|-------------|
| `src/lib/relayAuth.ts` | Authentication utility for relay requests |

### Modified Files (ssp-wallet & ssp-key)

| File | Changes |
|------|---------|
| `src/contexts/SocketContext.tsx` | Authenticated socket join |
| All relay API calls | Include authentication fields |

---

## Estimated Effort

| Phase | Tasks | Complexity |
|-------|-------|------------|
| Phase 1 | Core auth library | Medium |
| Phase 2 | Middleware | Low |
| Phase 3 | Endpoint updates | Medium |
| Phase 4 | WebSocket auth | Medium |
| Phase 5 | Client updates | High (two repos) |
| Testing | Unit + Integration | Medium |
| Migration | Staged rollout | Low |

---

## Open Questions

1. **Network detection**: How to determine mainnet vs testnet for address validation?
   - Option A: Derive from `chain` parameter
   - Option B: Accept both and try both networks

2. **Witness script storage**: Should relay store witness scripts?
   - Pro: Clients don't need to send it every time
   - Con: Additional storage, complexity

3. **Rate limiting per identity**: Should we add per-identity rate limits?
   - Would prevent spam even from authenticated clients

4. **Signature caching**: Cache valid signatures to reduce verification overhead?
   - Trade-off: Performance vs. storage/complexity

---

## Next Steps

1. Review and approve this plan
2. Implement Phase 1 (core library) with unit tests
3. Implement Phase 2-4 (relay changes)
4. Implement Phase 5 (client changes) in parallel
5. Deploy with backward compatibility
6. Monitor and iterate
7. Full enforcement after client adoption
