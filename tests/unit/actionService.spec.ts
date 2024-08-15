/* eslint-disable @typescript-eslint/no-unused-expressions */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import chai from 'chai';
import config from 'config';
import actionService from '../../src/services/actionService';
import serviceHelper from '../../src/services/serviceHelper';
import sinon from 'sinon';

const { expect, assert } = chai;

const testInsert = [
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
var actionCollection = undefined;

describe('Action Service', () => {
  describe('Get Action: Correctly verifies action', () => {
    before(async () => {
      const db = await serviceHelper.databaseConnection();
      database = db.db(config.database.database);
      actionCollection = config.collections.v1action;
      await database.collection(actionCollection).drop();
    });

    afterEach(function() {
      sinon.restore();
    });

    it('should return error when id is undefined', async () => {
      await actionService.getAction().catch((e) => assert.equal(e, 'Error: Action undefined not found'));
    });

    it('should return error when id is not valid', async () => {
      await actionService.getAction(123).catch((e) => assert.equal(e, 'Error: Action 123 not found'));
    });

    it('should return data when id is valid', async () => {
      await database.collection(actionCollection).insertMany(testInsert);
      await actionService.getAction(141).then((r) => {
        expect(r).to.have.property('wkIdentity');
        expect(r).to.deep.equal({ wkIdentity: 141 });
      });
    });

    it('should return error after database drop and id is invalid', async () => {
      await actionService.getAction(141).catch((e) => assert.equal(e, 'Error: Action 141 not found'));
    });

    // Testing using stub data
    it('should return successful result 141 if stub value is valid', async () => {
      await sinon.stub(serviceHelper, "findOneInDatabase").returns({ wkIdentity: 141});
      await actionService.getAction(141).then((r) => {
        expect(r).to.have.property('wkIdentity');
        expect(r).to.deep.equal({ wkIdentity: 141 });
      });
    });

    it('should return successful result 121 if stub value is valid', async () => {
      await sinon.stub(serviceHelper, "findOneInDatabase").returns({ wkIdentity: 121});
      await actionService.getAction(121).then((r) => {
        expect(r).to.have.property('wkIdentity');
        expect(r).to.deep.equal({ wkIdentity: 121 });
      });
    });

    it('should return error result if stub value is false', async () => {
      await sinon.stub(serviceHelper, "findOneInDatabase").returns(false);
      await actionService.getAction(141).catch((e) => assert.equal(e, 'Error: Action 141 not found'));
    });

    it('should return error result if stub value is undefined', async () => {
      await sinon.stub(serviceHelper, "findOneInDatabase").returns(undefined);
      await actionService.getAction(141).catch((e) => assert.equal(e, 'Error: Action 141 not found'));
    });

    it('should return error result if stub value is null', async () => {
      await sinon.stub(serviceHelper, "findOneInDatabase").returns(undefined);
      await actionService.getAction(141).catch((e) => assert.equal(e, 'Error: Action 141 not found'));
    });
  });

  describe('Post Action: Correctly verifies action', () => {
    it('should return data with wkIdentity when data is valid', async () => {
      await actionService.postAction({wkIdentity: 144}).then((r) => {
        expect(r).to.have.property('createdAt');
        expect(r).to.have.property('expireAt');
        expect(r.createdAt).to.not.be.null;
        expect(r.createdAt).to.not.be.undefined;
        expect(r.expireAt).to.not.be.null;
        expect(r.expireAt).to.not.be.undefined;
        expect(r.wkIdentity).equal(144);
      });
    });

    it('should return data without wkIdentity when data is empty', async () => {
      await actionService.postAction({}).then((r) => {
        expect(r).to.have.property('createdAt');
        expect(r).to.have.property('expireAt');
        expect(r.createdAt).to.not.be.null;
        expect(r.createdAt).to.not.be.undefined;
        expect(r.expireAt).to.not.be.null;
        expect(r.expireAt).to.not.be.undefined;
      });
    });

    it('should return data without wkIdentity when data is invalid', async () => {
      await actionService.postAction().catch((r) => {
        assert.equal(r, `TypeError: Cannot read properties of undefined (reading 'wkIdentity')`)
      });
    });
  });
});
