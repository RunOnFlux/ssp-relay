// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import chai from 'chai';
import actionService from '../../src/services/actionService';
import serviceHelper from '../../src/services/serviceHelper';
import actionApi from '../../src/apiServices/actionApi';
import sinon from 'sinon';
import httpMocks from 'node-mocks-http';

const { expect, assert } = chai;

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

    it('should return Bad Request result c1walletidentityif stub value is invalid', async function () {
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
      expect(res._getData()).to.deep.equal('Bad Request');
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
});
