// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect } from 'chai';
import {
  validateWkSignMessage,
  validateWkSigningRequestPayload,
} from '../../src/lib/wkSignValidation';

// Helper to create a hex-encoded message with timestamp
function createTestMessage(
  timestamp: number,
  randomPart: string = 'abc123randomxyz456',
): string {
  const message = `${timestamp}${randomPart}`;
  return Buffer.from(message, 'utf8').toString('hex');
}

// Test fixtures
const VALID_PUBLIC_KEY =
  '0278d4aa2a1c643fc68a0de5454e47c520cf59643526474e63b320144de9e0d59a';
const VALID_WITNESS_SCRIPT =
  '52210278d4aa2a1c643fc68a0de5454e47c520cf59643526474e63b320144de9e0d59a210354dae65cc6eede1d82b4a68a97c28b1f2cd44f7d99b86a2bdcfe89e9fd5c7f9e52ae';

describe('WK Sign Validation', function () {
  describe('validateWkSignMessage', function () {
    describe('valid messages', function () {
      it('should accept a valid message with current timestamp', function () {
        const timestamp = Date.now();
        const hexMessage = createTestMessage(timestamp);
        const result = validateWkSignMessage(hexMessage);

        expect(result.valid).to.be.true;
        expect(result.timestamp).to.equal(timestamp);
        expect(result.validTill).to.equal(timestamp + 15 * 60 * 1000);
      });

      it('should accept a message from 5 minutes ago', function () {
        const timestamp = Date.now() - 5 * 60 * 1000;
        const hexMessage = createTestMessage(timestamp);
        const result = validateWkSignMessage(hexMessage);

        expect(result.valid).to.be.true;
        expect(result.timestamp).to.equal(timestamp);
      });

      it('should accept a message from 14 minutes ago (not yet expired)', function () {
        const timestamp = Date.now() - 14 * 60 * 1000;
        const hexMessage = createTestMessage(timestamp);
        const result = validateWkSignMessage(hexMessage);

        expect(result.valid).to.be.true;
      });

      it('should accept a message from 1 minute in the future', function () {
        const timestamp = Date.now() + 1 * 60 * 1000;
        const hexMessage = createTestMessage(timestamp);
        const result = validateWkSignMessage(hexMessage);

        expect(result.valid).to.be.true;
      });
    });

    describe('invalid messages', function () {
      it('should reject empty message', function () {
        const result = validateWkSignMessage('');
        expect(result.valid).to.be.false;
        expect(result.error).to.include('required');
      });

      it('should reject null message', function () {
        const result = validateWkSignMessage(null);
        expect(result.valid).to.be.false;
        expect(result.error).to.include('required');
      });

      it('should reject non-hex message', function () {
        const result = validateWkSignMessage('not-hex-string!@#');
        expect(result.valid).to.be.false;
        expect(result.error).to.include('hex');
      });

      it('should reject message with invalid characters', function () {
        const result = validateWkSignMessage('123abc!@#');
        expect(result.valid).to.be.false;
        expect(result.error).to.include('hex');
      });

      it('should reject message that is too short', function () {
        const result = validateWkSignMessage('abcd');
        expect(result.valid).to.be.false;
        expect(result.error).to.include('short');
      });

      it('should reject message with invalid timestamp', function () {
        const hexMessage = Buffer.from('abcdefghijklmnopqrstuvwxyz', 'utf8').toString('hex');
        const result = validateWkSignMessage(hexMessage);
        expect(result.valid).to.be.false;
        expect(result.error).to.include('timestamp');
      });

      it('should reject expired message (16 minutes old)', function () {
        const timestamp = Date.now() - 16 * 60 * 1000;
        const hexMessage = createTestMessage(timestamp);
        const result = validateWkSignMessage(hexMessage);

        expect(result.valid).to.be.false;
        expect(result.error).to.include('expired');
      });

      it('should reject message with timestamp too far in the future (10 minutes)', function () {
        const timestamp = Date.now() + 10 * 60 * 1000;
        const hexMessage = createTestMessage(timestamp);
        const result = validateWkSignMessage(hexMessage);

        expect(result.valid).to.be.false;
        expect(result.error).to.include('future');
      });

      it('should reject message with unreasonable timestamp (year 1970)', function () {
        const hexMessage = createTestMessage(0);
        const result = validateWkSignMessage(hexMessage);

        expect(result.valid).to.be.false;
        expect(result.error).to.include('range');
      });

      it('should reject message without random component', function () {
        const timestamp = Date.now();
        const hexMessage = Buffer.from(`${timestamp}`, 'utf8').toString('hex');
        const result = validateWkSignMessage(hexMessage);

        expect(result.valid).to.be.false;
        expect(result.error).to.include('random');
      });
    });
  });

  describe('validateWkSigningRequestPayload', function () {
    describe('valid payloads', function () {
      it('should accept a valid payload with all required fields', function () {
        const timestamp = Date.now();
        const payload = {
          message: createTestMessage(timestamp),
          walletSignature: 'H9DBV+m3QW9abc123...',
          walletPubKey: VALID_PUBLIC_KEY,
          witnessScript: VALID_WITNESS_SCRIPT,
          wkIdentity: 'bc1qwqdg6squsna38e46795at95yu9atm8azzmqccj',
          requestId: 'req-123-456-789',
        };

        const result = validateWkSigningRequestPayload(payload);
        expect(result.valid).to.be.true;
      });
    });

    describe('invalid payloads', function () {
      it('should reject null payload', function () {
        const result = validateWkSigningRequestPayload(null);
        expect(result.valid).to.be.false;
        expect(result.error).to.include('object');
      });

      it('should reject non-object payload', function () {
        const result = validateWkSigningRequestPayload('string');
        expect(result.valid).to.be.false;
        expect(result.error).to.include('object');
      });

      it('should reject payload without message', function () {
        const payload = {
          walletSignature: 'signature',
          walletPubKey: VALID_PUBLIC_KEY,
          witnessScript: VALID_WITNESS_SCRIPT,
          wkIdentity: 'bc1qtest',
          requestId: 'req-123',
        };

        const result = validateWkSigningRequestPayload(payload);
        expect(result.valid).to.be.false;
        expect(result.error).to.include('message');
      });

      it('should reject payload with invalid message format', function () {
        const payload = {
          message: 'not-hex',
          walletSignature: 'signature',
          walletPubKey: VALID_PUBLIC_KEY,
          witnessScript: VALID_WITNESS_SCRIPT,
          wkIdentity: 'bc1qtest',
          requestId: 'req-123',
        };

        const result = validateWkSigningRequestPayload(payload);
        expect(result.valid).to.be.false;
        expect(result.error).to.include('Invalid message');
      });

      it('should reject payload with expired message', function () {
        const expiredTimestamp = Date.now() - 20 * 60 * 1000;
        const payload = {
          message: createTestMessage(expiredTimestamp),
          walletSignature: 'signature',
          walletPubKey: VALID_PUBLIC_KEY,
          witnessScript: VALID_WITNESS_SCRIPT,
          wkIdentity: 'bc1qtest',
          requestId: 'req-123',
        };

        const result = validateWkSigningRequestPayload(payload);
        expect(result.valid).to.be.false;
        expect(result.error).to.include('expired');
      });

      it('should reject payload without walletSignature', function () {
        const timestamp = Date.now();
        const payload = {
          message: createTestMessage(timestamp),
          walletPubKey: VALID_PUBLIC_KEY,
          witnessScript: VALID_WITNESS_SCRIPT,
          wkIdentity: 'bc1qtest',
          requestId: 'req-123',
        };

        const result = validateWkSigningRequestPayload(payload);
        expect(result.valid).to.be.false;
        expect(result.error).to.include('walletSignature');
      });

      it('should reject payload without walletPubKey', function () {
        const timestamp = Date.now();
        const payload = {
          message: createTestMessage(timestamp),
          walletSignature: 'signature',
          witnessScript: VALID_WITNESS_SCRIPT,
          wkIdentity: 'bc1qtest',
          requestId: 'req-123',
        };

        const result = validateWkSigningRequestPayload(payload);
        expect(result.valid).to.be.false;
        expect(result.error).to.include('walletPubKey');
      });

      it('should reject payload with invalid walletPubKey format', function () {
        const timestamp = Date.now();
        const payload = {
          message: createTestMessage(timestamp),
          walletSignature: 'signature',
          walletPubKey: 'invalid-pubkey',
          witnessScript: VALID_WITNESS_SCRIPT,
          wkIdentity: 'bc1qtest',
          requestId: 'req-123',
        };

        const result = validateWkSigningRequestPayload(payload);
        expect(result.valid).to.be.false;
        expect(result.error).to.include('walletPubKey');
      });

      it('should reject payload with wrong length walletPubKey', function () {
        const timestamp = Date.now();
        const payload = {
          message: createTestMessage(timestamp),
          walletSignature: 'signature',
          walletPubKey: '0278d4aa2a1c643fc68a', // too short
          witnessScript: VALID_WITNESS_SCRIPT,
          wkIdentity: 'bc1qtest',
          requestId: 'req-123',
        };

        const result = validateWkSigningRequestPayload(payload);
        expect(result.valid).to.be.false;
        expect(result.error).to.include('walletPubKey');
      });

      it('should reject payload without witnessScript', function () {
        const timestamp = Date.now();
        const payload = {
          message: createTestMessage(timestamp),
          walletSignature: 'signature',
          walletPubKey: VALID_PUBLIC_KEY,
          wkIdentity: 'bc1qtest',
          requestId: 'req-123',
        };

        const result = validateWkSigningRequestPayload(payload);
        expect(result.valid).to.be.false;
        expect(result.error).to.include('witnessScript');
      });

      it('should reject payload with invalid witnessScript format', function () {
        const timestamp = Date.now();
        const payload = {
          message: createTestMessage(timestamp),
          walletSignature: 'signature',
          walletPubKey: VALID_PUBLIC_KEY,
          witnessScript: 'not-hex!',
          wkIdentity: 'bc1qtest',
          requestId: 'req-123',
        };

        const result = validateWkSigningRequestPayload(payload);
        expect(result.valid).to.be.false;
        expect(result.error).to.include('witnessScript');
      });

      it('should reject payload without wkIdentity', function () {
        const timestamp = Date.now();
        const payload = {
          message: createTestMessage(timestamp),
          walletSignature: 'signature',
          walletPubKey: VALID_PUBLIC_KEY,
          witnessScript: VALID_WITNESS_SCRIPT,
          requestId: 'req-123',
        };

        const result = validateWkSigningRequestPayload(payload);
        expect(result.valid).to.be.false;
        expect(result.error).to.include('wkIdentity');
      });

      it('should reject payload without requestId', function () {
        const timestamp = Date.now();
        const payload = {
          message: createTestMessage(timestamp),
          walletSignature: 'signature',
          walletPubKey: VALID_PUBLIC_KEY,
          witnessScript: VALID_WITNESS_SCRIPT,
          wkIdentity: 'bc1qtest',
        };

        const result = validateWkSigningRequestPayload(payload);
        expect(result.valid).to.be.false;
        expect(result.error).to.include('requestId');
      });
    });

    describe('requesterInfo validation', function () {
      const validBasePayload = {
        message: '', // Will be set in beforeEach
        walletSignature: 'signature',
        walletPubKey: VALID_PUBLIC_KEY,
        witnessScript: VALID_WITNESS_SCRIPT,
        wkIdentity: 'bc1qtest',
        requestId: 'req-123',
      };

      it('should accept payload with valid requesterInfo', function () {
        const timestamp = Date.now();
        const payload = {
          ...validBasePayload,
          message: createTestMessage(timestamp),
          requesterInfo: {
            origin: 'example.com',
            siteName: 'Example Site',
            description: 'Login authentication',
            iconUrl: 'https://example.com/icon.png',
          },
        };

        const result = validateWkSigningRequestPayload(payload);
        expect(result.valid).to.be.true;
      });

      it('should accept payload with minimal requesterInfo (only origin)', function () {
        const timestamp = Date.now();
        const payload = {
          ...validBasePayload,
          message: createTestMessage(timestamp),
          requesterInfo: {
            origin: 'example.com',
          },
        };

        const result = validateWkSigningRequestPayload(payload);
        expect(result.valid).to.be.true;
      });

      it('should accept payload without requesterInfo', function () {
        const timestamp = Date.now();
        const payload = {
          ...validBasePayload,
          message: createTestMessage(timestamp),
        };

        const result = validateWkSigningRequestPayload(payload);
        expect(result.valid).to.be.true;
      });

      it('should reject requesterInfo that is not an object', function () {
        const timestamp = Date.now();
        const payload = {
          ...validBasePayload,
          message: createTestMessage(timestamp),
          requesterInfo: 'not-an-object',
        };

        const result = validateWkSigningRequestPayload(payload);
        expect(result.valid).to.be.false;
        expect(result.error).to.include('requesterInfo must be an object');
      });

      it('should reject requesterInfo without origin', function () {
        const timestamp = Date.now();
        const payload = {
          ...validBasePayload,
          message: createTestMessage(timestamp),
          requesterInfo: {
            siteName: 'Example Site',
          },
        };

        const result = validateWkSigningRequestPayload(payload);
        expect(result.valid).to.be.false;
        expect(result.error).to.include('origin is required');
      });

      it('should reject requesterInfo with origin too long', function () {
        const timestamp = Date.now();
        const payload = {
          ...validBasePayload,
          message: createTestMessage(timestamp),
          requesterInfo: {
            origin: 'a'.repeat(101),
          },
        };

        const result = validateWkSigningRequestPayload(payload);
        expect(result.valid).to.be.false;
        expect(result.error).to.include('100 characters or less');
      });

      it('should reject requesterInfo with siteName too long', function () {
        const timestamp = Date.now();
        const payload = {
          ...validBasePayload,
          message: createTestMessage(timestamp),
          requesterInfo: {
            origin: 'example.com',
            siteName: 'a'.repeat(101),
          },
        };

        const result = validateWkSigningRequestPayload(payload);
        expect(result.valid).to.be.false;
        expect(result.error).to.include('siteName');
      });

      it('should reject requesterInfo with description too long', function () {
        const timestamp = Date.now();
        const payload = {
          ...validBasePayload,
          message: createTestMessage(timestamp),
          requesterInfo: {
            origin: 'example.com',
            description: 'a'.repeat(501),
          },
        };

        const result = validateWkSigningRequestPayload(payload);
        expect(result.valid).to.be.false;
        expect(result.error).to.include('description');
      });

      it('should reject requesterInfo with non-HTTPS iconUrl', function () {
        const timestamp = Date.now();
        const payload = {
          ...validBasePayload,
          message: createTestMessage(timestamp),
          requesterInfo: {
            origin: 'example.com',
            iconUrl: 'http://example.com/icon.png',
          },
        };

        const result = validateWkSigningRequestPayload(payload);
        expect(result.valid).to.be.false;
        expect(result.error).to.include('HTTPS');
      });

      it('should reject requesterInfo with invalid iconUrl', function () {
        const timestamp = Date.now();
        const payload = {
          ...validBasePayload,
          message: createTestMessage(timestamp),
          requesterInfo: {
            origin: 'example.com',
            iconUrl: 'not-a-url',
          },
        };

        const result = validateWkSigningRequestPayload(payload);
        expect(result.valid).to.be.false;
        expect(result.error).to.include('valid URL');
      });

      it('should reject requesterInfo with iconUrl too long', function () {
        const timestamp = Date.now();
        const payload = {
          ...validBasePayload,
          message: createTestMessage(timestamp),
          requesterInfo: {
            origin: 'example.com',
            iconUrl: 'https://example.com/' + 'a'.repeat(500),
          },
        };

        const result = validateWkSigningRequestPayload(payload);
        expect(result.valid).to.be.false;
        expect(result.error).to.include('500 characters');
      });
    });
  });
});
