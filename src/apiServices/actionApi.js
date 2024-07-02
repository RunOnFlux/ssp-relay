const actionService = require('../services/actionService');
const serviceHelper = require('../services/serviceHelper');
const { sendNotificationKey } = require('../services/notificationService');
const log = require('../lib/log');
const socket = require('../lib/socket');

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
    if (!error.message.includes('testkappa')) {
      log.error(error);
    }
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
      log.info(processedBody);
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
      if (processedBody.action === 'tx' && !processedBody.path) {
        throw new Error('No Derivation Path specified');
      }

      const data = {
        chain: processedBody.chain,
        path: processedBody.path,
        wkIdentity: processedBody.wkIdentity,
        action: processedBody.action,
        payload: processedBody.payload,
      };

      if (processedBody.utxos) {
        data.utxos = processedBody.utxos;
      }

      const actionOK = await actionService.postAction(data);
      if (!actionOK) {
        throw new Error('Failed to post action data');
      }
      const result = serviceHelper.createDataMessage(actionOK);

      // ssp-key listens for tx action
      if (data.action === 'tx' || data.action === 'publicnoncesrequest') {
        const ioKey = socket.getIOKey();
        ioKey.to(data.wkIdentity).emit(data.action, data);
        await sendNotificationKey(data.wkIdentity, data).catch((error) => log.error(error));
      }
      // ssp-wallet listens for txid and txrejected actions
      if (data.action === 'txrejected' || data.action === 'txid' || data.action === 'publicnoncesrejected' || data.action === 'publicnonces') {
        const ioWallet = socket.getIOWallet();
        ioWallet.to(data.wkIdentity).emit(data.action, data);
      }

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
