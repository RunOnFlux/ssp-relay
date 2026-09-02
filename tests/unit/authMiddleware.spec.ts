// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect } from 'chai';
import httpMocks from 'node-mocks-http';
import crypto from 'crypto';
import utxolib from '@runonflux/utxo-lib';
import bitcoinMessage from 'bitcoinjs-message';

import {
  requireAuth,
  optionalWkIdentityAuth,
  stripAuthFields,
} from '../../src/middleware/authMiddleware';
import {
  deriveP2WSHAddress,
  createSignaturePayload,
} from '../../src/lib/identityAuth';

const WK = 'bc1qexamplewkidentity000000000000000000000';

// Real 2-of-2 fixtures (same key material as identityAuth.spec.ts)
const TEST_PRIVATE_KEY_WIF =
  'L1TnU2zbNaAqMoVh65Cyvmcjzbrj41Gs9iTLcWbpJCMynXuap6UN';
const TEST_PUBLIC_KEY =
  '0278d4aa2a1c643fc68a0de5454e47c520cf59643526474e63b320144de9e0d59a';
const TEST_PUBKEY_2 =
  '0354dae65cc6eede1d82b4a68a97c28b1f2cd44f7d99b86a2bdcfe89e9fd5c7f9e';

function testWitnessScript() {
  const pubKeys = [TEST_PUBLIC_KEY, TEST_PUBKEY_2].sort();
  const pubKeyBuffers = pubKeys.map((pk) => Buffer.from(pk, 'hex'));
  const witnessScript = utxolib.script.multisig.output.encode(2, pubKeyBuffers);
  return Buffer.from(witnessScript).toString('hex');
}

// Build a fully signed request body the way the SSP Key client does: hash the
// unsigned body, sign a payload carrying that hash, attach the auth envelope.
function signedRequestBody(unsignedBody, { withBodyHash = true } = {}) {
  const witnessScript = testWitnessScript();
  const wkIdentity = deriveP2WSHAddress(witnessScript, 'mainnet');
  const body = { ...unsignedBody, wkIdentity };
  const bodyHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(body))
    .digest('hex');
  const payload = createSignaturePayload(
    'action',
    wkIdentity,
    withBodyHash ? bodyHash : undefined,
  );
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
    ...body,
    signature: signature.toString('base64'),
    message,
    publicKey: TEST_PUBLIC_KEY,
    witnessScript,
  };
}

const run = async (middleware, body) => {
  const req = httpMocks.createRequest({
    method: 'POST',
    url: '/v1/action',
    body,
  });
  const res = httpMocks.createResponse({
    eventEmitter: require('events').EventEmitter,
    req,
  });
  let nextCalled = false;
  await middleware(req, res, () => {
    nextCalled = true;
  });
  return { req, res, nextCalled };
};

describe('Auth Middleware', function () {
  describe('optional auth', function () {
    it('lets a request with no credentials through', async function () {
      const { res, nextCalled, req } = await run(optionalWkIdentityAuth, {
        wkIdentity: WK,
        action: 'tx',
      });

      expect(nextCalled).to.equal(true);
      expect(req.isAuthenticated).to.equal(false);
      expect(res.statusCode).to.equal(200);
    });

    it('refuses a partial credential set instead of waving it through', async function () {
      // The client helpers attach signature, message and publicKey together, so
      // a partial set is not something a real client produces. Treating it as
      // "no credentials" would mean dropping one field turns a signed request
      // into an unsigned one, which is the whole point of signing it.
      for (const partial of [
        { signature: 'sig' },
        { message: 'msg' },
        { publicKey: 'pub' },
        { signature: 'sig', message: 'msg' },
        { signature: 'sig', publicKey: 'pub' },
        { message: 'msg', publicKey: 'pub' },
      ]) {
        const { res, nextCalled } = await run(optionalWkIdentityAuth, {
          wkIdentity: WK,
          action: 'tx',
          ...partial,
        });

        expect(nextCalled, JSON.stringify(partial)).to.equal(false);
        expect(res.statusCode, JSON.stringify(partial)).to.equal(401);
        expect(JSON.parse(res._getData()).data.code).to.equal(
          'AUTH_INCOMPLETE',
        );
      }
    });

    it('still validates a complete credential set', async function () {
      // Complete but bogus: it must be rejected, not skipped.
      const { res, nextCalled } = await run(optionalWkIdentityAuth, {
        wkIdentity: WK,
        signature: 'not-a-signature',
        message: 'not-json',
        publicKey: 'zz',
      });

      expect(nextCalled).to.equal(false);
      expect(res.statusCode).to.equal(401);
    });
  });

  describe('required auth', function () {
    it('rejects a request with no credentials', async function () {
      const { res, nextCalled } = await run(requireAuth('wkIdentity'), {
        wkIdentity: WK,
      });

      expect(nextCalled).to.equal(false);
      expect(res.statusCode).to.equal(401);
      expect(JSON.parse(res._getData()).data.code).to.equal(
        'AUTH_MISSING_SIGNATURE',
      );
    });
  });

  describe('identical resend handling', function () {
    it('acknowledges a byte-identical resend instead of failing it as a replay', async function () {
      // Mobile transport layers may deliver a POST whose response is lost and
      // then resend the exact same signed body; the second copy must get a
      // success, not a nonce-replay 401, while the handler runs only once.
      const body = signedRequestBody({ action: 'txid', payload: 'deadbeef' });

      const first = await run(optionalWkIdentityAuth, body);
      expect(first.nextCalled).to.equal(true);
      expect(first.req.isAuthenticated).to.equal(true);

      const resend = await run(optionalWkIdentityAuth, body);
      expect(resend.nextCalled).to.equal(false);
      expect(resend.res.statusCode).to.equal(200);
      const parsed = JSON.parse(resend.res._getData());
      expect(parsed.status).to.equal('success');
      expect(parsed.data.duplicate).to.equal(true);
    });

    it('refuses a resend without body-hash binding as a replay', async function () {
      // Without the signed body hash the relay cannot prove the resent body
      // is the one that was accepted, so it stays a replay refusal.
      const body = signedRequestBody(
        { action: 'txid', payload: 'deadbeef' },
        { withBodyHash: false },
      );

      const first = await run(optionalWkIdentityAuth, body);
      expect(first.nextCalled).to.equal(true);

      const resend = await run(optionalWkIdentityAuth, body);
      expect(resend.nextCalled).to.equal(false);
      expect(resend.res.statusCode).to.equal(401);
      expect(JSON.parse(resend.res._getData()).data.code).to.equal(
        'AUTH_FAILED',
      );
    });

    it('refuses a resend whose body was tampered with', async function () {
      const body = signedRequestBody({ action: 'txid', payload: 'deadbeef' });

      const first = await run(optionalWkIdentityAuth, body);
      expect(first.nextCalled).to.equal(true);

      const tampered = await run(optionalWkIdentityAuth, {
        ...body,
        payload: 'attacker-payload',
      });
      expect(tampered.nextCalled).to.equal(false);
      expect(tampered.res.statusCode).to.equal(401);
      expect(JSON.parse(tampered.res._getData()).data.code).to.equal(
        'AUTH_BODY_HASH_MISMATCH',
      );
    });
  });

  describe('stripAuthFields', function () {
    it('removes the envelope and leaves everything else', function () {
      const stripped = stripAuthFields({
        wkIdentity: WK,
        payload: 'keep',
        signature: 'drop',
        message: 'drop',
        publicKey: 'drop',
        witnessScript: 'drop',
      });

      expect(stripped).to.deep.equal({ wkIdentity: WK, payload: 'keep' });
    });
  });
});
