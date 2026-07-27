// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect } from 'chai';
import sinon from 'sinon';
import httpMocks from 'node-mocks-http';
import { readFileSync } from 'node:fs';

import recoveryPubApi from '../../src/apiServices/recoveryPubApi';
import recoveryPubService from '../../src/services/recoveryPubService';

const WK = 'bc1qexamplewkidentity000000000000000000000';
const XPUB =
  'Zpub74BWc4YJJs2zaF4x2W8PUFKZyQxkxkgPuDCNKymYBADpqYbXGWj95kPE346PUFcpeGUivfougEkNvGcbnLhWwBD1rJ2q7gsfGcSHpW87L4p';
const SIG =
  'HxGkyMKpPsD4ktvf2uJqX5ZQQ6CjKNPCtQyaUwUf52+lPzpYInpgRnxcZwiOhYWA/t97t7GEpITTOCKXfgn60t4=';

const makeRes = (request) =>
  httpMocks.createResponse({
    eventEmiiter: require('events').EventEmitter,
    req: request,
  });

const postBody = (overrides = {}) => ({
  wkIdentity: WK,
  recoveryXpub: XPUB,
  xpubSignature: SIG,
  chain: 'btc',
  ...overrides,
});

describe('Recovery Pub API', function () {
  afterEach(function () {
    sinon.restore();
  });

  describe('POST /v1/recoverypub', function () {
    it('stores a well-formed record', async function () {
      const request = httpMocks.createRequest({
        method: 'POST',
        url: '/v1/recoverypub',
        body: postBody(),
      });
      const res = makeRes(request);
      const stub = sinon
        .stub(recoveryPubService, 'postRecoveryPub')
        .callsFake((data) => data);

      await recoveryPubApi.postRecoveryPub(request, res);

      expect(res.statusCode).to.equal(200);
      expect(stub.calledOnce).to.equal(true);
      expect(stub.firstCall.args[0]).to.deep.equal({
        wkIdentity: WK,
        recoveryXpub: XPUB,
        xpubSignature: SIG,
        chain: 'btc',
      });
    });

    it('carries the signature past stripAuthFields', async function () {
      // The relay's auth envelope owns the names `signature`, `message`,
      // `publicKey` and `witnessScript`, and stripAuthFields() removes them
      // from the body before a handler runs. A detached signature sent under
      // any of those names would silently vanish, so this asserts the value
      // survives even when a real auth envelope is present alongside it.
      const request = httpMocks.createRequest({
        method: 'POST',
        url: '/v1/recoverypub',
        body: {
          ...postBody(),
          signature: 'auth-envelope-signature',
          message: 'auth-envelope-message',
          publicKey: 'auth-envelope-pubkey',
          witnessScript: 'auth-envelope-witness',
        },
      });
      const res = makeRes(request);
      const stub = sinon
        .stub(recoveryPubService, 'postRecoveryPub')
        .callsFake((data) => data);

      await recoveryPubApi.postRecoveryPub(request, res);

      expect(res.statusCode).to.equal(200);
      expect(stub.firstCall.args[0].xpubSignature).to.equal(SIG);
    });

    it('rejects a missing or malformed signature', async function () {
      for (const bad of [undefined, '', 123, 'x'.repeat(201)]) {
        const request = httpMocks.createRequest({
          method: 'POST',
          url: '/v1/recoverypub',
          body: postBody({ xpubSignature: bad }),
        });
        const res = makeRes(request);
        const stub = sinon.stub(recoveryPubService, 'postRecoveryPub');

        await recoveryPubApi.postRecoveryPub(request, res);

        expect(res.statusCode).to.equal(400);
        expect(stub.called).to.equal(false);
        sinon.restore();
      }
    });

    it('rejects a missing or malformed wkIdentity', async function () {
      for (const bad of [undefined, '', 'has spaces', 'x'.repeat(201)]) {
        const request = httpMocks.createRequest({
          method: 'POST',
          url: '/v1/recoverypub',
          body: postBody({ wkIdentity: bad }),
        });
        const res = makeRes(request);
        const stub = sinon.stub(recoveryPubService, 'postRecoveryPub');

        await recoveryPubApi.postRecoveryPub(request, res);

        expect(res.statusCode).to.equal(400);
        expect(stub.called).to.equal(false);
        sinon.restore();
      }
    });

    it('rejects a missing or malformed xpub', async function () {
      for (const bad of [undefined, '', 'not an xpub!', 'x'.repeat(201)]) {
        const request = httpMocks.createRequest({
          method: 'POST',
          url: '/v1/recoverypub',
          body: postBody({ recoveryXpub: bad }),
        });
        const res = makeRes(request);
        const stub = sinon.stub(recoveryPubService, 'postRecoveryPub');

        await recoveryPubApi.postRecoveryPub(request, res);

        expect(res.statusCode).to.equal(400);
        expect(stub.called).to.equal(false);
        sinon.restore();
      }
    });

    it('rejects a missing or malformed chain', async function () {
      for (const bad of [undefined, '', 'has spaces']) {
        const request = httpMocks.createRequest({
          method: 'POST',
          url: '/v1/recoverypub',
          body: postBody({ chain: bad }),
        });
        const res = makeRes(request);
        const stub = sinon.stub(recoveryPubService, 'postRecoveryPub');

        await recoveryPubApi.postRecoveryPub(request, res);

        expect(res.statusCode).to.equal(400);
        expect(stub.called).to.equal(false);
        sinon.restore();
      }
    });
  });

  describe('GET /v1/recoverypub/:id', function () {
    it('returns the stored record', async function () {
      const record = {
        wkIdentity: WK,
        recoveryXpub: XPUB,
        xpubSignature: SIG,
        chain: 'btc',
      };
      const request = httpMocks.createRequest({
        method: 'GET',
        url: '/v1/recoverypub',
        params: { id: WK },
      });
      const res = makeRes(request);
      sinon.stub(recoveryPubService, 'getRecoveryPub').returns(record);

      await recoveryPubApi.getRecoveryPub(request, res);

      expect(JSON.parse(res._getData())).to.deep.equal(record);
    });

    it('404s when nothing is published for that identity', async function () {
      const request = httpMocks.createRequest({
        method: 'GET',
        url: '/v1/recoverypub',
        params: { id: WK },
      });
      const res = makeRes(request);
      sinon
        .stub(recoveryPubService, 'getRecoveryPub')
        .throws(new Error('nope'));

      await recoveryPubApi.getRecoveryPub(request, res);

      expect(res.statusCode).to.equal(404);
    });

    it('rejects a malformed id', async function () {
      const request = httpMocks.createRequest({
        method: 'GET',
        url: '/v1/recoverypub',
        params: { id: 'has spaces' },
      });
      const res = makeRes(request);
      const stub = sinon.stub(recoveryPubService, 'getRecoveryPub');

      await recoveryPubApi.getRecoveryPub(request, res);

      expect(res.statusCode).to.equal(400);
      expect(stub.called).to.equal(false);
    });
  });
  describe('route wiring', function () {
    it('requires wkIdentity auth on the write route', function () {
      // The record is keyed by wkIdentity and upserted, so writes are
      // authenticated: only the paired Key may write its own identity's
      // record. Pinned here because the route wiring is the whole enforcement.
      const routes = readFileSync(
        new URL('../../src/routes.ts', import.meta.url),
        'utf8',
      );
      const post = routes.match(/app\.post\(\s*'\/v1\/recoverypub',\s*(\w+)/);
      expect(post, 'POST /v1/recoverypub is registered').to.not.equal(null);
      expect(post![1]).to.equal('requireWkIdentityAuth');

      // The read route stays open: the record is public data and the wallet
      // that needs it cannot sign yet at recovery time.
      const get = routes.match(
        /app\.get\(\s*'\/v1\/recoverypub\{\/:id\}',\s*\(/,
      );
      expect(
        get,
        'GET /v1/recoverypub is registered without middleware',
      ).to.not.equal(null);
    });
  });
});
