// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect } from 'chai';
import utxolib from '@runonflux/utxo-lib';
import bitcoinMessage from 'bitcoinjs-message';
import crypto from 'crypto';
import {
  verifyBitcoinSignature,
  deriveP2PKHAddress,
  deriveP2WSHAddress,
  parseWitnessScript,
  validateSignaturePayload,
  verifySingleSigAuth,
  verifyMultisigAuth,
  isMultisigIdentity,
  isValidCompressedPubKey,
  detectNetworkFromAddress,
  generateNonce,
  createSignaturePayload,
  cleanupNonceCache,
  consumeNonce,
  nonceCacheSize,
  resetNonceCache,
  MAX_TIMESTAMP_DRIFT_MS,
} from '../../src/lib/identityAuth';
import sinon from 'sinon';

// Test fixtures - derived from a known WIF
const TEST_PRIVATE_KEY_WIF =
  'L1TnU2zbNaAqMoVh65Cyvmcjzbrj41Gs9iTLcWbpJCMynXuap6UN'; // Mainnet WIF
// These values are derived from the WIF above
const TEST_PUBLIC_KEY =
  '0278d4aa2a1c643fc68a0de5454e47c520cf59643526474e63b320144de9e0d59a';
const TEST_ADDRESS = '15hETetDmcXm1mM4sEf7U2KXC9hDHFMSzz'; // P2PKH address matching TEST_PUBLIC_KEY

// For multisig testing - 2 key pairs
// TEST_PUBKEY_1 matches TEST_PUBLIC_KEY so we can sign with TEST_PRIVATE_KEY_WIF
const TEST_PUBKEY_1 = TEST_PUBLIC_KEY;
// A valid compressed point (the secp256k1 generator, private key 1). The
// previous fixture was an off-curve x coordinate, which the strict witness
// script parser now (correctly) refuses.
const TEST_PUBKEY_2 =
  '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
// An x coordinate that is NOT on the curve (no matching y exists).
const OFF_CURVE_PUBKEY =
  '0354dae65cc6eede1d82b4a68a97c28b1f2cd44f7d99b86a2bdcfe89e9fd5c7f9e';

// Generate a 2-of-2 witness script for testing
function generateTestWitnessScript(): string {
  const pubKeys = [TEST_PUBKEY_1, TEST_PUBKEY_2].sort();
  const pubKeyBuffers = pubKeys.map((pk) => Buffer.from(pk, 'hex'));
  const witnessScript = utxolib.script.multisig.output.encode(2, pubKeyBuffers);
  return Buffer.from(witnessScript).toString('hex');
}

// Derive the P2WSH address from the test witness script
function getTestP2WSHAddress(): string {
  const witnessScriptHex = generateTestWitnessScript();
  return deriveP2WSHAddress(witnessScriptHex, 'mainnet');
}

describe('Identity Authentication Library', function () {
  describe('verifyBitcoinSignature', function () {
    it('should verify a valid signature', function () {
      const message = 'test message';
      const keyPair = utxolib.ECPair.fromWIF(
        TEST_PRIVATE_KEY_WIF,
        utxolib.networks.bitcoin,
      );
      // utxo-lib uses 'd' (BigInteger) instead of 'privateKey'
      const privateKeyBuffer = keyPair.d.toBuffer(32);
      const signature = bitcoinMessage.sign(
        message,
        privateKeyBuffer,
        keyPair.compressed,
      );

      const isValid = verifyBitcoinSignature(
        message,
        signature.toString('base64'),
        TEST_ADDRESS,
      );
      expect(isValid).to.be.true;
    });

    it('should reject an invalid signature', function () {
      const isValid = verifyBitcoinSignature(
        'test message',
        'invalidsignature',
        TEST_ADDRESS,
      );
      expect(isValid).to.be.false;
    });

    it('should reject signature for wrong message', function () {
      const keyPair = utxolib.ECPair.fromWIF(
        TEST_PRIVATE_KEY_WIF,
        utxolib.networks.bitcoin,
      );
      const privateKeyBuffer = keyPair.d.toBuffer(32);
      const signature = bitcoinMessage.sign(
        'original message',
        privateKeyBuffer,
        keyPair.compressed,
      );

      const isValid = verifyBitcoinSignature(
        'different message',
        signature.toString('base64'),
        TEST_ADDRESS,
      );
      expect(isValid).to.be.false;
    });
  });

  describe('isMultisigIdentity', function () {
    it('should identify bc1q addresses as multisig', function () {
      expect(isMultisigIdentity('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'))
        .to.be.true;
    });

    it('should identify tb1q addresses as multisig (testnet)', function () {
      expect(isMultisigIdentity('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'))
        .to.be.true;
    });

    it('should not identify P2PKH addresses as multisig', function () {
      expect(isMultisigIdentity('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')).to.be
        .false;
    });

    it('should not identify P2SH addresses as multisig', function () {
      expect(isMultisigIdentity('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy')).to.be
        .false;
    });

    it('should not identify testnet P2PKH addresses as multisig', function () {
      expect(isMultisigIdentity('mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn')).to.be
        .false;
    });
  });

  describe('detectNetworkFromAddress', function () {
    it('should detect mainnet from P2PKH address starting with 1', function () {
      expect(
        detectNetworkFromAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'),
      ).to.equal('mainnet');
    });

    it('should detect mainnet from P2SH address starting with 3', function () {
      expect(
        detectNetworkFromAddress('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'),
      ).to.equal('mainnet');
    });

    it('should detect mainnet from bc1 address', function () {
      expect(
        detectNetworkFromAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'),
      ).to.equal('mainnet');
    });

    it('should detect testnet from m address', function () {
      expect(
        detectNetworkFromAddress('mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn'),
      ).to.equal('testnet');
    });

    it('should detect testnet from n address', function () {
      expect(
        detectNetworkFromAddress('n4VQ5YdHf7hLQ2gWQYYrcxoE5B7nWuDFNF'),
      ).to.equal('testnet');
    });

    it('should detect testnet from tb1 address', function () {
      expect(
        detectNetworkFromAddress('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'),
      ).to.equal('testnet');
    });
  });

  describe('generateNonce', function () {
    it('should generate a 64 character hex string', function () {
      const nonce = generateNonce();
      expect(nonce).to.have.length(64);
      expect(/^[a-f0-9]{64}$/.test(nonce)).to.be.true;
    });

    it('should generate unique nonces', function () {
      const nonce1 = generateNonce();
      const nonce2 = generateNonce();
      expect(nonce1).to.not.equal(nonce2);
    });
  });

  describe('createSignaturePayload', function () {
    it('should create a valid payload with all fields', function () {
      const payload = createSignaturePayload('join', 'test-identity');
      expect(payload.action).to.equal('join');
      expect(payload.identity).to.equal('test-identity');
      expect(payload.timestamp).to.be.a('number');
      expect(payload.nonce).to.have.length(64);
    });

    it('should include data hash if provided', function () {
      const payload = createSignaturePayload(
        'action',
        'test-identity',
        'abc123',
      );
      expect(payload.data).to.equal('abc123');
    });

    it('should not include data if not provided', function () {
      const payload = createSignaturePayload('sync', 'test-identity');
      expect(payload.data).to.be.undefined;
    });
  });

  describe('validateSignaturePayload', function () {
    it('should accept valid payload with current timestamp', function () {
      const payload = {
        timestamp: Date.now(),
        action: 'join' as const,
        identity: 'test-identity',
        nonce: crypto.randomBytes(32).toString('hex'),
      };
      const result = validateSignaturePayload(payload);
      expect(result.valid).to.be.true;
    });

    it('should reject payload with old timestamp', function () {
      const payload = {
        timestamp: Date.now() - 15 * 60 * 1000, // 15 minutes ago (exceeds 10 min limit)
        action: 'join' as const,
        identity: 'test-identity',
        nonce: crypto.randomBytes(32).toString('hex'),
      };
      const result = validateSignaturePayload(payload);
      expect(result.valid).to.be.false;
      expect(result.error).to.include('Timestamp');
    });

    it('should reject payload with future timestamp', function () {
      const payload = {
        timestamp: Date.now() + 15 * 60 * 1000, // 15 minutes in future (exceeds 10 min limit)
        action: 'join' as const,
        identity: 'test-identity',
        nonce: crypto.randomBytes(32).toString('hex'),
      };
      const result = validateSignaturePayload(payload);
      expect(result.valid).to.be.false;
      expect(result.error).to.include('Timestamp');
    });

    it('should reject payload with invalid nonce format', function () {
      const payload = {
        timestamp: Date.now(),
        action: 'join' as const,
        identity: 'test-identity',
        nonce: 'invalid-nonce',
      };
      const result = validateSignaturePayload(payload);
      expect(result.valid).to.be.false;
      expect(result.error).to.include('nonce');
    });

    it('should reject payload with invalid action', function () {
      const payload = {
        timestamp: Date.now(),
        // Intentionally invalid to test rejection; cast via unknown to bypass type check
        action: 'invalid' as unknown as 'sync' | 'action' | 'token' | 'join',
        identity: 'test-identity',
        nonce: crypto.randomBytes(32).toString('hex'),
      };
      const result = validateSignaturePayload(payload);
      expect(result.valid).to.be.false;
      expect(result.error).to.include('action');
    });

    // UTXO-9: a non-numeric timestamp used to yield NaN, which slipped past
    // the drift comparison.
    it('rejects non-numeric, non-integer and non-finite timestamps', function () {
      for (const timestamp of [
        'not-a-number',
        String(Date.now()),
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Date.now() + 0.5,
        null,
        undefined,
        { valueOf: () => Date.now() },
      ]) {
        const result = validateSignaturePayload({
          timestamp,
          action: 'join',
          identity: 'test-identity',
          nonce: crypto.randomBytes(32).toString('hex'),
        } as unknown as Parameters<typeof validateSignaturePayload>[0]);
        expect(result.valid, String(timestamp)).to.equal(false);
        expect(result.error).to.match(/timestamp/i);
      }
    });

    it('rejects a non-string nonce and a non-object payload', function () {
      const result = validateSignaturePayload({
        timestamp: Date.now(),
        action: 'join',
        identity: 'test-identity',
        nonce: 1234 as unknown as string,
      });
      expect(result.valid).to.equal(false);
      expect(
        validateSignaturePayload(
          null as unknown as Parameters<typeof validateSignaturePayload>[0],
        ).valid,
      ).to.equal(false);
    });

    it("does not accept a 'read' payload unless the caller allows it", function () {
      const payload = {
        timestamp: Date.now(),
        action: 'read' as const,
        identity: 'test-identity',
        nonce: crypto.randomBytes(32).toString('hex'),
      };
      expect(validateSignaturePayload(payload).valid).to.equal(false);
      expect(
        validateSignaturePayload({ ...payload }, undefined, ['read']).valid,
      ).to.equal(true);
      // and a read-only caller refuses write actions
      expect(
        validateSignaturePayload(
          { ...payload, action: 'action' as const },
          undefined,
          ['read'],
        ).valid,
      ).to.equal(false);
    });

    it('should reject reused nonce', function () {
      // Clean cache first
      cleanupNonceCache();

      const nonce = crypto.randomBytes(32).toString('hex');
      const payload = {
        timestamp: Date.now(),
        action: 'join' as const,
        identity: 'test-identity',
        nonce,
      };

      // First use should be valid
      const result1 = validateSignaturePayload(payload);
      expect(result1.valid).to.be.true;

      // Nonces are spent only after the whole request verifies (see
      // consumeNonce) — mark it spent the way a verified request would.
      consumeNonce(nonce);

      // Second use should be rejected
      const result2 = validateSignaturePayload(payload);
      expect(result2.valid).to.be.false;
      expect(result2.error).to.include('replay');
    });

    it('should flag identical resend as duplicate when fingerprint matches', function () {
      cleanupNonceCache();

      const nonce = crypto.randomBytes(32).toString('hex');
      const payload = {
        timestamp: Date.now(),
        action: 'action' as const,
        identity: 'test-identity',
        nonce,
      };
      const fingerprint = crypto.randomBytes(32).toString('hex');

      const result1 = validateSignaturePayload(payload, fingerprint);
      expect(result1.valid).to.be.true;
      expect(result1.duplicate).to.be.undefined;

      consumeNonce(nonce, fingerprint);

      // Same signed request again — duplicate, not a replay failure
      const result2 = validateSignaturePayload(payload, fingerprint);
      expect(result2.valid).to.be.true;
      expect(result2.duplicate).to.be.true;

      // Different fingerprint on a spent nonce — replay
      const result3 = validateSignaturePayload(
        payload,
        crypto.randomBytes(32).toString('hex'),
      );
      expect(result3.valid).to.be.false;
      expect(result3.error).to.include('replay');

      // No fingerprint supplied (strict caller, e.g. socket join) — replay
      const result4 = validateSignaturePayload(payload);
      expect(result4.valid).to.be.false;
      expect(result4.error).to.include('replay');
    });

    it('should not treat a spent no-fingerprint nonce as duplicate', function () {
      cleanupNonceCache();

      const nonce = crypto.randomBytes(32).toString('hex');
      const payload = {
        timestamp: Date.now(),
        action: 'action' as const,
        identity: 'test-identity',
        nonce,
      };

      // Spent without a fingerprint recorded (legacy consumeNonce call)
      consumeNonce(nonce);

      const result = validateSignaturePayload(
        payload,
        crypto.randomBytes(32).toString('hex'),
      );
      expect(result.valid).to.be.false;
      expect(result.error).to.include('replay');
    });
  });

  describe('deriveP2PKHAddress', function () {
    it('should derive correct P2PKH address from public key', function () {
      const address = deriveP2PKHAddress(TEST_PUBLIC_KEY, 'mainnet');
      expect(address).to.equal(TEST_ADDRESS);
    });

    it('should throw for invalid public key length', function () {
      expect(() => deriveP2PKHAddress('0203', 'mainnet')).to.throw(
        'Invalid public key length',
      );
    });

    it('should handle testnet addresses', function () {
      const address = deriveP2PKHAddress(TEST_PUBLIC_KEY, 'testnet');
      // Testnet addresses start with m or n
      expect(address.startsWith('m') || address.startsWith('n')).to.be.true;
    });
  });

  describe('parseWitnessScript', function () {
    it('should parse 2-of-2 multisig witness script correctly', function () {
      const witnessScript = generateTestWitnessScript();
      const parsed = parseWitnessScript(witnessScript);

      expect(parsed.m).to.equal(2);
      expect(parsed.n).to.equal(2);
      expect(parsed.publicKeys).to.have.length(2);
      expect(parsed.publicKeys).to.include(TEST_PUBKEY_1);
      expect(parsed.publicKeys).to.include(TEST_PUBKEY_2);
    });

    it('should throw for invalid witness script', function () {
      expect(() => parseWitnessScript('0000')).to.throw(
        'Invalid witness script',
      );
    });

    it('should throw for script missing OP_CHECKMULTISIG', function () {
      // Just OP_2 and two pubkeys, no OP_CHECKMULTISIG
      const badScript = '5221' + TEST_PUBKEY_1 + '21' + TEST_PUBKEY_2 + '52'; // Missing ae
      expect(() => parseWitnessScript(badScript)).to.throw(
        'Invalid witness script',
      );
    });

    // UTXO-9: only the exact canonical 2-of-2 layout is accepted.
    it('rejects a script with an interleaved opcode between the keys', function () {
      // OP_2 <k1> OP_NOP <k2> OP_2 OP_CHECKMULTISIG — used to parse because
      // non-push chunks were skipped.
      const script =
        '5221' + TEST_PUBKEY_1 + '61' + '21' + TEST_PUBKEY_2 + '52ae';
      expect(() => parseWitnessScript(script)).to.throw(
        'Invalid witness script',
      );
    });

    it('rejects a 1-of-2 and a 2-of-3 script', function () {
      const oneOfTwo = '5121' + TEST_PUBKEY_1 + '21' + TEST_PUBKEY_2 + '52ae';
      expect(() => parseWitnessScript(oneOfTwo)).to.throw(
        'Invalid witness script',
      );
      const third = '03' + crypto.randomBytes(32).toString('hex'); // length only matters
      const twoOfThree =
        '5221' + TEST_PUBKEY_1 + '21' + TEST_PUBKEY_2 + '21' + third + '53ae';
      expect(() => parseWitnessScript(twoOfThree)).to.throw(
        'Invalid witness script',
      );
    });

    it('rejects a script with the same key twice', function () {
      const dup = '5221' + TEST_PUBKEY_1 + '21' + TEST_PUBKEY_1 + '52ae';
      expect(() => parseWitnessScript(dup)).to.throw('distinct');
    });

    it('rejects an off-curve or uncompressed key', function () {
      const offCurve =
        '5221' + TEST_PUBKEY_1 + '21' + OFF_CURVE_PUBKEY + '52ae';
      expect(() => parseWitnessScript(offCurve)).to.throw(
        'valid compressed secp256k1 point',
      );
      const badPrefix =
        '5221' + TEST_PUBKEY_1 + '21' + '04' + TEST_PUBKEY_2.slice(2) + '52ae';
      expect(() => parseWitnessScript(badPrefix)).to.throw(
        'valid compressed secp256k1 point',
      );
    });

    it('rejects non-hex input and trailing bytes', function () {
      expect(() => parseWitnessScript('zz')).to.throw('Invalid witness script');
      const trailing = generateTestWitnessScript() + '00';
      expect(() => parseWitnessScript(trailing)).to.throw(
        'Invalid witness script',
      );
    });
  });

  describe('isValidCompressedPubKey', function () {
    it('accepts on-curve compressed keys and rejects everything else', function () {
      expect(isValidCompressedPubKey(TEST_PUBKEY_1)).to.equal(true);
      expect(isValidCompressedPubKey(TEST_PUBKEY_2)).to.equal(true);
      expect(isValidCompressedPubKey(OFF_CURVE_PUBKEY)).to.equal(false);
      expect(isValidCompressedPubKey('04' + TEST_PUBKEY_2.slice(2))).to.equal(
        false,
      );
      expect(isValidCompressedPubKey('02')).to.equal(false);
      expect(isValidCompressedPubKey(undefined as unknown as string)).to.equal(
        false,
      );
    });
  });

  describe('deriveP2WSHAddress', function () {
    it('should derive correct P2WSH address from witness script', function () {
      const witnessScript = generateTestWitnessScript();
      const address = deriveP2WSHAddress(witnessScript, 'mainnet');

      // P2WSH mainnet addresses start with bc1q
      expect(address.startsWith('bc1q')).to.be.true;
    });

    it('should derive testnet P2WSH address correctly', function () {
      const witnessScript = generateTestWitnessScript();
      const address = deriveP2WSHAddress(witnessScript, 'testnet');

      // P2WSH testnet addresses start with tb1q
      expect(address.startsWith('tb1q')).to.be.true;
    });

    it('should be deterministic', function () {
      const witnessScript = generateTestWitnessScript();
      const address1 = deriveP2WSHAddress(witnessScript, 'mainnet');
      const address2 = deriveP2WSHAddress(witnessScript, 'mainnet');

      expect(address1).to.equal(address2);
    });
  });

  describe('verifySingleSigAuth', function () {
    it('should verify valid single-sig authentication', function () {
      cleanupNonceCache();

      const payload = createSignaturePayload('action', TEST_ADDRESS);
      const message = JSON.stringify(payload);

      const keyPair = utxolib.ECPair.fromWIF(
        TEST_PRIVATE_KEY_WIF,
        utxolib.networks.bitcoin,
      );
      const privateKeyBuffer = keyPair.d.toBuffer(32);
      const signature = bitcoinMessage.sign(
        message,
        privateKeyBuffer,
        keyPair.compressed,
      );

      const result = verifySingleSigAuth(
        {
          signature: signature.toString('base64'),
          message,
          publicKey: TEST_PUBLIC_KEY,
        },
        TEST_ADDRESS,
        'mainnet',
      );

      expect(result.valid).to.be.true;
      expect(result.identity).to.equal(TEST_ADDRESS);
      expect(result.signerPublicKey).to.equal(TEST_PUBLIC_KEY);
    });

    it('should reject auth with invalid message JSON', function () {
      const result = verifySingleSigAuth(
        {
          signature: 'test',
          message: 'not-valid-json',
          publicKey: TEST_PUBLIC_KEY,
        },
        TEST_ADDRESS,
        'mainnet',
      );

      expect(result.valid).to.be.false;
      expect(result.error).to.include('not valid JSON');
    });

    it('should reject auth with identity mismatch', function () {
      const payload = createSignaturePayload('join', 'wrong-identity');
      const result = verifySingleSigAuth(
        {
          signature: 'test',
          message: JSON.stringify(payload),
          publicKey: TEST_PUBLIC_KEY,
        },
        TEST_ADDRESS,
        'mainnet',
      );

      expect(result.valid).to.be.false;
      expect(result.error).to.include('Identity mismatch');
    });

    it('should reject auth with address mismatch', function () {
      // Clean cache to avoid nonce reuse
      cleanupNonceCache();

      const payload = createSignaturePayload('join', 'different-address');
      const result = verifySingleSigAuth(
        {
          signature: 'test',
          message: JSON.stringify(payload),
          publicKey: TEST_PUBLIC_KEY,
        },
        'different-address',
        'mainnet',
      );

      expect(result.valid).to.be.false;
      expect(result.error).to.include('Address mismatch');
    });
  });

  describe('verifyMultisigAuth', function () {
    it('should verify valid multisig authentication', function () {
      cleanupNonceCache();

      const witnessScript = generateTestWitnessScript();
      const wkIdentity = deriveP2WSHAddress(witnessScript, 'mainnet');
      const payload = createSignaturePayload('action', wkIdentity);
      const message = JSON.stringify(payload);

      // Sign with the key that's in the witness script (TEST_PUBKEY_1 = TEST_PUBLIC_KEY)
      const keyPair = utxolib.ECPair.fromWIF(
        TEST_PRIVATE_KEY_WIF,
        utxolib.networks.bitcoin,
      );
      const privateKeyBuffer = keyPair.d.toBuffer(32);
      const signature = bitcoinMessage.sign(
        message,
        privateKeyBuffer,
        keyPair.compressed,
      );

      const result = verifyMultisigAuth(
        {
          signature: signature.toString('base64'),
          message,
          publicKey: TEST_PUBLIC_KEY,
          witnessScript,
        },
        wkIdentity,
        'mainnet',
      );

      expect(result.valid).to.be.true;
      expect(result.identity).to.equal(wkIdentity);
      expect(result.signerPublicKey).to.equal(TEST_PUBLIC_KEY);
    });

    it('should handle identical resend per allowIdenticalReplay option', function () {
      cleanupNonceCache();

      const witnessScript = generateTestWitnessScript();
      const wkIdentity = deriveP2WSHAddress(witnessScript, 'mainnet');
      const payload = createSignaturePayload('action', wkIdentity);
      const message = JSON.stringify(payload);

      const keyPair = utxolib.ECPair.fromWIF(
        TEST_PRIVATE_KEY_WIF,
        utxolib.networks.bitcoin,
      );
      const privateKeyBuffer = keyPair.d.toBuffer(32);
      const signature = bitcoinMessage.sign(
        message,
        privateKeyBuffer,
        keyPair.compressed,
      );

      const authData = {
        signature: signature.toString('base64'),
        message,
        publicKey: TEST_PUBLIC_KEY,
        witnessScript,
      };

      // First request verifies normally
      const first = verifyMultisigAuth(authData, wkIdentity, 'mainnet', {
        allowIdenticalReplay: true,
      });
      expect(first.valid).to.be.true;
      expect(first.duplicate).to.be.undefined;

      // Identical resend with the opt-in — accepted but flagged duplicate
      const resend = verifyMultisigAuth(authData, wkIdentity, 'mainnet', {
        allowIdenticalReplay: true,
      });
      expect(resend.valid).to.be.true;
      expect(resend.duplicate).to.be.true;

      // Identical resend WITHOUT the opt-in (socket join semantics) — replay
      const strict = verifyMultisigAuth(authData, wkIdentity, 'mainnet');
      expect(strict.valid).to.be.false;
      expect(strict.error).to.include('replay');

      // Same nonce under a different signed message — replay even with opt-in
      const tamperedMessage = JSON.stringify({
        ...payload,
        timestamp: payload.timestamp + 1,
      });
      const tamperedSignature = bitcoinMessage.sign(
        tamperedMessage,
        privateKeyBuffer,
        keyPair.compressed,
      );
      const tampered = verifyMultisigAuth(
        {
          signature: tamperedSignature.toString('base64'),
          message: tamperedMessage,
          publicKey: TEST_PUBLIC_KEY,
          witnessScript,
        },
        wkIdentity,
        'mainnet',
        { allowIdenticalReplay: true },
      );
      expect(tampered.valid).to.be.false;
      expect(tampered.error).to.include('replay');
    });

    it('should reject auth without witness script', function () {
      const wkIdentity = getTestP2WSHAddress();
      const payload = createSignaturePayload('join', wkIdentity);

      const result = verifyMultisigAuth(
        {
          signature: 'test',
          message: JSON.stringify(payload),
          publicKey: TEST_PUBKEY_1,
        },
        wkIdentity,
        'mainnet',
      );

      expect(result.valid).to.be.false;
      expect(result.error).to.include('Witness script required');
    });

    it('should reject auth with invalid witness script', function () {
      const wkIdentity = getTestP2WSHAddress();
      const payload = createSignaturePayload('join', wkIdentity);

      const result = verifyMultisigAuth(
        {
          signature: 'test',
          message: JSON.stringify(payload),
          publicKey: TEST_PUBKEY_1,
          witnessScript: 'invalid',
        },
        wkIdentity,
        'mainnet',
      );

      expect(result.valid).to.be.false;
      expect(result.error).to.include('Invalid witness script');
    });

    it('should reject auth with signer not in witness script', function () {
      // Clean cache
      cleanupNonceCache();

      const witnessScript = generateTestWitnessScript();
      const wkIdentity = deriveP2WSHAddress(witnessScript, 'mainnet');
      const payload = createSignaturePayload('join', wkIdentity);

      // Use a different public key that's not in the witness script
      // (2·G, a valid point that is not one of the script's keys)
      const otherPubKey =
        '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';

      const result = verifyMultisigAuth(
        {
          signature: 'test',
          message: JSON.stringify(payload),
          publicKey: otherPubKey,
          witnessScript,
        },
        wkIdentity,
        'mainnet',
      );

      expect(result.valid).to.be.false;
      expect(result.error).to.include('not part of the multisig');
    });

    it('should reject auth with wrong wkIdentity', function () {
      // Clean cache
      cleanupNonceCache();

      const witnessScript = generateTestWitnessScript();
      const wrongWkIdentity = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
      const payload = createSignaturePayload('join', wrongWkIdentity);

      const result = verifyMultisigAuth(
        {
          signature: 'test',
          message: JSON.stringify(payload),
          publicKey: TEST_PUBKEY_1,
          witnessScript,
        },
        wrongWkIdentity,
        'mainnet',
      );

      expect(result.valid).to.be.false;
      expect(result.error).to.include('Address mismatch');
    });
  });

  describe('nonce cache lifetime and bound (item 3)', function () {
    let clock;
    afterEach(function () {
      if (clock) clock.restore();
      clock = undefined;
      delete process.env.RELAY_NONCE_CACHE_MAX_ENTRIES;
      resetNonceCache();
    });

    const payloadAt = (timestamp, nonce = generateNonce()) => ({
      timestamp,
      action: 'action',
      identity: TEST_ADDRESS,
      nonce,
    });

    it('remembers a future-stamped nonce until timestamp + drift (not consume time + drift)', function () {
      resetNonceCache();
      const start = Date.now();
      clock = sinon.useFakeTimers({ now: start, toFake: ['Date'] });
      // stamped 9 minutes ahead: valid until start + 19 min
      const p = payloadAt(start + 9 * 60 * 1000);
      expect(validateSignaturePayload(p).valid).to.equal(true);
      expect(consumeNonce(p.nonce, 'fp', p.timestamp)).to.equal(true);
      // 11 minutes later the old cache (consume + 10 min) had forgotten it,
      // while the payload is still inside the drift window
      clock.tick(11 * 60 * 1000);
      cleanupNonceCache();
      const replay = validateSignaturePayload(p);
      expect(replay.valid).to.equal(false);
      expect(replay.error).to.include('replay');
      // once the payload itself has expired, the entry is swept
      clock.tick(9 * 60 * 1000);
      cleanupNonceCache();
      expect(nonceCacheSize()).to.equal(0);
      expect(validateSignaturePayload(p).error).to.include('Timestamp');
    });

    it('a past-stamped nonce is remembered for drift from consumption', function () {
      resetNonceCache();
      const start = Date.now();
      clock = sinon.useFakeTimers({ now: start, toFake: ['Date'] });
      const p = payloadAt(start - 9 * 60 * 1000);
      expect(consumeNonce(p.nonce, '', p.timestamp)).to.equal(true);
      clock.tick(9 * 60 * 1000);
      cleanupNonceCache();
      expect(nonceCacheSize()).to.equal(1);
      clock.tick(60 * 1000 + 1);
      cleanupNonceCache();
      expect(nonceCacheSize()).to.equal(0);
    });

    it('refuses (never evicts) when full of unexpired nonces, and recovers after they expire', function () {
      resetNonceCache();
      process.env.RELAY_NONCE_CACHE_MAX_ENTRIES = '2';
      const start = Date.now();
      clock = sinon.useFakeTimers({ now: start, toFake: ['Date'] });
      const a = generateNonce();
      expect(consumeNonce(a, '', start)).to.equal(true);
      expect(consumeNonce(generateNonce(), '', start)).to.equal(true);
      expect(consumeNonce(generateNonce(), '', start)).to.equal(false);
      // the earlier nonces are all still spent
      expect(validateSignaturePayload(payloadAt(start, a)).valid).to.equal(
        false,
      );
      clock.tick(MAX_TIMESTAMP_DRIFT_MS + 10_000);
      expect(consumeNonce(generateNonce(), '', Date.now())).to.equal(true);
      expect(nonceCacheSize()).to.equal(1);
    });

    it('a verifier answers "unavailable" instead of accepting when the cache is full', function () {
      resetNonceCache();
      process.env.RELAY_NONCE_CACHE_MAX_ENTRIES = '1';
      consumeNonce(generateNonce());
      const payload = createSignaturePayload('action', TEST_ADDRESS);
      const message = JSON.stringify(payload);
      const keyPair = utxolib.ECPair.fromWIF(
        TEST_PRIVATE_KEY_WIF,
        utxolib.networks.bitcoin,
      );
      const signature = bitcoinMessage
        .sign(message, keyPair.d.toBuffer(32), keyPair.compressed)
        .toString('base64');
      const r = verifySingleSigAuth(
        { signature, message, publicKey: TEST_PUBLIC_KEY },
        TEST_ADDRESS,
        'mainnet',
      );
      expect(r.valid).to.equal(false);
      expect(r.unavailable).to.equal(true);
    });
  });

  describe('cleanupNonceCache', function () {
    it('should not throw when cleaning up empty cache', function () {
      expect(() => cleanupNonceCache()).to.not.throw();
    });

    it('should be callable multiple times', function () {
      cleanupNonceCache();
      cleanupNonceCache();
      cleanupNonceCache();
    });
  });
  describe('nonce lifecycle', function () {
    // Build a genuinely signed request for TEST_ADDRESS.
    const signFor = (identity, nonce) => {
      const payload = createSignaturePayload('action', identity);
      if (nonce) payload.nonce = nonce;
      const message = JSON.stringify(payload);
      const keyPair = utxolib.ECPair.fromWIF(
        TEST_PRIVATE_KEY_WIF,
        utxolib.networks.bitcoin,
      );
      const signature = bitcoinMessage.sign(
        message,
        keyPair.d.toBuffer(32),
        keyPair.compressed,
      );
      return {
        nonce: payload.nonce,
        auth: {
          signature: signature.toString('base64'),
          message,
          publicKey: TEST_PUBLIC_KEY,
        },
      };
    };

    it('leaves the nonce usable when a request fails after validation', function () {
      cleanupNonceCache();

      // A well-formed, correctly signed request — but presented against the
      // wrong identity, so it fails an identity check that happens AFTER the
      // payload itself validates.
      const { nonce, auth } = signFor(TEST_ADDRESS);
      const rejected = verifySingleSigAuth(
        auth,
        '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
        'mainnet',
      );
      expect(rejected.valid).to.equal(false);

      // The client retries the identical signed request against the right
      // identity. A nonce spent on sight would make this look like a replay.
      const accepted = verifySingleSigAuth(auth, TEST_ADDRESS, 'mainnet');
      expect(accepted.valid).to.equal(true);
      expect(accepted.identity).to.equal(TEST_ADDRESS);
      expect(nonce).to.be.a('string');
    });

    it('refuses the same signed request a second time', function () {
      cleanupNonceCache();

      const { auth } = signFor(TEST_ADDRESS);
      expect(verifySingleSigAuth(auth, TEST_ADDRESS, 'mainnet').valid).to.equal(
        true,
      );

      const replayed = verifySingleSigAuth(auth, TEST_ADDRESS, 'mainnet');
      expect(replayed.valid).to.equal(false);
      expect(replayed.error).to.match(/already used/i);
    });

    it('spends a nonce only through consumeNonce', function () {
      cleanupNonceCache();

      const nonce = crypto.randomBytes(32).toString('hex');
      const payload = {
        timestamp: Date.now(),
        action: 'join',
        identity: 'test-identity',
        nonce,
      };
      // Validation on its own never spends it.
      expect(validateSignaturePayload(payload).valid).to.equal(true);
      expect(validateSignaturePayload({ ...payload }).valid).to.equal(true);

      consumeNonce(nonce);
      const after = validateSignaturePayload({ ...payload });
      expect(after.valid).to.equal(false);
      expect(after.error).to.match(/already used/i);
    });
  });
});
