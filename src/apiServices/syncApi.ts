import syncService from '../services/syncService';
import serviceHelper from '../services/serviceHelper';
import log from '../lib/log';
import { stripAuthFields } from '../middleware/authMiddleware';

interface syncData {
  chain: string;
  walletIdentity: string;
  keyXpub: string;
  wkIdentity: string;
  generatedAddress?: string;
  publicNonces?: string[];
}

async function getSync(req, res) {
  try {
    let { id } = req.params;
    id = id || req.query.id; // id is walletIdentity
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

async function postSync(req, res) {
  try {
    // Strip auth fields before processing
    const processedBody = stripAuthFields(req.body);
    if (
      !processedBody.chain ||
      typeof processedBody.chain !== 'string' ||
      processedBody.chain.length > 200 ||
      !/^[a-zA-Z0-9_:-]+$/.test(processedBody.chain)
    ) {
      throw new Error('Invalid Chain specified');
    }
    if (
      !processedBody.walletIdentity ||
      typeof processedBody.walletIdentity !== 'string' ||
      processedBody.walletIdentity.length > 200 ||
      !/^[a-zA-Z0-9_:-]+$/.test(processedBody.walletIdentity)
    ) {
      throw new Error('Invalid Wallet identity specified');
    }
    if (
      !processedBody.keyXpub ||
      typeof processedBody.keyXpub !== 'string' ||
      processedBody.keyXpub.length > 200 ||
      !/^[a-zA-Z0-9_:-]+$/.test(processedBody.keyXpub)
    ) {
      throw new Error('Invalid XPUB of Key specified');
    }
    if (
      !processedBody.wkIdentity ||
      typeof processedBody.wkIdentity !== 'string' ||
      processedBody.wkIdentity.length > 200 ||
      !/^[a-zA-Z0-9_:-]+$/.test(processedBody.wkIdentity)
    ) {
      throw new Error('Invalid SSP Identity specified');
    }

    // validations
    // generated address
    if (
      processedBody.generatedAddress &&
      typeof processedBody.generatedAddress !== 'string'
    ) {
      throw new Error('Invalid generated address');
    }

    if (
      processedBody.generatedAddress &&
      (processedBody.generatedAddress.length > 200 ||
        !/^[a-zA-Z0-9_:-]+$/.test(processedBody.generatedAddress))
    ) {
      throw new Error('Generated address is invalid');
    }

    // public nonces
    if (
      processedBody.publicNonces &&
      !Array.isArray(processedBody.publicNonces)
    ) {
      throw new Error('Invalid public nonces');
    }

    if (processedBody.publicNonces && processedBody.publicNonces.length > 0) {
      processedBody.publicNonces.forEach((nonce) => {
        // nonce is object containing kPublic and kTwoPublic
        if (
          typeof nonce !== 'object' ||
          typeof nonce.kPublic !== 'string' ||
          typeof nonce.kTwoPublic !== 'string'
        ) {
          throw new Error('Invalid public nonce detected');
        }

        if (nonce.kPublic.length > 200 || nonce.kTwoPublic.length > 200) {
          throw new Error('Public nonce is too long');
        }
      });
    }

    // too many nonces
    if (
      processedBody.publicNonces &&
      processedBody.publicNonces.length > 1000
    ) {
      throw new Error('Too many public nonces submitted');
    }

    const data: syncData = {
      chain: processedBody.chain,
      walletIdentity: processedBody.walletIdentity,
      keyXpub: processedBody.keyXpub,
      wkIdentity: processedBody.wkIdentity,
      generatedAddress: processedBody.generatedAddress, // this is the address generated on the key that must match the address on the wallet, this is optional, verification is done on the wallet
    };

    // EVM sync
    if (processedBody.publicNonces && processedBody.publicNonces.length > 0) {
      data.publicNonces = processedBody.publicNonces;
    }

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
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code,
    );
    res.json(errMessage);
  }
}

async function postToken(req, res) {
  try {
    // Strip auth fields before processing
    const processedBody = stripAuthFields(req.body);
    if (
      !processedBody.wkIdentity ||
      typeof processedBody.wkIdentity !== 'string' ||
      processedBody.wkIdentity.length > 200 ||
      !/^[a-zA-Z0-9_:-]+$/.test(processedBody.wkIdentity)
    ) {
      throw new Error('Invalid SSP identity specified');
    }

    if (
      !processedBody.keyToken ||
      typeof processedBody.keyToken !== 'string' ||
      processedBody.keyToken.length > 5000
    ) {
      throw new Error('Invalid SSP Key Token specified');
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
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code,
    );
    res.json(errMessage);
  }
}

export default {
  getSync,
  postSync,
  postToken,
};
