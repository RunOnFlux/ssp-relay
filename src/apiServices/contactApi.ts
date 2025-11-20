import contactService from '../services/contactService';
import serviceHelper from '../services/serviceHelper';
import log from '../lib/log';

let alreadySubmittedIps = [];

function postContact(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      if (!processedBody.message || typeof processedBody.message !== 'string') {
        throw new Error('No message specified');
      }
      if (!processedBody.name || typeof processedBody.name !== 'string') {
        throw new Error('No name specified');
      }
      if (!processedBody.email || typeof processedBody.email !== 'string') {
        throw new Error('No email specified');
      }
      // request must contain challenge header
      if (!req.headers['x-challenge']) {
        throw new Error('Invalid request');
      }

      // validate data
      if (processedBody.message.length > 50000) {
        throw new Error('Message is too long');
      }
      if (processedBody.name.length > 1000) {
        throw new Error('Name is too long');
      }
      if (
        processedBody.email.length > 500 ||
        !processedBody.email.includes('@')
      ) {
        throw new Error('Email is invalid');
      }

      // only following IP can make the request
      const ip = req.headers['x-forwarded-for'].split(',')[0];
      if (alreadySubmittedIps.filter((item) => item === ip).length > 10) {
        throw new Error('Contact already submitted');
      }

      const data = {
        message: processedBody.message,
        name: processedBody.name,
        email: processedBody.email,
      };

      const info = await contactService.postContact(data);
      alreadySubmittedIps.push(ip);
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
  postContact,
};

setInterval(
  () => {
    alreadySubmittedIps = [];
  },
  24 * 60 * 60 * 1000,
);
