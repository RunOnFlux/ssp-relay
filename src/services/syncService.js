const config = require('config');

const serviceHelper = require('./serviceHelper');

async function getSync(id) {
  const db = await serviceHelper.databaseConnection();
  const database = db.db(config.database.database);
  const syncCollection = config.collections.v1sync;
  const query = { walletIdentity: id };
  const projection = {
    projection: {
      _id: 0,
      chain: 1,
      walletIdentity: 1,
      keyXpub: 1,
      wkIdentity: 1,
    },
  };
  const syncRes = await serviceHelper.findOneInDatabase(database, syncCollection, query, projection);
  if (syncRes) {
    return syncRes;
  }
  throw new Error(`Sync ${id} not found`);
}

// data is an object of chain, walletIdentity, keyXpub, wkIdentity
async function postSync(data) {
  const db = await serviceHelper.databaseConnection();
  const database = db.db(config.database.database);
  const syncCollection = config.collections.v1sync;
  const query = { walletIdentity: data.walletIdentity };

  const timestamp = new Date().getTime();
  const validTill = timestamp + (15 * 60 * 1000); // 15 minutes

  // eslint-disable-next-line no-param-reassign
  data.createdAt = new Date(timestamp);
  // eslint-disable-next-line no-param-reassign
  data.expireAt = new Date(validTill);

  const update = { $set: data };
  const options = {
    upsert: true,
  };
  await serviceHelper.updateOneInDatabase(database, syncCollection, query, update, options);
  return data; // all ok
}

async function getToken(id) {
  const db = await serviceHelper.databaseConnection();
  const database = db.db(config.database.database);
  const tokenCollection = config.collections.v1token;
  const query = { wkIdentity: id };
  const projection = {
    projection: {
      _id: 0,
      wkIdentity: 1,
      keyToken: 1,
      walletToken: 1,
    },
  };
  const syncRes = await serviceHelper.findOneInDatabase(database, tokenCollection, query, projection);
  if (syncRes) {
    return syncRes;
  }
  throw new Error(`Sync ${id} not found`);
}

// data is an object of walletKeyIdentity, keyToken, walletToken
async function postToken(data) {
  const db = await serviceHelper.databaseConnection();
  const database = db.db(config.database.database);
  const tokenCollection = config.collections.v1token;
  const query = { wkIdentity: data.wkIdentity };

  const update = { $set: data };
  const options = {
    upsert: true,
  };
  await serviceHelper.updateOneInDatabase(database, tokenCollection, query, update, options);
  return data; // all ok
}

module.exports = {
  getSync,
  getToken,
  postSync,
  postToken,
};
