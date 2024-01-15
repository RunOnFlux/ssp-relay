const axios = require('axios');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');

let currentFees = [];

async function obtainBitcoinFees() {
  const url = 'https://bitcoinfees.net/api.json';
  const url2 = 'https://api.blockcypher.com/v1/btc/main';
  try {
    const res = await axios.get(url);
    const eco1 = Math.ceil(res.data.fee_by_block_target[20] / 1000);
    const normal1 = Math.ceil(res.data.fee_by_block_target[5] / 1000);
    const fast1 = Math.ceil(res.data.fee_by_block_target[1] / 1000);

    const res2 = await axios.get(url2);
    const eco2 = Math.ceil(res2.data.low_fee_per_kb / 1000);
    const normal2 = Math.ceil(res2.data.medium_fee_per_kb / 1000);
    const fast2 = Math.ceil(res2.data.high_fee_per_kb / 1000);

    // logic
    // prefer faster options
    const economy = eco1 > eco2 ? eco1 : eco2;
    const normal = normal1 > normal2 ? normal1 : normal2;
    const fast = fast1 > fast2 ? fast1 : fast2;

    const feesObject = {
      coin: 'btc',
      economy,
      normal,
      fast,
      recommended: fast,
    };
    return feesObject;
  } catch (error) {
    log.error(error);
    return false;
  }
}

async function obtainLitecoinFees() {
  const url2 = 'https://api.blockcypher.com/v1/ltc/main';
  try {
    const res2 = await axios.get(url2);
    const eco2 = Math.ceil(res2.data.low_fee_per_kb / 1000);
    const normal2 = Math.ceil(res2.data.medium_fee_per_kb / 1000);
    const fast2 = Math.ceil(res2.data.high_fee_per_kb / 1000);

    // logic
    // prefer faster eco, faster fast, lower normal
    const economy = eco2;
    const normal = normal2;
    const fast = fast2;

    const feesObject = {
      coin: 'ltc',
      economy,
      normal,
      fast,
      recommended: fast,
    };
    return feesObject;
  } catch (error) {
    log.error(error);
    return false;
  }
}

async function fetchFees() {
  const fees = [];
  const btcFee = await obtainBitcoinFees();
  await serviceHelper.delay(61000);
  const ltcFee = await obtainLitecoinFees();
  if (btcFee) {
    fees.push(btcFee);
  }
  if (ltcFee) {
    fees.push(ltcFee);
  }
  currentFees = fees;
  await serviceHelper.delay(61000);
  fetchFees();
}

async function networkFees(res) {
  while (currentFees.length === 0) {
    // eslint-disable-next-line no-await-in-loop
    await serviceHelper.delay(500);
  }
  res.json(currentFees);
}

module.exports = {
  networkFees,
  fetchFees,
};
