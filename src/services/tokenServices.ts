import { Alchemy, Network } from "alchemy-sdk";
import config from 'config';

export async function getFromAlchemy (contractAddress: any, network: any) {
  let value : any;
  
  // need to add here if new network with tokens
  if (network == 'eth') {
    value = Network.ETH_MAINNET;
  } else {
    value = Network.ETH_SEPOLIA;
  }

  const alchemy = new Alchemy({
    apiKey: `${config.keys.alchemy}`,
    network: value,
  });

  const metadata = await alchemy.core.getTokenMetadata(contractAddress);
  return metadata;
}