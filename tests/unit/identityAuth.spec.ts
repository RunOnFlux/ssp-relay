// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect } from 'chai';
import * as bitcoin from '@runonflux/utxo-lib';
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
  detectNetworkFromAddress,
  generateNonce,
  createSignaturePayload,
  cleanupNonceCache,
} from '../../src/lib/identityAuth';

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
const TEST_PUBKEY_2 =
  '0354dae65cc6eede1d82b4a68a97c28b1f2cd44f7d99b86a2bdcfe89e9fd5c7f9e';

// Generate a 2-of-2 witness script for testing
function generateTestWitnessScript(): string {
  const pubKeys = [TEST_PUBKEY_1, TEST_PUBKEY_2].sort();
  const pubKeyBuffers = pubKeys.map((pk) => Buffer.from(pk, 'hex'));
  const witnessScript = bitcoin.script.multisig.output.encode(2, pubKeyBuffers);
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
      const keyPair = bitcoin.ECPair.fromWIF(
        TEST_PRIVATE_KEY_WIF,
        bitcoin.networks.bitcoin,
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
      const keyPair = bitcoin.ECPair.fromWIF(
        TEST_PRIVATE_KEY_WIF,
        bitcoin.networks.bitcoin,
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
      expect(isMultisigIdentity('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).to
        .be.true;
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
      expect(detectNetworkFromAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')).to
        .equal('mainnet');
    });

    it('should detect mainnet from P2SH address starting with 3', function () {
      expect(detectNetworkFromAddress('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy')).to
        .equal('mainnet');
    });

    it('should detect mainnet from bc1 address', function () {
      expect(
        detectNetworkFromAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'),
      ).to.equal('mainnet');
    });

    it('should detect testnet from m address', function () {
      expect(detectNetworkFromAddress('mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn')).to
        .equal('testnet');
    });

    it('should detect testnet from n address', function () {
      expect(detectNetworkFromAddress('n4VQ5YdHf7hLQ2gWQYYrcxoE5B7nWuDFNF')).to
        .equal('testnet');
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
      const payload = createSignaturePayload('action', 'test-identity', 'abc123');
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
        action: 'invalid' as any,
        identity: 'test-identity',
        nonce: crypto.randomBytes(32).toString('hex'),
      };
      const result = validateSignaturePayload(payload);
      expect(result.valid).to.be.false;
      expect(result.error).to.include('action');
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

      // Second use should be rejected
      const result2 = validateSignaturePayload(payload);
      expect(result2.valid).to.be.false;
      expect(result2.error).to.include('replay');
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
      expect(() => parseWitnessScript('0000')).to.throw('Invalid witness script');
    });

    it('should throw for script missing OP_CHECKMULTISIG', function () {
      // Just OP_2 and two pubkeys, no OP_CHECKMULTISIG
      const badScript =
        '5221' + TEST_PUBKEY_1 + '21' + TEST_PUBKEY_2 + '52'; // Missing ae
      expect(() => parseWitnessScript(badScript)).to.throw('OP_CHECKMULTISIG');
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

      const keyPair = bitcoin.ECPair.fromWIF(
        TEST_PRIVATE_KEY_WIF,
        bitcoin.networks.bitcoin,
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
      const keyPair = bitcoin.ECPair.fromWIF(
        TEST_PRIVATE_KEY_WIF,
        bitcoin.networks.bitcoin,
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
      const otherPubKey =
        '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

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
});
