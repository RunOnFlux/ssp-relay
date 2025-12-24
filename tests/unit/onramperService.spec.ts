// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect, assert } from 'chai';
import crypto from 'crypto';
import { generateSignature } from '../../src/services/onramperService';

describe('Onramper Service', function () {
  describe('generateSignature', function () {
    it('should generate a valid hex signature for data >= 30 characters', function () {
      const data = 'a'.repeat(30);
      const signature = generateSignature(data);

      expect(signature).to.be.a('string');
      expect(signature).to.have.lengthOf(64); // SHA256 hex is 64 characters
      expect(signature).to.match(/^[a-f0-9]+$/); // Valid hex string
    });

    it('should throw error when data is less than 30 characters', function () {
      const shortData = 'a'.repeat(29);

      expect(() => generateSignature(shortData)).to.throw('Data is too short');
    });

    it('should throw error for empty string', function () {
      expect(() => generateSignature('')).to.throw('Data is too short');
    });

    it('should produce deterministic signatures (same input = same output)', function () {
      const data = 'test-data-that-is-at-least-thirty-characters-long';
      const signature1 = generateSignature(data);
      const signature2 = generateSignature(data);

      expect(signature1).to.equal(signature2);
    });

    it('should produce different signatures for different inputs', function () {
      const data1 = 'first-test-data-that-is-at-least-thirty-characters';
      const data2 = 'second-test-data-that-is-at-least-thirty-characters';
      const signature1 = generateSignature(data1);
      const signature2 = generateSignature(data2);

      expect(signature1).to.not.equal(signature2);
    });

    it('should handle exactly 30 characters', function () {
      const data = 'a'.repeat(30);
      const signature = generateSignature(data);

      expect(signature).to.be.a('string');
      expect(signature).to.have.lengthOf(64);
    });

    it('should handle long data strings', function () {
      const data = 'x'.repeat(10000);
      const signature = generateSignature(data);

      expect(signature).to.be.a('string');
      expect(signature).to.have.lengthOf(64);
      expect(signature).to.match(/^[a-f0-9]+$/);
    });

    it('should handle special characters in data', function () {
      const data = 'special-chars-!@#$%^&*()_+-=[]{}|;:,.<>?/~`';
      const signature = generateSignature(data);

      expect(signature).to.be.a('string');
      expect(signature).to.have.lengthOf(64);
    });

    it('should handle unicode characters in data', function () {
      const data = 'unicode-test-data-日本語-한국어-中文-emoji-🔐🔑';
      const signature = generateSignature(data);

      expect(signature).to.be.a('string');
      expect(signature).to.have.lengthOf(64);
    });
  });

  describe('HMAC-SHA256 algorithm verification', function () {
    it('should produce correct signature for known payload and secret key', function () {
      const secretKey = '01KDMCCDJS3W2NFO4PNAJFIQMP';
      const payload = 'networkWallets=flux:t3TRUNKvgywghL1vU5bsGQqs9eVC17XcUnV';
      const expectedSignature =
        '18c4e2ffd1622f7ee827598eb2c2e88f4dc02fbf315b1cb951a9978a9e69491a';

      const hmac = crypto.createHmac('sha256', secretKey);
      hmac.update(payload);
      const signature = hmac.digest('hex');

      expect(signature).to.equal(expectedSignature);
    });

    it('should produce correct signature using generateSignature with default config key', function () {
      const payload = 'networkWallets=flux:t3TRUNKvgywghL1vU5bsGQqs9eVC17XcUnV';
      const expectedSignature =
        '0c30da188858431a08be88a7042fca4ac03ec9197af0f0bd4b4e11725d794e18';

      const signature = generateSignature(payload);

      expect(signature).to.equal(expectedSignature);
    });
  });
});
