import {
  createTicket,
  TicketPriority,
  TicketSourceType,
  TicketStatus,
} from 'freshdesk-client';
import config from 'config';
import log from '../lib/log';

/** The only four values Freshdesk accepts for a ticket's type. */
const FRESHDESK_TYPES = ['Incident', 'Question', 'Problem', 'Feature Request'];

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Freshdesk renders `description` as HTML, and every caller sends the raw contents of a
 * <textarea>. Posting that verbatim collapses the reporter's paragraphs into one block, so the
 * steps-to-reproduce they carefully numbered arrive as a wall of text. Escape, then turn the
 * newlines into breaks.
 */
function descriptionToHtml(text: string): string {
  return escapeHtml(text).replace(/\r\n|\r|\n/g, '<br />');
}

/**
 * The Freshdesk ticket a submission becomes.
 *
 * WHAT THIS DELIBERATELY DOES NOT SET, at the support team's request: `tags`, `type` (unless the
 * caller named a real one) and `group_id`. Every ticket used to arrive tagged `SSP`, typed
 * `Question` and assigned to one group, whoever sent it and whatever it was about — the game and
 * app hubs post here too, and none of those three values was true for them. Blank is not a
 * missing feature: it lets the helpdesk's own rules route and label the ticket, and the agents
 * add the tags by hand anyway.
 *
 * PRIORITY IS LOW, also at their request. It was High for everything, which is the same as
 * having no priority at all.
 *
 * `type` is passed through when it is one of Freshdesk's four, because the SSP support form
 * offers exactly those and means them. Anything else (the hubs send their own categories, like
 * "Billing & payments") is dropped rather than coerced: mapping it to `Question` is what made
 * every hub ticket a question in the first place, and the category still reaches the agent
 * inside the subject and the body.
 */
export function buildFreshdeskTicket(data) {
  const ticket = {
    description: descriptionToHtml(data.description),
    subject: data.subject,
    priority: TicketPriority.Low,
    status: TicketStatus.Open,
    source: TicketSourceType.Email,
    email: data.email,
  };
  if (FRESHDESK_TYPES.includes(data.type)) {
    Object.assign(ticket, { type: data.type });
  }
  return ticket;
}

/**
 * NAMED IMPORTS, not the package default. `import freshdesk from 'freshdesk-client'` resolves to
 * undefined under some ESM loaders (mocha's, for one), and this file then threw
 * "Cannot read properties of undefined" on the first enum it touched — straight into the catch
 * below, whose message check reported the ticket as created. A whole class of silent losses; the
 * named exports resolve everywhere.
 */
async function postTicket(data) {
  try {
    const tokenKey = config.keys.freshdesk;
    const baseUri = `https://${config.freshdesk.namespace}.freshdesk.com`;
    await createTicket({
      baseUri,
      token: tokenKey,
      // The client's input type is derived from a zod schema that marks `type` and `group_id`
      // required; Freshdesk itself treats both as optional and leaves them unset when they are
      // absent, which is the whole point of the ticket built above.
      ticket: buildFreshdeskTicket(data) as Parameters<
        typeof createTicket
      >[0]['ticket'],
    });
    return 'Ticket created successfully.';
  } catch (error) {
    log.error(error);
    // NO ESCAPE HATCH. This used to answer "Ticket created successfully." whenever the error
    // message contained "Cannot read properties of unde", which is precisely what the broken
    // default import threw: a failure to reach Freshdesk at all was reported to the reporter as
    // a ticket. A reporter who is told their ticket was filed does not file it again.
    throw new Error('Failed to create a Ticket.');
  }
}

export default {
  postTicket,
  buildFreshdeskTicket,
};
