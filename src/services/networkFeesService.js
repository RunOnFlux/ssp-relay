const axios = require('axios');
const log = require('../lib/log');
const serviceHelper = require('./serviceHelper');

let currentFees = [];

async function obtainBitcoinFees() {
  const url = 'https://bitcoinfees.net/api.json';
  const url2 = 'https://proxy.app.runonflux.io/https://api.blockcypher.com/v1/btc/main';
  try {
    const res = await axios.get(url);
    const eco1 = Math.ceil(res.data.fee_by_block_target[30] / 1000);
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
  const url2 = 'https://proxy.app.runonflux.io/https://api.blockcypher.com/v1/ltc/main';
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

async function obtainEthFees() {
  const url = 'https://api.owlracle.info/v4/ethereum/gas';
  try {
    const res = await axios.get(url);
    const fastFee = res.data.speeds.find((s) => s.acceptance === 1);
    const base = Math.floor(fastFee.baseFee * 1e9);
    const eco = Math.floor(res.data.speeds[1].maxPriorityFeePerGas * 1e9);
    const normal = Math.floor(res.data.speeds[2].maxPriorityFeePerGas * 1e9);
    const fast = Math.floor(fastFee.maxPriorityFeePerGas * 1e9);

    const feesObject = {
      coin: 'eth',
      base,
      economy: eco,
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

async function obtainSepoliaFees() {
  const url = 'https://api.owlracle.info/v4/sepolia/gas';
  try {
    const res = await axios.get(url);
    const fastFee = res.data.speeds.find((s) => s.acceptance === 1);
    const base = Math.floor(fastFee.baseFee * 1e9);
    const eco = Math.floor(res.data.speeds[1].maxPriorityFeePerGas * 1e9);
    const normal = Math.floor(res.data.speeds[2].maxPriorityFeePerGas * 1e9);
    const fast = Math.floor(fastFee.maxPriorityFeePerGas * 1e9);

    const feesObject = {
      coin: 'sepolia',
      base,
      economy: eco,
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
  const ethFee = await obtainEthFees();
  await serviceHelper.delay(61000);
  const sepFee = await obtainSepoliaFees();
  if (btcFee) {
    fees.push(btcFee);
  }
  if (ltcFee) {
    fees.push(ltcFee);
  }
  if (ethFee) {
    fees.push(ethFee);
  }
  if (sepFee) {
    fees.push(sepFee);
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
