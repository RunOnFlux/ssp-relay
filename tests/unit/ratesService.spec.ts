/* eslint-disable @typescript-eslint/no-unused-expressions */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect } from 'chai';
import ratesService from '../../src/services/ratesService';
import sinon from 'sinon';
let r = undefined;

describe('Rate Service', function () {
  describe('Fetch Rates: Correctly verifies rates', function () {
    before(async function () {
      await ratesService.initRates();
      r = ratesService.getRates();
    });

    afterEach(function () {
      sinon.restore();
    });

    it('should correctly return rates of crypto', async function () {
      expect(r).to.have.property('crypto');
      expect(r.crypto).to.have.property('btc');
      expect(r.crypto).to.have.property('eth');
      expect(r.crypto).to.not.be.null;
      expect(r.crypto).to.not.be.undefined;
      expect(r.crypto.btc).to.not.be.null;
      expect(r.crypto.btc).to.not.be.undefined;
      expect(r.crypto.eth).to.not.be.null;
      expect(r.crypto.eth).to.not.be.undefined;
    });

    it('should correctly return rates of fiat', async function () {
      expect(r).to.have.property('fiat');
      expect(r.fiat).to.have.property('BTC');
      expect(r.fiat).to.have.property('ETH');
      expect(r.fiat).to.not.be.null;
      expect(r.fiat).to.not.be.undefined;
      expect(r.fiat.BTC).to.not.be.null;
      expect(r.fiat.BTC).to.not.be.undefined;
      expect(r.fiat.ETH).to.not.be.null;
      expect(r.fiat.ETH).to.not.be.undefined;
    });

    // Testing using stub data
    it('should return successful result if stub value is valid', async function () {
      await sinon
        .stub(ratesService, 'fetchFiatRates')
        .returns({ fiat: { BTC: 1, ETH: 1 } });
      await sinon
        .stub(ratesService, 'fetchCryptoRates')
        .returns({ crypto: { btc: 1, flux: 1 } });
      await sinon
        .stub(ratesService, 'getRates')
        .returns({ fiat: { BTC: 1, ETH: 1 }, crypto: { btc: 1, flux: 1 } });
      r = ratesService.getRates();
      expect(r).to.have.property('fiat');
      expect(r.fiat).to.have.property('BTC');
      expect(r.fiat).to.have.property('ETH');
      expect(r.fiat).to.not.be.null;
      expect(r.fiat).to.not.be.undefined;
      expect(r.fiat.BTC).to.not.be.null;
      expect(r.fiat.BTC).to.not.be.undefined;
      expect(r.fiat.ETH).to.not.be.null;
      expect(r.fiat.ETH).to.not.be.undefined;
      expect(r).to.have.property('crypto');
      expect(r.crypto).to.have.property('btc');
      expect(r.crypto).to.have.property('flux');
      expect(r.crypto).to.not.be.null;
      expect(r.crypto).to.not.be.undefined;
      expect(r.crypto.btc).to.not.be.null;
      expect(r.crypto.btc).to.not.be.undefined;
      expect(r.crypto.flux).to.not.be.null;
      expect(r.crypto.flux).to.not.be.undefined;
      expect(r.fiat).to.deep.equal({ BTC: 1, ETH: 1 });
      expect(r.crypto).to.deep.equal({ btc: 1, flux: 1 });
    });
  });
});
