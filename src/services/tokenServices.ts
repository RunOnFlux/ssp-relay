import { Alchemy, Network } from 'alchemy-sdk';
import config from 'config';

export async function getFromAlchemy(contractAddress: string, network: string) {
  let networkValue: Network;

  // need to add here if new network with tokens
  if (network == 'eth') {
    networkValue = Network.ETH_MAINNET;
  } else if (network === 'sepolia') {
    networkValue = Network.ETH_SEPOLIA;
  } else if (network === 'polygon') {
    networkValue = Network.MATIC_MAINNET;
  } else if (network === 'amoy') {
    networkValue = Network.MATIC_AMOY;
  } else if (network === 'base') {
    networkValue = Network.BASE_MAINNET;
  } else if (network === 'bsc') {
    networkValue = Network.BNB_MAINNET;
  } else if (network === 'avax') {
    networkValue = Network.AVAX_MAINNET;
  } else {
    throw new Error('Unsupported network');
  }

  const alchemy = new Alchemy({
    apiKey: `${config.keys.alchemy}`,
    network: networkValue,
  });

  const metadata = await alchemy.core.getTokenMetadata(contractAddress);
  return metadata;
}
