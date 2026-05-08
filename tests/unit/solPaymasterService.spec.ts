// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect } from 'chai';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { decodeSecretKey } from '../../src/services/solPaymasterService';

describe('Solana Paymaster Service', function () {
  describe('decodeSecretKey', function () {
    it('decodes a base58-encoded 64-byte secret key', function () {
      const kp = Keypair.generate();
      const b58 = bs58.encode(kp.secretKey);
      const decoded = decodeSecretKey(b58);
      expect(decoded.length).to.equal(64);
      // Round-trip: a freshly constructed Keypair must yield same pubkey
      const kp2 = Keypair.fromSecretKey(decoded);
      expect(kp2.publicKey.toBase58()).to.equal(kp.publicKey.toBase58());
    });

    it('decodes a JSON byte-array secret key (solana-keygen format)', function () {
      const kp = Keypair.generate();
      const json = JSON.stringify(Array.from(kp.secretKey));
      const decoded = decodeSecretKey(json);
      expect(decoded.length).to.equal(64);
      const kp2 = Keypair.fromSecretKey(decoded);
      expect(kp2.publicKey.toBase58()).to.equal(kp.publicKey.toBase58());
    });

    it('trims whitespace before parsing', function () {
      const kp = Keypair.generate();
      const json = '\n  ' + JSON.stringify(Array.from(kp.secretKey)) + '  \n';
      const decoded = decodeSecretKey(json);
      expect(decoded.length).to.equal(64);
    });

    it('throws for an empty string', function () {
      expect(() => decodeSecretKey('')).to.throw(/empty/);
    });

    it('throws for a JSON array of the wrong length', function () {
      const json = JSON.stringify(new Array(63).fill(0));
      expect(() => decodeSecretKey(json)).to.throw(/64-byte array/);
    });

    it('throws for a JSON value that is not an array', function () {
      expect(() => decodeSecretKey('{"foo":"bar"}')).to.throw();
    });

    it('throws for a base58 string that decodes to the wrong length', function () {
      const tooShort = bs58.encode(new Uint8Array(32));
      expect(() => decodeSecretKey(tooShort)).to.throw(/64 bytes/);
    });

    it('throws for non-base58 input that is not JSON', function () {
      expect(() => decodeSecretKey('!@#$%^&*()')).to.throw();
    });
  });
});
