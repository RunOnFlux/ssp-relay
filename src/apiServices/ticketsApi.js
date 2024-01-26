const ticketService = require('../services/ticketService');
const serviceHelper = require('../services/serviceHelper');
const log = require('../lib/log');

let alreadySubmittedIps = [];

function postTicket(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      if (!processedBody.description) {
        throw new Error('No description specified');
      }
      if (!processedBody.subject) {
        throw new Error('No subjet specified');
      }
      if (!processedBody.type) {
        throw new Error('No type specified');
      }
      if (!processedBody.email) {
        throw new Error('No email specified');
      }
      // request must contain challenge header
      if (!req.headers['x-challenge']) {
        throw new Error('Invalid request');
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
      const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
      res.json(errMessage);
    }
  });
}

module.exports = {
  postTicket,
};

setInterval(() => {
  alreadySubmittedIps = [];
}, 24 * 60 * 60 * 1000);
