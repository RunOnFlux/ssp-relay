// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
/**
 * RA-2 handler-side checks: what POST /v1/sync, /v1/token and /v1/action do
 * with the auth state the middleware leaves on the request.
 */
import { expect } from 'chai';
import sinon from 'sinon';
import httpMocks from 'node-mocks-http';
import utxolib from '@runonflux/utxo-lib';
import syncApi, {
  verifySyncIdentityBinding,
} from '../../src/apiServices/syncApi';
import actionApi, {
  validateRecoveryRequestPayload,
} from '../../src/apiServices/actionApi';
import syncService from '../../src/services/syncService';
import actionService from '../../src/services/actionService';
import notificationService from '../../src/services/notificationService';
import socket from '../../src/lib/socket';
import {
  deriveP2PKHAddress,
  deriveP2WSHAddress,
} from '../../src/lib/identityAuth';

// Wallet /10/0 key (A) and Key /10/0 key (B), both valid points.
const WALLET_PUB =
  '0278d4aa2a1c643fc68a0de5454e47c520cf59643526474e63b320144de9e0d59a';
const KEY_PUB =
  '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const OTHER_PUB =
  '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';

function wkScript(a = WALLET_PUB, b = KEY_PUB) {
  return Buffer.from(
    utxolib.script.multisig.output.encode(
      2,
      [a, b].sort().map((pk) => Buffer.from(pk, 'hex')),
    ),
  ).toString('hex');
}

const WK_SCRIPT = wkScript();
const WK = deriveP2WSHAddress(WK_SCRIPT, 'mainnet');
const WALLET_IDENTITY = deriveP2PKHAddress(WALLET_PUB, 'mainnet');
const KEY_IDENTITY = deriveP2PKHAddress(KEY_PUB, 'mainnet');
const KEY_XPUB_SIG = 'H' + 'A'.repeat(86) + '='; // 88-char base64

function signedSyncRequest(bodyOverrides = {}, reqOverrides = {}) {
  const req = httpMocks.createRequest({
    method: 'POST',
    url: '/v1/sync',
    body: {
      chain: 'btc',
      walletIdentity: WALLET_IDENTITY,
      keyXpub: 'xpubKEY',
      wkIdentity: WK,
      generatedAddress: 'bc1qgenerated',
      keyIdentity: KEY_IDENTITY,
      chainWitnessScript: 'abcdef',
      keyXpubSignature: KEY_XPUB_SIG,
      keyToken: 'fcm',
      // auth envelope (already verified by the middleware)
      signature: 'sig',
      message: '{}',
      publicKey: KEY_PUB,
      witnessScript: WK_SCRIPT,
      ...bodyOverrides,
    },
  });
  req.isAuthenticated = true;
  req.verifiedIdentity = WK;
  req.signerPublicKey = KEY_PUB;
  Object.assign(req, reqOverrides);
  return req;
}

function response(req) {
  return httpMocks.createResponse({
    eventEmitter: require('events').EventEmitter,
    req,
  });
}

describe('RA-2 handler checks', function () {
  afterEach(function () {
    sinon.restore();
  });

  describe('verifySyncIdentityBinding', function () {
    it('accepts the Key signing for its own WK partner wallet', function () {
      expect(() =>
        verifySyncIdentityBinding({
          wkIdentity: WK,
          wkWitnessScript: WK_SCRIPT,
          signerPublicKey: KEY_PUB,
          walletIdentity: WALLET_IDENTITY,
          keyIdentity: KEY_IDENTITY,
        }),
      ).to.not.throw();
    });

    it("refuses to write another wallet's sync record", function () {
      expect(() =>
        verifySyncIdentityBinding({
          wkIdentity: WK,
          wkWitnessScript: WK_SCRIPT,
          signerPublicKey: KEY_PUB,
          walletIdentity: deriveP2PKHAddress(OTHER_PUB, 'mainnet'),
        }),
      ).to.throw(/WK partner/);
      // nor the signer's own address as walletIdentity
      expect(() =>
        verifySyncIdentityBinding({
          wkIdentity: WK,
          wkWitnessScript: WK_SCRIPT,
          signerPublicKey: KEY_PUB,
          walletIdentity: KEY_IDENTITY,
        }),
      ).to.throw(/WK partner/);
    });

    it('refuses a keyIdentity that is not the signer, or a signer outside the script', function () {
      expect(() =>
        verifySyncIdentityBinding({
          wkIdentity: WK,
          wkWitnessScript: WK_SCRIPT,
          signerPublicKey: KEY_PUB,
          walletIdentity: WALLET_IDENTITY,
          keyIdentity: deriveP2PKHAddress(OTHER_PUB, 'mainnet'),
        }),
      ).to.throw(/keyIdentity/);
      expect(() =>
        verifySyncIdentityBinding({
          wkIdentity: WK,
          wkWitnessScript: WK_SCRIPT,
          signerPublicKey: OTHER_PUB,
          walletIdentity: WALLET_IDENTITY,
        }),
      ).to.throw(/not a member/);
    });
  });

  describe('POST /v1/sync handler', function () {
    let ownerStub;
    beforeEach(function () {
      ownerStub = sinon.stub(syncService, 'getSyncOwner').resolves(null);
    });

    it('stores a signed sync with its own address-0 script and keyXpubSignature, never the WK auth script', async function () {
      const stored = sinon
        .stub(syncService, 'postSync')
        .callsFake(async (d) => d);
      sinon.stub(syncService, 'postToken').resolves(true);
      const req = signedSyncRequest();
      const res = response(req);
      await syncApi.postSync(req, res);
      expect(stored.calledOnce).to.equal(true);
      const doc = stored.firstCall.args[0];
      expect(doc.witnessScript).to.equal('abcdef');
      expect(doc.witnessScript).to.not.equal(WK_SCRIPT);
      expect(doc.keyXpubSignature).to.equal(KEY_XPUB_SIG);
      expect(doc).to.not.have.property('signature');
      expect(doc).to.not.have.property('publicKey');
      expect(doc).to.not.have.property('chainWitnessScript');
    });

    it('stores no witnessScript when a signed sync carries none', async function () {
      const stored = sinon
        .stub(syncService, 'postSync')
        .callsFake(async (d) => d);
      sinon.stub(syncService, 'postToken').resolves(true);
      const req = signedSyncRequest({ chainWitnessScript: undefined });
      await syncApi.postSync(req, response(req));
      expect(stored.firstCall.args[0]).to.not.have.property('witnessScript');
    });

    it('refuses a malformed keyXpubSignature', async function () {
      const stored = sinon.stub(syncService, 'postSync').resolves(true);
      for (const bad of ['x'.repeat(121), 'not base64!', 42]) {
        const req = signedSyncRequest({ keyXpubSignature: bad });
        const res = response(req);
        await syncApi.postSync(req, res);
        expect(JSON.parse(res._getData()).status, String(bad)).to.equal(
          'error',
        );
      }
      expect(stored.called).to.equal(false);
    });

    it('refuses a signed sync for a wallet that is not the WK partner', async function () {
      const stored = sinon.stub(syncService, 'postSync').resolves(true);
      const req = signedSyncRequest({
        walletIdentity: deriveP2PKHAddress(OTHER_PUB, 'mainnet'),
      });
      const res = response(req);
      await syncApi.postSync(req, res);
      expect(JSON.parse(res._getData()).status).to.equal('error');
      expect(stored.called).to.equal(false);
    });

    it('refuses an unsigned sync unless the legacy gate let it through', async function () {
      const stored = sinon
        .stub(syncService, 'postSync')
        .callsFake(async (d) => d);
      sinon.stub(syncService, 'postToken').resolves(true);
      const req = signedSyncRequest(
        { signature: undefined, message: undefined, publicKey: undefined },
        { isAuthenticated: false, verifiedIdentity: undefined },
      );
      const res = response(req);
      await syncApi.postSync(req, res);
      expect(JSON.parse(res._getData()).status).to.equal('error');
      expect(stored.called).to.equal(false);

      // RELAY_LEGACY_UNAUTH_MODE=log path: legacy body, witnessScript is the
      // chain script (old Key behaviour) and is stored as before.
      const legacy = signedSyncRequest(
        {
          signature: undefined,
          message: undefined,
          publicKey: undefined,
          witnessScript: '00aa',
          chainWitnessScript: undefined,
        },
        {
          isAuthenticated: false,
          verifiedIdentity: undefined,
          legacyUnauthenticated: true,
        },
      );
      await syncApi.postSync(legacy, response(legacy));
      expect(stored.calledOnce).to.equal(true);
      expect(stored.firstCall.args[0].witnessScript).to.equal('00aa');
    });

    describe('live record ownership (item 5)', function () {
      const OTHER_WK = deriveP2WSHAddress(
        wkScript(WALLET_PUB, OTHER_PUB),
        'mainnet',
      );

      it('refuses a signed sync that would take over a live record of another wkIdentity', async function () {
        ownerStub.resolves({
          wkIdentity: OTHER_WK,
          createdAt: new Date(),
          expireAt: new Date(Date.now() + 10 * 60_000),
          authenticated: true,
        });
        const stored = sinon.stub(syncService, 'postSync').resolves(true);
        const req = signedSyncRequest();
        const res = response(req);
        await syncApi.postSync(req, res);
        const body = JSON.parse(res._getData());
        expect(body.status).to.equal('error');
        expect(body.data.message).to.match(/different SSP identity/);
        expect(stored.called).to.equal(false);
      });

      it('lets the same wkIdentity rewrite its live record, and anyone replace an expired or legacy-empty one', async function () {
        const stored = sinon
          .stub(syncService, 'postSync')
          .callsFake(async (d) => d);
        sinon.stub(syncService, 'postToken').resolves(true);
        for (const existing of [
          {
            wkIdentity: WK,
            expireAt: new Date(Date.now() + 10 * 60_000),
            authenticated: true,
          },
          {
            wkIdentity: OTHER_WK,
            expireAt: new Date(Date.now() - 1000),
            authenticated: true,
          },
          { walletIdentity: WALLET_IDENTITY },
        ]) {
          ownerStub.resolves(existing);
          const req = signedSyncRequest();
          const res = response(req);
          await syncApi.postSync(req, res);
          expect(JSON.parse(res._getData()).status).to.equal('success');
        }
        expect(stored.callCount).to.equal(3);
        expect(stored.firstCall.args[0].authenticated).to.equal(true);
      });

      it('never lets an unsigned (legacy) sync replace a live signed record or another identity', async function () {
        const stored = sinon.stub(syncService, 'postSync').resolves(true);
        const legacy = () =>
          signedSyncRequest(
            {
              signature: undefined,
              message: undefined,
              publicKey: undefined,
              witnessScript: '00aa',
              chainWitnessScript: undefined,
            },
            {
              isAuthenticated: false,
              verifiedIdentity: undefined,
              legacyUnauthenticated: true,
            },
          );
        for (const existing of [
          {
            wkIdentity: WK,
            expireAt: new Date(Date.now() + 10 * 60_000),
            authenticated: true,
          },
          {
            wkIdentity: OTHER_WK,
            expireAt: new Date(Date.now() + 10 * 60_000),
            authenticated: false,
          },
        ]) {
          ownerStub.resolves(existing);
          const req = legacy();
          const res = response(req);
          await syncApi.postSync(req, res);
          expect(JSON.parse(res._getData()).status).to.equal('error');
        }
        expect(stored.called).to.equal(false);
      });

      it('fails closed when the current owner cannot be read', async function () {
        ownerStub.rejects(new Error('MongoNetworkError'));
        const stored = sinon.stub(syncService, 'postSync').resolves(true);
        const req = signedSyncRequest();
        const res = response(req);
        await syncApi.postSync(req, res);
        expect(JSON.parse(res._getData()).status).to.equal('error');
        expect(stored.called).to.equal(false);
      });
    });
  });

  describe('POST /v1/token handler', function () {
    it('refuses a token update that is not signed by the identity it names', async function () {
      const stored = sinon.stub(syncService, 'postToken').resolves(true);
      const req = httpMocks.createRequest({
        method: 'POST',
        body: { wkIdentity: WK, keyToken: 'attacker-device-token' },
      });
      const res = response(req);
      await syncApi.postToken(req, res);
      expect(JSON.parse(res._getData()).status).to.equal('error');
      req.isAuthenticated = true;
      req.verifiedIdentity = 'bc1qsomeoneelse000000000000000000000000000';
      await syncApi.postToken(req, response(req));
      expect(stored.called).to.equal(false);
    });
  });

  describe('POST /v1/action handler', function () {
    function recoveryPayload(overrides = {}) {
      return JSON.stringify({
        pkEph: '02' + 'ab'.repeat(32),
        nonce: 'cd'.repeat(16),
        timestamp: Date.now(),
        recoveryIndex: 0,
        ...overrides,
      });
    }

    it('validates the recovery request payload strictly', function () {
      expect(validateRecoveryRequestPayload(recoveryPayload()).valid).to.equal(
        true,
      );
      expect(
        validateRecoveryRequestPayload(recoveryPayload({ version: 2 })).valid,
      ).to.equal(true);
      for (const bad of [
        recoveryPayload({ pkEph: '04' + 'ab'.repeat(32) }),
        recoveryPayload({ nonce: 'xyz' }),
        recoveryPayload({ timestamp: '1' }),
        recoveryPayload({ recoveryIndex: 2 ** 31 }),
        recoveryPayload({ note: 'phish' }),
        '[]',
        'not json',
        42,
      ]) {
        expect(validateRecoveryRequestPayload(bad).valid, String(bad)).to.equal(
          false,
        );
      }
    });

    it('refuses an unauthenticated non-recovery action even if it reached the handler', async function () {
      const posted = sinon.stub(actionService, 'postAction').resolves({});
      const req = httpMocks.createRequest({
        method: 'POST',
        body: {
          action: 'tx',
          chain: 'btc',
          path: '0-0',
          wkIdentity: WK,
          payload: 'deadbeef',
        },
      });
      const res = response(req);
      await actionApi.postAction(req, res);
      expect(res.statusCode).to.equal(400);
      expect(posted.called).to.equal(false);
    });

    it('refuses a signed action for a different wkIdentity than the verified one', async function () {
      const posted = sinon.stub(actionService, 'postAction').resolves({});
      const req = httpMocks.createRequest({
        method: 'POST',
        body: {
          action: 'tx',
          chain: 'btc',
          path: '0-0',
          wkIdentity: WK,
          payload: 'deadbeef',
        },
      });
      req.isAuthenticated = true;
      req.verifiedIdentity = 'bc1qsomeoneelse000000000000000000000000000';
      const res = response(req);
      await actionApi.postAction(req, res);
      expect(res.statusCode).to.equal(400);
      expect(posted.called).to.equal(false);
    });

    it('accepts the unsigned recovery request and delivers it to the Key room', async function () {
      sinon
        .stub(actionService, 'getAction')
        .rejects(new Error(`Action ${WK} not found`));
      sinon.stub(actionService, 'postAction').resolves({ ok: true });
      sinon.stub(notificationService, 'sendNotificationKey').resolves();
      const emitted = [];
      sinon.stub(socket, 'getIOKey').returns({
        to: (room) => ({ emit: (ev) => emitted.push([room, ev]) }),
      });
      const req = httpMocks.createRequest({
        method: 'POST',
        body: {
          action: 'recoveryrequest',
          chain: 'btc',
          path: '',
          wkIdentity: WK,
          payload: recoveryPayload(),
        },
      });
      const res = response(req);
      await actionApi.postAction(req, res);
      expect(res.statusCode).to.equal(200);
      expect(emitted).to.deep.equal([[WK, 'recoveryrequest']]);
    });

    it('sends the recovery answer to the recovery-only room as well, and nothing else there', async function () {
      sinon.stub(actionService, 'postAction').resolves({ ok: true });
      const rooms = [];
      sinon.stub(socket, 'getIOWallet').returns({
        to: (room) => ({ emit: (ev) => rooms.push([room, ev]) }),
      });
      for (const action of ['recoveryresponse', 'txid']) {
        const req = httpMocks.createRequest({
          method: 'POST',
          body: {
            action,
            chain: 'btc',
            path: '',
            wkIdentity: WK,
            payload: '{"transit":"00"}',
          },
        });
        req.isAuthenticated = true;
        req.verifiedIdentity = WK;
        await actionApi.postAction(req, response(req));
      }
      expect(rooms).to.deep.equal([
        [WK, 'recoveryresponse'],
        [`recovery:${WK}`, 'recoveryresponse'],
        [WK, 'txid'],
      ]);
    });

    it('does not let an unsigned recovery request clobber a pending signing request', async function () {
      sinon.stub(actionService, 'getAction').resolves({
        action: 'tx',
        wkIdentity: WK,
        payload: 'deadbeef',
        expireAt: new Date(Date.now() + 10 * 60 * 1000),
      });
      const posted = sinon.stub(actionService, 'postAction').resolves({});
      const req = httpMocks.createRequest({
        method: 'POST',
        body: {
          action: 'recoveryrequest',
          chain: 'btc',
          path: '',
          wkIdentity: WK,
          payload: recoveryPayload(),
        },
      });
      const res = response(req);
      await actionApi.postAction(req, res);
      expect(res.statusCode).to.equal(400);
      expect(posted.called).to.equal(false);
    });

    function unsignedRecovery(payload = recoveryPayload()) {
      return httpMocks.createRequest({
        method: 'POST',
        body: {
          action: 'recoveryrequest',
          chain: 'btc',
          path: '',
          wkIdentity: WK,
          payload,
        },
      });
    }

    it('never lets an unsigned recovery request erase a fresh recovery answer (item 7)', async function () {
      const getStub = sinon.stub(actionService, 'getAction');
      const posted = sinon.stub(actionService, 'postAction').resolves({});
      for (const action of ['recoveryresponse', 'recoverydenied']) {
        getStub.resolves({
          action,
          wkIdentity: WK,
          payload: '{"transit":"00"}',
          createdAt: new Date(Date.now() - 30_000),
          expireAt: new Date(Date.now() + 14 * 60_000),
        });
        const req = unsignedRecovery();
        const res = response(req);
        await actionApi.postAction(req, res);
        expect(res.statusCode, action).to.equal(400);
      }
      expect(posted.called).to.equal(false);
    });

    it("never lets a stranger's unsigned recovery request replace a live one; the same wallet may retry", async function () {
      const live = recoveryPayload({ pkEph: '02' + 'ab'.repeat(32) });
      const getStub = sinon.stub(actionService, 'getAction').resolves({
        action: 'recoveryrequest',
        wkIdentity: WK,
        payload: live,
        createdAt: new Date(Date.now() - 60_000),
        expireAt: new Date(Date.now() + 14 * 60_000),
      });
      const posted = sinon.stub(actionService, 'postAction').resolves({});
      sinon.stub(notificationService, 'sendNotificationKey').resolves();
      sinon
        .stub(socket, 'getIOKey')
        .returns({ to: () => ({ emit: () => {} }) });
      const stranger = unsignedRecovery(
        recoveryPayload({ pkEph: '03' + 'cd'.repeat(32) }),
      );
      const strangerRes = response(stranger);
      await actionApi.postAction(stranger, strangerRes);
      expect(strangerRes.statusCode).to.equal(400);
      expect(posted.called).to.equal(false);
      // same ephemeral key: the recovering wallet re-sending its request
      const retry = unsignedRecovery(
        recoveryPayload({ pkEph: '02' + 'ab'.repeat(32) }),
      );
      const retryRes = response(retry);
      await actionApi.postAction(retry, retryRes);
      expect(retryRes.statusCode).to.equal(200);
      // a request older than the Key's 5-minute window is dead and replaceable
      getStub.resolves({
        action: 'recoveryrequest',
        wkIdentity: WK,
        payload: recoveryPayload({
          pkEph: '02' + 'ab'.repeat(32),
          timestamp: Date.now() - 6 * 60_000,
        }),
        expireAt: new Date(Date.now() + 9 * 60_000),
      });
      const after = unsignedRecovery(
        recoveryPayload({ pkEph: '03' + 'cd'.repeat(32) }),
      );
      const afterRes = response(after);
      await actionApi.postAction(after, afterRes);
      expect(afterRes.statusCode).to.equal(200);
      expect(posted.callCount).to.equal(2);
    });

    it('fails closed when the pending action cannot be read', async function () {
      sinon
        .stub(actionService, 'getAction')
        .rejects(new Error('MongoServerSelectionError'));
      const posted = sinon.stub(actionService, 'postAction').resolves({});
      const req = unsignedRecovery();
      const res = response(req);
      await actionApi.postAction(req, res);
      expect(res.statusCode).to.equal(400);
      expect(posted.called).to.equal(false);
    });

    it('lets an unsigned recovery request replace an expired action or a previous (answered) recovery round', async function () {
      const getStub = sinon.stub(actionService, 'getAction');
      const posted = sinon.stub(actionService, 'postAction').resolves({});
      sinon.stub(notificationService, 'sendNotificationKey').resolves();
      sinon
        .stub(socket, 'getIOKey')
        .returns({ to: () => ({ emit: () => {} }) });
      for (const existing of [
        { action: 'tx', expireAt: new Date(Date.now() - 1000) },
        {
          action: 'recoverydenied',
          createdAt: new Date(Date.now() - 6 * 60_000),
          expireAt: new Date(Date.now() + 9 * 60_000),
        },
      ]) {
        getStub.resolves({ wkIdentity: WK, payload: 'x', ...existing });
        const req = httpMocks.createRequest({
          method: 'POST',
          body: {
            action: 'recoveryrequest',
            chain: 'btc',
            path: '',
            wkIdentity: WK,
            payload: recoveryPayload(),
          },
        });
        const res = response(req);
        await actionApi.postAction(req, res);
        expect(res.statusCode, existing.action).to.equal(200);
      }
      expect(posted.callCount).to.equal(2);
    });
  });

  describe('GET /v1/action unsigned recovery-only read (RELAY_READ_AUTH_MODE=enforce)', function () {
    function recoveryRead() {
      const req = httpMocks.createRequest({
        method: 'GET',
        url: `/v1/action/${WK}`,
        params: { id: WK },
      });
      req.recoveryOnlyRead = true;
      return req;
    }

    it('returns a recovery answer to an unsigned reader', async function () {
      sinon.stub(actionService, 'getAction').resolves({
        action: 'recoveryresponse',
        wkIdentity: WK,
        payload: '{"transit":"00"}',
      });
      const req = recoveryRead();
      const res = response(req);
      await actionApi.getAction(req, res);
      expect(res.statusCode).to.equal(200);
      expect(JSON.parse(res._getData()).action).to.equal('recoveryresponse');
    });

    it('never returns any other action (or reveals that one exists) to an unsigned reader', async function () {
      const getStub = sinon.stub(actionService, 'getAction');
      for (const action of [
        'tx',
        'wksigned',
        'recoveryrequest',
        'evmsigningrequest',
      ]) {
        getStub.resolves({ action, wkIdentity: WK, payload: 'secret' });
        const req = recoveryRead();
        const res = response(req);
        await actionApi.getAction(req, res);
        expect(res.statusCode, action).to.equal(401);
        expect(res._getData()).to.not.include('secret');
      }
      getStub.rejects(new Error('not found'));
      const req = recoveryRead();
      const res = response(req);
      await actionApi.getAction(req, res);
      expect(res.statusCode).to.equal(401);
    });

    it('the read middleware sets recoveryOnlyRead only for unsigned reads in enforce mode', async function () {
      const { requireReadAuth } =
        await import('../../src/middleware/authMiddleware');
      const mw = requireReadAuth('id', { allowUnsignedRecoveryRead: true });
      const prev = process.env.RELAY_READ_AUTH_MODE;
      try {
        process.env.RELAY_READ_AUTH_MODE = 'enforce';
        const req = httpMocks.createRequest({
          method: 'GET',
          url: `/v1/action/${WK}`,
          params: { id: WK },
        });
        let nextCalled = false;
        await mw(req, response(req), () => {
          nextCalled = true;
        });
        expect(nextCalled).to.equal(true);
        expect(req.recoveryOnlyRead).to.equal(true);
        expect(req.isAuthenticated).to.equal(false);

        // without the option the same read is refused outright
        const strict = requireReadAuth('id');
        const req2 = httpMocks.createRequest({
          method: 'GET',
          url: `/v1/nonces/status/${WK}`,
          params: { id: WK },
        });
        const res2 = response(req2);
        await strict(req2, res2, () => {});
        expect(res2.statusCode).to.equal(401);

        // log mode: unsigned reads are served normally (contract default)
        process.env.RELAY_READ_AUTH_MODE = 'log';
        const req3 = httpMocks.createRequest({
          method: 'GET',
          url: `/v1/action/${WK}`,
          params: { id: WK },
        });
        await mw(req3, response(req3), () => {});
        expect(req3.recoveryOnlyRead).to.equal(false);
        expect(req3.legacyUnauthenticated).to.equal(true);
      } finally {
        if (prev === undefined) delete process.env.RELAY_READ_AUTH_MODE;
        else process.env.RELAY_READ_AUTH_MODE = prev;
      }
    });
  });
});
