import BigNumber from 'bignumber.js';
import utxolib from '@runonflux/utxo-lib';
import bchaddrjs from 'bchaddrjs';
import * as viem from 'viem';
import { generated } from '@runonflux/aa-schnorr-multisig-sdk';

import blockchains from './blockchains';
import log from '../lib/log';

import { getFromAlchemy } from './tokenServices';

function getLibId(chain) {
  return blockchains[chain].libid;
}

async function decodeEVMTransactionForApproval(rawTx, chain = 'eth') {
  try {
    let { decimals } = blockchains[chain];
    const multisigUserOpJSON = JSON.parse(rawTx);
    const {
      callData,
      sender,
      callGasLimit,
      verificationGasLimit,
      preVerificationGas,
      maxFeePerGas,
      maxPriorityFeePerGas,
    } = multisigUserOpJSON.userOpRequest;

    const totalGasLimit = new BigNumber(callGasLimit)
      .plus(new BigNumber(verificationGasLimit))
      .plus(new BigNumber(preVerificationGas));

    const totalMaxWeiPerGas = new BigNumber(maxFeePerGas).plus(
      new BigNumber(maxPriorityFeePerGas),
    );

    const totalFeeWei = totalGasLimit.multipliedBy(totalMaxWeiPerGas);

    console.log(multisigUserOpJSON);

    // callGasLimit":"0x5ea6","verificationGasLimit":"0x11b5a","preVerificationGas":"0xdf89","maxFeePerGas":"0xee6b28000","maxPriorityFeePerGas":"0x77359400",
    const decodedData = viem.decodeFunctionData({
      abi: generated.abi.MultiSigSmartAccount_abi as viem.Abi,
      data: callData,
    });

    let txReceiver = 'decodingError';
    let amount = '0';

    if (
      decodedData &&
      decodedData.functionName === 'execute' &&
      decodedData.args &&
      decodedData.args.length >= 3
    ) {
      txReceiver = decodedData.args[0] as string;
      amount = new BigNumber(decodedData.args[1].toString())
        .dividedBy(new BigNumber(10 ** decimals))
        .toFixed();
    } else {
      throw new Error('Unexpected decoded data.');
    }

    const txInfo = {
      sender,
      receiver: txReceiver,
      amount,
      fee: totalFeeWei.toFixed(),
      token: '',
      tokenSymbol: '',
      data: '',
    };

    if (amount === '0') {
      txInfo.token = decodedData.args[0] as string;

      // find the token in our token list
      let token = blockchains[chain].tokens.find(
        (t) => t.contract.toLowerCase() === txInfo.token.toLowerCase(),
      );

      if (!token) {
        token = await getFromAlchemy(
          txInfo.token.toLowerCase(), // contract address
          chain.toLowerCase(), // chain
        ).catch((error) => {
          log.error(
            `Error getting token info from alchemy for ${txInfo.token} on ${chain}. Might be a contract execution.`,
          );
          log.error(error);
        });
      }

      if (token) {
        decimals = token.decimals;
        txInfo.tokenSymbol = token.symbol;
        const contractData = decodedData.args[2];
        // most likely we are dealing with a contract call, sending some erc20 token
        // docode args[2] which is operation
        const decodedDataContract = viem.decodeFunctionData({
          abi: viem.erc20Abi,
          data: contractData as `0x${string}`,
        });
        console.log(decodedDataContract);
        if (
          decodedDataContract &&
          decodedDataContract.functionName === 'transfer' &&
          decodedDataContract.args &&
          decodedDataContract.args.length >= 2
        ) {
          txInfo.receiver = decodedDataContract.args[0];
          txInfo.amount = new BigNumber(decodedDataContract.args[1].toString())
            .dividedBy(new BigNumber(10 ** decimals))
            .toFixed();
        }
      } else {
        // this is not a standard token transfer, treat it as a contract execution and only display data information
        txInfo.data = decodedData.args[2] as `0x${string}`;
      }
    } else {
      txInfo.tokenSymbol = blockchains[chain].symbol;
    }

    return txInfo;
  } catch (error) {
    console.log(error);
    const txInfo = {
      sender: 'decodingError',
      receiver: 'decodingError',
      amount: 'decodingError',
      fee: 'decodingError',
      token: 'decodingError',
      tokenSymbol: 'decodingError',
      data: 'decodingError',
    };
    return txInfo;
  }
}

async function decodeTransactionForApproval(rawTx, chain = 'btc') {
  try {
    if (blockchains[chain].chainType === 'evm') {
      const decoded = await decodeEVMTransactionForApproval(rawTx, chain);
      return decoded;
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
      tokenSymbol: blockchains[chain].symbol,
    };
    return txInfo;
  } catch (error) {
    log.error(error);
    return {
      receiver: 'decodingError',
      amount: 'decodingError',
      tokenSymbol: 'decodingError',
    };
  }
}

export default {
  decodeTransactionForApproval,
};
