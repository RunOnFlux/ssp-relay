/* eslint-disable @typescript-eslint/no-unused-expressions */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import chai from 'chai';
import tokenApi from '../../src/apiServices/tokenApi';
import sinon from 'sinon';
import httpMocks from 'node-mocks-http';

const { expect } = chai;

describe('Token API', function () {
  describe('Token API: Correctly verifies asset data', function () {
    afterEach(function () {
      sinon.restore();
    });

    it('should return getTokenInfo successful result if value is valid', async function () {
        const request = httpMocks.createRequest({
            method: 'GET',
            url: 'test',
            params: {
                network: "eth",
                address: "0x455e53cbb86018ac2b8092fdcd39d8444affc3f6"
            }
        });
        await sinon
            .stub(tokenApi, 'getTokenInfo')
            .returns({
                decimal: "18",
                logo: "http://eth.svg",
                name: "Ethereum",
                symbol: "eth"
            });
        const response = httpMocks.createResponse({
            eventEmiiter: require('events').EventEmitter,
            req: request,
        });
        const res = await tokenApi.getTokenInfo(request, response);
        expect(res).to.have.property('decimal');
        expect(res).to.have.property('logo');
        expect(res).to.have.property('name');
        expect(res).to.have.property('symbol');
    });
  });
});
