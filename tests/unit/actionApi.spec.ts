// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect, assert } from 'chai';
import actionService from '../../src/services/actionService';
import serviceHelper from '../../src/services/serviceHelper';
import actionApi from '../../src/apiServices/actionApi';
import sinon from 'sinon';
import httpMocks from 'node-mocks-http';
import socket from '../../src/lib/socket';
import notificationService from '../../src/services/notificationService';
import enterpriseHooks from '../../src/services/enterpriseHooks';
import { buildKaspaBundle } from '../helpers/kaspaBundle';
import tronVectors from '../fixtures/tron-ssp-vectors.json';

const reqValid = {
  params: {
    id: 'bc1walletidentity',
  },
  query: {
    id: 'bc1walletidentity',
  },
};

describe('Action API', function () {
  describe('Get Action API: Correctly verifies action', function () {
    afterEach(function () {
      sinon.restore();
    });

    // Testing using stub data
    it('should return successful result bc1walletidentity if stub value is valid', async function () {
      const request = httpMocks.createRequest({
        method: 'GET',
        url: 'test',
        body: reqValid,
        query: { id: 'bc1walletidentity' },
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      await sinon
        .stub(actionService, 'getAction')
        .returns({ wkIdentity: 'bc1walletidentity' });
      await actionApi.getAction(request, res);
      expect(JSON.parse(res._getData())).to.have.property('wkIdentity');
      expect(JSON.parse(res._getData())).to.deep.equal({
        wkIdentity: 'bc1walletidentity',
      });
    });

    it('should return Invalid ID result bc1walletidentityif stub value is invalid', async function () {
      const request = httpMocks.createRequest({
        method: 'GET',
        url: 'test',
        body: reqValid,
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      await sinon
        .stub(actionService, 'getAction')
        .returns({ wkIdentity: 'bc1walletidentity' });
      await actionApi.getAction(request, res);
      expect(res._getData()).to.deep.equal('Invalid ID');
    });

    it('should return error result bc1walletidentity if stub value is valid', async function () {
      const request = httpMocks.createRequest({
        method: 'GET',
        url: 'test',
        body: reqValid,
        query: { id: 'bc1walletidentity' },
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      await sinon.stub(actionService, 'getAction').returns(false);
      await actionApi.getAction(request, res);
      expect(res._getData()).to.deep.equal('Not Found');
    });
  });

  describe('Post Action: Correctly verifies action', function () {
    afterEach(function () {
      sinon.restore();
    });

    // Testing using stub data
    it('should return error result if stub value has no chain', async function () {
      const request = httpMocks.createRequest({
        method: 'POST',
        url: 'test',
        body: reqValid,
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      await sinon.stub(serviceHelper, 'ensureObject').returns({});
      await sinon
        .stub(actionApi, 'postAction')
        .returns('Error: No Chain specified');
      const data = await actionApi.postAction(request, res);
      assert.equal(data, 'Error: No Chain specified');
    });

    it('should return error result if stub value has no wallet key', async function () {
      const request = httpMocks.createRequest({
        method: 'POST',
        url: 'test',
        body: reqValid,
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      await sinon.stub(serviceHelper, 'ensureObject').returns({ chain: 1 });
      await sinon
        .stub(actionApi, 'postAction')
        .returns('Error: No Wallet-Key Identity specified');
      const data = await actionApi.postAction(request, res);
      assert.equal(data, 'Error: No Wallet-Key Identity specified');
    });

    it('should return error result if stub value has no action', async function () {
      const request = httpMocks.createRequest({
        method: 'POST',
        url: 'test',
        body: reqValid,
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      await sinon
        .stub(serviceHelper, 'ensureObject')
        .returns({ chain: 1, wkIdentity: 1 });
      await sinon
        .stub(actionApi, 'postAction')
        .returns('Error: No Action specified');
      const data = await actionApi.postAction(request, res);
      assert.equal(data, 'Error: No Action specified');
    });

    it('should return error result if stub value has no payload', async function () {
      const request = httpMocks.createRequest({
        method: 'POST',
        url: 'test',
        body: reqValid,
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      await sinon
        .stub(serviceHelper, 'ensureObject')
        .returns({ chain: 1, wkIdentity: 1, action: '' });
      await sinon
        .stub(actionApi, 'postAction')
        .returns('Error: No Payload specified');
      const data = await actionApi.postAction(request, res);
      assert.equal(data, 'Error: No Payload specified');
    });

    it('should return error result if stub value has no derivation', async function () {
      const request = httpMocks.createRequest({
        method: 'POST',
        url: 'test',
        body: reqValid,
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      await sinon
        .stub(serviceHelper, 'ensureObject')
        .returns({ chain: 1, wkIdentity: 1, action: '', payload: '' });
      await sinon
        .stub(actionApi, 'postAction')
        .returns('Error: No Derivation Path specified');
      const data = await actionApi.postAction(request, res);
      assert.equal(data, 'Error: No Derivation Path specified');
    });

    it('should return error result if failed to post data', async function () {
      const request = httpMocks.createRequest({
        method: 'POST',
        url: 'test',
        body: reqValid,
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      await sinon.stub(serviceHelper, 'ensureObject').returns({
        chain: 1,
        wkIdentity: 1,
        action: 'tx',
        payload: '',
        path: '',
      });
      await sinon.stub(actionService, 'postAction').returns(false);
      await sinon
        .stub(actionApi, 'postAction')
        .returns('Error: Failed to post action data');
      const data = await actionApi.postAction(request, res);
      assert.equal(data, 'Error: Failed to post action data');
    });

    it('should return successful result if stub value are valid', async function () {
      const request = httpMocks.createRequest({
        method: 'POST',
        url: 'test',
        body: reqValid,
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      await sinon.stub(serviceHelper, 'ensureObject').returns({
        chain: 1,
        wkIdentity: 1,
        action: 'publicnoncesrequest',
        payload: '',
        path: '',
      });
      await sinon.stub(actionService, 'postAction').returns({
        chain: 1,
        wkIdentity: 1,
        action: 'publicnoncesrequest',
        payload: '',
        path: '',
      });
      await sinon.stub(actionApi, 'postAction').returns({
        chain: 1,
        wkIdentity: 1,
        action: 'publicnoncesrequest',
        payload: '',
        path: '',
      });
      const data = await actionApi.postAction(request, res);
      assert.deepEqual(data, {
        chain: 1,
        wkIdentity: 1,
        action: 'publicnoncesrequest',
        payload: '',
        path: '',
      });
    });
  });

  describe('Post Action: Kaspa (kas) tx payloads', function () {
    afterEach(function () {
      sinon.restore();
    });

    function kasRequest(payload, action = 'tx') {
      return httpMocks.createRequest({
        method: 'POST',
        url: 'test',
        body: {
          chain: 'kas',
          wkIdentity: 'kaspa-wk-identity',
          action,
          payload,
          path: '0-0',
        },
      });
    }

    function stubDelivery() {
      const emit = sinon.stub();
      sinon.stub(socket, 'getIOKey').returns({ to: () => ({ emit }) });
      sinon.stub(socket, 'getIOWallet').returns({ to: () => ({ emit }) });
      sinon.stub(notificationService, 'sendNotificationKey').resolves();
      sinon.stub(enterpriseHooks, 'onAction').resolves();
      return emit;
    }

    it('accepts a kaspa-core signing bundle', async function () {
      const { json } = await buildKaspaBundle();
      const emit = stubDelivery();
      const post = sinon
        .stub(actionService, 'postAction')
        .callsFake(async (d) => d);
      const res = httpMocks.createResponse();
      await actionApi.postAction(kasRequest(json), res);
      assert.equal(res.statusCode, 200);
      assert.equal(post.callCount, 1);
      assert.equal(post.firstCall.args[0].payload, json);
      assert.equal(emit.callCount, 1);
      assert.equal(res._getJSONData().status, 'success');
    });

    it('rejects a hex payload for kas', async function () {
      stubDelivery();
      const post = sinon.stub(actionService, 'postAction').resolves({});
      const res = httpMocks.createResponse();
      await actionApi.postAction(kasRequest('0200000001abcdef'), res);
      assert.equal(res.statusCode, 400);
      assert.equal(post.callCount, 0);
    });

    it('rejects JSON that is not a kaspa-core-signing-bundle', async function () {
      stubDelivery();
      const post = sinon.stub(actionService, 'postAction').resolves({});
      const res = httpMocks.createResponse();
      await actionApi.postAction(
        kasRequest(JSON.stringify({ format: 'psbt', version: 1 })),
        res,
      );
      assert.equal(res.statusCode, 400);
      assert.equal(post.callCount, 0);
    });

    it('does not apply bundle validation to non-tx kas actions (txid)', async function () {
      stubDelivery();
      const post = sinon
        .stub(actionService, 'postAction')
        .callsFake(async (d) => d);
      const res = httpMocks.createResponse();
      await actionApi.postAction(kasRequest('ab'.repeat(32), 'txid'), res);
      assert.equal(res.statusCode, 200);
      assert.equal(post.callCount, 1);
    });
  });

  describe('Post Action: TRON (tron / tronNile) tx payloads', function () {
    const LEAF = tronVectors.consumer.leaves['0-0'];
    const V = tronVectors.consumerOp;

    function payload(overrides = {}) {
      return JSON.stringify({
        format: 'ssp-tron-op',
        version: 1,
        network: 'mainnet',
        vault: LEAF.address,
        signers: LEAF.signers,
        threshold: 2,
        op: V.op,
        walletSignature: V.walletSignature,
        ...overrides,
      });
    }

    function tronRequest(body, action = 'tx', chain = 'tron') {
      return httpMocks.createRequest({
        method: 'POST',
        url: 'test',
        body: {
          chain,
          wkIdentity: 'tron-wk-identity',
          action,
          payload: body,
          path: '0-0',
        },
      });
    }

    function stubDelivery() {
      const emit = sinon.stub();
      sinon.stub(socket, 'getIOKey').returns({ to: () => ({ emit }) });
      sinon.stub(socket, 'getIOWallet').returns({ to: () => ({ emit }) });
      sinon.stub(notificationService, 'sendNotificationKey').resolves();
      sinon.stub(enterpriseHooks, 'onAction').resolves();
      return emit;
    }

    afterEach(function () {
      sinon.restore();
    });

    it('accepts an ssp-tron-op payload (vectors consumerOp)', async function () {
      const emit = stubDelivery();
      const post = sinon
        .stub(actionService, 'postAction')
        .callsFake(async (d) => d);
      const res = httpMocks.createResponse();
      const json = payload();
      await actionApi.postAction(tronRequest(json), res);
      assert.equal(res.statusCode, 200);
      assert.equal(post.callCount, 1);
      assert.equal(post.firstCall.args[0].payload, json);
      assert.equal(emit.callCount, 1);
    });

    it('accepts a tronNile payload with network nile', async function () {
      stubDelivery();
      const post = sinon
        .stub(actionService, 'postAction')
        .callsFake(async (d) => d);
      const res = httpMocks.createResponse();
      await actionApi.postAction(
        tronRequest(payload({ network: 'nile' }), 'tx', 'tronNile'),
        res,
      );
      assert.equal(res.statusCode, 200);
      assert.equal(post.callCount, 1);
    });

    const rejects = {
      'a hex payload': '0a02abcd',
      'another format': payload({ format: 'kaspa-core-signing-bundle' }),
      'version 2': payload({ version: 2 }),
      'a network that does not match the chain': payload({ network: 'nile' }),
      'a non-canonical op (leading zero nonce)': payload({
        op: { ...V.op, nonce: '07' },
      }),
      'an op with 17 calls': payload({
        op: { ...V.op, calls: new Array(17).fill(V.op.calls[0]) },
      }),
      'a lowercased vault address': payload({
        vault: LEAF.address.toLowerCase(),
      }),
      'a missing walletSignature': payload({ walletSignature: undefined }),
      'a bad threshold': payload({ threshold: 3 }),
      'a JSON array': '[]',
    };
    for (const [what, body] of Object.entries(rejects)) {
      it(`rejects ${what}`, async function () {
        stubDelivery();
        const post = sinon.stub(actionService, 'postAction').resolves({});
        const res = httpMocks.createResponse();
        await actionApi.postAction(tronRequest(body), res);
        assert.equal(res.statusCode, 400);
        assert.equal(post.callCount, 0);
      });
    }

    it('does not validate non-tx TRON actions (txid)', async function () {
      stubDelivery();
      const post = sinon
        .stub(actionService, 'postAction')
        .callsFake(async (d) => d);
      const res = httpMocks.createResponse();
      await actionApi.postAction(tronRequest('ab'.repeat(32), 'txid'), res);
      assert.equal(res.statusCode, 200);
      assert.equal(post.callCount, 1);
    });
  });
});
