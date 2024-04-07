const syncService = require('../services/syncService');
const serviceHelper = require('../services/serviceHelper');
const log = require('../lib/log');

async function getSync(req, res) {
  try {
    let { id } = req.params;
    id = id || req.query.id; // id is walletIdentity
    if (!id) {
      res.sendStatus(400);
      return;
    }
    const syncExist = await syncService.getSync(id);
    if (!syncExist) {
      throw new Error(`Sync of ${id} does not exist`);
    }
    res.json(syncExist);
  } catch (error) {
    if (!error.message.includes('testkappa')) {
      log.error(error);
    }
    res.sendStatus(404);
  }
}

function postSync(req, res) {
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
      if (!processedBody.walletIdentity) {
        throw new Error('No Wallet identity specified');
      }
      if (!processedBody.keyXpub) {
        throw new Error('No XPUB of Key specified');
      }
      if (!processedBody.wkIdentity) {
        throw new Error('No SSP Identity specified');
      }

      const data = {
        chain: processedBody.chain,
        walletIdentity: processedBody.walletIdentity,
        keyXpub: processedBody.keyXpub,
        wkIdentity: processedBody.wkIdentity,
      };

      const tokenData = {
        wkIdentity: processedBody.wkIdentity,
        keyToken: processedBody.keyToken,
      };

      const syncOK = await syncService.postSync(data);
      await syncService.postToken(tokenData).catch((error) => log.error(error)); // we do not need to fail if this fails
      if (!syncOK) {
        throw new Error('Failed to update synchronisation data');
      }
      const result = serviceHelper.createDataMessage(syncOK);
      res.json(result);
    } catch (error) {
      log.error(error);
      const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
      res.json(errMessage);
    }
  });
}

function postToken(req, res) {
  let body = '';
  req.on('data', (data) => {
    body += data;
  });
  req.on('end', async () => {
    try {
      const processedBody = serviceHelper.ensureObject(body);
      if (!processedBody.wkIdentity) {
        throw new Error('No SSP identity specified');
      }

      if (!processedBody.keyToken) {
        throw new Error('No SSP Key Token specified');
      }

      const tokenData = {
        wkIdentity: processedBody.wkIdentity,
        keyToken: processedBody.keyToken,
      };

      const syncOK = await syncService.postToken(tokenData);
      if (!syncOK) {
        throw new Error('Failed to update synced data');
      }
      const result = serviceHelper.createDataMessage(syncOK);
      res.json(result);
    } catch (error) {
      log.error(error);
      const errMessage = serviceHelper.createErrorMessage(error.message, error.name, error.code);
      res.json(errMessage);
    }
  });
}

module.exports = {
  getSync,
  postSync,
  postToken,
};
