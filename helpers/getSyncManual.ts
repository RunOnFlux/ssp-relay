const axios = require('axios');

async function getSync() {
  const response = await axios.get(
    'https://relay.ssp.runonflux.io/v1/sync/testkappa',
  );
  console.log(JSON.stringify(response.data));
}

getSync();
