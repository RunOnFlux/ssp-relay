import { Alchemy, Network } from 'alchemy-sdk';
import config from 'config';

export async function getFromAlchemy(contractAddress: string, network: string) {
  let networkValue: Network;

  // need to add here if new network with tokens
  if (network == 'eth') {
    networkValue = Network.ETH_MAINNET;
  } else if (network === 'sepolia') {
    networkValue = Network.ETH_SEPOLIA;
  } else {
    throw new Error('Unsupported network');
  }

  const alchemy = new Alchemy({
    apiKey: "U6aOhjmaLQzmOhKeMCpx16c9aUlcGgpW",
    // apiKey: `${config.keys.alchemy}`,
    network: networkValue,
  });

  const metadata = await alchemy.core.getTokenMetadata(contractAddress);
  return metadata;
}
