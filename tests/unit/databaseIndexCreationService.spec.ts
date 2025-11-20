/* eslint-disable @typescript-eslint/no-unused-expressions */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect } from 'chai';
import config from 'config';
import databaseIndexCreationService from '../../src/services/databaseIndexCreationService';
import serviceHelper from '../../src/services/serviceHelper';

const testInsertV1action = [
  {
    createdAt: 1,
    wkIdentity: 1,
  },
];

const testInsertV1token = [
  {
    wkIdentity: 1,
    keyToken: 1,
  },
];

const testInsertV1sync = [
  {
    createdAt: 1,
    walletIdentity: 1,
  },
];

let database = undefined;

describe('Database Index Creation Service', function () {
  describe('Do Index: Correctly verifies index', function () {
    before(async function () {
      const db = await serviceHelper.databaseConnection();
      database = db.db(config.database.database);
    });

    it('should return when collection v1action index initialized', async function () {
      const v1action = config.collections.v1action;
      await database.collection(v1action).insertMany(testInsertV1action);
      await databaseIndexCreationService.doIndexes();

      const projection = {
        projection: {
          _id: 0,
          wkIdentity: 1,
          createdAt: 1,
        },
      };

      await serviceHelper
        .findOneInDatabase(database, v1action, { wkIdentity: 1 }, projection)
        .then((r) => {
          expect(r).to.have.property('createdAt');
          expect(r).to.have.property('wkIdentity');
          expect(r.createdAt).to.not.be.null;
          expect(r.createdAt).to.not.be.undefined;
          expect(r.wkIdentity).to.not.be.null;
          expect(r.wkIdentity).to.not.be.undefined;
          expect(r).to.deep.equal({ createdAt: 1, wkIdentity: 1 });
        });
    });

    it('should return when collection v1token index initialized', async function () {
      const v1token = config.collections.v1token;
      await database.collection(v1token).insertMany(testInsertV1token);
      await databaseIndexCreationService.doIndexes();

      const projection = {
        projection: {
          _id: 0,
          wkIdentity: 1,
          keyToken: 1,
        },
      };

      await serviceHelper
        .findOneInDatabase(database, v1token, { wkIdentity: 1 }, projection)
        .then((r) => {
          expect(r).to.have.property('keyToken');
          expect(r).to.have.property('wkIdentity');
          expect(r.keyToken).to.not.be.null;
          expect(r.keyToken).to.not.be.undefined;
          expect(r.wkIdentity).to.not.be.null;
          expect(r.wkIdentity).to.not.be.undefined;
          expect(r).to.deep.equal({ keyToken: 1, wkIdentity: 1 });
        });
    });

    it('should return when collection v1sync index initialized', async function () {
      const v1sync = config.collections.v1sync;
      await database.collection(v1sync).insertMany(testInsertV1sync);
      await databaseIndexCreationService.doIndexes();

      const projection = {
        projection: {
          _id: 0,
          walletIdentity: 1,
          createdAt: 1,
        },
      };

      await serviceHelper
        .findOneInDatabase(database, v1sync, { walletIdentity: 1 }, projection)
        .then((r) => {
          expect(r).to.have.property('createdAt');
          expect(r).to.have.property('walletIdentity');
          expect(r.createdAt).to.not.be.null;
          expect(r.createdAt).to.not.be.undefined;
          expect(r.walletIdentity).to.not.be.null;
          expect(r.walletIdentity).to.not.be.undefined;
          expect(r).to.deep.equal({ createdAt: 1, walletIdentity: 1 });
        });
    });
  });
});
