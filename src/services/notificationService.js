const admin = require('firebase-admin');
const syncService = require('./syncService');

var serviceAccount = require('../../config/serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

async function sendNotification(wkIdentity) {
  try {
    const sync = await syncService.getSyncByWkIdentity(wkIdentity);
    await admin.messaging().send({
      token: sync.fcmSSPKeyToken,
      notification: {
        title: 'New transaction received',
        body: 'Please confirm or reject if not initiated by you',
      },
    });
  } catch (error) {
    console.log('cannot send the notification to user ', error);
  }
}

module.exports = {
  sendNotification,
};
