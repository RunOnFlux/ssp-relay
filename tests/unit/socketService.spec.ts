/* eslint-disable @typescript-eslint/no-unused-expressions */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import chai from 'chai';
import config from 'config';
import socketService from '../../src/services/socketService';
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
var socketCollection = undefined;

describe('Socket Service', () => {
  describe('Get Action: Correctly verifies action', () => {
    before(async () => {
      const db = await serviceHelper.databaseConnection();
      database = db.db(config.database.database);
      socketCollection = config.collections.v1action;
      await database.collection(socketCollection).drop();
    });

    afterEach(function() {
      sinon.restore();
    });

    it('should return error when id is undefined', async () => {
      await socketService.getAction().catch((e) => assert.equal(e, 'Error: Socket Action undefined not found'));
    });

    it('should return error when id is not valid', async () => {
      await socketService.getAction(123).catch((e) => assert.equal(e, 'Error: Socket Action 123 not found'));
    });

    it('should return data when id is valid', async () => {
      await database.collection(socketCollection).insertMany(testInsert);
      await socketService.getAction(141).then((r) => {
        expect(r).to.have.property('wkIdentity');
        expect(r).to.deep.equal({ wkIdentity: 141 });
      });

      await socketService.getAction(121).then((r) => {
        expect(r).to.have.property('wkIdentity');
        expect(r).to.deep.equal({ wkIdentity: 121 });
      });

      await socketService.getAction(231).then((r) => {
        expect(r).to.have.property('wkIdentity');
        expect(r).to.deep.equal({ wkIdentity: 231 });
      });
    });

    // Testing using stub data
    it('should return successful result 141 if stub value is valid', async () => {
      await sinon.stub(serviceHelper, "findOneInDatabase").returns({ wkIdentity: 141});
      await socketService.getAction(141).then((r) => {
        expect(r).to.have.property('wkIdentity');
        expect(r).to.deep.equal({ wkIdentity: 141 });
      });
    });

    it('should return successful result 151 if stub value is valid', async () => {
      await sinon.stub(serviceHelper, "findOneInDatabase").returns({ wkIdentity: 151});
      await socketService.getAction(151).then((r) => {
        expect(r).to.have.property('wkIdentity');
        expect(r).to.deep.equal({ wkIdentity: 151 });
      });
    });

    it('should return error result if stub value is false', async () => {
      await sinon.stub(serviceHelper, "findOneInDatabase").returns(false);
      await socketService.getAction(141).catch((e) => assert.equal(e, 'Error: Socket Action 141 not found'));
    });

    it('should return error result if stub value is undefined', async () => {
      await sinon.stub(serviceHelper, "findOneInDatabase").returns(undefined);
      await socketService.getAction(141).catch((e) => assert.equal(e, 'Error: Socket Action 141 not found'));
    });

    it('should return error result if stub value is null', async () => {
      await sinon.stub(serviceHelper, "findOneInDatabase").returns(undefined);
      await socketService.getAction(141).catch((e) => assert.equal(e, 'Error: Socket Action 141 not found'));
    });
  });
});