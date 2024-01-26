const config = require('config');
const ticketService = require('../services/ticketService');
const serviceHelper = require('../services/serviceHelper');
const log = require('../lib/log');

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
      // only following IP can make the request
      const ip = req.headers['x-forwarded-for'].split(',')[0];
      if (config.freshdesk.ips.includes(ip) === false) {
        throw new Error('Unauthorized IP');
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
