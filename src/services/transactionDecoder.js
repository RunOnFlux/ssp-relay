const BigNumber = require('bignumber.js');
const utxolib = require('utxo-lib');

function decodeTransactionForApproval(
  rawTx,
  chain = 'flux',
) {
  try {
    const network = utxolib.networks[chain];
    const txhex = rawTx;
    const txb = utxolib.TransactionBuilder.fromTransaction(
      utxolib.Transaction.fromHex(txhex, network),
      network,
    );
    console.log(JSON.stringify(txb));
    let txReceiver = '';
    let amount = '0';
    let senderAddress = '';
    const scriptPubKey = utxolib.script.scriptHash.output.encode(
      utxolib.crypto.hash160(txb.inputs[0].redeemScript),
    );

    senderAddress = utxolib.address.fromOutputScript(
      scriptPubKey,
      network,
    );
    txb.tx.outs.forEach((out) => {
      if (out.value) {
        const address = utxolib.address.fromOutputScript(out.script, network);
        console.log(address);
        if (address !== senderAddress) {
          txReceiver = address;
          amount = new BigNumber(out.value)
            .dividedBy(new BigNumber(1e8))
            .toFixed();
        }
      }
    });
    const txInfo = {
      receiver: txReceiver,
      amount,
    };
    return txInfo;
  } catch (error) {
    console.log(error);
    return {
      receiver: 'decodingError',
      amount: 'decodingError',
    };
  }
}

module.exports = {
  decodeTransactionForApproval,
};
