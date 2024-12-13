import syncApi from './apiServices/syncApi';
import actionApi from './apiServices/actionApi';
import ratesApi from './apiServices/ratesApi';
import ticketsApi from './apiServices/ticketsApi';
import feeService from './services/networkFeesService';
import tokenApi from './apiServices/tokenApi';
import assetApi from './apiServices/assetApi';

export default (app) => {
  // return sync data
  app.get('/v1/sync/:id?', (req, res) => {
    syncApi.getSync(req, res);
  });
  app.get('/v1/action/:id?', (req, res) => {
    actionApi.getAction(req, res);
  });
  // post sync data
  app.post('/v1/sync', (req, res) => {
    syncApi.postSync(req, res);
  });
  app.post('/v1/token', (req, res) => {
    syncApi.postToken(req, res);
  });
  // post sync data
  app.post('/v1/action', (req, res) => {
    actionApi.postAction(req, res);
  });
  // rates endpoint
  app.get('/v1/rates', (req, res) => {
    ratesApi.getRates(req, res);
  });
  // fees endpoint
  app.get('/v1/networkfees', (req, res) => {
    feeService.networkFees(res);
  });
  // freshdesk ticket
  app.post('/v1/ticket', (req, res) => {
    ticketsApi.postTicket(req, res);
  });
  // get token information endpoint
  app.get('/v1/tokeninfo/:network?/:address?', (req, res) => {
    tokenApi.getTokenInfo(req, res);
  });
  // get fiat assets
  app.get('/v1/assetinfo/assets/fiat', (req, res) => {
    assetApi.getFiatAssets(req, res);
  });
  // get crypto assets
  app.get('/v1/assetinfo/assets/crypto', (req, res) => {
    assetApi.getCryptoAssets(req, res);
  });
  // get asset providers
  app.get('/v1/assetinfo/assets/providers', (req, res) => {
    assetApi.getAssetProviders(req, res);
  });
  // get purchase by id
  app.get('/v1/assetinfo/purchase/id/:purchaseid?', (req, res) => {
    assetApi.getPurchaseDetailsByPurchaseId(req, res);
  });
  // send purchase
  app.get('/v1/assetinfo/purchase/send/:purchaseid?/:providerid?', (req, res) => {
    assetApi.sendPurchase(req, res);
  });
  // get purchase history
  app.get('/v1/assetinfo/purchase/history/:zelid?', (req, res) => {
    assetApi.getAllPurchase(req, res);
  });
  app.post('/v1/assetinfo/purchase/details', (req, res) => {
    assetApi.getAllPurchaseDetails(req, res);
  });
  // send purchase
  app.post('/v1/assetinfo/purchase/details/assets', (req, res) => {
    assetApi.getPurchaseDetailsOnSelectedAsset(req, res);
  });
  // get purchase history
  app.post('/v1/assetinfo/purchase/create/:zelid?', (req, res) => {
    assetApi.createPurchaseDetails(req, res);
  });
  // get purchase history
  app.post('/v1/assetinfo/purchase/status', (req, res) => {
    assetApi.getAllPurchaseStatus(req, res);
  });
};
