import config from 'config';

import serviceHelper from './serviceHelper';

// Stores SSP Key's recovery account xpub for a wkIdentity, so SSP Wallet can
// fetch it whenever it needs one rather than only while both apps happen to be
// awake. Persistent by design — unlike v1sync/v1action there is no TTL index on
// this collection (see databaseIndexCreationService).
//
// Everything held here is public: an account-level xpub plus the detached
// signature SSP Key made over it. The wallet verifies that signature against
// the identity pubkey it derives itself, so this store is not trusted.

async function getRecoveryPub(id) {
  const db = await serviceHelper.databaseConnection();
  const database = db.db(config.database.database);
  const collection = config.collections.v1recoverypub;
  const query = { wkIdentity: id };
  const projection = {
    projection: {
      _id: 0,
      wkIdentity: 1,
      recoveryXpub: 1,
      xpubSignature: 1,
      chain: 1,
      createdAt: 1,
    },
  };
  const res = await serviceHelper.findOneInDatabase(
    database,
    collection,
    query,
    projection,
  );
  if (res) {
    return res;
  }
  throw new Error(`Recovery pub of ${id} not found`);
}

// data is an object of wkIdentity, recoveryXpub, xpubSignature, chain
async function postRecoveryPub(data) {
  const db = await serviceHelper.databaseConnection();
  const database = db.db(config.database.database);
  const collection = config.collections.v1recoverypub;
  const query = { wkIdentity: data.wkIdentity };

  const newData = {
    wkIdentity: data.wkIdentity,
    recoveryXpub: data.recoveryXpub,
    xpubSignature: data.xpubSignature,
    chain: data.chain,
    createdAt: new Date(),
  };

  const update = { $set: newData };
  const options = {
    upsert: true,
  };
  await serviceHelper.updateOneInDatabase(
    database,
    collection,
    query,
    update,
    options,
  );
  return newData;
}

export default {
  getRecoveryPub,
  postRecoveryPub,
};
