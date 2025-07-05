// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect } from 'chai';
import transactionDecoder from '../../src/services/transactionDecoder';


const rawTxSepolia = {
  id: '0x8b18236447c918b3b217da857a787a7561313b730374430596eaa6f9c2d0ee16',
  opHash: '0xc195efc3bf3541c0e4b75591c0a8bf36484fef6ef6feb85f501ed1b4daa4ba68',
  userOpRequest: {
    sender: '0xd447BA08b0d395fCAd6e480d270529c932289Ce1',
    nonce: '0x14',
    initCode: '0x',
    callData:
      '0xb61d27f600000000000000000000000066324ee406ccccdddad7f510a61af22dec391606000000000000000000000000000000000000000000000000016345785d8a000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000',
    callGasLimit: '0x6a02',
    verificationGasLimit: '0x13d5a',
    preVerificationGas: '0xfa5c',
    maxFeePerGas: '0x7309fdd1',
    maxPriorityFeePerGas: '0x59682f00',
    paymasterAndData: '0x',
    signature:
      '0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c',
  },
  combinedPubKey:
    '03b0177e3dbfa2d2460721bc1f32c80576b7adfd7ab4a899c0065879ef95296acb',
  publicKeys: {
    '0x300429d8ef26b7264fab66d9368958d0e99e3f1f':
      '02e10148f9606cfc52d5a3a5d61fb3640d5f135266f32ac0b3dceff438c3f0bd52',
    '0x24c752b40767088059fc4d4be4fe4f52facbac57':
      '032f320a64727d2d23ccd6caa40af5f2700dc3265143d275beaf04194166b6756e',
  },
  publicNonces: {
    '0x300429d8ef26b7264fab66d9368958d0e99e3f1f': {
      kPublic:
        '022f8178611318387a91b287a5942278fb2f66942dfa72f2fdae5a2de4ba2a5e62',
      kTwoPublic:
        '037a0ba8f0d247907508520ba7df81a31c3f084eb2648f566c8ad902af7a798d63',
    },
    '0x24c752b40767088059fc4d4be4fe4f52facbac57': {
      kPublic:
        '03d0976461943725f33309ff56605784ad7c8d3e2b7a82c45c5df6151d9aed1149',
      kTwoPublic:
        '03d4f0e6406c080882c5574297c01ffd26aed8ca3f0cad34258592acf74d314650',
    },
  },
  signatures: {
    '0x300429d8ef26b7264fab66d9368958d0e99e3f1f': {
      finalPublicNonce:
        '037cde1f949b8c62d815da75d6082718538d0ef68b3819bdde4b7ec3afd5c26c91',
      challenge:
        '659c5592db35c0b52ec11487d92feb627d7b51d1f0a8fe1451f148726e59871d',
      signature:
        'e1f70aa45833fdd10fe3b254d9e5b173988c1c9c4e91c8b6220ad9314a39621e',
    },
  },
};

describe('Transaction Decoder', function () {
  describe('Decode Transaction: Correctly verifies action', function () {
    it('should return error result if raw tx is empty', async function () {
      const response = await transactionDecoder.decodeTransactionForApproval(
        {},
      );
      expect(response).to.deep.equal({
        amount: 'decodingError',
        receiver: 'decodingError',
        tokenSymbol: 'decodingError',
      });
    });

    it('should return error result if raw tx is undefined', async function () {
      const response =
        await transactionDecoder.decodeTransactionForApproval(undefined);
      expect(response).to.deep.equal({
        amount: 'decodingError',
        receiver: 'decodingError',
        tokenSymbol: 'decodingError',
      });
    });

    it('should return error result if raw tx is null', async function () {
      const response =
        await transactionDecoder.decodeTransactionForApproval(null);
      expect(response).to.deep.equal({
        amount: 'decodingError',
        receiver: 'decodingError',
        tokenSymbol: 'decodingError',
      });
    });

    it('should return successful result if raw tx is valid for sepolia', async function () {
      const response = await transactionDecoder.decodeTransactionForApproval(
        JSON.stringify(rawTxSepolia),
        'sepolia',
      );
      expect(response).to.deep.equal({
        amount: '0.1',
        data: '',
        fee: '591584934602552',
        receiver: '0x66324EE406cCccdDdAd7f510a61Af22DeC391606',
        sender: '0xd447BA08b0d395fCAd6e480d270529c932289Ce1',
        token: '',
        tokenSymbol: 'TEST-ETH',
      });
    });
  });
});
