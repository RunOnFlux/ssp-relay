import axios from 'axios';

async function postAction() {
  const data = {
    chain: 'btc',
    path: '0-0',
    wkIdentity: 'testkappab',
    action: 'tx',
    payload: '04asdadw',
  };
  const response = await axios.post(
    'https://relay.ssp.runonflux.io/v1/action',
    data,
  );
  console.log(response.data);
}

postAction().catch((error) => {
  console.log(error);
});
