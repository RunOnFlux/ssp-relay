const axios = require('axios');
const config = require('config');
const log = require('../lib/log');

let fiatRates = [];
let cryptoRates = [];

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
    // flux id is 3029
    const url = `https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?CMC_PRO_API_KEY=${apiKey}&id=3029`;
    const response = await axios.get(url);
    const { price } = response.data.data['3029'].quote.USD;
    const prices = [{ flux: price }];
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
    }, 15 * 60 * 1000); // 15 mins
  }
}

module.exports = {
  getRates,
  fetchFiatRates,
  fetchCryptoRates,
  initRates,
};
