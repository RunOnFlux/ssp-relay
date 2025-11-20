import actionService from '../services/actionService';
import serviceHelper from '../services/serviceHelper';
import notificationService from '../services/notificationService';
import log from '../lib/log';
import socket from '../lib/socket';

interface utxo {
  txid: string;
  vout: number;
  scriptPubKey: string;
  satoshis: string;
  confirmations: number;
  coinbase: boolean;
}
interface actionData {
  chain: string;
  path: string;
  wkIdentity: string;
  action: string;
  payload: string;
  utxos?: utxo[];
}

async function getAction(req, res) {
  try {
    let { id } = req.params;
    id = id || req.query.id; // id is wkIdentity
    if (
      !id ||
      typeof id !== 'string' ||
      id.length > 200 ||
      !/^[a-zA-Z0-9_:-]+$/.test(id)
    ) {
      // send status code 400 and message of invalid id
      res.status(400).send('Invalid ID');
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

async function postAction(req, res) {
  try {
    const processedBody = req.body;
    log.info(processedBody);
    if (
      !processedBody.chain ||
      typeof processedBody.chain !== 'string' ||
      processedBody.chain.length > 200 ||
      !/^[a-zA-Z0-9_:-]+$/.test(processedBody.chain)
    ) {
      throw new Error('Invalid Chain specified');
    }
    if (
      !processedBody.wkIdentity ||
      typeof processedBody.wkIdentity !== 'string' ||
      processedBody.wkIdentity.length > 200 ||
      !/^[a-zA-Z0-9_:-]+$/.test(processedBody.wkIdentity)
    ) {
      throw new Error('Invalid Wallet-Key Identity specified');
    }
    if (
      !processedBody.action ||
      typeof processedBody.action !== 'string' ||
      processedBody.action.length > 200 ||
      !/^[a-zA-Z0-9_:-]+$/.test(processedBody.action)
    ) {
      throw new Error('Invalid Action specified');
    }
    if (
      !processedBody.payload ||
      typeof processedBody.payload !== 'string' ||
      processedBody.payload.length > 1000000
    ) {
      throw new Error('Invalid Payload specified'); // can be large
    }
    if (processedBody.action === 'tx' && !processedBody.path) {
      throw new Error('No Derivation Path specified');
    }

    if (processedBody.path) {
      if (
        typeof processedBody.path !== 'string' ||
        processedBody.path.length > 200 ||
        !/^[a-zA-Z0-9_:-]+$/.test(processedBody.path)
      ) {
        throw new Error('Invalid Derivation Path specified');
      }
    }

    // utxo {
    //   txid: string;
    //   vout: number;
    //   scriptPubKey: string;
    //   satoshis: string;
    //   confirmations: number;
    //   coinbase: boolean;
    // }
    if (processedBody.utxos) {
      // utxos must be an array of utxo objects. Not all fields have to be specified there
      if (!Array.isArray(processedBody.utxos)) {
        throw new Error('Invalid UTXOs specified');
      }
      // utxos must be an array of utxo objects. Not all fields have to be specified there
      processedBody.utxos.forEach((utxo) => {
        if (
          typeof utxo !== 'object' ||
          !utxo.txid ||
          (typeof utxo.vout !== 'number' && typeof utxo.vout !== 'string')
        ) {
          throw new Error('Invalid UTXO specified');
        }
        if (typeof utxo.txid !== 'string' || utxo.txid.length > 200) {
          // mandatory
          throw new Error('Invalid UTXO txid specified');
        }
        if (Number(utxo.vout) > 100000) {
          // mandatory
          throw new Error('Invalid UTXO vout specified');
        }
        if (utxo.scriptPubKey) {
          // optional
          if (
            typeof utxo.scriptPubKey !== 'string' ||
            utxo.scriptPubKey.length > 5000
          ) {
            throw new Error('Invalid UTXO scriptPubKey specified');
          }
        }
        if (utxo.satoshis) {
          // if its false, 0 its alright
          // optional
          if (Number(utxo.satoshis) > 1000000000000000000) {
            throw new Error('Invalid UTXO satoshis specified');
          }
        }
        if (utxo.confirmations) {
          // if its false, 0 its alright
          // optional
          if (Number(utxo.confirmations) > 100000000000) {
            throw new Error('Invalid UTXO confirmations specified');
          }
        }
        if (utxo.coinbase) {
          // if its false, 0 its alright
          // optional
          if (
            typeof utxo.coinbase !== 'boolean' &&
            utxo.coinbase !== 'true' &&
            utxo.coinbase !== 'false' &&
            utxo.coinbase !== '0' &&
            utxo.coinbase !== '1' &&
            utxo.coinbase !== 0 &&
            utxo.coinbase !== 1
          ) {
            throw new Error('Invalid UTXO coinbase specified');
          }
        }
      });
    }

    const data: actionData = {
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

    // SSP Key listens for these actions
    if (
      data.action === 'tx' ||
      data.action === 'publicnoncesrequest' ||
      data.action === 'evmsigningrequest' ||
      data.action === 'wksigningrequest'
    ) {
      const ioKey = socket.getIOKey();
      ioKey.to(data.wkIdentity).emit(data.action, data);
      await notificationService
        .sendNotificationKey(data.wkIdentity, data)
        .catch((error) => log.error(error));
    }

    // SSP Wallet listens for these actions
    if (
      data.action === 'txrejected' ||
      data.action === 'txid' ||
      data.action === 'publicnoncesrejected' ||
      data.action === 'publicnonces' ||
      data.action === 'evmsigningrejected' ||
      data.action === 'evmsigned' ||
      data.action === 'wksigningrejected' ||
      data.action === 'wksigned'
    ) {
      const ioWallet = socket.getIOWallet();
      ioWallet.to(data.wkIdentity).emit(data.action, data);
    }

    res.json(result);
  } catch (error) {
    log.error(error);
    res.sendStatus(400);
  }
}

export default {
  getAction,
  postAction,
};
