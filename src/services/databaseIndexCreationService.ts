import config from 'config';

import serviceHelper from './serviceHelper';
import enterpriseHooks from './enterpriseHooks';
import ratesService from './ratesService';
import log from '../lib/log';

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
    await database
      .collection(config.collections.v1recoverypub)
      .createIndex({ wkIdentity: 1 }, { unique: true }); // one per identity, no expiry

    // TRON sponsor. Own try/catch so a failure here can never skip the
    // enterprise hook initialisation below.
    try {
      const tronOps = database.collection(config.collections.tronSponsorOps);
      // Audit data: NO TTL. The unique digest index is also the broadcast
      // dedupe lock (one sponsored transaction per signed Op).
      await tronOps.createIndex({ digest: 1 }, { unique: true });
      await tronOps.createIndex({ vault: 1, createdAt: -1 });
      await tronOps.createIndex({ status: 1 });
      const tronReservations = database.collection(
        config.collections.tronNonceReservations,
      );
      // Quote nonce reservations live until the quoted Op's deadline.
      await tronReservations.createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0 },
      );
      await tronReservations.createIndex(
        { chain: 1, vault: 1, nonce: 1 },
        { unique: true },
      );
    } catch (error) {
      log.error(error);
    }

    // Initialize enterprise hooks (loads enterprise module if installed)
    await enterpriseHooks.init({
      db: database,
      config,
      ratesService,
      coingeckoApiKey: (config as { keys?: { coingecko?: string } }).keys
        ?.coingecko,
    });

    log.info('Collection indexes created.');
  } catch (error) {
    log.error(error); // failiure is ok, continue
  }
}

export default {
  doIndexes,
};
