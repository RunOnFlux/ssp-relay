// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect } from 'chai';
import sinon from 'sinon';
import httpMocks from 'node-mocks-http';
import tronSponsorApi from '../../src/apiServices/tronSponsorApi';
import tronSponsorService, {
  TronSponsorRefusal,
} from '../../src/services/tronSponsorService';

function body(res) {
  return JSON.parse(res._getData());
}

describe('TRON sponsor API', function () {
  afterEach(function () {
    sinon.restore();
  });

  describe('GET /v1/tron/sponsor', function () {
    it('returns the sponsor context in the standard envelope', async function () {
      const ctx = {
        enabled: false,
        chain: 'tron',
        chainId: '728126428',
        factory: null,
        implementation: null,
        sponsor: null,
        feeCollector: null,
        ceilings: { trx: '30000000', usdt: '8000000' },
      };
      const stub = sinon
        .stub(tronSponsorService, 'getSponsorContext')
        .returns(ctx);
      const res = httpMocks.createResponse();
      await tronSponsorApi.getSponsor(
        httpMocks.createRequest({ method: 'GET', query: { chain: 'tron' } }),
        res,
      );
      expect(stub.firstCall.args[0]).to.equal('tron');
      expect(body(res)).to.deep.equal({ status: 'success', data: ctx });
    });

    it('accepts tronNile', async function () {
      sinon
        .stub(tronSponsorService, 'getSponsorContext')
        .returns({ chain: 'tronNile' });
      const res = httpMocks.createResponse();
      await tronSponsorApi.getSponsor(
        httpMocks.createRequest({
          method: 'GET',
          query: { chain: 'tronNile' },
        }),
        res,
      );
      expect(body(res).status).to.equal('success');
    });

    for (const chain of [
      undefined,
      'eth',
      'TRON',
      'tron;drop',
      'a'.repeat(60),
    ]) {
      it(`rejects chain=${String(chain).slice(0, 12)}`, async function () {
        const res = httpMocks.createResponse();
        await tronSponsorApi.getSponsor(
          httpMocks.createRequest({ method: 'GET', query: { chain } }),
          res,
        );
        const b = body(res);
        expect(b.status).to.equal('error');
        expect(b.data.message).to.match(/Invalid or unsupported chain/);
        expect(b.data.code).to.equal('400');
      });
    }
  });

  describe('POST /v1/tron/quote', function () {
    it('forwards an UNTRUSTED quote (the relay picks nonce and markup)', async function () {
      const q = { vault: 'T…', nonce: '0' };
      const stub = sinon.stub(tronSponsorService, 'quote').resolves(q);
      const res = httpMocks.createResponse();
      await tronSponsorApi.postQuote(
        httpMocks.createRequest({
          method: 'POST',
          body: {
            chain: 'tron',
            signers: ['A', 'B'],
            threshold: 2,
            calls: [],
            max: { token: 'TRX' },
            signature: 'auth-field',
          },
        }),
        res,
      );
      expect(body(res)).to.deep.equal({ status: 'success', data: q });
      const [req, opts] = stub.firstCall.args;
      expect(opts).to.deep.equal({ trusted: false });
      expect(req).to.deep.equal({
        chain: 'tron',
        signers: ['A', 'B'],
        threshold: 2,
        calls: [],
        max: { token: 'TRX' },
      });
    });

    it('passes a client nonce through so the service refuses it', async function () {
      const stub = sinon
        .stub(tronSponsorService, 'quote')
        .rejects(
          new TronSponsorRefusal('nonce and markup are chosen by the relay'),
        );
      const res = httpMocks.createResponse();
      await tronSponsorApi.postQuote(
        httpMocks.createRequest({
          method: 'POST',
          body: { chain: 'tron', nonce: '5' },
        }),
        res,
      );
      expect(stub.firstCall.args[0].nonce).to.equal('5');
      const b = body(res);
      expect(b.status).to.equal('error');
      expect(b.data.code).to.equal('400');
      expect(b.data.name).to.equal('TronSponsorRefusal');
    });

    it('rejects an unsupported chain before calling the service', async function () {
      const stub = sinon.stub(tronSponsorService, 'quote');
      const res = httpMocks.createResponse();
      await tronSponsorApi.postQuote(
        httpMocks.createRequest({
          method: 'POST',
          body: { chain: 'solMainnet' },
        }),
        res,
      );
      expect(stub.called).to.equal(false);
      expect(body(res).status).to.equal('error');
    });
  });

  describe('POST /v1/tron/broadcast', function () {
    it('forwards exactly {chain, signers, threshold, op, signatures} and returns {txid}', async function () {
      const stub = sinon
        .stub(tronSponsorService, 'broadcast')
        .resolves({ txid: 'ab'.repeat(32) });
      const res = httpMocks.createResponse();
      await tronSponsorApi.postBroadcast(
        httpMocks.createRequest({
          method: 'POST',
          body: {
            chain: 'tron',
            signers: ['A', 'B'],
            threshold: 2,
            op: { calls: [] },
            signatures: ['0x1', '0x2'],
            wkIdentity: 'bc1q…',
            signature: 'auth',
            message: 'auth',
            publicKey: 'auth',
          },
        }),
        res,
      );
      expect(body(res)).to.deep.equal({
        status: 'success',
        data: { txid: 'ab'.repeat(32) },
      });
      expect(stub.firstCall.args[0]).to.deep.equal({
        chain: 'tron',
        signers: ['A', 'B'],
        threshold: 2,
        op: { calls: [] },
        signatures: ['0x1', '0x2'],
      });
    });

    it('returns refusals as 400 and unexpected errors as 500', async function () {
      sinon
        .stub(tronSponsorService, 'broadcast')
        .onFirstCall()
        .rejects(
          new TronSponsorRefusal('fee recipient must be the SSP fee collector'),
        )
        .onSecondCall()
        .rejects(new Error('socket hang up'));
      const req = () =>
        httpMocks.createRequest({ method: 'POST', body: { chain: 'tron' } });
      const r1 = httpMocks.createResponse();
      await tronSponsorApi.postBroadcast(req(), r1);
      expect(body(r1).data).to.include({
        code: '400',
        message: 'fee recipient must be the SSP fee collector',
      });
      const r2 = httpMocks.createResponse();
      await tronSponsorApi.postBroadcast(req(), r2);
      expect(body(r2).data).to.include({
        code: '500',
        message: 'socket hang up',
      });
    });
  });
});
