/* eslint-disable @typescript-eslint/no-unused-expressions */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import chai from 'chai';
import sinon from 'sinon';
import { MongoClient } from 'mongodb';
import axios from 'axios';
import bitcoinjs from 'bitcoinjs-lib';
import zelcorejs from 'zelcorejs';
import serviceHelper from '../../src/lib/services/serviceHelper';

const { expect } = chai;

describe('Service Helper', function () {
  describe('Ensure data types', function () {
    it('ensureBoolean correctly converts values', function () {
      expect(serviceHelper.ensureBoolean('false')).to.be.false;
      expect(serviceHelper.ensureBoolean(0)).to.be.false;
      expect(serviceHelper.ensureBoolean('0')).to.be.false;
      expect(serviceHelper.ensureBoolean(false)).to.be.false;
      expect(serviceHelper.ensureBoolean('true')).to.be.true;
      expect(serviceHelper.ensureBoolean(1)).to.be.true;
      expect(serviceHelper.ensureBoolean('1')).to.be.true;
      expect(serviceHelper.ensureBoolean(true)).to.be.true;
      expect(serviceHelper.ensureBoolean('other')).to.be.undefined;
    });

    it('ensureNumber correctly converts values', function () {
      expect(serviceHelper.ensureNumber('123')).to.equal(123);
      expect(serviceHelper.ensureNumber(456)).to.equal(456);
      expect(serviceHelper.ensureNumber('abc')).to.be.NaN;
    });

    it('ensureObject correctly converts values', function () {
      expect(serviceHelper.ensureObject('{"key":"value"}')).to.deep.equal({
        key: 'value',
      });
      expect(serviceHelper.ensureObject({ key: 'value' })).to.deep.equal({
        key: 'value',
      });
      expect(serviceHelper.ensureObject('key=value')).to.deep.equal({
        key: 'value',
      });
      const consoleStub = sinon.stub(console, 'log');
      expect(serviceHelper.ensureObject('invalid')).to.deep.equal({
        invalid: '',
      });
      consoleStub.restore();
    });

    it('ensureString correctly converts values', function () {
      expect(serviceHelper.ensureString('string')).to.equal('string');
      expect(serviceHelper.ensureString({ key: 'value' })).to.equal(
        '{"key":"value"}',
      );
      expect(serviceHelper.ensureString(123)).to.equal('123');
    });
  });

  describe('Database functions', function () {
    let connectStub;
    let dbStub;

    beforeEach(function () {
      connectStub = sinon.stub(MongoClient, 'connect');
      dbStub = {
        collection: sinon.stub().returnsThis(),
        find: sinon.stub().returnsThis(),
        findOne: sinon.stub(),
        distinct: sinon.stub(),
        insertOne: sinon.stub(),
        updateOne: sinon.stub(),
        updateMany: sinon.stub(),
        findOneAndUpdate: sinon.stub(),
        findOneAndDelete: sinon.stub(),
        deleteMany: sinon.stub(),
        drop: sinon.stub(),
        stats: sinon.stub(),
        insertMany: sinon.stub(),
        createIndex: sinon.stub(),
        toArray: sinon.stub(),
        sort: sinon.stub().returnsThis(),
      };
      connectStub.resolves(dbStub);
    });

    afterEach(function () {
      connectStub.restore();
    });

    it('connectMongoDb connects to the database', async function () {
      await serviceHelper.connectMongoDb();
      expect(connectStub.calledOnce).to.be.true;
    });

    it('connectMongoDb connects to the database with custom URL', async function () {
      await serviceHelper.connectMongoDb('custom-url');
      expect(connectStub.calledWith('custom-url')).to.be.true;
    });

    it('initiateDB initiates the database connection', async function () {
      const result = await serviceHelper.initiateDB();
      expect(result).to.be.true;
      expect(connectStub.calledOnce).to.be.true;
    });

    it('databaseConnection returns an open connection', async function () {
      await serviceHelper.initiateDB();
      const connection = await serviceHelper.databaseConnection();
      expect(connection).to.equal(dbStub);
    });

    it('databaseConnection initiates connection if not open', async function () {
      const connection = await serviceHelper.databaseConnection();
      expect(connection).to.equal(dbStub);
      expect(connectStub.calledOnce).to.be.true;
    });

    it('distinctDatabase performs distinct operation', async function () {
      dbStub.distinct.resolves(['distinct1', 'distinct2']);
      const result = await serviceHelper.distinctDatabase(
        dbStub,
        'collection',
        'field',
        {},
      );
      expect(result).to.deep.equal(['distinct1', 'distinct2']);
    });

    it('findInDatabase finds documents in the database', async function () {
      dbStub.toArray.resolves([{ id: 1 }]);
      const result = await serviceHelper.findInDatabase(
        dbStub,
        'collection',
        {},
        {},
      );
      expect(result).to.deep.equal([{ id: 1 }]);
    });

    it('findInDatabaseSort finds and sorts documents in the database', async function () {
      dbStub.toArray.resolves([{ id: 1 }, { id: 2 }]);
      const result = await serviceHelper.findInDatabaseSort(
        dbStub,
        'collection',
        {},
        {},
        { id: 1 },
      );
      expect(result).to.deep.equal([{ id: 1 }, { id: 2 }]);
    });

    it('findOneInDatabase finds one document in the database', async function () {
      dbStub.findOne.resolves({ id: 1 });
      const result = await serviceHelper.findOneInDatabase(
        dbStub,
        'collection',
        {},
        {},
      );
      expect(result).to.deep.equal({ id: 1 });
    });

    it('findOneAndUpdateInDatabase finds and updates one document in the database', async function () {
      dbStub.findOneAndUpdate.resolves({ value: { id: 1 } });
      const result = await serviceHelper.findOneAndUpdateInDatabase(
        dbStub,
        'collection',
        {},
        {},
        {},
      );
      expect(result).to.deep.equal({ value: { id: 1 } });
    });

    it('insertOneToDatabase inserts one document to the database', async function () {
      dbStub.insertOne.resolves({ insertedId: 'abc123' });
      const result = await serviceHelper.insertOneToDatabase(
        dbStub,
        'collection',
        { id: 1 },
      );
      expect(result).to.deep.equal({ insertedId: 'abc123' });
    });

    it('updateOneInDatabase updates one document in the database', async function () {
      dbStub.updateOne.resolves({ modifiedCount: 1 });
      const result = await serviceHelper.updateOneInDatabase(
        dbStub,
        'collection',
        {},
        {},
        {},
      );
      expect(result).to.deep.equal({ modifiedCount: 1 });
    });

    it('updateInDatabase updates multiple documents in the database', async function () {
      dbStub.updateMany.resolves({ modifiedCount: 2 });
      const result = await serviceHelper.updateInDatabase(
        dbStub,
        'collection',
        {},
        {},
      );
      expect(result).to.deep.equal({ modifiedCount: 2 });
    });

    it('findOneAndDeleteInDatabase finds and deletes one document in the database', async function () {
      dbStub.findOneAndDelete.resolves({ value: { id: 1 } });
      const result = await serviceHelper.findOneAndDeleteInDatabase(
        dbStub,
        'collection',
        {},
        {},
      );
      expect(result).to.deep.equal({ value: { id: 1 } });
    });

    it('removeDocumentsFromCollection removes documents from a collection', async function () {
      dbStub.deleteMany.resolves({ deletedCount: 2 });
      const result = await serviceHelper.removeDocumentsFromCollection(
        dbStub,
        'collection',
        {},
      );
      expect(result).to.deep.equal({ deletedCount: 2 });
    });

    it('dropCollection drops a collection', async function () {
      dbStub.drop.resolves(true);
      const result = await serviceHelper.dropCollection(dbStub, 'collection');
      expect(result).to.be.true;
    });

    it('collectionStats returns collection statistics', async function () {
      dbStub.stats.resolves({ count: 100, size: 1000 });
      const result = await serviceHelper.collectionStats(dbStub, 'collection');
      expect(result).to.deep.equal({ count: 100, size: 1000 });
    });

    it('addMultipleDocuments adds multiple documents to a collection', async function () {
      dbStub.insertMany.resolves({ insertedCount: 2 });
      const result = await serviceHelper.addMultipleDocuments(
        dbStub,
        'collection',
        [{}, {}],
      );
      expect(result).to.deep.equal({ insertedCount: 2 });
    });

    it('addMultipleDocuments creates an index when expireTimeInSeconds is provided', async function () {
      dbStub.insertMany.resolves({ insertedCount: 2 });
      await serviceHelper.addMultipleDocuments(
        dbStub,
        'collection',
        [{}, {}],
        3600,
      );
      expect(dbStub.createIndex.calledOnce).to.be.true;
    });
  });

  describe('Message creation', function () {
    it('createDataMessage creates a success message with data', function () {
      const result = serviceHelper.createDataMessage({ key: 'value' });
      expect(result).to.deep.equal({
        status: 'success',
        data: { key: 'value' },
      });
    });

    it('createSuccessMessage creates a success message', function () {
      const result = serviceHelper.createSuccessMessage(
        'Success',
        'TestSuccess',
        200,
      );
      expect(result).to.deep.equal({
        status: 'success',
        data: {
          code: 200,
          name: 'TestSuccess',
          message: 'Success',
        },
      });
    });

    it('createWarningMessage creates a warning message', function () {
      const result = serviceHelper.createWarningMessage(
        'Warning',
        'TestWarning',
        300,
      );
      expect(result).to.deep.equal({
        status: 'warning',
        data: {
          code: 300,
          name: 'TestWarning',
          message: 'Warning',
        },
      });
    });

    it('createErrorMessage creates an error message', function () {
      const result = serviceHelper.createErrorMessage(
        'Error',
        'TestError',
        400,
      );
      expect(result).to.deep.equal({
        status: 'error',
        data: {
          code: 400,
          name: 'TestError',
          message: 'Error',
        },
      });
    });

    it('createErrorMessage creates an error message with default message', function () {
      const result = serviceHelper.createErrorMessage(null, 'TestError', 400);
      expect(result.data.message).to.equal('Unknown error');
    });

    it('errUnauthorizedMessage creates an unauthorized error message', function () {
      const result = serviceHelper.errUnauthorizedMessage();
      expect(result).to.deep.equal({
        status: 'error',
        data: {
          code: 401,
          name: 'Unauthorized',
          message: 'Unauthorized. Access denied.',
        },
      });
    });
  });

  describe('Verification functions', function () {
    it('verifyZelID verifies a valid ZelID', function () {
      const result = serviceHelper.verifyZelID(
        '1P5ZEDWTKTFGxQjZphgWPQUpe554WKDfHQ',
      );
      expect(result).to.be.true;
    });

    it('verifyZelID rejects an invalid ZelID', function () {
      const result = serviceHelper.verifyZelID(
        '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo',
      );
      expect(result).to.be.false;
    });

    it('verifyZelID rejects a missing ZelID', function () {
      const result = serviceHelper.verifyZelID();
      expect(result).to.be.false;
    });

    it('verifyZelID handles a ZelID longer than 36 characters', function () {
      const longZelID = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'.repeat(2);
      const result = serviceHelper.verifyZelID(longZelID);
      expect(result).to.be.true;
    });

    it('verifyPublicKey verifies a valid public key', function () {
      const result = serviceHelper.verifyPublicKey(
        '618423c1dbed7381cf8cf151702f205a8c3979a76d60b307b03c97bb95474a84',
      );
      expect(result).to.be.true;
    });

    it('verifyPublicKey rejects an invalid public key', function () {
      const result = serviceHelper.verifyPublicKey('invalid');
      expect(result).to.be.false;
    });

    it('verifyPublicKey rejects a missing public key', function () {
      const result = serviceHelper.verifyPublicKey();
      expect(result).to.be.false;
    });

    it('verifyMessage verifies a valid message signature', function () {
      const message = 'Beautiful Message';
      const isValid = serviceHelper.verifyMessage(
        message,
        '1E1NSwDHtvCziYP4CtgiDMcgvgZL64PhkR',
        'HyAx+99on7kGgfqn5oCZMS98Hpate1XEduqM1OtJVu7NWFqw7UgvXEiGlXtETm1IJTXJiZltd3zF1H9R3MFCjWg=',
      );
      expect(isValid).to.be.true;
    });

    it('verifyMessage rejects an invalid message signature', function () {
      const message = 'Beautiful Message';
      const isValid = serviceHelper.verifyMessage(
        message,
        '1E1NSwDHtvCziYP4CtgiDMcgvgZL64PhkR',
        'InvalidSignature',
      );
      expect(isValid).to.be.false;
    });

    it('verifyMessage handles missing parameters', function () {
      const result = serviceHelper.verifyMessage('kappa', null, 'echo');
      expect(result).to.be.false;
    });

    it('verifyMessage with custom message magic', function () {
      const message = 'Beautiful Message';
      const isValid = serviceHelper.verifyMessage(
        message,
        '1E7utaVa4wFWmrafUvvKRpbNEhFX3JHAkT',
        'H/lodJkp7ruVp6oK7KkE8ehpgoDiSl51podJkp7ruVp6oK7KkE8ehpgoDiSl51pMUbICShYhfOC6mtnljQwCvwaTokJi14vJjyZEU1EUl5Szt9jDD0Srg=',
        '00',
        '\u0018Zelcash Signed Message:\n',
      );
      expect(isValid).to.be.true;
    });

    it('verifyMessage on different network with correct message magic', function () {
      const message = 'Beautiful Message';
      const isValid = serviceHelper.verifyMessage(
        message,
        't1WzWtuui3G37NVdZRMjSZdhHVMSbmjCZky',
        'H/lodJkp7ruVp6oK7KkE8ehpgoDiSl51pMUbICShYhfOC6mtnljQwCvwaTokJi14vJjyZEU1EUl5Szt9jDD0Srg=',
        '1cbd',
        '\u0018Zelcash Signed Message:\n',
      );
      expect(isValid).to.be.true;
    });

    it('verifyMessage with invalid signature on different network', function () {
      const message = 'Beautiful Message';
      const isValid = serviceHelper.verifyMessage(
        message,
        't1WzWtuui3G37NVdZRMjSZdhHVMSbmjCZky',
        'H/lodJkp7ruVp6oK7KkE8ehpgoDiSl51pMUbICShYhfOC6mtnljQwCvwaTokJi14vJjyZEU1EUl5Szt9jDD0SrP=',
        '1cbd',
        '\u0018Zelcash Signed Message:\n',
      );
      expect(isValid).to.be.false;
    });
  });

  describe('Signing function', function () {
    it('signMessage signs a message', function () {
      const signStub = sinon
        .stub(zelcorejs.message, 'sign')
        .returns(Buffer.from('signature'));
      const keyPairStub = sinon.stub(bitcoinjs.ECPair, 'fromWIF').returns({
        privateKey: Buffer.from('privateKey'),
        compressed: true,
      });
      const result = serviceHelper.signMessage(
        'message',
        'privateKey',
        'magic',
      );
      expect(result).to.equal('signature');
      signStub.restore();
      keyPairStub.restore();
    });

    it('signMessage handles errors', function () {
      const signStub = sinon
        .stub(zelcorejs.message, 'sign')
        .throws(new Error('Signing error'));
      const result = serviceHelper.signMessage(
        'message',
        'privateKey',
        'magic',
      );
      expect(result).to.be.an('error');
      signStub.restore();
    });
  });

  describe('Utility functions', function () {
    it('delay creates a delay', async function () {
      const start = Date.now();
      await serviceHelper.delay(100);
      const end = Date.now();
      expect(end - start).to.be.at.least(100);
    });

    describe('axiosGet', function () {
      let axiosStub;
      let clock;

      beforeEach(function () {
        axiosStub = sinon.stub(axios, 'get');
        clock = sinon.useFakeTimers();
      });

      afterEach(function () {
        axiosStub.restore();
        clock.restore();
      });

      it('should successfully get data', async function () {
        const expectedData = { data: 'test data' };
        axiosStub.resolves(expectedData);

        const result = await serviceHelper.axiosGet('http://example.com');
        expect(result).to.deep.equal(expectedData);
      });

      it('should timeout after specified time', async function () {
        axiosStub.returns(new Promise(() => {})); // Never resolves

        const promise = serviceHelper.axiosGet('http://example.com', {
          timeout: 1000,
        });
        clock.tick(1001);

        await expect(promise).to.be.rejectedWith('Timeout of 1000ms.');
      });

      it('should use default timeout if not specified', async function () {
        axiosStub.returns(new Promise(() => {})); // Never resolves

        const promise = serviceHelper.axiosGet('http://example.com');
        clock.tick(20001);

        await expect(promise).to.be.rejectedWith('Timeout of 20000ms.');
      });
    });
  });
});
