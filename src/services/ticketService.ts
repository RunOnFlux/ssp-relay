import axios from 'axios';
import config from 'config';
import log from '../lib/log';

/** The only four values Freshdesk accepts for a ticket's type. */
const FRESHDESK_TYPES = ['Incident', 'Question', 'Problem', 'Feature Request'];

/**
 * Freshdesk's own numeric codes, inlined rather than imported.
 *
 * `freshdesk-client` is written against FRESHSERVICE (`@ref api.freshservice.com` in its own
 * source) and only happens to fit Freshdesk for the request half — see postTicket below for the
 * half where it does not. These three are documented on Freshdesk's ticket-fields page and are
 * the same numbers the library exported.
 */
const PRIORITY_LOW = 1;
const STATUS_OPEN = 2;
const SOURCE_EMAIL = 1;

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
    priority: PRIORITY_LOW,
    status: STATUS_OPEN,
    source: SOURCE_EMAIL,
    email: data.email,
  };
  if (FRESHDESK_TYPES.includes(data.type)) {
    Object.assign(ticket, { type: data.type });
  }
  return ticket;
}

/** The id of the created ticket, whichever of the two response shapes came back. */
function createdTicketId(body) {
  return body?.id ?? body?.ticket?.id;
}

/**
 * WHY THIS POSTS TO FRESHDESK ITSELF instead of calling `freshdesk-client`.
 *
 * That library is a Freshservice client. Freshservice answers a ticket creation with
 * `{ "ticket": { "id": ... } }`; Freshdesk answers with the ticket object at the top level. The
 * library logs `data.ticket.id` right after the POST, so against Freshdesk it threw
 * "Cannot read properties of undefined (reading 'id')" on every SUCCESSFUL creation — the ticket
 * existed, the caller was told it did not. That is what the removed
 * `if (error.message.includes('Cannot read properties of unde')) return success` swallowed, and
 * removing it is what made the games hub report "Failed to create a Ticket." for tickets that
 * had in fact been filed.
 *
 * The request is one JSON POST with basic auth (api key as the username, any password), so
 * there is nothing left to gain from the dependency, and errors below are now Freshdesk's own.
 */
async function postTicket(data) {
  const token = config.keys.freshdesk;
  const baseUri = `https://${config.freshdesk.namespace}.freshdesk.com`;
  try {
    const response = await axios.post(
      `${baseUri}/api/v2/tickets`,
      buildFreshdeskTicket(data),
      {
        headers: { 'Content-Type': 'application/json' },
        auth: { username: token, password: 'X' },
        timeout: 30000,
      },
    );
    log.info(`Freshdesk ticket created: ${createdTicketId(response.data)}`);
    return 'Ticket created successfully.';
  } catch (error) {
    // Freshdesk says WHICH field it rejected, in `errors: [{ field, message, code }]`. Logging
    // the bare Error prints "Request failed with status code 400" and nothing else, which is how
    // a mandatory-field change on the helpdesk side would reach us as a mystery.
    const status = error.response?.status;
    const details = error.response?.data
      ? JSON.stringify(error.response.data)
      : error.message;
    log.error(
      `Freshdesk ticket creation failed (${status ?? 'no response'}): ${details}`,
    );
    log.error(error);
    // NO ESCAPE HATCH. This used to answer "Ticket created successfully." whenever the error
    // message contained "Cannot read properties of unde". A reporter who is told their ticket
    // was filed does not file it again.
    throw new Error('Failed to create a Ticket.');
  }
}

export default {
  postTicket,
  buildFreshdeskTicket,
};
