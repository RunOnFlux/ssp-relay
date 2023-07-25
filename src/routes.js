const syncApi = require('./apiServices/syncApi');

module.exports = (app) => {
  // return sync data
  app.get('/v1/sync/:id?', (req, res) => {
    syncApi.getSync(req, res);
  });
  // post sync data
  app.post('/v1/sync', (req, res) => {
    syncApi.postSync(req, res);
  });
};
