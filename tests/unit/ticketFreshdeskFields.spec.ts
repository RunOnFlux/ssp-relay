// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { assert } from 'chai';
import ticketService from '../../src/services/ticketService';

const submission = (overrides = {}) => ({
  email: 'player@example.com',
  type: 'Question',
  subject: 'Server will not start',
  description: 'Line one\nLine two',
  ...overrides,
});

describe('Ticket Service: Freshdesk fields', function () {
  it('leaves tags, group and type unset for a caller category', function () {
    const ticket = ticketService.buildFreshdeskTicket(
      submission({ type: 'Billing & payments' }),
    );
    assert.notProperty(ticket, 'tags');
    assert.notProperty(ticket, 'group_id');
    assert.notProperty(ticket, 'type');
  });

  it('defaults to low priority and an open ticket', function () {
    const ticket = ticketService.buildFreshdeskTicket(submission());
    assert.equal(ticket.priority, 1);
    assert.equal(ticket.status, 2);
    assert.equal(ticket.email, 'player@example.com');
    assert.equal(ticket.subject, 'Server will not start');
  });

  it('passes through the four types Freshdesk knows', function () {
    ['Incident', 'Question', 'Problem', 'Feature Request'].forEach((type) => {
      const ticket = ticketService.buildFreshdeskTicket(submission({ type }));
      assert.equal(ticket.type, type);
    });
  });

  it('keeps the reporter paragraphs by sending breaks', function () {
    const ticket = ticketService.buildFreshdeskTicket(submission());
    assert.equal(ticket.description, 'Line one<br />Line two');
  });

  it('escapes markup in the reported description', function () {
    const ticket = ticketService.buildFreshdeskTicket(
      submission({ description: '<script>alert(1)</script> & "quotes"' }),
    );
    assert.equal(
      ticket.description,
      '&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;',
    );
  });
});
