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
    // Validate and parse JSON safely
    if (typeof rawTx !== 'string') {
      throw new Error('Invalid transaction format: must be string');
    }
    if (rawTx.length > 500000) {
      throw new Error('Invalid transaction format: too large');
    }

    let multisigUserOpJSON;
    try {
      multisigUserOpJSON = JSON.parse(rawTx);
    } catch {
      throw new Error('Invalid transaction format: invalid JSON');
    }

    if (!multisigUserOpJSON || typeof multisigUserOpJSON !== 'object') {
      throw new Error('Invalid transaction format: must be object');
    }
    if (
      !multisigUserOpJSON.userOpRequest ||
      typeof multisigUserOpJSON.userOpRequest !== 'object'
    ) {
      throw new Error('Invalid transaction format: missing userOpRequest');
    }

    let { decimals } = blockchains[chain];
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

    log.debug({
      message: 'Decoding EVM transaction',
      multisigUserOpJSON,
    });

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
        log.debug({
          message: 'Decoded ERC20 contract data',
          decodedDataContract,
        });
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
    log.error({
      message: 'Error decoding EVM transaction',
      error,
    });
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

/**
 * Decode an SSP Solana proposal payload for the push-notification body.
 *
 * The wallet sends `tx` actions for SOL chains as a JSON wrapper:
 *   { unsignedTxBase64, needsInit, walletInitSigBase64, ... }
 *
 * We pull `unsignedTxBase64` out, deserialize it as a Solana tx, find the
 * `create_transaction` ix, and walk its inline proposal message to identify
 * the user's send (vault → recipient) and the paymaster reimbursement
 * (vault → paymaster, used as the displayed fee).
 */
async function decodeSOLTransactionForApproval(rawTx, chain) {
  try {
    const { Transaction, PublicKey, SystemProgram } =
      await import('@solana/web3.js');
    const { createHash } = await import('crypto');

    let serialized = rawTx;
    try {
      const parsed = JSON.parse(rawTx);
      if (parsed && typeof parsed.unsignedTxBase64 === 'string') {
        serialized = parsed.unsignedTxBase64;
      }
    } catch {
      // not JSON — assume it's already a base64 tx
    }

    const decimals = blockchains[chain].decimals;
    const tokenSymbol = blockchains[chain].symbol;

    const tx = Transaction.from(Buffer.from(serialized, 'base64'));
    if (!tx.feePayer) {
      throw new Error('Solana tx missing feePayer');
    }
    const paymasterPubkey = tx.feePayer;

    const createIxDiscriminator = createHash('sha256')
      .update('global:create_transaction')
      .digest()
      .subarray(0, 8);

    const createIx = tx.instructions.find(
      (ix) =>
        ix.data.length >= 8 &&
        Buffer.from(ix.data).subarray(0, 8).equals(createIxDiscriminator),
    );
    if (!createIx) {
      throw new Error('Solana tx does not contain a create_transaction ix');
    }

    const data = Buffer.from(createIx.data);
    let off = 8 + 1 + 3; // skip discriminator + vault_index + 3-byte header
    const accountKeysLen = data.readUInt32LE(off);
    off += 4;
    const accountKeys = [];
    for (let i = 0; i < accountKeysLen; i++) {
      accountKeys.push(new PublicKey(data.subarray(off, off + 32)));
      off += 32;
    }
    const ixCount = data.readUInt32LE(off);
    off += 4;

    const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

    let userReceiver = '';
    let userAmountBase = '0';
    let userTokenSymbol = tokenSymbol;

    for (let i = 0; i < ixCount; i++) {
      off += 1; // programIdIndex consumed below via ixProgram lookup
      const programIdIdx = data.readUInt8(off - 1);
      const aiLen = data.readUInt32LE(off);
      off += 4;
      const accountIdxs = data.subarray(off, off + aiLen);
      off += aiLen;
      const ixDataLen = data.readUInt32LE(off);
      off += 4;
      const ixData = data.subarray(off, off + ixDataLen);
      off += ixDataLen;

      const ixProgram = accountKeys[programIdIdx];
      if (!ixProgram) continue;

      if (ixProgram.equals(SystemProgram.programId)) {
        // SystemProgram::transfer = tag 2 (4-byte LE) + 8-byte lamports
        if (ixData.length < 12 || ixData.readUInt32LE(0) !== 2) continue;
        if (accountIdxs.length < 2) continue;
        const toPubkey = accountKeys[accountIdxs[1]];
        if (!toPubkey) continue;
        if (toPubkey.equals(paymasterPubkey)) continue; // skip fee transfer
        userReceiver = toPubkey.toBase58();
        userAmountBase = ixData.readBigUInt64LE(4).toString();
        continue;
      }

      if (ixProgram.toBase58() === TOKEN_PROGRAM) {
        const tag = ixData.readUInt8(0);
        if ((tag !== 3 && tag !== 12) || ixData.length < 9) continue;
        if (accountIdxs.length < 2) continue;
        const destAta = accountKeys[accountIdxs[1]];
        if (!destAta) continue;
        userReceiver = destAta.toBase58();
        userAmountBase = ixData.readBigUInt64LE(1).toString();
        userTokenSymbol = '(token)';
      }
    }

    const isNative = userTokenSymbol === tokenSymbol;
    const displayAmount = isNative
      ? new BigNumber(userAmountBase).dividedBy(10 ** decimals).toFixed()
      : userAmountBase;

    return {
      receiver: userReceiver || 'decodingError',
      amount: displayAmount,
      tokenSymbol: userTokenSymbol,
    };
  } catch (error) {
    log.error(error);
    return {
      receiver: 'decodingError',
      amount: 'decodingError',
      tokenSymbol: 'decodingError',
    };
  }
}

async function decodeTransactionForApproval(rawTx, chain = 'btc') {
  try {
    if (blockchains[chain].chainType === 'evm') {
      const decoded = await decodeEVMTransactionForApproval(rawTx, chain);
      return decoded;
    }
    if (blockchains[chain].chainType === 'sol') {
      const decoded = await decodeSOLTransactionForApproval(rawTx, chain);
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
