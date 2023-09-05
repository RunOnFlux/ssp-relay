const syncApi = require('./apiServices/syncApi');
const actionApi = require('./apiServices/actionApi');
const ratesApi = require('./apiServices/ratesApi');

module.exports = (app) => {
  // return sync data
  app.get('/v1/sync/:id?', (req, res) => {
    syncApi.getSync(req, res);
  });
  app.get('/v1/action/:id?', (req, res) => {
    actionApi.getAction(req, res);
  });
  app.get('/v1/token/:id?', (req, res) => {
    syncApi.getToken(req, res);
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
};
