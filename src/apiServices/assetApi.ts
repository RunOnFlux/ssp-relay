import log from '../lib/log';
import { 
  showFiatAssets,
  showCryptoAssets,
  getPurchaseDetailByPurchaseId,
  submitPurchase,
  getPurchaseHistory,
  getPurchaseDetails,
  getPurchaseDetailsSelectedAsset,
  createPurchase,
  getPurchaseStatus,
  getProviders
} from '../services/assetService';

async function getFiatAssets(req, res) {
  try {
    const value = await showFiatAssets();
    res.json(value);
  } catch (error) {
    log.error(error);
    res.sendStatus(404);
  }
}

async function getCryptoAssets(req, res) {
  try {
    const value = await showCryptoAssets();
    res.json(value);
  } catch (error) {
    log.error(error);
    res.sendStatus(404);
  }
}

async function getAssetProviders(req, res) {
  try {
    const value = await getProviders();
    res.json(value);
  } catch (error) {
    log.error(error);
    res.sendStatus(404);
  }
}

async function getPurchaseDetailsByPurchaseId(req, res) {
  try {
    let { purchaseid } = req.params;
    purchaseid = purchaseid ?? req.query.purchaseid;
    const value = await getPurchaseDetailByPurchaseId(purchaseid);
    res.json(value);
  } catch (error) {
    log.error(error);
    res.sendStatus(404);
  }
}

async function sendPurchase(req, res) {
  try {
    let { purchaseid } = req.params;
    purchaseid = purchaseid ?? req.query.purchaseid;

    let { providerid } = req.params;
    providerid = providerid ?? req.query.providerid;

    const value = await submitPurchase(purchaseid, providerid);
    res.json(value);
  } catch (error) {
    log.error(error);
    res.sendStatus(404);
  }
}

async function getAllPurchase(req, res) {
  try {
    let { zelid } = req.params;
    zelid = zelid ?? req.query.zelid;

    const value = await getPurchaseHistory(zelid);
    res.json(value);
  } catch (error) {
    log.error(error);
    res.sendStatus(404);
  }
}

async function getAllPurchaseDetails(req, res) {
  try {
    let body = '';
    await req.on('data', (data) => {
      body += data;
    });
    const value = await getPurchaseDetails(body);
    res.json(value);
  } catch (error) {
    log.error(error);
    res.sendStatus(404);
  }
}

async function getPurchaseDetailsOnSelectedAsset(req, res) {
  try {
    let body = '';
    await req.on('data', (data) => {
      body += data;
    });
    const value = await getPurchaseDetailsSelectedAsset(body);
    res.json(value);
  } catch (error) {
    log.error(error);
    res.sendStatus(404);
  }
}

async function createPurchaseDetails(req, res) {
  try {
    let body = '';
    await req.on('data', (data) => {
      body += data;
    });

    let { zelid } = req.params;
    zelid = zelid ?? req.query.zelid;

    const value = await createPurchase(body, zelid);
    res.json(value);
  } catch (error) {
    log.error(error);
    res.sendStatus(404);
  }
}

async function getAllPurchaseStatus(req, res) {
  try {
    let body = '';
    await req.on('data', (data) => {
      body += data;
    });
    const value = await getPurchaseStatus(body);
    res.json(value);
  } catch (error) {
    log.error(error);
    res.sendStatus(404);
  }
}


export default {
  getFiatAssets,
  getCryptoAssets,
  getPurchaseDetailsByPurchaseId,
  sendPurchase,
  getAllPurchase,
  getAllPurchaseDetails,
  getPurchaseDetailsOnSelectedAsset,
  createPurchaseDetails,
  getAllPurchaseStatus,
  getAssetProviders
}