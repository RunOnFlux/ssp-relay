import axios from 'axios';

async function postSync() {
  const data = {
    chain: 'btc',
    walletIdentity: 'testkappa',
    keyXpub: 'xpubaaaa',
    generatedAddress: '0-0addressGeneratedonKeyMustMatchOnWallet',
    wkIdentity: 'asdadsadad',
    publicNonces: [{ kPublic: 'akk', kTwoPublic: 'asdd' }],
  };
  const response = await axios.post(
    'https://relay.ssp.runonflux.io/v1/sync',
    data,
  );
  console.log(response.data);
}

postSync().catch((error) => {
  console.log(error);
});
