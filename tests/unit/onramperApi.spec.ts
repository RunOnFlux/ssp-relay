// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect } from 'chai';
import sinon from 'sinon';
import httpMocks from 'node-mocks-http';
import onramperApi from '../../src/apiServices/onramperApi';

describe('Onramper API', function () {
  describe('postDataToSign', function () {
    afterEach(function () {
      sinon.restore();
    });

    it('should return signature for valid string body (text/plain)', async function () {
      const payload = 'networkWallets=flux:t3TRUNKvgywghL1vU5bsGQqs9eVC17XcUnV';
      const request = httpMocks.createRequest({
        method: 'POST',
        url: '/v1/onramper/sign',
        body: payload,
      });
      const res = httpMocks.createResponse({
        eventEmitter: require('events').EventEmitter,
        req: request,
      });

      await onramperApi.postDataToSign(request, res);

      const data = JSON.parse(res._getData());
      expect(res.statusCode).to.equal(200);
      expect(data).to.have.property('signature');
      expect(data.signature).to.equal(
        '0c30da188858431a08be88a7042fca4ac03ec9197af0f0bd4b4e11725d794e18',
      );
    });

    it('should convert JSON object to query string and return correct signature', async function () {
      // JSON object { networkWallets: "flux:..." } should be converted to "networkWallets=flux:..."
      const payload = {
        networkWallets: 'flux:t3TRUNKvgywghL1vU5bsGQqs9eVC17XcUnV',
      };
      const request = httpMocks.createRequest({
        method: 'POST',
        url: '/v1/onramper/sign',
        body: payload,
      });
      const res = httpMocks.createResponse({
        eventEmitter: require('events').EventEmitter,
        req: request,
      });

      await onramperApi.postDataToSign(request, res);

      const data = JSON.parse(res._getData());
      expect(res.statusCode).to.equal(200);
      expect(data).to.have.property('signature');
      // Should produce same signature as the text/plain version
      expect(data.signature).to.equal(
        '0c30da188858431a08be88a7042fca4ac03ec9197af0f0bd4b4e11725d794e18',
      );
    });

    it('should return 400 error when body is empty', async function () {
      const request = httpMocks.createRequest({
        method: 'POST',
        url: '/v1/onramper/sign',
        body: '',
      });
      const res = httpMocks.createResponse({
        eventEmitter: require('events').EventEmitter,
        req: request,
      });

      await onramperApi.postDataToSign(request, res);

      const data = JSON.parse(res._getData());
      expect(res.statusCode).to.equal(400);
      expect(data).to.have.property('error');
    });

    it('should return 400 error when data is too short (< 30 chars)', async function () {
      const payload = 'short-data';
      const request = httpMocks.createRequest({
        method: 'POST',
        url: '/v1/onramper/sign',
        body: payload,
      });
      const res = httpMocks.createResponse({
        eventEmitter: require('events').EventEmitter,
        req: request,
      });

      await onramperApi.postDataToSign(request, res);

      const data = JSON.parse(res._getData());
      expect(res.statusCode).to.equal(400);
      expect(data).to.have.property('error');
      expect(data.error).to.equal('Data is too short');
    });

    it('should return 400 error when data is too long (> 5000 chars)', async function () {
      const payload = 'x'.repeat(5001);
      const request = httpMocks.createRequest({
        method: 'POST',
        url: '/v1/onramper/sign',
        body: payload,
      });
      const res = httpMocks.createResponse({
        eventEmitter: require('events').EventEmitter,
        req: request,
      });

      await onramperApi.postDataToSign(request, res);

      const data = JSON.parse(res._getData());
      expect(res.statusCode).to.equal(400);
      expect(data).to.have.property('error');
      expect(data.error).to.equal('Data is too long');
    });

    it('should accept data at exactly 30 characters', async function () {
      const payload = 'a'.repeat(30);
      const request = httpMocks.createRequest({
        method: 'POST',
        url: '/v1/onramper/sign',
        body: payload,
      });
      const res = httpMocks.createResponse({
        eventEmitter: require('events').EventEmitter,
        req: request,
      });

      await onramperApi.postDataToSign(request, res);

      const data = JSON.parse(res._getData());
      expect(res.statusCode).to.equal(200);
      expect(data).to.have.property('signature');
    });

    it('should accept data at exactly 5000 characters', async function () {
      const payload = 'x'.repeat(5000);
      const request = httpMocks.createRequest({
        method: 'POST',
        url: '/v1/onramper/sign',
        body: payload,
      });
      const res = httpMocks.createResponse({
        eventEmitter: require('events').EventEmitter,
        req: request,
      });

      await onramperApi.postDataToSign(request, res);

      const data = JSON.parse(res._getData());
      expect(res.statusCode).to.equal(200);
      expect(data).to.have.property('signature');
    });

    it('should reject data at 29 characters', async function () {
      const payload = 'a'.repeat(29);
      const request = httpMocks.createRequest({
        method: 'POST',
        url: '/v1/onramper/sign',
        body: payload,
      });
      const res = httpMocks.createResponse({
        eventEmitter: require('events').EventEmitter,
        req: request,
      });

      await onramperApi.postDataToSign(request, res);

      const data = JSON.parse(res._getData());
      expect(res.statusCode).to.equal(400);
      expect(data.error).to.equal('Data is too short');
    });

    it('should handle undefined body', async function () {
      const request = httpMocks.createRequest({
        method: 'POST',
        url: '/v1/onramper/sign',
        body: undefined,
      });
      const res = httpMocks.createResponse({
        eventEmitter: require('events').EventEmitter,
        req: request,
      });

      await onramperApi.postDataToSign(request, res);

      const data = JSON.parse(res._getData());
      expect(res.statusCode).to.equal(400);
      expect(data).to.have.property('error');
    });

    it('should produce deterministic signatures for same payload', async function () {
      const payload = 'networkWallets=flux:t3TRUNKvgywghL1vU5bsGQqs9eVC17XcUnV';

      const request1 = httpMocks.createRequest({
        method: 'POST',
        url: '/v1/onramper/sign',
        body: payload,
      });
      const res1 = httpMocks.createResponse({
        eventEmitter: require('events').EventEmitter,
        req: request1,
      });

      const request2 = httpMocks.createRequest({
        method: 'POST',
        url: '/v1/onramper/sign',
        body: payload,
      });
      const res2 = httpMocks.createResponse({
        eventEmitter: require('events').EventEmitter,
        req: request2,
      });

      await onramperApi.postDataToSign(request1, res1);
      await onramperApi.postDataToSign(request2, res2);

      const data1 = JSON.parse(res1._getData());
      const data2 = JSON.parse(res2._getData());

      expect(data1.signature).to.equal(data2.signature);
    });
  });
});
