const axios = require('axios');

async function postSync() {
  const data = {
    chain: 'btc',
    walletIdentity: 'testkappa',
    keyXpub: 'xpubaaaa',
    wkIdentity: 'asdadsadad',
    publicNonces: [{ kPublic: 'akk', kTwoPublic: 'asdd' }],
  };
  const response = await axios.post('https://relay.ssp.runonflux.io/v1/sync', data);
  console.log(response.data);
}

postSync();
