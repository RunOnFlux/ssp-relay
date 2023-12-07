const axios = require('axios');

async function postSync() {
  const data = {
    chain: 'btc',
    path: '0-0',
    wkIdentity: 'testkappab',
    action: 'tx',
    payload: '04asdadw',
  };
  const response = await axios.post('https://relay.ssp.runonflux.io/v1/action', data);
  console.log(response.data);
}

postSync();
