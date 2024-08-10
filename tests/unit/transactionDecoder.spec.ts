/* eslint-disable @typescript-eslint/no-unused-expressions */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import chai from 'chai';
import config from 'config';
import transactionDecoder from '../../src/services/transactionDecoder';

const { expect, assert } = chai;

var database = undefined;
var actionCollection = undefined;

describe('Transaction Decoder', () => {
  describe('Decode Transaction For Approval: Correctly verifies transaction', () => {
    it('should return successfully', async () => {
      const ret = transactionDecoder.decodeTransactionForApproval();
      assert.deepEqual(ret, { receiver: 'decodingError', amount: 'decodingError'});
    });

    // Valid test cases will be included moving forward once sample data is present
  });
});
