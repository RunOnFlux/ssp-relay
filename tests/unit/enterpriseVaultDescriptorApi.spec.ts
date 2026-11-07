// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect } from 'chai';
import sinon from 'sinon';
import httpMocks from 'node-mocks-http';

import enterpriseApi from '../../src/apiServices/enterpriseApi';
import enterpriseHooks from '../../src/services/enterpriseHooks';

const makeReq = () =>
  httpMocks.createRequest({
    method: 'GET',
    url: '/v1/enterprise/organizations/org1/vaults/vault1/descriptor',
    params: { id: 'org1', vaultId: 'vault1' },
  });

const makeRes = (request) =>
  httpMocks.createResponse({
    eventEmiiter: require('events').EventEmitter,
    req: request,
  });

describe('Enterprise vault descriptor pass-through (VD-1)', function () {
  afterEach(function () {
    sinon.restore();
  });

  it('passes the request to the vaultDescriptorGet hook and wraps the result', async function () {
    const result = {
      success: true,
      descriptor: { v: 1 },
      descriptorHash: 'ab'.repeat(32),
    };
    const hook = sinon.stub().resolves(result);
    sinon.stub(enterpriseHooks, 'isLoaded').returns(true);
    const getHook = sinon.stub(enterpriseHooks, 'getHook').returns(hook);
    const req = makeReq();
    const res = makeRes(req);

    await enterpriseApi.getVaultDescriptor(req, res);

    expect(getHook.calledOnceWithExactly('vaultDescriptorGet')).to.equal(true);
    expect(hook.calledOnceWithExactly(req)).to.equal(true);
    expect(res.statusCode).to.equal(200);
    expect(res._getJSONData()).to.deep.equal({
      status: 'success',
      data: result,
    });
  });

  it('sends a real HTTP 409 when the descriptor is not available yet', async function () {
    sinon.stub(enterpriseHooks, 'isLoaded').returns(true);
    sinon.stub(enterpriseHooks, 'getHook').returns(
      sinon.stub().resolves({
        success: false,
        error: 'not ready',
        errorCode: 'DESCRIPTOR_NOT_READY',
        httpStatus: 409,
      }),
    );
    const req = makeReq();
    const res = makeRes(req);

    await enterpriseApi.getVaultDescriptor(req, res);

    expect(res.statusCode).to.equal(409);
    expect(res._getJSONData()).to.deep.equal({
      status: 'error',
      data: { code: 409, name: 'DESCRIPTOR_NOT_READY', message: 'not ready' },
    });
  });

  it('keeps other failures in the usual 200 envelope', async function () {
    const result = {
      success: false,
      error: 'Access denied',
      errorCode: 'VAULT_ACCESS_DENIED',
    };
    sinon.stub(enterpriseHooks, 'isLoaded').returns(true);
    sinon
      .stub(enterpriseHooks, 'getHook')
      .returns(sinon.stub().resolves(result));
    const req = makeReq();
    const res = makeRes(req);

    await enterpriseApi.getVaultDescriptor(req, res);

    expect(res.statusCode).to.equal(200);
    expect(res._getJSONData()).to.deep.equal({
      status: 'success',
      data: result,
    });
  });

  it('errors when the enterprise module is not loaded', async function () {
    sinon.stub(enterpriseHooks, 'isLoaded').returns(false);
    const getHook = sinon.stub(enterpriseHooks, 'getHook');
    const req = makeReq();
    const res = makeRes(req);

    await enterpriseApi.getVaultDescriptor(req, res);

    expect(getHook.called).to.equal(false);
    expect(res._getJSONData().status).to.equal('error');
  });

  it('errors when the enterprise module has no vaultDescriptorGet hook', async function () {
    sinon.stub(enterpriseHooks, 'isLoaded').returns(true);
    sinon.stub(enterpriseHooks, 'getHook').returns(undefined);
    const req = makeReq();
    const res = makeRes(req);

    await enterpriseApi.getVaultDescriptor(req, res);

    expect(res._getJSONData().status).to.equal('error');
    expect(res._getJSONData().data.message).to.include('vaultDescriptorGet');
  });
});
