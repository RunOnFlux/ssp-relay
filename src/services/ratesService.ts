const axios = require('axios');
const config = require('config');
const log = require('../lib/log');

let fiatRates = {};
let cryptoRates = {
  btc: undefined,
  eth: undefined,
};

async function fetchFiatRates() {
  try {
    const response = await axios.get('https://api.mixin.one/external/fiats');
    const { data } = response;
    const fetchedRates = data.data;
    const fiatObject = {};
    fetchedRates.forEach((rate) => {
      fiatObject[rate.code] = rate.rate;
    });
    fiatRates = fiatObject;
  } catch (error) {
    log.error(error);
  }
}

async function fetchCryptoRates() {
  try {
    const apiKey = config.keys.cmc;
    const url = `https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?CMC_PRO_API_KEY=${apiKey}&id=1,3029,2577,2,74,1027,1437,1831,825,3408`;
    const response = await axios.get(url);
    const priceBtc = response.data.data['1'].quote.USD.price;
    const priceFlux = response.data.data['3029'].quote.USD.price;
    const priceRvn = response.data.data['2577'].quote.USD.price;
    const priceLtc = response.data.data['2'].quote.USD.price;
    const priceDoge = response.data.data['74'].quote.USD.price;
    const priceEth = response.data.data['1027'].quote.USD.price;
    const priceZec = response.data.data['1437'].quote.USD.price;
    const priceBch = response.data.data['1831'].quote.USD.price;
    const priceUSDT = response.data.data['825'].quote.USD.price;
    const priceUSDC = response.data.data['3408'].quote.USD.price;
    const prices = {
      btc: priceBtc,
      flux: priceFlux,
      rvn: priceRvn,
      ltc: priceLtc,
      doge: priceDoge,
      eth: priceEth,
      zec: priceZec,
      bch: priceBch,
      usdt: priceUSDT,
      usdc: priceUSDC,
    };
    cryptoRates = prices;
  } catch (error) {
    log.error(error);
  }
}

function getRates() {
  const fiatRatesWithBTC = {
    ...fiatRates,
    BTC: 1 / cryptoRates.btc,
    ETH: 1 / cryptoRates.eth,
  };
  const rates = {
    fiat: fiatRatesWithBTC, // 1 usd = X fiat
    crypto: cryptoRates, // always to usd
  };
  return rates;
}

async function initRates() {
  try {
    await fetchFiatRates();
    await fetchCryptoRates();
  } catch (error) {
    log.error(error);
  } finally {
    setTimeout(
      () => {
        initRates();
      },
      5 * 60 * 1000,
    ); // 5 mins
  }
}

module.exports = {
  getRates,
  fetchFiatRates,
  fetchCryptoRates,
  initRates,
};
