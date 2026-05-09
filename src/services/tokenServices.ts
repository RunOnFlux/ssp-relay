import { Alchemy, Network } from 'alchemy-sdk';
import config from 'config';
import axios from 'axios';

interface TokenMetadata {
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  logo: string | null;
}

const SOLANA_RPC: Record<string, string> = {
  solDevnet: 'https://api.devnet.solana.com',
  solMainnet: 'https://api.mainnet-beta.solana.com',
};

// Returns decimals (from the mint account) plus optional name/symbol/logo
// from a Metaplex metadata account if one exists. SPL tokens without
// Metaplex metadata return null for name/symbol/logo.
async function getSolanaTokenMetadata(
  mintAddress: string,
  network: string,
): Promise<TokenMetadata> {
  const url = SOLANA_RPC[network];
  if (!url) throw new Error(`Unsupported Solana network: ${network}`);

  const mintResp = await axios.post<{
    result: {
      value: {
        data: {
          parsed: { info: { decimals: number; supply: string } };
        };
      } | null;
    };
  }>(url, {
    id: 1,
    jsonrpc: '2.0',
    method: 'getAccountInfo',
    params: [mintAddress, { encoding: 'jsonParsed' }],
  });
  const mintInfo = mintResp.data.result?.value?.data?.parsed?.info;
  if (!mintInfo) {
    throw new Error('Mint account not found');
  }
  const decimals = mintInfo.decimals;

  // 2. Try to fetch Metaplex metadata account for name/symbol. Optional —
  // tokens without on-chain metadata still return decimals.
  let name: string | null = null;
  let symbol: string | null = null;
  let logo: string | null = null;
  try {
    const meta = await fetchMetaplexMetadata(url, mintAddress);
    if (meta) {
      name = meta.name;
      symbol = meta.symbol;
      logo = meta.logo;
    }
  } catch {
    // Non-fatal — token simply has no metadata account.
  }

  return { name, symbol, decimals, logo };
}

const METAPLEX_PROGRAM_ID = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';

async function fetchMetaplexMetadata(
  rpcUrl: string,
  mintAddress: string,
): Promise<TokenMetadata | null> {
  const { PublicKey } = await import('@solana/web3.js');
  const mintPubkey = new PublicKey(mintAddress);
  const [metadataPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('metadata'),
      new PublicKey(METAPLEX_PROGRAM_ID).toBuffer(),
      mintPubkey.toBuffer(),
    ],
    new PublicKey(METAPLEX_PROGRAM_ID),
  );

  const resp = await axios.post<{
    result: {
      value: { data: [string, string] } | null;
    };
  }>(rpcUrl, {
    id: 1,
    jsonrpc: '2.0',
    method: 'getAccountInfo',
    params: [metadataPda.toBase58(), { encoding: 'base64' }],
  });

  const accountData = resp.data.result?.value?.data;
  if (!accountData) return null;
  const raw = Buffer.from(accountData[0], 'base64');

  // Metaplex layout: 1 byte key + 32 update_authority + 32 mint, then
  // length-prefixed name/symbol/uri zero-padded to fixed widths.
  if (raw.length < 1 + 32 + 32 + 4) return null;
  let offset = 1 + 32 + 32;
  const readString = (): string => {
    const len = raw.readUInt32LE(offset);
    offset += 4;
    const str = raw.subarray(offset, offset + len).toString('utf8');
    offset += len;
    return str.replace(/\0+$/, '').trim();
  };
  const name = readString();
  const symbol = readString();
  const uri = readString();

  // Try to resolve image URL from the off-chain JSON pointed at by `uri`.
  let logo: string | null = null;
  if (uri && uri.startsWith('http')) {
    try {
      const offChain = await axios.get<{ image?: string }>(uri, {
        timeout: 5000,
      });
      if (offChain.data?.image) logo = offChain.data.image;
    } catch {
      /* off-chain JSON unavailable — return without logo */
    }
  }

  return { name: name || null, symbol: symbol || null, decimals: null, logo };
}

export async function getFromAlchemy(contractAddress: string, network: string) {
  if (network === 'solDevnet' || network === 'solMainnet') {
    return getSolanaTokenMetadata(contractAddress, network);
  }

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
