// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
/**
 * The optional `receiver` of a 'tx' action: the recipient as the user entered
 * it in SSP Wallet (Zcash TEX, ZIP 320). The relay validates it, stores it
 * with the request, hands it to SSP Key, and never lets one outlive the
 * request it came with.
 */
import { expect } from 'chai';
import sinon from 'sinon';
import httpMocks from 'node-mocks-http';
import { EventEmitter } from 'events';
import actionApi from '../../src/apiServices/actionApi';
import actionService from '../../src/services/actionService';
import notificationService from '../../src/services/notificationService';
import serviceHelper from '../../src/services/serviceHelper';
import socket from '../../src/lib/socket';

const WK = 'bc1qwalletkeyidentity0000000000000000000000';
const TEX = 'tex1s2rt77ggv6q989lr49rkgzmh5slsksa9khdgte';

function postTx(body: Record<string, unknown>) {
  const req = httpMocks.createRequest({
    method: 'POST',
    body: {
      action: 'tx',
      chain: 'zec',
      path: '0-0',
      wkIdentity: WK,
      payload: 'deadbeef',
      ...body,
    },
  });
  req.isAuthenticated = true;
  req.verifiedIdentity = WK;
  const res = httpMocks.createResponse({ eventEmitter: EventEmitter, req });
  return { req, res };
}

describe('Action API: tx receiver hint', function () {
  let posted: sinon.SinonStub;
  let emitted: Array<[string, Record<string, unknown>]>;

  beforeEach(function () {
    posted = sinon.stub(actionService, 'postAction').callsFake(async (d) => d);
    sinon.stub(notificationService, 'sendNotificationKey').resolves();
    emitted = [];
    sinon.stub(socket, 'getIOKey').returns({
      to: () => ({
        emit: (event, data) => emitted.push([event, data]),
      }),
    });
  });

  afterEach(function () {
    sinon.restore();
  });

  it('stores the receiver with the tx and hands it to SSP Key', async function () {
    const { req, res } = postTx({ receiver: TEX });
    await actionApi.postAction(req, res);
    expect(res.statusCode).to.equal(200);
    expect(posted.firstCall.args[0].receiver).to.equal(TEX);
    expect(emitted).to.have.length(1);
    expect(emitted[0][0]).to.equal('tx');
    expect(emitted[0][1].receiver).to.equal(TEX);
  });

  it('leaves a tx without a receiver as it was', async function () {
    const { req, res } = postTx({});
    await actionApi.postAction(req, res);
    expect(res.statusCode).to.equal(200);
    expect(posted.firstCall.args[0]).to.not.have.property('receiver');
  });

  it('refuses a malformed receiver', async function () {
    for (const receiver of [
      42,
      { address: TEX },
      'tex1 abc',
      'tex1<script>',
      'x'.repeat(201),
    ]) {
      const { req, res } = postTx({ receiver });
      await actionApi.postAction(req, res);
      expect(res.statusCode).to.equal(400);
    }
    expect(posted.called).to.equal(false);
    expect(emitted).to.have.length(0);
  });

  it('does not store a receiver on actions other than tx', async function () {
    const { req, res } = postTx({
      action: 'publicnoncesrequest',
      payload: 'x',
      receiver: TEX,
    });
    await actionApi.postAction(req, res);
    expect(res.statusCode).to.equal(200);
    expect(posted.firstCall.args[0]).to.not.have.property('receiver');
  });
});

describe('Action service: receiver slot', function () {
  let update: sinon.SinonStub;

  beforeEach(function () {
    sinon.stub(serviceHelper, 'databaseConnection').resolves({
      db: () => ({}),
    });
    update = sinon.stub(serviceHelper, 'updateOneInDatabase').resolves();
  });

  afterEach(function () {
    sinon.restore();
  });

  it('clears a receiver left by an earlier request', async function () {
    await actionService.postAction({ wkIdentity: WK, action: 'tx' });
    const written = update.firstCall.args[3];
    expect(written.$set).to.not.have.property('receiver');
    expect(written.$unset).to.deep.equal({ receiver: '' });
  });

  it('writes the receiver of the current request', async function () {
    await actionService.postAction({
      wkIdentity: WK,
      action: 'tx',
      receiver: TEX,
    });
    const written = update.firstCall.args[3];
    expect(written.$set.receiver).to.equal(TEX);
    expect(written).to.not.have.property('$unset');
  });
});
