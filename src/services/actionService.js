const config = require('config');

const serviceHelper = require('./serviceHelper');

async function getAction(id) {
  const db = await serviceHelper.databaseConnection();
  const database = db.db(config.database.database);
  const actionCollection = config.collections.v1action;
  const query = { wkIdentity: id };
  const projection = {
    projection: {
      _id: 0,
      chain: 1,
      path: 1,
      wkIdentity: 1,
      action: 1,
      payload: 1,
      utxos: 1,
      expireAt: 1,
      createdAt: 1,
    },
  };
  const actionRes = await serviceHelper.findOneInDatabase(
    database,
    actionCollection,
    query,
    projection,
  );
  if (actionRes) {
    return actionRes;
  }
  throw new Error(`Action ${id} not found`);
}

// data is an object of chain, wkIdentity, action, payload
async function postAction(data) {
  const db = await serviceHelper.databaseConnection();
  const database = db.db(config.database.database);
  const actionCollection = config.collections.v1action;
  const query = { wkIdentity: data.wkIdentity };

  const timestamp = new Date().getTime();
  const validTill = timestamp + 15 * 60 * 1000; // 15 minutes

  data.createdAt = new Date(timestamp);
  data.expireAt = new Date(validTill);

  const update = { $set: data };
  const options = {
    upsert: true,
  };
  await serviceHelper.updateOneInDatabase(
    database,
    actionCollection,
    query,
    update,
    options,
  );
  return data; // all ok
}

module.exports = {
  getAction,
  postAction,
};
