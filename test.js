const axios = require('axios');

async function obtainSepoliaFees() {
  const url = `https://eth-sepolia.g.alchemy.com/v2/U6aOhjmaLQzmOhKeMCpx16c9aUlcGgpW`;
  try {
    const data = {
      id: new Date().getTime,
      jsonrpc: '2.0',
      method: 'eth_gasPrice',
    };
    const res = await axios.post(url, data);
    console.log(res.data);
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
    console.error(error);
    return false;
  }
}

obtainSepoliaFees();
