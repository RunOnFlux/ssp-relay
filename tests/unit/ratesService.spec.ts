/* eslint-disable @typescript-eslint/no-unused-expressions */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import chai from 'chai';
import ratesService from '../../src/services/ratesService';

const { expect } = chai;
var r = undefined;

describe('Rate Service', () => {
  describe('Fetch Rates: Correctly verifies rates', () => {
    before(async () => {
        await ratesService.initRates();
        r =  ratesService.getRates();
    });

    it('should correctly return rates', async () => {
        expect(r).to.not.be.null;
        expect(r).to.not.be.undefined;
    });

    it('should correctly return rates of crypto', async () => {
        expect(r.crypto).to.not.be.null;
        expect(r.crypto).to.not.be.undefined;
        expect(r.crypto.btc).to.not.be.null;
        expect(r.crypto.btc).to.not.be.undefined;
        expect(r.crypto.eth).to.not.be.null;
        expect(r.crypto.eth).to.not.be.undefined;
    });

    it('should correctly return rates of fiat', async () => {
        expect(r.fiat).to.not.be.null;
        expect(r.fiat).to.not.be.undefined;
        expect(r.fiat.BTC).to.not.be.null;
        expect(r.fiat.BTC).to.not.be.undefined;
        expect(r.fiat.ETH).to.not.be.null;
        expect(r.fiat.ETH).to.not.be.undefined;
    });

    // Currently fetchFiatRates and fetchCryptoRates functions are not test ready since 
    // the nature of these functions is recursive in getting data
  });
});
