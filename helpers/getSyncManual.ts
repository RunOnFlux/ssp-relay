import axios from 'axios';

async function getSync() {
  const response = await axios.get(
    'https://relay.ssp.runonflux.io/v1/sync/testkappa',
  );
  console.log(JSON.stringify(response.data));
}

getSync().catch((error) => {
  console.log(error);
});
