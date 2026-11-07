// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
/**
 * Item 6: GET /v1/action and GET /v1/sync are polled every second; the
 * enterprise nonce-pool flag they carry must not cost a pool query per poll.
 */
import { expect } from 'chai';
import sinon from 'sinon';
import httpMocks from 'node-mocks-http';
import enterpriseHooks from '../../src/services/enterpriseHooks';
import actionService from '../../src/services/actionService';
import actionApi from '../../src/apiServices/actionApi';
import {
  getEnterpriseNoncesNeeded,
  resetNoncePoolStatusCache,
  AUTHENTICATED_TTL_MS,
  UNAUTHENTICATED_TTL_MS,
} from '../../src/services/noncePoolStatusCache';

const WK = 'bc1qnoncepoolcache0000000000000000000000000';

describe('enterprise nonce-pool flag rate limiting (item 6)', function () {
  let status;
  beforeEach(function () {
    resetNoncePoolStatusCache();
    sinon.stub(enterpriseHooks, 'isLoaded').returns(true);
    status = sinon.stub(enterpriseHooks, 'getNoncePoolStatus').resolves([
      { source: 'wallet', available: 3 },
      { source: 'key', available: 20 },
    ]);
  });
  afterEach(function () {
    sinon.restore();
    resetNoncePoolStatusCache();
  });

  it('computes the flag from the pool status', async function () {
    expect(await getEnterpriseNoncesNeeded(WK, true)).to.deep.equal({
      wallet: true,
      key: false,
    });
  });

  it('queries at most once per minute per identity for unsigned reads', async function () {
    const t0 = 1_000_000;
    for (let i = 0; i < 30; i++) {
      await getEnterpriseNoncesNeeded(WK, false, t0 + i * 1000);
    }
    expect(status.callCount).to.equal(1);
    await getEnterpriseNoncesNeeded(WK, false, t0 + UNAUTHENTICATED_TTL_MS + 1);
    expect(status.callCount).to.equal(2);
  });

  it('refreshes faster (10 s) for authenticated reads', async function () {
    const t0 = 2_000_000;
    await getEnterpriseNoncesNeeded(WK, true, t0);
    await getEnterpriseNoncesNeeded(WK, true, t0 + AUTHENTICATED_TTL_MS - 1);
    expect(status.callCount).to.equal(1);
    await getEnterpriseNoncesNeeded(WK, true, t0 + AUTHENTICATED_TTL_MS);
    expect(status.callCount).to.equal(2);
  });

  it('shares one in-flight query between concurrent reads', async function () {
    await Promise.all(
      Array.from({ length: 10 }, () => getEnterpriseNoncesNeeded(WK, false)),
    );
    expect(status.callCount).to.equal(1);
  });

  it('skips the query entirely without the enterprise module', async function () {
    enterpriseHooks.isLoaded.returns(false);
    expect(await getEnterpriseNoncesNeeded(WK, true)).to.equal(undefined);
    expect(status.called).to.equal(false);
  });

  it('a poll storm on GET /v1/action costs one pool query', async function () {
    sinon.stub(actionService, 'getAction').callsFake(async () => ({
      action: 'tx',
      wkIdentity: WK,
      payload: 'aa',
    }));
    sinon.stub(enterpriseHooks, 'onGetAction').resolves();
    let last;
    for (let i = 0; i < 20; i++) {
      const req = httpMocks.createRequest({
        method: 'GET',
        params: { id: WK },
      });
      const res = httpMocks.createResponse();
      await actionApi.getAction(req, res);
      last = JSON.parse(res._getData());
    }
    expect(status.callCount).to.equal(1);
    expect(last.enterpriseNoncesNeeded).to.deep.equal({
      wallet: true,
      key: false,
    });
  });
});
