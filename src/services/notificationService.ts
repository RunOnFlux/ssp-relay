import admin, { ServiceAccount } from 'firebase-admin';
import syncService from './syncService';
import log from '../lib/log';
import * as serviceAccount from '../../config/serviceAccountKey.json';
import transactionDecoder from './transactionDecoder';
import blockchains from './blockchains';

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount as ServiceAccount),
});

interface decodedTx {
  amount: string;
  receiver: string;
  token?: string;
  sender?: string;
  fee?: string;
}

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
        const decodedTransaction: decodedTx =
          await transactionDecoder.decodeTransactionForApproval(
            data.payload,
            data.chain,
          );
        body = `A transaction of ${decodedTransaction.amount} ${decodedTransaction.token ? blockchains[data.chain].tokens.find((ttt) => ttt.contract.toLowerCase() === decodedTransaction.token.toLowerCase()).symbol : blockchains[data.chain].symbol} to ${decodedTransaction.receiver} has been initiated on your wallet.`;
      }
    } catch (error) {
      log.error(error);
    }
    for (const sync of syncs) {
      try {
        if (sync.keyToken) {
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
        if (
          typeof error.message === 'string' &&
          error.message.includes === 'not found'
        ) {
          await syncService.deleteToken(sync).catch((er) => log.error(er));
        }
        log.error(error);
      }
    }
  } catch (error) {
    log.error(error);
  }
}

export default {
  sendNotificationKey,
};
