const config = require('config');

const serviceHelper = require('./serviceHelper');
const log = require('../lib/log');

async function doSyncIndexes() {
  try {
    log.info('Sync collection indexes');
    const db = await serviceHelper.databaseConnection();
    const database = db.db(config.database.database);

    await database.collection(config.collections.v1sync).createIndex({ walletIdentity: 1 }); // for querying paritcular id
    await database.collection(config.collections.v1sync).createIndex({ createdAt: 1 }, { expireAfterSeconds: 900 });

    log.info('Sync collection indexes created.');
  } catch (error) {
    log.error(error); // failiure is ok, continue
  }
}

module.exports = {
  doSyncIndexes,
};
