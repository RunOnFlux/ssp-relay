import syncApi from './apiServices/syncApi';
import actionApi from './apiServices/actionApi';
import ratesApi from './apiServices/ratesApi';
import ticketsApi from './apiServices/ticketsApi';
import feeService from './services/networkFeesService';
import tokenApi from './apiServices/tokenApi';

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
  // get key endpoint
  app.get('/v1/tokeninfo/:network/:address', (req, res) => {
    tokenApi.getTokenInfo(req, res);
  });
};
