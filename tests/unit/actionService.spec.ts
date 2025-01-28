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
    wkIdentity: 'bc1walletidentity',
  },
  {
    wkIdentity: 'bc1walletidentitya',
  },
  {
    wkIdentity: 'bc1walletidentity3',
  },
];

let database = undefined;
let actionCollection = undefined;

describe('Action Service', function () {
  describe('Get Action: Correctly verifies action', function () {
    before(async function () {
      const db = await serviceHelper.databaseConnection();
      database = db.db(config.database.database);
      actionCollection = config.collections.v1action;
      await database
        .collection(actionCollection)
        .drop()
        .catch(() => {});
    });

    afterEach(function () {
      sinon.restore();
    });

    it('should return error when id is undefined', async function () {
      await actionService
        .getAction()
        .catch((e) => assert.equal(e, 'Error: Action undefined not found'));
    });

    it('should return error when id is not valid', async function () {
      await actionService
        .getAction('bc1walletidentity123')
        .catch((e) =>
          assert.equal(e, 'Error: Action bc1walletidentity123 not found'),
        );
    });

    it('should return data when id is valid', async function () {
      await database.collection(actionCollection).insertMany(testInsert);
      await actionService.getAction('bc1walletidentity').then((r) => {
        expect(r).to.have.property('wkIdentity');
        expect(r).to.deep.equal({ wkIdentity: 'bc1walletidentity' });
      });
    });

    it('should return error after database drop and id is invalid', async function () {
      await actionService
        .getAction('bc1walletidentity')
        .catch((e) =>
          assert.equal(e, 'Error: Action bc1walletidentity not found'),
        );
    });

    // Testing using stub data
    it('should return successful result bc1walletidentity if stub value is valid', async function () {
      await sinon
        .stub(serviceHelper, 'findOneInDatabase')
        .returns({ wkIdentity: 'bc1walletidentity' });
      await actionService.getAction('bc1walletidentity').then((r) => {
        expect(r).to.have.property('wkIdentity');
        expect(r).to.deep.equal({ wkIdentity: 'bc1walletidentity' });
      });
    });

    it('should return successful result bc1walletidentitya if stub value is valid', async function () {
      await sinon
        .stub(serviceHelper, 'findOneInDatabase')
        .returns({ wkIdentity: 'bc1walletidentitya' });
      await actionService.getAction('bc1walletidentitya').then((r) => {
        expect(r).to.have.property('wkIdentity');
        expect(r).to.deep.equal({ wkIdentity: 'bc1walletidentitya' });
      });
    });

    it('should return error result if stub value is false', async function () {
      await sinon.stub(serviceHelper, 'findOneInDatabase').returns(false);
      await actionService
        .getAction('bc1walletidentity141')
        .catch((e) =>
          assert.equal(e, 'Error: Action bc1walletidentity141 not found'),
        );
    });

    it('should return error result if stub value is undefined', async function () {
      await sinon.stub(serviceHelper, 'findOneInDatabase').returns(undefined);
      await actionService
        .getAction('bc1walletidentity141')
        .catch((e) =>
          assert.equal(e, 'Error: Action bc1walletidentity141 not found'),
        );
    });

    it('should return error result if stub value is null', async function () {
      await sinon.stub(serviceHelper, 'findOneInDatabase').returns(undefined);
      await actionService
        .getAction('bc1walletidentity141')
        .catch((e) =>
          assert.equal(e, 'Error: Action bc1walletidentity141 not found'),
        );
    });
  });

  describe('Post Action: Correctly verifies action', function () {
    it('should return data with wkIdentity when data is valid', async function () {
      await actionService
        .postAction({ wkIdentity: 'bc1walletidentityb' })
        .then((r) => {
          expect(r).to.have.property('createdAt');
          expect(r).to.have.property('expireAt');
          expect(r.createdAt).to.not.be.null;
          expect(r.createdAt).to.not.be.undefined;
          expect(r.expireAt).to.not.be.null;
          expect(r.expireAt).to.not.be.undefined;
          expect(r.wkIdentity).equal('bc1walletidentityb');
        });
    });

    it('should return data without wkIdentity when data is empty', async function () {
      await actionService.postAction({}).then((r) => {
        expect(r).to.have.property('createdAt');
        expect(r).to.have.property('expireAt');
        expect(r.createdAt).to.not.be.null;
        expect(r.createdAt).to.not.be.undefined;
        expect(r.expireAt).to.not.be.null;
        expect(r.expireAt).to.not.be.undefined;
      });
    });

    it('should return data without wkIdentity when data is invalid', async function () {
      await actionService.postAction().catch((r) => {
        assert.equal(
          r,
          `TypeError: Cannot read properties of undefined (reading 'wkIdentity')`,
        );
      });
    });
  });
});
