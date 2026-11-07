// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect } from 'chai';
import httpMocks from 'node-mocks-http';
import crypto from 'crypto';
import utxolib from '@runonflux/utxo-lib';
import bitcoinMessage from 'bitcoinjs-message';

import {
  requireAuth,
  requireReadAuth,
  requireWkIdentityAuth,
  requireWkIdentityAuthLegacyGated,
  computeReadPathHash,
  stripAuthFields,
  legacyUnauthMode,
  logAuthModeBanner,
} from '../../src/middleware/authMiddleware';
import {
  deriveP2WSHAddress,
  deriveP2PKHAddress,
  createSignaturePayload,
  generateNonce,
  resetNonceCache,
} from '../../src/lib/identityAuth';
import { isUnsignedRecoveryRequest } from '../../src/apiServices/actionApi';
import sinon from 'sinon';
import log from '../../src/lib/log';

const WK = 'bc1qexamplewkidentity000000000000000000000';

// Real 2-of-2 fixtures (same key material as identityAuth.spec.ts)
const TEST_PRIVATE_KEY_WIF =
  'L1TnU2zbNaAqMoVh65Cyvmcjzbrj41Gs9iTLcWbpJCMynXuap6UN';
const TEST_PUBLIC_KEY =
  '0278d4aa2a1c643fc68a0de5454e47c520cf59643526474e63b320144de9e0d59a';
// A valid compressed point (secp256k1 generator) as the second WK key.
const TEST_PUBKEY_2 =
  '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

function testWitnessScript() {
  const pubKeys = [TEST_PUBLIC_KEY, TEST_PUBKEY_2].sort();
  const pubKeyBuffers = pubKeys.map((pk) => Buffer.from(pk, 'hex'));
  const witnessScript = utxolib.script.multisig.output.encode(2, pubKeyBuffers);
  return Buffer.from(witnessScript).toString('hex');
}

// Build a fully signed request body the way the SSP Key client does: hash the
// unsigned body, sign a payload carrying that hash, attach the auth envelope.
function signedRequestBody(
  unsignedBody,
  { withBodyHash = true, action = 'action' } = {},
) {
  const witnessScript = testWitnessScript();
  const wkIdentity = deriveP2WSHAddress(witnessScript, 'mainnet');
  const body = { ...unsignedBody, wkIdentity };
  const bodyHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(body))
    .digest('hex');
  const payload = createSignaturePayload(
    action,
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

function signMessage(message) {
  const keyPair = utxolib.ECPair.fromWIF(
    TEST_PRIVATE_KEY_WIF,
    utxolib.networks.bitcoin,
  );
  return bitcoinMessage
    .sign(message, keyPair.d.toBuffer(32), keyPair.compressed)
    .toString('base64');
}

// Read-auth headers the way the clients will build them (contract RA-4).
function readAuthHeaders(
  path,
  identity,
  { witness = true, overrides = {}, dataPath = path } = {},
) {
  const payload = {
    timestamp: Date.now(),
    action: 'read',
    identity,
    nonce: generateNonce(),
    data: computeReadPathHash(dataPath),
    ...overrides,
  };
  const message = JSON.stringify(payload);
  const headers = {
    'x-ssp-signature': signMessage(message),
    'x-ssp-message': message,
    'x-ssp-publickey': TEST_PUBLIC_KEY,
  };
  if (witness) headers['x-ssp-witnessscript'] = testWitnessScript();
  return headers;
}

const runGet = async (middleware, { url, params, headers = {} }) => {
  const req = httpMocks.createRequest({ method: 'GET', url, params, headers });
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

const code = (res) => JSON.parse(res._getData()).data.code;

function withEnv(name, value, fn) {
  return async function () {
    const prev = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    try {
      await fn.call(this);
    } finally {
      if (prev === undefined) delete process.env[name];
      else process.env[name] = prev;
    }
  };
}

function recoveryBody(overrides = {}) {
  return {
    action: 'recoveryrequest',
    chain: 'btc',
    path: '',
    wkIdentity: WK,
    payload: JSON.stringify({
      pkEph: '02' + 'ab'.repeat(32),
      nonce: 'cd'.repeat(16),
      timestamp: Date.now(),
      recoveryIndex: 0,
      ...overrides,
    }),
  };
}

describe('Auth Middleware', function () {
  describe('mandatory auth (RA-1/RA-2: no unsigned fallback)', function () {
    it('refuses a request with no credentials', async function () {
      const { res, nextCalled, req } = await run(requireWkIdentityAuth, {
        wkIdentity: WK,
        action: 'tx',
      });

      expect(nextCalled).to.equal(false);
      expect(req.isAuthenticated).to.equal(false);
      expect(res.statusCode).to.equal(401);
      expect(code(res)).to.equal('AUTH_REQUIRED');
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
        const { res, nextCalled } = await run(
          requireWkIdentityAuthLegacyGated,
          { wkIdentity: WK, action: 'tx', ...partial },
        );

        expect(nextCalled, JSON.stringify(partial)).to.equal(false);
        expect(res.statusCode, JSON.stringify(partial)).to.equal(401);
        expect(code(res)).to.equal('AUTH_INCOMPLETE');
      }
    });

    it('still validates a complete credential set', async function () {
      // Complete but bogus: it must be rejected, not skipped.
      const { res, nextCalled } = await run(requireWkIdentityAuth, {
        wkIdentity: WK,
        signature: 'not-a-signature',
        message: 'not-json',
        publicKey: 'zz',
      });

      expect(nextCalled).to.equal(false);
      expect(res.statusCode).to.equal(401);
    });

    it('accepts a valid signed request and sets verifiedIdentity', async function () {
      const body = signedRequestBody({ action: 'tx', payload: 'aa' });
      const { req, nextCalled } = await run(requireWkIdentityAuth, body);
      expect(nextCalled).to.equal(true);
      expect(req.isAuthenticated).to.equal(true);
      expect(req.verifiedIdentity).to.equal(body.wkIdentity);
      expect(req.signerPublicKey).to.equal(TEST_PUBLIC_KEY);
    });

    it("refuses a body signed with a 'read' payload (read signatures cannot authorise writes)", async function () {
      const body = signedRequestBody(
        { action: 'tx', payload: 'aa' },
        { action: 'read' },
      );
      const { res, nextCalled } = await run(requireWkIdentityAuth, body);
      expect(nextCalled).to.equal(false);
      expect(res.statusCode).to.equal(401);
    });

    it('ignores client-supplied isAuthenticated / verifiedIdentity flags', async function () {
      const req = httpMocks.createRequest({
        method: 'POST',
        url: '/v1/action',
        body: { wkIdentity: WK, action: 'tx' },
      });
      req.isAuthenticated = true;
      req.verifiedIdentity = WK;
      const res = httpMocks.createResponse({
        eventEmitter: require('events').EventEmitter,
        req,
      });
      await requireWkIdentityAuth(req, res, () => {});
      expect(req.isAuthenticated).to.equal(false);
      expect(req.verifiedIdentity).to.equal(undefined);
      expect(res.statusCode).to.equal(401);
    });
  });

  describe('RELAY_LEGACY_UNAUTH_MODE gate', function () {
    it(
      "lets unsigned requests through by default ('log', released-client compatibility)",
      withEnv('RELAY_LEGACY_UNAUTH_MODE', undefined, async function () {
        expect(legacyUnauthMode()).to.equal('log');
        const { nextCalled, req } = await run(
          requireWkIdentityAuthLegacyGated,
          { wkIdentity: WK, nonces: [] },
        );
        expect(nextCalled).to.equal(true);
        expect(req.isAuthenticated).to.equal(false);
        expect(req.legacyUnauthenticated).to.equal(true);
        expect(req.verifiedIdentity).to.equal(undefined);
      }),
    );

    it(
      "denies unsigned requests in 'deny' mode",
      withEnv('RELAY_LEGACY_UNAUTH_MODE', 'deny', async function () {
        const { res, nextCalled, req } = await run(
          requireWkIdentityAuthLegacyGated,
          { wkIdentity: WK, nonces: [] },
        );
        expect(nextCalled).to.equal(false);
        expect(res.statusCode).to.equal(401);
        expect(code(res)).to.equal('AUTH_REQUIRED');
        expect(req.legacyUnauthenticated).to.equal(false);
      }),
    );

    it(
      'warns loudly at startup while in log mode',
      withEnv('RELAY_LEGACY_UNAUTH_MODE', undefined, async function () {
        const warn = sinon.stub(log, 'warn');
        try {
          logAuthModeBanner();
          expect(
            warn
              .getCalls()
              .some((c) =>
                /WARNING: RELAY_LEGACY_UNAUTH_MODE=log/.test(String(c.args[0])),
              ),
          ).to.equal(true);
        } finally {
          warn.restore();
        }
      }),
    );

    it(
      'denies unsigned requests for any unrecognised value (typo fails closed)',
      withEnv('RELAY_LEGACY_UNAUTH_MODE', 'allow', async function () {
        const { res, nextCalled } = await run(
          requireWkIdentityAuthLegacyGated,
          { wkIdentity: WK },
        );
        expect(nextCalled).to.equal(false);
        expect(res.statusCode).to.equal(401);
      }),
    );

    it(
      "lets unsigned requests through unauthenticated in 'log' mode",
      withEnv('RELAY_LEGACY_UNAUTH_MODE', 'log', async function () {
        const { nextCalled, req } = await run(
          requireWkIdentityAuthLegacyGated,
          { wkIdentity: WK, nonces: [] },
        );
        expect(nextCalled).to.equal(true);
        expect(req.isAuthenticated).to.equal(false);
        expect(req.legacyUnauthenticated).to.equal(true);
        expect(req.verifiedIdentity).to.equal(undefined);
      }),
    );

    it(
      "never applies 'log' mode to always-signed endpoints",
      withEnv('RELAY_LEGACY_UNAUTH_MODE', 'log', async function () {
        const { res, nextCalled } = await run(requireWkIdentityAuth, {
          wkIdentity: WK,
          action: 'tx',
        });
        expect(nextCalled).to.equal(false);
        expect(res.statusCode).to.equal(401);
      }),
    );

    it(
      "still verifies signed requests in 'log' mode",
      withEnv('RELAY_LEGACY_UNAUTH_MODE', 'log', async function () {
        const body = signedRequestBody({ nonces: [] });
        const ok = await run(requireWkIdentityAuthLegacyGated, body);
        expect(ok.nextCalled).to.equal(true);
        expect(ok.req.verifiedIdentity).to.equal(body.wkIdentity);
        const tampered = await run(requireWkIdentityAuthLegacyGated, {
          ...signedRequestBody({ nonces: [] }),
          nonces: ['x'],
        });
        expect(tampered.nextCalled).to.equal(false);
        expect(tampered.res.statusCode).to.equal(401);
      }),
    );
  });

  describe('route binding: signed action and body hash (item 4)', function () {
    it('accepts only the signed action the route lists', async function () {
      const tokenAuth = requireAuth('wkIdentity', { actions: ['token'] });
      const syncAuth = requireAuth('wkIdentity', { actions: ['sync'] });
      // a /v1/token signature ('token') is refused on an 'action' route…
      const tokenBody = signedRequestBody(
        { keyToken: 'fcm' },
        { action: 'token' },
      );
      const wrong = await run(requireWkIdentityAuth, tokenBody);
      expect(wrong.nextCalled).to.equal(false);
      expect(wrong.res.statusCode).to.equal(401);
      expect(code(wrong.res)).to.equal('AUTH_ACTION_MISMATCH');
      // …and on the 'sync' route…
      const wrongSync = await run(syncAuth, tokenBody);
      expect(code(wrongSync.res)).to.equal('AUTH_ACTION_MISMATCH');
      // …and its nonce was not spent: the right route still accepts it.
      const right = await run(tokenAuth, tokenBody);
      expect(right.nextCalled).to.equal(true);
      expect(right.req.verifiedIdentity).to.equal(tokenBody.wkIdentity);
      // an 'action' signature cannot be spent on /v1/sync
      const actionBody = signedRequestBody({ chain: 'btc' });
      expect(code((await run(syncAuth, actionBody)).res)).to.equal(
        'AUTH_ACTION_MISMATCH',
      );
      expect(
        (await run(requireWkIdentityAuth, actionBody)).nextCalled,
      ).to.equal(true);
    });

    it('a tampered body does not spend the nonce of the honest request', async function () {
      const honest = signedRequestBody({ action: 'tx', payload: 'aa' });
      const tampered = await run(requireWkIdentityAuth, {
        ...honest,
        payload: 'attacker',
      });
      expect(code(tampered.res)).to.equal('AUTH_BODY_HASH_MISMATCH');
      // the honest request is processed normally, not acknowledged as a
      // duplicate of the tampered one
      const ok = await run(requireWkIdentityAuth, honest);
      expect(ok.nextCalled).to.equal(true);
      expect(ok.req.isAuthenticated).to.equal(true);
    });

    it('refuses to build a route without its accepted actions, or with read', function () {
      expect(() => requireAuth('wkIdentity')).to.throw(/actions/);
      expect(() => requireAuth('wkIdentity', { actions: [] })).to.throw(
        /actions/,
      );
      expect(() => requireAuth('wkIdentity', { actions: ['read'] })).to.throw(
        /requireReadAuth/,
      );
    });

    it(
      'answers 503 (not 401) when the replay cache is saturated, and recovers',
      withEnv('RELAY_NONCE_CACHE_MAX_ENTRIES', '1', async function () {
        resetNonceCache();
        try {
          const first = await run(
            requireWkIdentityAuth,
            signedRequestBody({ action: 'tx', payload: 'a1' }),
          );
          expect(first.nextCalled).to.equal(true);
          const second = await run(
            requireWkIdentityAuth,
            signedRequestBody({ action: 'tx', payload: 'a2' }),
          );
          expect(second.nextCalled).to.equal(false);
          expect(second.res.statusCode).to.equal(503);
          expect(code(second.res)).to.equal('AUTH_UNAVAILABLE');
        } finally {
          resetNonceCache();
        }
        const after = await run(
          requireWkIdentityAuth,
          signedRequestBody({ action: 'tx', payload: 'a3' }),
        );
        expect(after.nextCalled).to.equal(true);
      }),
    );
  });

  describe('unsigned wallet-recovery request (by-design exception on POST /v1/action)', function () {
    const actionAuth = requireAuth('wkIdentity', {
      actions: ['action'],
      allowUnauthenticated: isUnsignedRecoveryRequest,
    });

    it('lets a well-formed unsigned recoveryrequest through', async function () {
      const { nextCalled, req } = await run(actionAuth, recoveryBody());
      expect(nextCalled).to.equal(true);
      expect(req.isAuthenticated).to.equal(false);
      expect(req.verifiedIdentity).to.equal(undefined);
    });

    it('refuses any other unsigned action', async function () {
      for (const action of ['tx', 'wksigningrequest', 'recoveryresponse']) {
        const { res, nextCalled } = await run(actionAuth, {
          ...recoveryBody(),
          action,
        });
        expect(nextCalled, action).to.equal(false);
        expect(res.statusCode, action).to.equal(401);
      }
    });

    it('refuses an unsigned recoveryrequest with a malformed or extended payload', async function () {
      for (const bad of [
        { pkEph: 'zz' },
        { nonce: 'short' },
        { timestamp: Date.now() - 60 * 60 * 1000 },
        { recoveryIndex: -1 },
        { extra: 'smuggled text shown on the phone' },
      ]) {
        const { res, nextCalled } = await run(actionAuth, recoveryBody(bad));
        expect(nextCalled, JSON.stringify(bad)).to.equal(false);
        expect(res.statusCode).to.equal(401);
      }
    });
  });

  describe('identical resend handling', function () {
    it('acknowledges a byte-identical resend instead of failing it as a replay', async function () {
      // Mobile transport layers may deliver a POST whose response is lost and
      // then resend the exact same signed body; the second copy must get a
      // success, not a nonce-replay 401, while the handler runs only once.
      const body = signedRequestBody({ action: 'txid', payload: 'deadbeef' });

      const first = await run(requireWkIdentityAuth, body);
      expect(first.nextCalled).to.equal(true);
      expect(first.req.isAuthenticated).to.equal(true);

      const resend = await run(requireWkIdentityAuth, body);
      expect(resend.nextCalled).to.equal(false);
      expect(resend.res.statusCode).to.equal(200);
      const parsed = JSON.parse(resend.res._getData());
      expect(parsed.status).to.equal('success');
      expect(parsed.data.duplicate).to.equal(true);
    });

    it('refuses a signed request without body-hash binding (before spending its nonce)', async function () {
      // Every signing client binds the body; an unbound signature could be
      // replayed over any body, so it is refused outright.
      const body = signedRequestBody(
        { action: 'txid', payload: 'deadbeef' },
        { withBodyHash: false },
      );
      const first = await run(requireWkIdentityAuth, body);
      expect(first.nextCalled).to.equal(false);
      expect(first.res.statusCode).to.equal(401);
      expect(code(first.res)).to.equal('AUTH_BODY_HASH_REQUIRED');
    });

    it('refuses a resend whose body was tampered with', async function () {
      const body = signedRequestBody({ action: 'txid', payload: 'deadbeef' });

      const first = await run(requireWkIdentityAuth, body);
      expect(first.nextCalled).to.equal(true);

      const tampered = await run(requireWkIdentityAuth, {
        ...body,
        payload: 'attacker-payload',
      });
      expect(tampered.nextCalled).to.equal(false);
      expect(tampered.res.statusCode).to.equal(401);
      expect(code(tampered.res)).to.equal('AUTH_BODY_HASH_MISMATCH');
    });
  });

  describe('requireReadAuth (RA-4 header-signed GET reads)', function () {
    const wkIdentity = () => deriveP2WSHAddress(testWitnessScript(), 'mainnet');
    const actionRead = requireReadAuth('id');

    it('accepts valid read auth and sets verifiedIdentity (multisig)', async function () {
      const wk = wkIdentity();
      const url = `/v1/action/${wk}`;
      const { req, nextCalled } = await runGet(actionRead, {
        url,
        params: { id: wk },
        headers: readAuthHeaders(url, wk),
      });
      expect(nextCalled).to.equal(true);
      expect(req.isAuthenticated).to.equal(true);
      expect(req.verifiedIdentity).to.equal(wk);
    });

    it('accepts valid read auth for a single-sig walletIdentity (GET /v1/sync)', async function () {
      const walletIdentity = deriveP2PKHAddress(TEST_PUBLIC_KEY, 'mainnet');
      const url = `/v1/sync/${walletIdentity}`;
      const { req, nextCalled } = await runGet(actionRead, {
        url,
        params: { id: walletIdentity },
        headers: readAuthHeaders(url, walletIdentity, { witness: false }),
      });
      expect(nextCalled).to.equal(true);
      expect(req.verifiedIdentity).to.equal(walletIdentity);
    });

    it('binds the query string out of the hash but the path in', async function () {
      const wk = wkIdentity();
      const path = `/v1/action/${wk}`;
      const { nextCalled } = await runGet(actionRead, {
        url: `${path}?cachebust=1`,
        params: { id: wk },
        headers: readAuthHeaders(path, wk),
      });
      expect(nextCalled).to.equal(true);
    });

    it('rejects a wrong path hash (signature made for another resource)', async function () {
      const wk = wkIdentity();
      const url = `/v1/action/${wk}`;
      const { res, nextCalled } = await runGet(actionRead, {
        url,
        params: { id: wk },
        headers: readAuthHeaders(url, wk, {
          dataPath: `/v1/nonces/status/${wk}`,
        }),
      });
      expect(nextCalled).to.equal(false);
      expect(res.statusCode).to.equal(401);
      expect(code(res)).to.equal('AUTH_PATH_HASH_MISMATCH');
    });

    it('rejects a signature for a different identity', async function () {
      const wk = wkIdentity();
      const victim = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
      const url = `/v1/action/${victim}`;
      // signed for the attacker's own wk, path of the victim
      const { res, nextCalled } = await runGet(actionRead, {
        url,
        params: { id: victim },
        headers: readAuthHeaders(url, wk),
      });
      expect(nextCalled).to.equal(false);
      expect(res.statusCode).to.equal(401);
      // and claiming the victim identity with the attacker's script fails too
      const forged = await runGet(actionRead, {
        url,
        params: { id: victim },
        headers: readAuthHeaders(url, victim),
      });
      expect(forged.nextCalled).to.equal(false);
      expect(forged.res.statusCode).to.equal(401);
    });

    it('rejects a replayed nonce', async function () {
      const wk = wkIdentity();
      const url = `/v1/action/${wk}`;
      const headers = readAuthHeaders(url, wk);
      const first = await runGet(actionRead, {
        url,
        params: { id: wk },
        headers,
      });
      expect(first.nextCalled).to.equal(true);
      const replay = await runGet(actionRead, {
        url,
        params: { id: wk },
        headers,
      });
      expect(replay.nextCalled).to.equal(false);
      expect(replay.res.statusCode).to.equal(401);
    });

    it("rejects a non-'read' action in the signed payload", async function () {
      const wk = wkIdentity();
      const url = `/v1/action/${wk}`;
      const { res, nextCalled } = await runGet(actionRead, {
        url,
        params: { id: wk },
        headers: readAuthHeaders(url, wk, { overrides: { action: 'action' } }),
      });
      expect(nextCalled).to.equal(false);
      expect(res.statusCode).to.equal(401);
    });

    it('rejects partial headers in both modes', async function () {
      const wk = wkIdentity();
      const url = `/v1/action/${wk}`;
      for (const mode of ['log', 'enforce']) {
        await withEnv('RELAY_READ_AUTH_MODE', mode, async function () {
          const headers = readAuthHeaders(url, wk);
          delete headers['x-ssp-signature'];
          const { res, nextCalled } = await runGet(actionRead, {
            url,
            params: { id: wk },
            headers,
          });
          expect(nextCalled, mode).to.equal(false);
          expect(res.statusCode, mode).to.equal(401);
          expect(code(res)).to.equal('AUTH_INCOMPLETE');
        }).call(this);
      }
    });

    it('rejects a missing witness script for a multisig identity', async function () {
      const wk = wkIdentity();
      const url = `/v1/action/${wk}`;
      const { res, nextCalled } = await runGet(actionRead, {
        url,
        params: { id: wk },
        headers: readAuthHeaders(url, wk, { witness: false }),
      });
      expect(nextCalled).to.equal(false);
      expect(res.statusCode).to.equal(401);
    });

    it(
      "serves unsigned reads in 'log' mode (default) without an identity",
      withEnv('RELAY_READ_AUTH_MODE', undefined, async function () {
        const wk = wkIdentity();
        const { req, nextCalled } = await runGet(actionRead, {
          url: `/v1/action/${wk}`,
          params: { id: wk },
        });
        expect(nextCalled).to.equal(true);
        expect(req.isAuthenticated).to.equal(false);
        expect(req.legacyUnauthenticated).to.equal(true);
        expect(req.verifiedIdentity).to.equal(undefined);
      }),
    );

    it(
      "refuses unsigned reads in 'enforce' mode",
      withEnv('RELAY_READ_AUTH_MODE', 'enforce', async function () {
        const wk = wkIdentity();
        const { res, nextCalled } = await runGet(actionRead, {
          url: `/v1/action/${wk}`,
          params: { id: wk },
        });
        expect(nextCalled).to.equal(false);
        expect(res.statusCode).to.equal(401);
        expect(code(res)).to.equal('AUTH_REQUIRED');
      }),
    );

    it(
      "rejects bad read auth in 'log' mode too",
      withEnv('RELAY_READ_AUTH_MODE', 'log', async function () {
        const wk = wkIdentity();
        const url = `/v1/action/${wk}`;
        const headers = readAuthHeaders(url, wk);
        headers['x-ssp-signature'] = signMessage('something else');
        const { res, nextCalled } = await runGet(actionRead, {
          url,
          params: { id: wk },
          headers,
        });
        expect(nextCalled).to.equal(false);
        expect(res.statusCode).to.equal(401);
      }),
    );

    it('uses the named route param (GET /v1/nonces/status/:wkIdentity)', async function () {
      const wk = wkIdentity();
      const url = `/v1/nonces/status/${wk}`;
      const { req, nextCalled } = await runGet(requireReadAuth('wkIdentity'), {
        url,
        params: { wkIdentity: wk },
        headers: readAuthHeaders(url, wk),
      });
      expect(nextCalled).to.equal(true);
      expect(req.verifiedIdentity).to.equal(wk);
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
