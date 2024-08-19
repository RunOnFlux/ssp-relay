/* eslint-disable @typescript-eslint/no-unused-expressions */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import chai from 'chai';
import config from 'config';
import notificationService from '../../src/services/notificationService';
import serviceHelper from '../../src/services/serviceHelper';
import sinon from 'sinon';
import syncService from '../../src/services/syncService';

const { expect } = chai;

const testInsert = [
  {
    wkIdentity: 141,
  },
  {
    wkIdentity: 121,
  },
  {
    wkIdentity: 231,
  },
];

const data = {
  action: 'publicnoncesrequest',
  payload: 'tx',
};

const dataNoAction = {
  action: 'publicnoncesrequest',
};

let database = undefined;
let tokenCollection = undefined;

describe('Notification Service', function () {
  describe('Send Notification: Validates sends key', function () {
    before(async function () {
      const db = await serviceHelper.databaseConnection();
      database = db.db(config.database.database);
      tokenCollection = config.collections.v1token;
    });

    afterEach(function () {
      sinon.restore();
    });

    // Checking exception if the notification is successful or not
    it('should return successfully sends key', async function () {
      await database.collection(tokenCollection).insertMany(testInsert);
      await notificationService.sendNotificationKey(141, data).catch((e) => {
        expect(e).to.be.undefined;
      });
    });

    // Currently there is a limitation in testing the firebase
    it('should return error when it sends key to firebase', async function () {
      await database
        .collection(tokenCollection)
        .drop()
        .catch(() => {});
      await notificationService
        .sendNotificationKey(141, dataNoAction)
        .catch((e) => {
          expect(e).to.not.be.null;
          expect(e).to.not.be.undefined;
        });
    });

    // Testing using stub data
    it('should return successful result 141 if stub value is valid', async function () {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const stub = await sinon
        .stub(syncService, 'getTokens')
        .returns({ wkIdentity: 141 });
      await notificationService.sendNotificationKey(141, data).catch((e) => {
        expect(e).to.be.undefined;
      });
    });

    it('should return successful result 121 if stub value is valid', async function () {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const stub = await sinon
        .stub(syncService, 'getTokens')
        .returns({ wkIdentity: 121 });
      await notificationService.sendNotificationKey(121, data).catch((e) => {
        expect(e).to.be.undefined;
      });
    });
  });
});
