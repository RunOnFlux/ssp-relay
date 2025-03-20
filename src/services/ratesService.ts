import axios from 'axios';
import config from 'config';
import log from '../lib/log';

let fiatRates = {};
let cryptoRates = {
  btc: 1,
  eth: 1,
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
    const apiKeyA = config.keys.cmc;
    const apiKeyB = config.keys.cmcb;
    // use api key A or B with 50% chance
    const apiKey = Math.random() < 0.5 ? apiKeyA : apiKeyB;
    const url = `https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?CMC_PRO_API_KEY=${apiKey}&id=1,3029,2577,2,74,1027,1437,1831,825,3408,3717,2396,1958,11419,5994,1975,3957,4943,7083,3773,24478,26081,28321,5690,3897,3635,10603,7278,11841,12437,7226,1518,6719,11092,10804,23095,8425,10368,6536,8000,3155,16086,21159,4558,4269,19891,28298,6783,22691,13502,5176,7080,6210,13855,2694,1966,29587,9481,2563,4705,4066,7186,18876,1518,27772,7326,30171,26997,9104,3640,9816,17799,8290,1659,4041,5692,8119,10407,23121,27659,21585,12220,3964,2777,29676,6538,8104,18069,7501,6945,14806,23711,2682,1455,28301,32120,2299,1697,3783,1896,29814,21259,12999,27565,21846,8536,2467,2943`;
    const response = await axios.get(url);
    const prices = {
      btc: response.data.data['1'].quote.USD.price,
      flux: response.data.data['3029'].quote.USD.price,
      rvn: response.data.data['2577'].quote.USD.price,
      ltc: response.data.data['2'].quote.USD.price,
      doge: response.data.data['74'].quote.USD.price,
      eth: response.data.data['1027'].quote.USD.price,
      zec: response.data.data['1437'].quote.USD.price,
      bch: response.data.data['1831'].quote.USD.price,
      usdt: response.data.data['825'].quote.USD.price,
      usdc: response.data.data['3408'].quote.USD.price,
      wbtc: response.data.data['3717'].quote.USD.price,
      weth: response.data.data['2396'].quote.USD.price,
      trx: response.data.data['1958'].quote.USD.price,
      ton: response.data.data['11419'].quote.USD.price,
      shib: response.data.data['5994'].quote.USD.price,
      link: response.data.data['1975'].quote.USD.price,
      leo: response.data.data['3957'].quote.USD.price,
      dai: response.data.data['4943'].quote.USD.price,
      uni: response.data.data['7083'].quote.USD.price,
      fet: response.data.data['3773'].quote.USD.price,
      pepe: response.data.data['24478'].quote.USD.price,
      fdusd: response.data.data['26081'].quote.USD.price,
      pol: response.data.data['28321'].quote.USD.price,
      rndr: response.data.data['5690'].quote.USD.price,
      render: response.data.data['5690'].quote.USD.price,
      okb: response.data.data['3897'].quote.USD.price,
      cro: response.data.data['3635'].quote.USD.price,
      imx: response.data.data['10603'].quote.USD.price,
      aave: response.data.data['7278'].quote.USD.price,
      arb: response.data.data['11841'].quote.USD.price,
      mnt: response.data.data['12437'].quote.USD.price,
      inj: response.data.data['7226'].quote.USD.price,
      mkr: response.data.data['1518'].quote.USD.price,
      grt: response.data.data['6719'].quote.USD.price,
      bgb: response.data.data['11092'].quote.USD.price,
      floki: response.data.data['10804'].quote.USD.price,
      bonk: response.data.data['23095'].quote.USD.price,
      jasmy: response.data.data['8425'].quote.USD.price,
      kcs: response.data.data['10368'].quote.USD.price,
      om: response.data.data['6536'].quote.USD.price,
      ldo: response.data.data['8000'].quote.USD.price,
      qnt: response.data.data['3155'].quote.USD.price,
      btt: response.data.data['16086'].quote.USD.price,
      ondo: response.data.data['21159'].quote.USD.price,
      wflow: response.data.data['4558'].quote.USD.price,
      gt: response.data.data['4269'].quote.USD.price,
      usdd: response.data.data['19891'].quote.USD.price,
      beam: response.data.data['28298'].quote.USD.price,
      axs: response.data.data['6783'].quote.USD.price,
      strk: response.data.data['22691'].quote.USD.price,
      wld: response.data.data['13502'].quote.USD.price,
      xaut: response.data.data['5176'].quote.USD.price,
      gala: response.data.data['7080'].quote.USD.price,
      sand: response.data.data['6210'].quote.USD.price,
      ens: response.data.data['13855'].quote.USD.price,
      nexo: response.data.data['2694'].quote.USD.price,
      mana: response.data.data['1966'].quote.USD.price,
      w: response.data.data['29587'].quote.USD.price,
      pendle: response.data.data['9481'].quote.USD.price,
      tusd: response.data.data['2563'].quote.USD.price,
      paxg: response.data.data['4705'].quote.USD.price,
      chz: response.data.data['4066'].quote.USD.price,
      cake: response.data.data['7186'].quote.USD.price,
      ape: response.data.data['18876'].quote.USD.price,
      snx: response.data.data['1518'].quote.USD.price,
      pyusd: response.data.data['27772'].quote.USD.price,
      dexe: response.data.data['7326'].quote.USD.price,
      ena: response.data.data['30171'].quote.USD.price,
      zro: response.data.data['26997'].quote.USD.price,
      aioz: response.data.data['9104'].quote.USD.price,
      lpt: response.data.data['3640'].quote.USD.price,
      nft: response.data.data['9816'].quote.USD.price,
      axl: response.data.data['17799'].quote.USD.price,
      super: response.data.data['8290'].quote.USD.price,
      gno: response.data.data['1659'].quote.USD.price,
      mx: response.data.data['4041'].quote.USD.price,
      comp: response.data.data['5692'].quote.USD.price,
      sfp: response.data.data['8119'].quote.USD.price,
      babydoge: response.data.data['10407'].quote.USD.price,
      blur: response.data.data['23121'].quote.USD.price,
      mog: response.data.data['27659'].quote.USD.price,
      safe: response.data.data['21585'].quote.USD.price,
      osmo: response.data.data['12220'].quote.USD.price,
      rsr: response.data.data['3964'].quote.USD.price,
      iotx: response.data.data['2777'].quote.USD.price,
      aevo: response.data.data['29676'].quote.USD.price,
      crv: response.data.data['6538'].quote.USD.price,
      '1inch': response.data.data['8104'].quote.USD.price,
      gmt: response.data.data['18069'].quote.USD.price,
      woo: response.data.data['7501'].quote.USD.price,
      amp: response.data.data['6945'].quote.USD.price,
      people: response.data.data['14806'].quote.USD.price,
      prime: response.data.data['23711'].quote.USD.price,
      hot: response.data.data['2682'].quote.USD.price,
      glm: response.data.data['1455'].quote.USD.price,
      meme: response.data.data['28301'].quote.USD.price,
      g: response.data.data['32120'].quote.USD.price,
      elf: response.data.data['2299'].quote.USD.price,
      bat: response.data.data['1697'].quote.USD.price,
      ankr: response.data.data['3783'].quote.USD.price,
      zrx: response.data.data['1896'].quote.USD.price,
      ethfi: response.data.data['29814'].quote.USD.price,
      zeta: response.data.data['21259'].quote.USD.price,
      ssv: response.data.data['12999'].quote.USD.price,
      arkm: response.data.data['27565'].quote.USD.price,
      id: response.data.data['21846'].quote.USD.price,
      mask: response.data.data['8536'].quote.USD.price,
      trac: response.data.data['2467'].quote.USD.price,
      rpl: response.data.data['2943'].quote.USD.price,
      kava: response.data.data['2943'].quote.USD.price,
      virtual: response.data.data['2943'].quote.USD.price,
      xcn: response.data.data['2943'].quote.USD.price,
      matic: response.data.data['2943'].quote.USD.price,
      spx: response.data.data['2943'].quote.USD.price,
      ctc: response.data.data['2943'].quote.USD.price,
      morpho: response.data.data['2943'].quote.USD.price,
      eigen: response.data.data['2943'].quote.USD.price,
      ath: response.data.data['2943'].quote.USD.price,
      zkj: response.data.data['2943'].quote.USD.price,
      rose: response.data.data['2943'].quote.USD.price,
      zil: response.data.data['2943'].quote.USD.price,
      ach: response.data.data['2943'].quote.USD.price,
      auction: response.data.data['2943'].quote.USD.price,
      cvx: response.data.data['2943'].quote.USD.price,
      moca: response.data.data['2943'].quote.USD.price,
      red: response.data.data['2943'].quote.USD.price,
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

export default {
  getRates,
  fetchFiatRates,
  fetchCryptoRates,
  initRates,
};
