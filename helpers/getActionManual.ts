import axios from 'axios';

async function getAction() {
  const response = await axios.get(
    'https://relay.ssp.runonflux.io/v1/action/testkappab',
  );
  console.log(JSON.stringify(response.data));
}

getAction().catch((error) => {
  console.log(error);
});
