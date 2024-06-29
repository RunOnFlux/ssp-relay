const BigNumber = require('bignumber.js');
const utxolib = require('utxo-lib');
const bchaddrjs = require('bchaddrjs');
const viem = require('viem');
const abi = require('@runonflux/aa-schnorr-multisig-sdk/dist/abi');

const blockchains = require('./blockchains');
const log = require('../lib/log');

function getLibId(chain) {
  return blockchains[chain].libid;
}

function decodeEVMTransactionForApproval(
  rawTx,
  chain,
) {
  try {
    const { decimals } = blockchains[chain];
    const multisigUserOpJSON = JSON.parse(rawTx);
    const { callData } = multisigUserOpJSON.userOpRequest;

    const decodedData = viem.decodeFunctionData({
      abi: abi.MultiSigSmartAccount_abi,
      data: callData,
    });

    let txReceiver = 'decodingError';
    let amount = '0';

    if (
      decodedData
      && decodedData.functionName === 'execute'
      && decodedData.args
      && decodedData.args.length === 3
    ) {
      // eslint-disable-next-line prefer-destructuring
      txReceiver = decodedData.args[0];
      amount = new BigNumber(decodedData.args[1].toString())
        .dividedBy(new BigNumber(10 ** decimals))
        .toFixed();
    } else {
      throw new Error('Unexpected decoded data.');
    }

    const txInfo = {
      receiver: txReceiver,
      amount,
    };
    return txInfo;
  } catch (error) {
    log.error(error);
    return {
      receiver: 'decodingError',
      amount: 'decodingError',
    };
  }
}

function decodeTransactionForApproval(
  rawTx,
  chain = 'btc',
) {
  try {
    if (blockchains[chain].chainType === 'evm') {
      return decodeEVMTransactionForApproval(rawTx, chain);
    }
    log.info('Decoding transaction for approval');
    log.info(rawTx);
    log.info(chain);
    const libID = getLibId(chain);
    const cashAddrPrefix = blockchains[chain].cashaddr;
    const network = utxolib.networks[libID];
    const txhex = rawTx;
    const txb = utxolib.TransactionBuilder.fromTransaction(
      utxolib.Transaction.fromHex(txhex, network),
      network,
    );

    log.info(JSON.stringify(txb));
    let txReceiver = 'decodingError';
    let amount = '0';
    let senderAddress = '';

    if (txb.inputs[0].witnessScript && txb.inputs[0].redeemScript) {
      // p2sh-p2wsh
      const scriptPubKey = utxolib.script.scriptHash.output.encode(
        utxolib.crypto.hash160(txb.inputs[0].redeemScript),
      );
      senderAddress = utxolib.address.fromOutputScript(scriptPubKey, network);
    } else if (txb.inputs[0].witnessScript) {
      // p2wsh
      const scriptPubKey = utxolib.script.witnessScriptHash.output.encode(
        utxolib.crypto.sha256(txb.inputs[0].witnessScript),
      );
      senderAddress = utxolib.address.fromOutputScript(scriptPubKey, network);
    } else {
      // p2sh
      const scriptPubKey = utxolib.script.scriptHash.output.encode(
        utxolib.crypto.hash160(txb.inputs[0].redeemScript),
      );
      senderAddress = utxolib.address.fromOutputScript(scriptPubKey, network);
    }
    txb.tx.outs.forEach((out) => {
      if (out.value) {
        const address = utxolib.address.fromOutputScript(out.script, network);
        if (address !== senderAddress) {
          txReceiver = address;
          amount = new BigNumber(out.value)
            .dividedBy(new BigNumber(1e8))
            .toFixed();
        }
      }
    });
    if (txReceiver === 'decodingError') {
      // use first output as being the receiver
      const outOne = txb.tx.outs[0];
      if (outOne.value) {
        const address = utxolib.address.fromOutputScript(
          outOne.script,
          network,
        );
        log.warn(address);
        txReceiver = address;
        amount = new BigNumber(outOne.value)
          .dividedBy(new BigNumber(1e8))
          .toFixed();
      }
    }
    if (cashAddrPrefix) {
      txReceiver = bchaddrjs.toCashAddress(txReceiver);
    }
    const txInfo = {
      receiver: txReceiver,
      amount,
    };
    return txInfo;
  } catch (error) {
    log.error(error);
    return {
      receiver: 'decodingError',
      amount: 'decodingError',
    };
  }
}

module.exports = {
  decodeTransactionForApproval,
};
