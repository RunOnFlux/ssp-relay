// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect } from 'chai';
import httpMocks from 'node-mocks-http';

import {
  requireAuth,
  optionalWkIdentityAuth,
  stripAuthFields,
} from '../../src/middleware/authMiddleware';

const WK = 'bc1qexamplewkidentity000000000000000000000';

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
