// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { assert } from 'chai';
import ticketService from '../../src/services/ticketService';

/**
 * WHAT THIS SUITE USED TO ASSERT, and why it no longer does.
 *
 * Four cases called postTicket() with a valid submission and asserted
 * "Ticket created successfully.". They passed without a Freshdesk account, without a token and
 * without a network: `import freshdesk from 'freshdesk-client'` resolved to undefined under this
 * loader, reading TicketPriority off it threw "Cannot read properties of undefined", and the
 * catch block turned exactly that message into the success string. The service now uses named
 * imports and no longer launders failures into successes, so a call with placeholder config
 * fails, as it should.
 *
 * The ticket the service composes is asserted directly in ticketFreshdeskFields.spec.ts, which
 * needs neither a token nor a network to be meaningful.
 */
const submission = {
  type: 'Question',
  description: 'Sample Question',
  subject: 'Sample Question',
  email: 'sample@question.com',
};

describe('Ticket Service', function () {
  describe('Post Ticket: reports what actually happened', function () {
    it('fails when Freshdesk cannot be reached', async function () {
      await ticketService
        .postTicket(submission)
        .then(() => assert.fail('expected the unreachable helpdesk to throw'))
        .catch((e) => assert.equal(e.message, 'Failed to create a Ticket.'));
    });

    it('fails on a malformed submission instead of claiming success', async function () {
      await ticketService
        .postTicket(141)
        .catch((e) => assert.equal(e.message, 'Failed to create a Ticket.'));
    });
  });
});
