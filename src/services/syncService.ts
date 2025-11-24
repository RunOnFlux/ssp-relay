import config from 'config';

import serviceHelper from './serviceHelper';
import log from '../lib/log';

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
      publicNonces: 1,
      generatedAddress: 1,
    },
  };
  const syncRes = await serviceHelper.findOneInDatabase(
    database,
    syncCollection,
    query,
    projection,
  );
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
  const validTill = timestamp + 15 * 60 * 1000; // 15 minutes

  data.createdAt = new Date(timestamp);
  data.expireAt = new Date(validTill);

  const update = { $set: data };
  const options = {
    upsert: true,
  };
  await serviceHelper.updateOneInDatabase(
    database,
    syncCollection,
    query,
    update,
    options,
  );
  return data; // all ok
}

async function getTokens(id) {
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
  const syncRes = await serviceHelper.findInDatabase(
    database,
    tokenCollection,
    query,
    projection,
  );
  if (syncRes.length) {
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
  const projection = {
    projection: {
      _id: 0,
      wkIdentity: 1,
      keyToken: 1,
      walletToken: 1,
      createdAt: 1,
    },
  };
  if (data.keyToken && typeof data.keyToken !== 'string') {
    throw new Error('Invalid keyToken type');
  }
  if (data.walletToken && typeof data.walletToken !== 'string') {
    throw new Error('Invalid walletToken type');
  }
  if (data.wkIdentity && typeof data.wkIdentity !== 'string') {
    throw new Error('Invalid wkIdentity type');
  }

  const newData = {
    wkIdentity: data.wkIdentity,
    keyToken: data.keyToken,
    walletToken: data.walletToken,
    createdAt: new Date(),
  };
  // a token can be associated ONLY with one wkIdentity
  const queryTokens = { keyToken: String(newData.keyToken) };
  const existingTokens = await serviceHelper.findInDatabase(
    database,
    tokenCollection,
    queryTokens,
    projection,
  );
  if (existingTokens.length > 1) {
    try {
      await serviceHelper.removeDocumentsFromCollection(
        database,
        tokenCollection,
        queryTokens,
      );
    } catch (error) {
      log.error({
        message: 'Failed to bulk delete duplicate tokens',
        error,
        keyToken: newData.keyToken,
      });
    }
  }
  const existingRecords = await serviceHelper.findInDatabase(
    database,
    tokenCollection,
    query,
    projection,
  );
  if (existingRecords.length > 0) {
    for (const existingRecord of existingRecords) {
      // sync ALWAYS has a keyToken OR a walletToken
      if (newData.keyToken) {
        if (existingRecord.keyToken === newData.keyToken) {
          return existingRecord; // already exists
        }
      }
      if (newData.walletToken) {
        if (existingRecord.walletToken === newData.walletToken) {
          return existingRecord; // already exists
        }
      }
    }
  }
  if (existingRecords.length > 100) {
    // we do not want to store more than 100 tokens for wkIdentity
    throw new Error(
      `More than 100 tokens for ${data.wkIdentity} found, not storing new one`,
    );
  }
  // update this existing record for this wkIdentity
  const update = { $set: newData };
  const options = {
    upsert: true,
  };
  await serviceHelper.updateOneInDatabase(
    database,
    tokenCollection,
    queryTokens,
    update,
    options,
  );
  return data; // all ok
}

async function deleteToken(sync) {
  const db = await serviceHelper.databaseConnection();
  const database = db.db(config.database.database);
  const tokenCollection = config.collections.v1token;
  await serviceHelper.findOneAndDeleteInDatabase(
    database,
    tokenCollection,
    sync,
  );
}
export default {
  getSync,
  getTokens,
  postSync,
  postToken,
  deleteToken,
};
