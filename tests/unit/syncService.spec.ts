/* eslint-disable @typescript-eslint/no-unused-expressions */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import chai from 'chai';
import config from 'config';
import syncService from '../../src/services/syncService';
import serviceHelper from '../../src/services/serviceHelper';

const { expect, assert } = chai;

const testInsertV1Sync = [
  {
    walletIdentity: 141
  },
  {
    walletIdentity: 121
  },
  {
    walletIdentity: 231
  },
];

const testInsertV1Tokens = [
    {
      wkIdentity: 141
    },
    {
      wkIdentity: 121
    },
    {
      wkIdentity: 231
    },
];

var database = undefined;
var syncCollection = undefined;
var tokenCollection = undefined;

describe('Sync Service', () => {
  describe('Get Sync: Correctly verifies get sync', () => {
    before(async () => {
      const db = await serviceHelper.databaseConnection();
      database = db.db(config.database.database);
      syncCollection = config.collections.v1sync;
      await database.collection(syncCollection).drop();
      await database.collection(syncCollection).insertMany(testInsertV1Sync);
    });

    it('should return error when id is undefined', async () => {
      await syncService.getSync().catch((e) => assert.equal(e, 'Error: Sync undefined not found'));
    });

    it('should return error when id is not valid', async () => {
      await syncService.getSync(123).catch((e) => assert.equal(e, 'Error: Sync 123 not found'));
    });

    it('should return data when id is valid', async () => {
      await syncService.getSync(141).then((r) => expect(r).to.deep.equal({ walletIdentity: 141 }));
    });

    it('should return error after database drop and id is invalid', async () => {
      await database.collection(syncCollection).drop();
      await syncService.getSync(141).catch((e) => assert.equal(e, 'Error: Sync 141 not found'));
    });
  });

  describe('Post Sync: Correctly verifies post sync', () => {
    it('should return data with walletIdentity when id is valid', async () => {
      await syncService.postSync({walletIdentity: 144}).then((r) => {
        expect(r.createdAt).to.not.be.null;
        expect(r.createdAt).to.not.be.undefined;
        expect(r.expireAt).to.not.be.null;
        expect(r.expireAt).to.not.be.undefined;
        expect(r.walletIdentity).equal(144);
      });
    });

    it('should return data without walletIdentity when data is empty', async () => {
      await syncService.postSync({}).then((r) => {
        expect(r.createdAt).to.not.be.null;
        expect(r.createdAt).to.not.be.undefined;
        expect(r.expireAt).to.not.be.null;
        assert.equal(r.walletIdentity, undefined);
      });
    });

    it('should return data without walletIdentity when id is invalid', async () => {
      await syncService.postSync().catch((r) => {
        assert.equal(r, `TypeError: Cannot read properties of undefined (reading 'walletIdentity')`)
      });
    });
  });

  describe('Get tokens: Correctly verifies get tokens', () => {
    before(async () => {
      const db = await serviceHelper.databaseConnection();
      database = db.db(config.database.database);
      tokenCollection = config.collections.v1token;
      await database.collection(tokenCollection).drop();
      await database.collection(tokenCollection).insertMany(testInsertV1Tokens);
    });

    it('should return error when id is undefined', async () => {
      await syncService.getTokens().catch((e) => assert.equal(e, 'Error: Sync undefined not found'));
    });

    it('should return error when id is not valid', async () => {
      await syncService.getTokens(123).catch((e) => assert.equal(e, 'Error: Sync 123 not found'));
    });

    it('should return data when id is valid', async () => {
      await syncService.getTokens(141).then((r) => expect(r).to.deep.equal([{ wkIdentity: 141 }]));
    });

    it('should return error after database drop and id is invalid', async () => {
      await database.collection(tokenCollection).drop();
      await syncService.getTokens(141).catch((e) => assert.equal(e, 'Error: Sync 141 not found'));
    });
  });


  describe('Post Token: Correctly verifies post token', () => {
    it('should return data with wkIdentity when id is valid', async () => {
      await syncService.postToken({wkIdentity: 144}).then((r) => {
        expect(r.wkIdentity).equal(144);
      });
    });

    it('should return data without wkIdentity when data is empty', async () => {
      await syncService.postToken({}).then((r) => {
        assert.equal(r.wkIdentity, undefined);
      });
    });
  });

  describe('Delete Token: Correctly verifies delete token', () => {
    it('should return successfully', async () => {
      await syncService.postToken({wkIdentity: 188});
      await syncService.deleteToken({wkIdentity: 188}).then(async () => {
        await syncService.getTokens({wkIdentity: 188}).catch((e) => {
            assert.equal(e, 'Error: Sync [object Object] not found');
        });
      });
    });
  });
});
