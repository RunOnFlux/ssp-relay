const admin = require('firebase-admin');
const syncService = require('./syncService');
const log = require('../lib/log');
const serviceAccount = require('../../config/serviceAccountKey');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

async function sendNotificationKey(wkIdentity) {
  try {
    const sync = await syncService.getToken(wkIdentity);
    await admin.messaging().send({
      token: sync.tokenKey,
      notification: {
        title: 'Transaction request',
        body: 'A transaction has been initiated on your wallet.',
      },
    });
  } catch (error) {
    log.error(error);
  }
}

module.exports = {
  sendNotificationKey,
};
