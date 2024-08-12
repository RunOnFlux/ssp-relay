/* eslint-disable @typescript-eslint/no-unused-expressions */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import chai from 'chai';
import networkFeesService from '../../src/services/networkFeesService';

const { expect, assert } = chai;

describe('Network Fees Service', () => {
  describe('Obtain Fess: Correctly verifies fees', () => {
    it('should return ltc fees when valid', async () => {
        await networkFeesService.obtainLitecoinFees().then((r) => {
            assert.equal(r.coin, 'ltc');
            expect(r).to.have.property('economy');
            expect(r).to.have.property('normal');
            expect(r).to.have.property('fast');
            expect(r).to.have.property('recommended');
            expect(r.economy).to.not.be.null;
            expect(r.economy).to.not.be.undefined;
            expect(r.normal).to.not.be.null;
            expect(r.normal).to.not.be.undefined;
            expect(r.fast).to.not.be.null;
            expect(r.fast).to.not.be.undefined;
            expect(r.recommended).to.not.be.null;
            expect(r.recommended).to.not.be.undefined;
        });
    });

    it('should return ltc fees when valid', async () => {
        await networkFeesService.obtainLitecoinFees().then((r) => {
            assert.equal(r.coin, 'ltc');
            expect(r).to.have.property('economy');
            expect(r).to.have.property('normal');
            expect(r).to.have.property('fast');
            expect(r).to.have.property('recommended');
            expect(r.economy).to.not.be.null;
            expect(r.economy).to.not.be.undefined;
            expect(r.normal).to.not.be.null;
            expect(r.normal).to.not.be.undefined;
            expect(r.fast).to.not.be.null;
            expect(r.fast).to.not.be.undefined;
            expect(r.recommended).to.not.be.null;
            expect(r.recommended).to.not.be.undefined;
        });
    });

    // Please provide valid key in URL before testing
    it.skip('should return eth fees when valid', async () => {
        await networkFeesService.obtainEthFees().then((r) => {
            assert.equal(r.coin, 'eth');
            expect(r).to.have.property('economy');
            expect(r).to.have.property('normal');
            expect(r).to.have.property('fast');
            expect(r).to.have.property('recommended');
            expect(r.economy).to.not.be.null;
            expect(r.economy).to.not.be.undefined;
            expect(r.normal).to.not.be.null;
            expect(r.normal).to.not.be.undefined;
            expect(r.fast).to.not.be.null;
            expect(r.fast).to.not.be.undefined;
            expect(r.recommended).to.not.be.null;
            expect(r.recommended).to.not.be.undefined;
        });
    });

    // Please provide valid key in URL before testing
    it.skip('should return sepolia fees when valid', async () => {
        await networkFeesService.obtainSepoliaFees().then((r) => {
            assert.equal(r.coin, 'sepolia');
            expect(r).to.have.property('economy');
            expect(r).to.have.property('normal');
            expect(r).to.have.property('fast');
            expect(r).to.have.property('recommended');
            expect(r.economy).to.not.be.null;
            expect(r.economy).to.not.be.undefined;
            expect(r.normal).to.not.be.null;
            expect(r.normal).to.not.be.undefined;
            expect(r.fast).to.not.be.null;
            expect(r.fast).to.not.be.undefined;
            expect(r.recommended).to.not.be.null;
            expect(r.recommended).to.not.be.undefined;
        });
    });

    // Currently network and fetch fees functions are not test ready since 
    // the nature of these functions is recursive in getting data
  });

});
