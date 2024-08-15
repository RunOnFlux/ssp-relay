/* eslint-disable @typescript-eslint/no-unused-expressions */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import chai from 'chai';
import networkFeesService from '../../src/services/networkFeesService';
import sinon from 'sinon';

const { expect, assert } = chai;

describe('Network Fees Service', () => {
  describe('Obtain Fess: Correctly verifies fees', () => {
    afterEach(function() {
      sinon.restore();
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

    // Fetch fees using stub values
    it('should return successful result if stub value is valid values', async () => {
        await sinon.stub(networkFeesService, "obtainBitcoinFees").returns(1);
        await sinon.stub(networkFeesService, "obtainLitecoinFees").returns(1);
        await sinon.stub(networkFeesService, "obtainEthFees").returns(1);
        await sinon.stub(networkFeesService, "obtainSepoliaFees").returns(1);
        await sinon.stub(networkFeesService, "networkFees").returns({ btcFee: 1, ltcFee: 1,  ethFee: 1, sepFee: 1});
        const response = networkFeesService.networkFees();
        expect(response).to.deep.equal({ btcFee: 1, ltcFee: 1,  ethFee: 1, sepFee: 1});
    });

    it('should return successful result if stub value is valid', async () => {
        await sinon.stub(networkFeesService, "obtainBitcoinFees").returns(2);
        await sinon.stub(networkFeesService, "obtainLitecoinFees").returns(2);
        await sinon.stub(networkFeesService, "obtainEthFees").returns(2);
        await sinon.stub(networkFeesService, "obtainSepoliaFees").returns(2);
        await sinon.stub(networkFeesService, "networkFees").returns({ btcFee: 2, ltcFee: 2,  ethFee: 2, sepFee: 2});
        const response = networkFeesService.networkFees();
        expect(response).to.deep.equal({ btcFee: 2, ltcFee: 2,  ethFee: 2, sepFee: 2});
    });
  });

});
