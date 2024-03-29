const axios = require('axios');
const config = require('config');
const log = require('../lib/log');

let fiatRates = {};
let cryptoRates = {};

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
    const url = `https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?CMC_PRO_API_KEY=${apiKey}&id=1,3029,2577,2,74`;
    const response = await axios.get(url);
    const priceFlux = response.data.data['3029'].quote.USD.price;
    const priceBtc = response.data.data['1'].quote.USD.price;
    const priceRvn = response.data.data['3029'].quote.USD.price;
    const priceLtc = response.data.data['2'].quote.USD.price;
    const priceDoge = response.data.data['74'].quote.USD.price;
    const prices = {
      flux: priceFlux, rvn: priceRvn, btc: priceBtc, ltc: priceLtc, doge: priceDoge,
    };
    cryptoRates = prices;
  } catch (error) {
    log.error(error);
  }
}

function getRates() {
  const rates = {
    fiat: fiatRates, // 1 usd = X fiat
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
    setTimeout(() => {
      initRates();
    }, 5 * 60 * 1000); // 5 mins
  }
}

module.exports = {
  getRates,
  fetchFiatRates,
  fetchCryptoRates,
  initRates,
};
