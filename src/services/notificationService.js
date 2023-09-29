const admin = require('firebase-admin');
const syncService = require('./syncService');
const log = require('../lib/log');
const serviceAccount = require('../../config/serviceAccountKey');
const transactionDecoder = require('./transactionDecoder');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

async function sendNotificationKey(wkIdentity, data) {
  try {
    const syncs = await syncService.getTokens(wkIdentity);
    const title = 'Transaction request';
    let body = 'A transaction has been initiated on your wallet.';
    if (data.payload && data.action === 'tx') {
      const decodedTransaction = transactionDecoder.decodeTransactionForApproval(
        data.payload,
        data.chain,
      );
      body = `A transaction of ${decodedTransaction.amount} ${data.chain.toUpperCase()} to ${decodedTransaction.receiver} has been initiated on your wallet.`;
    }
    // eslint-disable-next-line no-restricted-syntax
    for (const sync of syncs) {
      if (sync.keyToken) {
        // eslint-disable-next-line no-await-in-loop
        await admin.messaging().send({
          token: sync.keyToken,
          notification: {
            title,
            body,
          },
        });
      }
    }
  } catch (error) {
    log.error(error);
  }
}

module.exports = {
  sendNotificationKey,
};
