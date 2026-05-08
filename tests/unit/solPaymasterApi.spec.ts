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
});
