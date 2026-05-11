// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect } from 'chai';
import sinon from 'sinon';
import httpMocks from 'node-mocks-http';
import solPaymasterApi from '../../src/apiServices/solPaymasterApi';
import solPaymasterService from '../../src/services/solPaymasterService';

describe('Solana Paymaster API', function () {
  describe('GET /v1/sol/paymaster — getPaymaster', function () {
    afterEach(function () {
      sinon.restore();
    });

    it('returns the paymaster pubkey for a valid chain', async function () {
      sinon
        .stub(solPaymasterService, 'getPaymasterPubkey')
        .returns('FakePubkey123456789');
      const req = httpMocks.createRequest({
        method: 'GET',
        url: '/v1/sol/paymaster',
        query: { chain: 'solDevnet' },
      });
      const res = httpMocks.createResponse();
      await solPaymasterApi.getPaymaster(req, res);
      const body = JSON.parse(res._getData());
      expect(body.status).to.equal('success');
      expect(body.data.chain).to.equal('solDevnet');
      expect(body.data.pubkey).to.equal('FakePubkey123456789');
    });

    it('rejects an unknown chain id', async function () {
      const req = httpMocks.createRequest({
        method: 'GET',
        query: { chain: 'btc' }, // not a Solana chain
      });
      const res = httpMocks.createResponse();
      await solPaymasterApi.getPaymaster(req, res);
      const body = JSON.parse(res._getData());
      expect(body.status).to.equal('error');
      expect(body.data.message).to.match(/Invalid or unsupported chain/);
    });

    it('rejects a missing chain query param', async function () {
      const req = httpMocks.createRequest({
        method: 'GET',
        query: {},
      });
      const res = httpMocks.createResponse();
      await solPaymasterApi.getPaymaster(req, res);
      const body = JSON.parse(res._getData());
      expect(body.status).to.equal('error');
      expect(body.data.message).to.match(/Invalid or unsupported chain/);
    });

    it('rejects a chain id with disallowed characters', async function () {
      const req = httpMocks.createRequest({
        method: 'GET',
        query: { chain: 'sol;DROP TABLE users' },
      });
      const res = httpMocks.createResponse();
      await solPaymasterApi.getPaymaster(req, res);
      const body = JSON.parse(res._getData());
      expect(body.status).to.equal('error');
      expect(body.data.message).to.match(/Invalid or unsupported chain/);
    });

    it('rejects an over-long chain id', async function () {
      const req = httpMocks.createRequest({
        method: 'GET',
        query: { chain: 'a'.repeat(60) },
      });
      const res = httpMocks.createResponse();
      await solPaymasterApi.getPaymaster(req, res);
      const body = JSON.parse(res._getData());
      expect(body.status).to.equal('error');
      expect(body.data.message).to.match(/Invalid or unsupported chain/);
    });

    it('accepts solMainnet as a valid chain id', async function () {
      sinon
        .stub(solPaymasterService, 'getPaymasterPubkey')
        .returns('MainnetPubkey');
      const req = httpMocks.createRequest({
        method: 'GET',
        query: { chain: 'solMainnet' },
      });
      const res = httpMocks.createResponse();
      await solPaymasterApi.getPaymaster(req, res);
      const body = JSON.parse(res._getData());
      expect(body.status).to.equal('success');
      expect(body.data.chain).to.equal('solMainnet');
    });

    it('returns an error response when service throws (e.g. not configured)', async function () {
      sinon
        .stub(solPaymasterService, 'getPaymasterPubkey')
        .throws(new Error('Solana paymaster not configured for solDevnet'));
      const req = httpMocks.createRequest({
        method: 'GET',
        query: { chain: 'solDevnet' },
      });
      const res = httpMocks.createResponse();
      await solPaymasterApi.getPaymaster(req, res);
      const body = JSON.parse(res._getData());
      expect(body.status).to.equal('error');
      expect(body.data.message).to.match(/not configured/);
    });
  });

  describe('POST /v1/sol/broadcast — postBroadcast', function () {
    afterEach(function () {
      sinon.restore();
    });

    function makeReq(body: unknown) {
      return httpMocks.createRequest({
        method: 'POST',
        url: '/v1/sol/broadcast',
        body,
      });
    }

    it('broadcasts a valid request and returns the signature', async function () {
      sinon
        .stub(solPaymasterService, 'broadcastWithPaymaster')
        .resolves('5broadcastSig');
      const req = makeReq({
        chain: 'solDevnet',
        serializedTxBase64: 'AQAB' + 'A'.repeat(20) + '=',
      });
      const res = httpMocks.createResponse();
      await solPaymasterApi.postBroadcast(req, res);
      const body = JSON.parse(res._getData());
      expect(body.status).to.equal('success');
      expect(body.data.signature).to.equal('5broadcastSig');
    });

    it('rejects an unknown chain id', async function () {
      const req = makeReq({
        chain: 'btc',
        serializedTxBase64: 'AQAB' + 'A'.repeat(20) + '=',
      });
      const res = httpMocks.createResponse();
      await solPaymasterApi.postBroadcast(req, res);
      const body = JSON.parse(res._getData());
      expect(body.status).to.equal('error');
      expect(body.data.message).to.match(/Invalid or unsupported chain/);
    });

    it('rejects an empty serializedTxBase64', async function () {
      const req = makeReq({ chain: 'solDevnet', serializedTxBase64: '' });
      const res = httpMocks.createResponse();
      await solPaymasterApi.postBroadcast(req, res);
      const body = JSON.parse(res._getData());
      expect(body.status).to.equal('error');
      expect(body.data.message).to.match(/Invalid serialized transaction/);
    });

    it('rejects a non-string serializedTxBase64', async function () {
      const req = makeReq({ chain: 'solDevnet', serializedTxBase64: 123 });
      const res = httpMocks.createResponse();
      await solPaymasterApi.postBroadcast(req, res);
      const body = JSON.parse(res._getData());
      expect(body.status).to.equal('error');
      expect(body.data.message).to.match(/Invalid serialized transaction/);
    });

    it('rejects an over-large serializedTxBase64 (> 16384 chars)', async function () {
      const req = makeReq({
        chain: 'solDevnet',
        serializedTxBase64: 'A'.repeat(16385),
      });
      const res = httpMocks.createResponse();
      await solPaymasterApi.postBroadcast(req, res);
      const body = JSON.parse(res._getData());
      expect(body.status).to.equal('error');
      expect(body.data.message).to.match(/Invalid serialized transaction/);
    });

    it('rejects serializedTxBase64 with non-base64 characters', async function () {
      const req = makeReq({
        chain: 'solDevnet',
        serializedTxBase64: 'AQAB!@#$%^&*()',
      });
      const res = httpMocks.createResponse();
      await solPaymasterApi.postBroadcast(req, res);
      const body = JSON.parse(res._getData());
      expect(body.status).to.equal('error');
      expect(body.data.message).to.match(/Invalid serialized transaction/);
    });

    it('strips top-level auth fields before processing the body', async function () {
      const broadcastStub = sinon
        .stub(solPaymasterService, 'broadcastWithPaymaster')
        .resolves('5sigOk');
      const req = makeReq({
        chain: 'solDevnet',
        serializedTxBase64: 'AQAB' + 'A'.repeat(20) + '=',
        // Auth fields that the middleware would normally strip — the API
        // calls stripAuthFields directly on its body.
        wkIdentity: 'bc1xyz',
        signature: 'abcdef',
        publicKey: '02deadbeef',
      });
      const res = httpMocks.createResponse();
      await solPaymasterApi.postBroadcast(req, res);
      const body = JSON.parse(res._getData());
      expect(body.status).to.equal('success');
      expect(broadcastStub.calledOnce).to.equal(true);
      // Service is invoked with chain + serializedTxBase64 only (auth fields stripped)
      const [chainArg, txArg] = broadcastStub.firstCall.args;
      expect(chainArg).to.equal('solDevnet');
      expect(typeof txArg).to.equal('string');
    });

    it('returns an error when the service rejects (e.g. feePayer mismatch)', async function () {
      sinon
        .stub(solPaymasterService, 'broadcastWithPaymaster')
        .rejects(new Error('Tx feePayer does not match paymaster'));
      const req = makeReq({
        chain: 'solDevnet',
        serializedTxBase64: 'AQAB' + 'A'.repeat(20) + '=',
      });
      const res = httpMocks.createResponse();
      await solPaymasterApi.postBroadcast(req, res);
      const body = JSON.parse(res._getData());
      expect(body.status).to.equal('error');
      expect(body.data.message).to.match(/feePayer/);
    });
  });

  describe('POST /v1/sol/setup — postSetup', function () {
    afterEach(function () {
      sinon.restore();
    });

    // Two known-valid base58 pubkeys for the wallet+key leaves. These are
    // ed25519 pubkeys (32 bytes → ~44 chars base58) — static fixtures only;
    // they don't sign anything. base58 alphabet is `[1-9A-HJ-NP-Za-km-z]`
    // (no 0/O/I/l).
    const FAKE_WALLET_PUB = 'D7v8Z2Yk1XQGv8sRf3jPmK9LtH4n2BcWdEhA6pNuS5xT';
    const FAKE_KEY_PUB = 'F3wQ8L2nM4kRpX5jY7uV6bH9cT8sA1dN2gECiB4mP3xK';

    function makeReq(body: unknown) {
      return httpMocks.createRequest({
        method: 'POST',
        url: '/v1/sol/setup',
        body,
      });
    }

    it('calls the service and returns the bundled setup result', async function () {
      const setupStub = sinon
        .stub(solPaymasterService, 'setupSolMultisig')
        .resolves({
          signature: '5setupSig',
          multisigAddress: 'Multisig111',
          vaultAddress: 'Vault111',
          nonceAccount: 'Nonce111',
          nonceValue: 'NonceHashDeadbeef',
          alreadyProvisioned: false,
        });
      const req = makeReq({
        chain: 'solDevnet',
        walletPubkey: FAKE_WALLET_PUB,
        keyPubkey: FAKE_KEY_PUB,
      });
      const res = httpMocks.createResponse();
      await solPaymasterApi.postSetup(req, res);
      const body = JSON.parse(res._getData());
      expect(body.status).to.equal('success');
      expect(body.data.signature).to.equal('5setupSig');
      expect(body.data.multisigAddress).to.equal('Multisig111');
      expect(body.data.nonceAccount).to.equal('Nonce111');
      expect(body.data.nonceValue).to.equal('NonceHashDeadbeef');
      expect(body.data.alreadyProvisioned).to.equal(false);
      expect(setupStub.calledOnce).to.equal(true);
      const [args] = setupStub.firstCall.args;
      expect(args.chain).to.equal('solDevnet');
      expect(args.walletPubkey).to.equal(FAKE_WALLET_PUB);
      expect(args.keyPubkey).to.equal(FAKE_KEY_PUB);
    });

    it('returns the existing state when service reports already provisioned', async function () {
      sinon.stub(solPaymasterService, 'setupSolMultisig').resolves({
        signature: null,
        multisigAddress: 'Multisig222',
        vaultAddress: 'Vault222',
        nonceAccount: 'Nonce222',
        nonceValue: 'CurrentNonceHash',
        alreadyProvisioned: true,
      });
      const req = makeReq({
        chain: 'solDevnet',
        walletPubkey: FAKE_WALLET_PUB,
        keyPubkey: FAKE_KEY_PUB,
      });
      const res = httpMocks.createResponse();
      await solPaymasterApi.postSetup(req, res);
      const body = JSON.parse(res._getData());
      expect(body.status).to.equal('success');
      expect(body.data.alreadyProvisioned).to.equal(true);
      expect(body.data.signature).to.equal(null);
    });

    it('surfaces service errors (e.g. vault balance gate rejection)', async function () {
      sinon
        .stub(solPaymasterService, 'setupSolMultisig')
        .rejects(
          new Error(
            'Vault Vault333 balance 100000 lamports is below the required minimum 3250000',
          ),
        );
      const req = makeReq({
        chain: 'solDevnet',
        walletPubkey: FAKE_WALLET_PUB,
        keyPubkey: FAKE_KEY_PUB,
      });
      const res = httpMocks.createResponse();
      await solPaymasterApi.postSetup(req, res);
      const body = JSON.parse(res._getData());
      expect(body.status).to.equal('error');
      expect(body.data.message).to.match(/below the required minimum/);
    });

    it('rejects an unsupported chain', async function () {
      const req = makeReq({
        chain: 'btc',
        walletPubkey: FAKE_WALLET_PUB,
        keyPubkey: FAKE_KEY_PUB,
      });
      const res = httpMocks.createResponse();
      await solPaymasterApi.postSetup(req, res);
      const body = JSON.parse(res._getData());
      expect(body.status).to.equal('error');
      expect(body.data.message).to.match(/Invalid or unsupported chain/);
    });

    it('rejects missing walletPubkey', async function () {
      const req = makeReq({
        chain: 'solDevnet',
        keyPubkey: FAKE_KEY_PUB,
      });
      const res = httpMocks.createResponse();
      await solPaymasterApi.postSetup(req, res);
      const body = JSON.parse(res._getData());
      expect(body.status).to.equal('error');
      expect(body.data.message).to.match(/Invalid walletPubkey/);
    });

    it('rejects missing keyPubkey', async function () {
      const req = makeReq({
        chain: 'solDevnet',
        walletPubkey: FAKE_WALLET_PUB,
      });
      const res = httpMocks.createResponse();
      await solPaymasterApi.postSetup(req, res);
      const body = JSON.parse(res._getData());
      expect(body.status).to.equal('error');
      expect(body.data.message).to.match(/Invalid keyPubkey/);
    });

    it('rejects malformed walletPubkey (non-base58)', async function () {
      const req = makeReq({
        chain: 'solDevnet',
        walletPubkey: 'not!a!base58!key',
        keyPubkey: FAKE_KEY_PUB,
      });
      const res = httpMocks.createResponse();
      await solPaymasterApi.postSetup(req, res);
      const body = JSON.parse(res._getData());
      expect(body.status).to.equal('error');
      expect(body.data.message).to.match(/Invalid walletPubkey/);
    });

    it('rejects equal walletPubkey and keyPubkey', async function () {
      const req = makeReq({
        chain: 'solDevnet',
        walletPubkey: FAKE_WALLET_PUB,
        keyPubkey: FAKE_WALLET_PUB,
      });
      const res = httpMocks.createResponse();
      await solPaymasterApi.postSetup(req, res);
      const body = JSON.parse(res._getData());
      expect(body.status).to.equal('error');
      expect(body.data.message).to.match(
        /walletPubkey and keyPubkey must differ/,
      );
    });

    it('strips auth fields before passing to the service', async function () {
      const setupStub = sinon
        .stub(solPaymasterService, 'setupSolMultisig')
        .resolves({
          signature: '5authStrippedSig',
          multisigAddress: 'M',
          vaultAddress: 'V',
          nonceAccount: 'N',
          nonceValue: 'H',
          alreadyProvisioned: false,
        });
      const req = makeReq({
        chain: 'solDevnet',
        walletPubkey: FAKE_WALLET_PUB,
        keyPubkey: FAKE_KEY_PUB,
        // auth fields that should NOT reach the service
        wkIdentity: 'bc1xyz',
        signature: 'abcdef',
        publicKey: '02deadbeef',
      });
      const res = httpMocks.createResponse();
      await solPaymasterApi.postSetup(req, res);
      const body = JSON.parse(res._getData());
      expect(body.status).to.equal('success');
      const [args] = setupStub.firstCall.args;
      // Service receives ONLY the validated business fields
      expect(Object.keys(args).sort()).to.deep.equal([
        'chain',
        'keyPubkey',
        'walletPubkey',
      ]);
    });
  });
});
