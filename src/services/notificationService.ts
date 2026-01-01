import admin, { ServiceAccount } from 'firebase-admin';
import syncService from './syncService';
import log from '../lib/log';
import serviceAccount from '../../config/serviceAccountKey.json';
import transactionDecoder from './transactionDecoder';
import blockchains from './blockchains';

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount as ServiceAccount),
});

interface decodedTx {
  amount: string;
  receiver: string;
  tokenSymbol?: string;
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
    } else if (data.action === 'evmsigningrequest') {
      title = 'EVM Signing Request';
      body = 'An EVM signing request has been initiated on your wallet.';
    } else if (data.action === 'wksigningrequest') {
      title = 'SSP Authentication';
      body = 'A website is requesting your approval to authenticate.';
    }
    try {
      if (data.payload && data.action === 'tx') {
        const decodedTransaction: decodedTx =
          await transactionDecoder.decodeTransactionForApproval(
            data.payload,
            data.chain,
          );
        body = `A transaction of ${decodedTransaction.amount} ${decodedTransaction.token ? decodedTransaction.tokenSymbol : blockchains[data.chain].symbol} to ${decodedTransaction.receiver} has been initiated on your wallet.`;
      }
    } catch (error) {
      log.error(error);
    }

    // Prepare messages for batch sending
    const validTokens = syncs
      .filter((sync) => sync.keyToken)
      .map((sync) => sync.keyToken);

    if (validTokens.length === 0) {
      return;
    }

    // Use Firebase batch messaging API
    const messages = validTokens.map((token) => ({
      token,
      notification: {
        title,
        body,
      },
    }));

    try {
      const batchResponse = await admin.messaging().sendEach(messages);

      // Handle failed messages and clean up invalid tokens
      if (batchResponse.failureCount > 0) {
        const tokensToDelete = [];

        batchResponse.responses.forEach((response, index) => {
          if (!response.success && response.error) {
            const errorCode = response.error.code;
            // Remove tokens that are invalid or not registered
            if (
              errorCode === 'messaging/invalid-registration-token' ||
              errorCode === 'messaging/registration-token-not-registered'
            ) {
              tokensToDelete.push(syncs[index]);
            }
            log.error({
              message: 'Failed to send notification',
              error: response.error,
              token: validTokens[index],
            });
          }
        });

        // Clean up invalid tokens from database
        for (const sync of tokensToDelete) {
          await syncService.deleteToken(sync).catch((er) => log.error(er));
        }
      }

      log.info({
        message: 'Batch notification sent',
        successCount: batchResponse.successCount,
        failureCount: batchResponse.failureCount,
        totalTokens: validTokens.length,
      });
    } catch (error) {
      log.error({
        message: 'Failed to send batch notifications',
        error,
        wkIdentity,
      });
    }
  } catch (error) {
    log.error(error);
  }
}

export default {
  sendNotificationKey,
};
