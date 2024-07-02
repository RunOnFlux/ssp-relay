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
    let title = 'Transaction Request';
    let body = 'A transaction has been initiated on your wallet.';
    if (data.action === 'publicnoncesrequest') {
      title = 'Public Nonces Request';
      body = 'Your Wallet is requesting public nonces synchronisation.';
    }
    try {
      if (data.payload && data.action === 'tx') {
        const decodedTransaction = transactionDecoder.decodeTransactionForApproval(
          data.payload,
          data.chain,
        );
        body = `A transaction of ${decodedTransaction.amount} ${data.chain.toUpperCase()} to ${decodedTransaction.receiver} has been initiated on your wallet.`;
      }
    } catch (error) {
      log.error(error);
    }
    // eslint-disable-next-line no-restricted-syntax
    for (const sync of syncs) {
      try {
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
      } catch (error) {
        // delete this from database
        if (typeof error.message === 'string' && error.message.includes === 'not found') {
          // eslint-disable-next-line no-await-in-loop
          await syncService.deleteToken(sync).catch((er) => log.error(er));
        }
        log.error(error);
      }
    }
  } catch (error) {
    log.error(error);
  }
}

module.exports = {
  sendNotificationKey,
};
