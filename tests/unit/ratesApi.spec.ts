/* eslint-disable @typescript-eslint/no-unused-expressions */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect, assert } from 'chai';
import ratesService from '../../src/services/ratesService';
import ratesApi from '../../src/apiServices/ratesApi';
import sinon from 'sinon';
import httpMocks from 'node-mocks-http';

describe('Rates API', function () {
  describe('Get Rates API: Correctly verifies rates', function () {
    afterEach(function () {
      sinon.restore();
    });

    // Testing using stub data
    it('should return successful result if stub value is valid', async function () {
      const request = httpMocks.createRequest({
        method: 'GET',
        url: 'test',
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      await sinon
        .stub(ratesService, 'getRates')
        .returns({ fiat: { BTC: 1, ETH: 1 }, crypto: { btc: 1, flux: 1 } });
      await ratesApi.getRates(request, res);
      expect(JSON.parse(res._getData())).to.have.property('fiat');
      expect(JSON.parse(res._getData()).fiat).to.have.property('BTC');
      expect(JSON.parse(res._getData()).fiat).to.have.property('ETH');
      expect(JSON.parse(res._getData()).fiat).to.not.be.null;
      expect(JSON.parse(res._getData()).fiat).to.not.be.undefined;
      expect(JSON.parse(res._getData()).fiat.BTC).to.not.be.null;
      expect(JSON.parse(res._getData()).fiat.BTC).to.not.be.undefined;
      expect(JSON.parse(res._getData()).fiat.ETH).to.not.be.null;
      expect(JSON.parse(res._getData()).fiat.ETH).to.not.be.undefined;
      expect(JSON.parse(res._getData())).to.have.property('crypto');
      expect(JSON.parse(res._getData()).crypto).to.have.property('btc');
      expect(JSON.parse(res._getData()).crypto).to.have.property('flux');
      expect(JSON.parse(res._getData()).crypto).to.not.be.null;
      expect(JSON.parse(res._getData()).crypto).to.not.be.undefined;
      expect(JSON.parse(res._getData()).crypto.btc).to.not.be.null;
      expect(JSON.parse(res._getData()).crypto.btc).to.not.be.undefined;
      expect(JSON.parse(res._getData()).crypto.flux).to.not.be.null;
      expect(JSON.parse(res._getData()).crypto.flux).to.not.be.undefined;
      expect(JSON.parse(res._getData()).fiat).to.deep.equal({ BTC: 1, ETH: 1 });
      expect(JSON.parse(res._getData()).crypto).to.deep.equal({
        btc: 1,
        flux: 1,
      });
    });

    it('should return Not Found if stub value is undefined', async function () {
      const request = httpMocks.createRequest({
        method: 'GET',
        url: 'test',
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      await sinon.stub(ratesService, 'getRates').returns(undefined);
      await ratesApi.getRates(request, res);
      assert.deepEqual(res._getData(), 'Not Found');
    });

    it('should return Not Found if stub value is false', async function () {
      const request = httpMocks.createRequest({
        method: 'GET',
        url: 'test',
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      await sinon.stub(ratesService, 'getRates').returns(false);
      await ratesApi.getRates(request, res);
      assert.deepEqual(res._getData(), 'Not Found');
    });

    it('should return Not Found if stub value is null', async function () {
      const request = httpMocks.createRequest({
        method: 'GET',
        url: 'test',
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      await sinon.stub(ratesService, 'getRates').returns(null);
      await ratesApi.getRates(request, res);
      assert.deepEqual(res._getData(), 'Not Found');
    });
  });
});
