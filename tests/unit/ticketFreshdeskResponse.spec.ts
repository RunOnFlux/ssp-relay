// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { assert } from 'chai';
import sinon from 'sinon';
import axios from 'axios';
import ticketService from '../../src/services/ticketService';

/**
 * THE SHAPE THAT BROKE THE SUPPORT FORM.
 *
 * Freshdesk answers a created ticket with the ticket object at the top level. `freshdesk-client`
 * is a Freshservice client and read `response.data.ticket.id`, so every successful creation
 * threw "Cannot read properties of undefined (reading 'id')" and the reporter was told
 * "Failed to create a Ticket." for a ticket that had just been filed. These two cases fail if
 * anything goes back to reading a wrapper that Freshdesk does not send.
 */
const submission = {
  email: 'player@example.com',
  type: 'Server down or crashing',
  subject: '[Valheim · valheim1787597949160] Server down',
  description: 'It stopped\nyesterday',
};

describe('Ticket Service: Freshdesk response', function () {
  afterEach(function () {
    sinon.restore();
  });

  it('treats a top-level ticket id as the success Freshdesk means it to be', async function () {
    const post = sinon.stub(axios, 'post').resolves({
      status: 201,
      data: { id: 9182, subject: submission.subject, status: 2, priority: 1 },
    });

    const result = await ticketService.postTicket(submission);

    assert.equal(result, 'Ticket created successfully.');
    assert.isTrue(post.calledOnce);
    const [uri, body, options] = post.firstCall.args;
    assert.match(uri, /^https:\/\/.+\.freshdesk\.com\/api\/v2\/tickets$/);
    assert.equal(body.subject, submission.subject);
    assert.equal(body.description, 'It stopped<br />yesterday');
    assert.notProperty(body, 'type');
    assert.property(options.auth, 'username');
  });

  it('still fails when Freshdesk rejects the ticket', async function () {
    sinon.stub(axios, 'post').rejects({
      message: 'Request failed with status code 400',
      response: {
        status: 400,
        data: {
          description: 'Validation failed',
          errors: [
            { field: 'type', message: 'It should be one of these values' },
          ],
        },
      },
    });

    await ticketService
      .postTicket(submission)
      .then(() => assert.fail('a rejected ticket must not report success'))
      .catch((e) => assert.equal(e.message, 'Failed to create a Ticket.'));
  });
});
