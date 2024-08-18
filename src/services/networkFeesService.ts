import axios from 'axios';
import config from 'config';
import log from '../lib/log';
import serviceHelper from './serviceHelper';

let currentFees = [];

async function obtainBitcoinFees() {
  const url = 'https://bitcoinfees.net/api.json';
  const url2 = 'https://api.blockcypher.com/v1/btc/main';
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

async function obtainEthFees() {
  const url = `https://eth-mainnet.g.alchemy.com/v2/${config.keys.alchemy}`;
  try {
    const dataA = {
      id: new Date().getTime,
      jsonrpc: '2.0',
      method: 'eth_gasPrice',
    };
    const dataB = {
      id: new Date().getTime,
      jsonrpc: '2.0',
      method: 'rundler_maxPriorityFeePerGas',
    };
    const resA = await axios.post(url, dataA);
    const resB = await axios.post(url, dataB);
    let priorityFee = parseInt(resB.data.result, 16);
    if (priorityFee < 1250000000) {
      priorityFee = 1250000000;
    }
    const baseFee = +(
      Math.floor(parseInt(resA.data.result, 16) * 1.25) / 1e9
    ).toFixed(9);
    const economyFee = +(Math.floor(priorityFee * 1) / 1e9).toFixed(9);
    const normalFee = +(Math.floor(priorityFee * 1.15) / 1e9).toFixed(9);
    const fastFee = +(Math.floor(priorityFee * 1.3) / 1e9).toFixed(9);

    const feesObject = {
      coin: 'eth',
      base: baseFee,
      economy: economyFee,
      normal: normalFee,
      fast: fastFee,
      recommended: fastFee,
    };
    return feesObject;
  } catch (error) {
    log.error(error);
    return false;
  }
}

async function obtainSepoliaFees() {
  const url = `https://eth-sepolia.g.alchemy.com/v2/${config.keys.alchemy}`;
  try {
    const dataA = {
      id: new Date().getTime,
      jsonrpc: '2.0',
      method: 'eth_gasPrice',
    };
    const dataB = {
      id: new Date().getTime,
      jsonrpc: '2.0',
      method: 'rundler_maxPriorityFeePerGas',
    };
    const resA = await axios.post(url, dataA);
    const resB = await axios.post(url, dataB);
    let priorityFee = parseInt(resB.data.result, 16);
    if (priorityFee < 1250000000) {
      priorityFee = 1250000000;
    }
    const baseFee = +(
      Math.floor(parseInt(resA.data.result, 16) * 1.2) / 1e9
    ).toFixed(9);
    const economyFee = +(Math.floor(priorityFee * 1) / 1e9).toFixed(9);
    const normalFee = +(Math.floor(priorityFee * 1.1) / 1e9).toFixed(9);
    const fastFee = +(Math.floor(priorityFee * 1.2) / 1e9).toFixed(9);

    const feesObject = {
      coin: 'sepolia',
      base: baseFee,
      economy: economyFee,
      normal: normalFee,
      fast: fastFee,
      recommended: fastFee,
    };
    return feesObject;
  } catch (error) {
    log.error(error);
    return false;
  }
}

let i = -1;

async function fetchFees() {
  i += 1;
  const fees = [];
  let btcFee;
  let ltcFee;
  if (i % 10 === 1) {
    // intentional second round, prefer faster load for evm
    btcFee = await obtainBitcoinFees();
    await serviceHelper.delay(61000);
    ltcFee = await obtainLitecoinFees();
  } else {
    btcFee = currentFees.find((f) => f.coin === 'btc');
    ltcFee = currentFees.find((f) => f.coin === 'ltc');
  }
  const ethFee = await obtainEthFees();
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
  await serviceHelper.delay(18000); // every 18 seconds
  fetchFees();
}

async function networkFees(res) {
  while (currentFees.length === 0) {
    await serviceHelper.delay(500);
  }
  res.json(currentFees);
}

export default {
  networkFees,
  fetchFees,
  obtainBitcoinFees,
  obtainLitecoinFees,
  obtainEthFees,
  obtainSepoliaFees
};
