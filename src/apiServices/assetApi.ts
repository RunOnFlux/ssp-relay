import log from '../lib/log';
import { 
  showFiatAssets,
  showCryptoAssets,
  getPurchaseDetailByPurchaseId,
  submitPurchase,
  getPurchaseHistory
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

export default {
  getFiatAssets,
  getCryptoAssets,
  getPurchaseDetailsByPurchaseId,
  sendPurchase,
  getAllPurchase
}