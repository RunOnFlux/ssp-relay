/* eslint-disable @typescript-eslint/no-unused-expressions */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import chai from 'chai';
import config from 'config';
import syncService from '../../src/services/syncService';
import serviceHelper from '../../src/services/serviceHelper';
import sinon from 'sinon';

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

    afterEach(function() {
      sinon.restore();
    });

    it('should return error when id is undefined', async () => {
      await syncService.getSync().catch((e) => assert.equal(e, 'Error: Sync undefined not found'));
    });

    it('should return error when id is not valid', async () => {
      await syncService.getSync(123).catch((e) => assert.equal(e, 'Error: Sync 123 not found'));
    });

    it('should return data when id is valid', async () => {
      await syncService.getSync(141).then((r) => {
        expect(r).to.have.property('walletIdentity');
        expect(r).to.deep.equal({ walletIdentity: 141 });
      });
      await syncService.getSync(121).then((r) => {
        expect(r).to.have.property('walletIdentity');
        expect(r).to.deep.equal({ walletIdentity: 121 });
      });
      await syncService.getSync(231).then((r) => {
        expect(r).to.have.property('walletIdentity');
        expect(r).to.deep.equal({ walletIdentity: 231 });
      });
    });

    it('should return error after database drop and id is invalid', async () => {
      await database.collection(syncCollection).drop();
      await syncService.getSync(141).catch((e) => assert.equal(e, 'Error: Sync 141 not found'));
    });

    // Testing using stub data
    it('should return successful result 141 if stub value is valid', async () => {
      await sinon.stub(serviceHelper, "findOneInDatabase").returns({ walletIdentity: 141});
      await syncService.getSync(141).then((r) => {
        expect(r).to.have.property('walletIdentity');
        expect(r).to.deep.equal({ walletIdentity: 141 });
      });
    });

    it('should return successful result 121 if stub value is valid', async () => {
      await sinon.stub(serviceHelper, "findOneInDatabase").returns({ walletIdentity: 121});
      await syncService.getSync(121).then((r) => {
        expect(r).to.have.property('walletIdentity');
        expect(r).to.deep.equal({ walletIdentity: 121 });
      });
    });


    it('should return error result if stub value is false', async () => {
      await sinon.stub(serviceHelper, "findOneInDatabase").returns(false);
      await syncService.getSync(141).catch((e) => assert.equal(e, 'Error: Sync 141 not found'));
    });

    it('should return error result if stub value is undefined', async () => {
      await sinon.stub(serviceHelper, "findOneInDatabase").returns(undefined);
      await syncService.getSync(141).catch((e) => assert.equal(e, 'Error: Sync 141 not found'));
    });

    it('should return error result if stub value is null', async () => {
      await sinon.stub(serviceHelper, "findOneInDatabase").returns(undefined);
      await syncService.getSync(141).catch((e) => assert.equal(e, 'Error: Sync 141 not found'));
    });
  });

  describe('Post Sync: Correctly verifies post sync', () => {
    it('should return data with walletIdentity when id is valid', async () => {
      await syncService.postSync({walletIdentity: 144}).then((r) => {
        expect(r).to.have.property('createdAt');
        expect(r).to.have.property('expireAt');
        expect(r).to.have.property('walletIdentity');
        expect(r.createdAt).to.not.be.null;
        expect(r.createdAt).to.not.be.undefined;
        expect(r.expireAt).to.not.be.null;
        expect(r.expireAt).to.not.be.undefined;
        expect(r.walletIdentity).equal(144);
      });
    });

    it('should return data without walletIdentity when data is empty', async () => {
      await syncService.postSync({}).then((r) => {
        expect(r).to.have.property('createdAt');
        expect(r).to.have.property('expireAt');
        expect(r.createdAt).to.not.be.null;
        expect(r.createdAt).to.not.be.undefined;
        expect(r.expireAt).to.not.be.null;
        expect(r.expireAt).to.not.be.undefined;
        expect(r.walletIdentity).to.be.undefined;
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

    afterEach(function() {
      sinon.restore();
    });

    it('should return error when id is undefined', async () => {
      await syncService.getTokens().catch((e) => assert.equal(e, 'Error: Sync undefined not found'));
    });

    it('should return error when id is not valid', async () => {
      await syncService.getTokens(123).catch((e) => assert.equal(e, 'Error: Sync 123 not found'));
    });

    it('should return data when id is valid', async () => {
      await syncService.getTokens(141).then((r) => {
        expect(r[0]).to.have.property('wkIdentity');
        expect(r).to.deep.equal([{ wkIdentity: 141 }]);
      });
      await syncService.getTokens(121).then((r) => {
        expect(r[0]).to.have.property('wkIdentity');
        expect(r).to.deep.equal([{ wkIdentity: 121 }]);
      });
      await syncService.getTokens(231).then((r) => {
        expect(r[0]).to.have.property('wkIdentity');
        expect(r).to.deep.equal([{ wkIdentity: 231 }]);
      });
    });

    it('should return error after database drop and id is invalid', async () => {
      await database.collection(tokenCollection).drop();
      await syncService.getTokens(141).catch((e) => assert.equal(e, 'Error: Sync 141 not found'));
    });

    // Testing using stub data
    it('should return successful result 141 if stub value is valid', async () => {
      await sinon.stub(serviceHelper, "findInDatabase").returns([{ wkIdentity: 141}]);
      await syncService.getTokens(141).then((r) => {
        expect(r[0]).to.have.property('wkIdentity');
        expect(r).to.deep.equal([{ wkIdentity: 141 }]);
      });
    });

    it('should return successful result 121 if stub value is valid', async () => {
      await sinon.stub(serviceHelper, "findInDatabase").returns([{ wkIdentity: 121}]);
      await syncService.getTokens(121).then((r) => {
        expect(r[0]).to.have.property('wkIdentity');
        expect(r).to.deep.equal([{ wkIdentity: 121 }]);
      });
    });

    it('should return error result if stub value is empty', async () => {
      await sinon.stub(serviceHelper, "findInDatabase").returns([]);
      await syncService.getTokens(141).catch((e) => assert.equal(e, 'Error: Sync 141 not found'));
    });
  });


  describe('Post Token: Correctly verifies post token', () => {
    afterEach(function() {
      sinon.restore();
    });

    it('should return data with wkIdentity when id is valid', async () => {
      await syncService.postToken({wkIdentity: 144}).then((r) => {
        expect(r).to.have.property('wkIdentity');
        expect(r.wkIdentity).equal(144);
      });
      await syncService.postToken({wkIdentity: 191}).then((r) => {
        expect(r).to.have.property('wkIdentity');
        expect(r.wkIdentity).equal(191);
      });
    });

    it('should return data without wkIdentity when data is empty', async () => {
      await syncService.postToken({}).then((r) => {
        expect(r.wkIdentity).to.be.undefined;
      });
    });

    // Testing using stub data
    it('should return successful result 141 if stub value is valid', async () => {
      var call = await sinon.stub(serviceHelper, "findInDatabase");
      await call.onCall(0).returns([{ wkIdentity: 141}]);
      await call.onCall(1).returns([]);
      await syncService.postToken({ wkIdentity: 141 }).then((r) => {
        expect(r).to.have.property('wkIdentity');
        expect(r).to.deep.equal({ wkIdentity: 141 });
      });
    });

    it('should return error result 141 if stub value with 100 keys', async () => {
      var call = await sinon.stub(serviceHelper, "findInDatabase");
      await call.onCall(0).returns([{ wkIdentity: 141}]);
      await call.onCall(1).returns(
        [
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
          { wkIdentity: 141},
        ]);
        await syncService.postToken(141).catch((e) => assert.equal(e, `Error: More than 100 tokens for 141 found, not storing new one`));
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
