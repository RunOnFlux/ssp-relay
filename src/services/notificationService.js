const admin = require('firebase-admin');
const syncService = require('./syncService');
const log = require('../lib/log');
const serviceAccount = require('../../config/serviceAccountKey');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

async function sendNotificationKey(wkIdentity) {
  try {
    const syncs = await syncService.getTokens(wkIdentity);
    // eslint-disable-next-line no-restricted-syntax
    for (const sync of syncs) {
      // eslint-disable-next-line no-await-in-loop
      await admin.messaging().send({
        token: sync.keyToken,
        notification: {
          title: 'Transaction request',
          body: 'A transaction has been initiated on your wallet.',
        },
      });
    }
  } catch (error) {
    log.error(error);
  }
}

module.exports = {
  sendNotificationKey,
};
