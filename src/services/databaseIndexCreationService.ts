const config = require('config');

const serviceHelper = require('./serviceHelper');
const log = require('../lib/log');

async function doIndexes() {
  try {
    log.info('Creating collection indexes');
    const db = await serviceHelper.databaseConnection();
    const database = db.db(config.database.database);

    await database
      .collection(config.collections.v1sync)
      .createIndex({ walletIdentity: 1 }); // for querying paritcular id
    await database
      .collection(config.collections.v1sync)
      .createIndex({ createdAt: 1 }, { expireAfterSeconds: 900 });
    await database
      .collection(config.collections.v1action)
      .createIndex({ wkIdentity: 1 }); // for querying paritcular id
    await database
      .collection(config.collections.v1action)
      .createIndex({ createdAt: 1 }, { expireAfterSeconds: 900 });
    await database
      .collection(config.collections.v1token)
      .createIndex({ wkIdentity: 1 }); // for querying paritcular id
    await database
      .collection(config.collections.v1token)
      .createIndex({ keyToken: 1 }); // for querying paritcular token

    log.info('Collection indexes created.');
  } catch (error) {
    log.error(error); // failiure is ok, continue
  }
}

module.exports = {
  doIndexes,
};
