// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect, assert } from 'chai';
import syncService from '../../src/services/syncService';
import serviceHelper from '../../src/services/serviceHelper';
import syncApi from '../../src/apiServices/syncApi';
import sinon from 'sinon';
import httpMocks from 'node-mocks-http';


const reqValid = {
  params: {
    id: 'bc1walletidentity141',
  },
  query: {
    id: 'bc1walletidentity141',
  },
};

describe('Sync API', function () {
  describe('Get Sync API: Correctly verifies action', function () {
    afterEach(function () {
      sinon.restore();
    });

    // Testing using stub data
    it('should return successful result bc1walletidentity141 if stub value is valid', async function () {
      const request = httpMocks.createRequest({
        method: 'GET',
        url: 'test',
        body: reqValid,
        query: { id: 'bc1walletidentity141' },
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      await sinon
        .stub(syncService, 'getSync')
        .returns({ wkIdentity: 'bc1walletidentity141' });
      await syncApi.getSync(request, res);
      expect(JSON.parse(res._getData())).to.have.property('wkIdentity');
      expect(JSON.parse(res._getData())).to.deep.equal({
        wkIdentity: 'bc1walletidentity141',
      });
    });

    it('should return Invalid ID result bc1walletidentity141 if stub value is false', async function () {
      const request = httpMocks.createRequest({
        method: 'GET',
        url: 'test',
        body: reqValid,
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      await sinon.stub(syncService, 'getSync').returns(false);
      await syncApi.getSync(request, res);
      expect(res._getData()).to.deep.equal('Invalid ID');
    });

    it('should return Invalid ID result bc1walletidentity141 if stub value is undefined', async function () {
      const request = httpMocks.createRequest({
        method: 'GET',
        url: 'test',
        body: reqValid,
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      await sinon.stub(syncService, 'getSync').returns(undefined);
      await syncApi.getSync(request, res);
      expect(res._getData()).to.deep.equal('Invalid ID');
    });

    it('should return Invalid ID result bc1walletidentity141 if stub value is null', async function () {
      const request = httpMocks.createRequest({
        method: 'GET',
        url: 'test',
        body: reqValid,
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      await sinon.stub(syncService, 'getSync').returns(null);
      await syncApi.getSync(request, res);
      expect(res._getData()).to.deep.equal('Invalid ID');
    });
  });

  describe('Post Sync API: Correctly verifies action', function () {
    afterEach(function () {
      sinon.restore();
    });

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
        .stub(syncApi, 'postSync')
        .returns('Error: No Chain specified');
      const data = await syncApi.postSync(request, res);
      assert.equal(data, 'Error: No Chain specified');
    });

    it('should return error result if stub value has no wallet identity', async function () {
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
        .stub(syncApi, 'postSync')
        .returns('Error: No Wallet identity specified');
      const data = await syncApi.postSync(request, res);
      assert.equal(data, 'Error: No Wallet identity specified');
    });

    it('should return error result if stub value has no xpub', async function () {
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
        .returns({ chain: 1, walletIdentity: 1 });
      await sinon
        .stub(syncApi, 'postSync')
        .returns('Error: No XPUB of Key specified');
      const data = await syncApi.postSync(request, res);
      assert.equal(data, 'Error: No XPUB of Key specified');
    });

    it('should return error result if stub value has ssp identity', async function () {
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
        .returns({ chain: 1, walletIdentity: 1, keyXpub: 1 });
      await sinon
        .stub(syncApi, 'postSync')
        .returns('Error: No SSP Identity specified');
      const data = await syncApi.postSync(request, res);
      assert.equal(data, 'Error: No SSP Identity specified');
    });

    it('should return error result if stub value sync not ok', async function () {
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
        .returns({ chain: 1, walletIdentity: 1, keyXpub: 1, wkIdentity: 1 });
      await sinon
        .stub(syncApi, 'postSync')
        .returns('Failed to update synchronisation data');
      await sinon.stub(syncService, 'postSync').returns(false);
      const data = await syncApi.postSync(request, res);
      assert.equal(data, 'Failed to update synchronisation data');
    });

    it('should return successful result if stub value is valid', async function () {
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
        .returns({ chain: 1, walletIdentity: 1, keyXpub: 1, wkIdentity: 1 });
      await sinon
        .stub(syncApi, 'postSync')
        .returns({ chain: 1, walletIdentity: 1, keyXpub: 1, wkIdentity: 1 });
      await sinon.stub(syncService, 'postSync').returns(true);
      const data = await syncApi.postSync(request, res);
      assert.deepEqual(data, {
        chain: 1,
        walletIdentity: 1,
        keyXpub: 1,
        wkIdentity: 1,
      });
    });
  });

  describe('Post Token API: Correctly verifies action', function () {
    afterEach(function () {
      sinon.restore();
    });

    it('should return error result if stub value has no ssp identity', async function () {
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
        .stub(syncApi, 'postSync')
        .returns('Error: No SSP identity specified');
      const data = await syncApi.postSync(request, res);
      assert.equal(data, 'Error: No SSP identity specified');
    });

    it('should return error result if stub value has no token', async function () {
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
        .returns({ wkIdentity: 1 });
      await sinon
        .stub(syncApi, 'postSync')
        .returns('Error: No SSP Key Token specified');
      const data = await syncApi.postSync(request, res);
      assert.equal(data, 'Error: No SSP Key Token specified');
    });

    it('should return error result if stub value sync not ok', async function () {
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
        .returns({ wkIdentity: 1, keyToken: 1 });
      await sinon
        .stub(syncApi, 'postSync')
        .returns('Failed to update synced data');
      await sinon.stub(syncService, 'postToken').returns(false);
      const data = await syncApi.postSync(request, res);
      assert.equal(data, 'Failed to update synced data');
    });

    it('should return successful result if stub value is valid', async function () {
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
        .returns({ wkIdentity: 1, keyToken: 1 });
      await sinon
        .stub(syncApi, 'postSync')
        .returns({ wkIdentity: 1, keyToken: 1 });
      await sinon.stub(syncService, 'postSync').returns(true);
      const data = await syncApi.postSync(request, res);
      assert.deepEqual(data, { wkIdentity: 1, keyToken: 1 });
    });
  });
});
