import ticketService from '../services/ticketService';
import serviceHelper from '../services/serviceHelper';
import log from '../lib/log';

let alreadySubmittedIps = [];

function postTicket(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      if (
        !processedBody.description ||
        typeof processedBody.description !== 'string'
      ) {
        throw new Error('No description specified');
      }
      if (!processedBody.subject || typeof processedBody.subject !== 'string') {
        throw new Error('No subject specified');
      }
      if (!processedBody.type || typeof processedBody.type !== 'string') {
        throw new Error('No type specified');
      }
      if (!processedBody.email || typeof processedBody.email !== 'string') {
        throw new Error('No email specified');
      }
      // request must contain challenge header
      if (!req.headers['x-challenge']) {
        throw new Error('Invalid request');
      }

      // validate data
      if (processedBody.description.length > 50000) {
        throw new Error('Description is too long');
      }
      if (processedBody.subject.length > 1000) {
        throw new Error('Subject is too long');
      }
      if (
        processedBody.email.length > 500 ||
        !processedBody.email.includes('@')
      ) {
        throw new Error('Email is invalid');
      }
      if (processedBody.type.length > 500) {
        throw new Error('Type is too long');
      }

      // only following IP can make the request
      const ip = req.headers['x-forwarded-for'].split(',')[0];
      if (alreadySubmittedIps.filter((item) => item === ip).length > 10) {
        throw new Error('Ticket already submitted');
      }

      const data = {
        description: processedBody.description,
        subject: processedBody.subject,
        type: processedBody.type,
        email: processedBody.email,
      };

      const info = await ticketService.postTicket(data);
      const result = serviceHelper.createDataMessage(info);
      res.json(result);
    } catch (error) {
      log.error(error);
      const errMessage = serviceHelper.createErrorMessage(
        error.message,
        error.name,
        error.code,
      );
      res.json(errMessage);
    }
  });
}

export default {
  postTicket,
};

setInterval(
  () => {
    alreadySubmittedIps = [];
  },
  24 * 60 * 60 * 1000,
);
