const actionService = require('../services/actionService');
const serviceHelper = require('../services/serviceHelper');
const log = require('../lib/log');

async function getAction(req, res) {
  try {
    let { id } = req.params;
    id = id || req.query.id; // id is wkIdentity
    if (!id) {
      res.sendStatus(400);
      return;
    }
    const syncExist = await actionService.getAction(id);
    if (!syncExist) {
      throw new Error(`Action of ${id} does not exist`);
    }
    res.json(syncExist);
  } catch (error) {
    log.error(error);
    res.sendStatus(404);
  }
}

function postAction(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      if (!processedBody.chain) {
        throw new Error('No Chain specified');
      }
      if (!processedBody.wkIdentity) {
        throw new Error('No Wallet-Key Identity specified');
      }
      if (!processedBody.action) {
        throw new Error('No Action specified');
      }
      if (!processedBody.payload) {
        throw new Error('No Payload specified');
      }

      const data = {
        chain: processedBody.chain,
        wkIdentity: processedBody.wkIdentity,
        action: processedBody.action,
        payload: processedBody.payload,
      };

      const actionOK = await actionService.postAction(data);
      if (!actionOK) {
        throw new Error('Failed to post action data');
      }
      const result = serviceHelper.createDataMessage(actionOK);
      res.json(result);
    } catch (error) {
      log.error(error);
      const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
      res.json(errMessage);
    }
  });
}

module.exports = {
  getAction,
  postAction,
};
