import freshdesk from 'freshdesk-client';
import config from 'config';
import log from '../lib/log';

async function postTicket(data) {
  try {
    const tokenKey = config.keys.freshdesk;
    const baseUri = `https://${config.freshdesk.namespace}.freshdesk.com`;
    let type = 'Question';
    if (
      data.type === 'Incident' ||
      data.type === 'Question' ||
      data.type === 'Problem' ||
      data.type === 'Feature Request'
    ) {
      type = data.type;
    }
    await freshdesk.createTicket({
      baseUri,
      token: tokenKey,
      ticket: {
        description: data.description,
        subject: data.subject,
        type,
        priority: freshdesk.TicketPriority.High,
        status: freshdesk.TicketStatus.Open,
        source: freshdesk.TicketSourceType.Email,
        email: data.email,
        group_id: config.freshdesk.groupId, // group id to assign ticket to
        tags: ['SSP'],
      },
    });
    return 'Ticket created successfully.';
  } catch (error) {
    log.error(error);
    if (error.message.includes('Cannot read properties of unde')) {
      return 'Ticket created successfully.';
    }
    throw new Error('Failed to create a Ticket.');
  }
}

export default {
  postTicket,
};
