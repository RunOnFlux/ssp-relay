// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { assert } from 'chai';
import sinon from 'sinon';
import axios from 'axios';
import config from 'config';
import ticketService from '../../src/services/ticketService';

/**
 * THE MOVE TO THE FLUX HELPDESK.
 *
 * With the desk's url and token in config/helpdesksecrets.ts, a ticket goes to the desk's
 * web-forms endpoint; while either is empty it still goes to Freshdesk, so a server that has not
 * been given them keeps working exactly as before.
 */
const submission = {
  email: 'player@example.com',
  type: 'Server down or crashing',
  subject: '[Valheim · valheim1787597949160] Server down',
  description: 'It stopped\nyesterday',
  origin: 'https://sspwallet.io',
};

/** config.get with the desk's settings in helpdesksecrets.ts, everything else as configured. */
function deskConfig(desk: { url?: string; token?: string }) {
  const get = sinon.stub(config, 'get');
  get.callsFake((path: string) => {
    if (path === 'helpdesk.url') return desk.url ?? '';
    if (path === 'helpdesk.token') return desk.token ?? '';
    return get.wrappedMethod.call(config, path);
  });
}

describe('Ticket Service: Flux Helpdesk', function () {
  beforeEach(function () {
    deskConfig({ url: 'https://desk.example/', token: 'key123:secret456' });
  });

  afterEach(function () {
    sinon.restore();
  });

  it('files the ticket with the desk, as typed, with the site it came from', async function () {
    const post = sinon.stub(axios, 'post').resolves({
      status: 200,
      data: { message: { ticket: '1042' } },
    });

    const result = await ticketService.postTicket(submission);

    assert.equal(result, 'Ticket created successfully.');
    assert.isTrue(post.calledOnce);
    const [uri, body, options] = post.firstCall.args;
    assert.equal(
      uri,
      'https://desk.example/api/method/flux_helpdesk.web_forms.create_ticket',
    );
    assert.deepEqual(body, {
      email: submission.email,
      subject: submission.subject,
      description: 'It stopped\nyesterday',
      type: submission.type,
      origin: 'https://sspwallet.io',
    });
    assert.equal(options.headers.Authorization, 'token key123:secret456');
    assert.equal(options.maxRedirects, 0);
    assert.notProperty(options, 'auth');
  });

  it('fails when the desk refuses the ticket', async function () {
    sinon.stub(axios, 'post').rejects({
      message: 'Request failed with status code 417',
      response: {
        status: 417,
        data: { exc_type: 'ValidationError', _server_messages: '[]' },
      },
    });

    await ticketService
      .postTicket(submission)
      .then(() => assert.fail('expected the refused ticket to throw'))
      .catch((e) => assert.equal(e.message, 'Failed to create a Ticket.'));
  });

  it('fails when the answer is not the desk’s (a login page, a proxy)', async function () {
    sinon.stub(axios, 'post').resolves({
      status: 200,
      data: '<html>Sign in</html>',
    });

    await ticketService
      .postTicket(submission)
      .then(() => assert.fail('expected a non-desk answer to throw'))
      .catch((e) => assert.equal(e.message, 'Failed to create a Ticket.'));
  });

  it('still files to Freshdesk while the desk is not configured', async function () {
    sinon.restore();
    deskConfig({ token: 'key123:secret456' });
    const post = sinon.stub(axios, 'post').resolves({
      status: 201,
      data: { id: 9182 },
    });

    const result = await ticketService.postTicket(submission);

    assert.equal(result, 'Ticket created successfully.');
    const [uri, body] = post.firstCall.args;
    assert.match(uri, /^https:\/\/.+\.freshdesk\.com\/api\/v2\/tickets$/);
    assert.notProperty(body, 'origin');
  });
});
