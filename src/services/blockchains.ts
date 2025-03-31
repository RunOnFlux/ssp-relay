import { tokens } from './tokens';

const flux = {
  id: 'flux',
  libid: 'flux',
  name: 'Flux',
  symbol: 'FLUX',
  decimals: 8,
  slip: 19167,
  scriptType: 'p2sh',
  messagePrefix: '\u0018Zelcash Signed Message:\n',
  pubKeyHash: '1cb8',
  scriptHash: '1cbd',
  wif: '80',
  bip32: {
    public: 0x0488b21e,
    private: 0x0488ade4,
  },
  txVersion: 4,
  txGroupID: 0x892f2085,
  backend: 'insight',
  dustLimit: 546, // min utxo amount
  minFeePerByte: 1, // min fee per byte
  feePerByte: 1, // fee per byte
  maxMessage: 80, // 80 bytes in size
  maxTxSize: 1800000, // 1,800,000 vbytes
  rbf: false,
  txExpiryHeight: 30, // 30 blocks, 1 hour
};

const fluxTestnet = {
  id: 'fluxTestnet',
  libid: 'fluxtestnet',
  name: 'Testnet Flux',
  symbol: 'TEST-FLUX',
  decimals: 8,
  slip: 1, // all testnets have 1
  scriptType: 'p2sh',
  messagePrefix: '\u0018Zelcash Signed Message:\n',
  pubKeyHash: '1d25',
  scriptHash: '1cba',
  wif: 'ef',
  bip32: {
    public: 0x043587cf,
    private: 0x04358394,
  },
  txVersion: 4,
  txGroupID: 0x892f2085,
  backend: 'insight',
  dustLimit: 546, // min utxo amount
  minFeePerByte: 1, // min fee per byte
  feePerByte: 1, // fee per byte
  maxMessage: 80, // 80 bytes in size
  maxTxSize: 1800000, // 1,800,000 vbytes
  rbf: false,
  txExpiryHeight: 30, // 30 blocks, 1 hour
};

const rvn = {
  id: 'rvn',
  libid: 'ravencoin',
  name: 'Ravencoin',
  symbol: 'RVN',
  decimals: 8,
  slip: 175,
  scriptType: 'p2sh',
  messagePrefix: '\u0016Raven Signed Message:\n',
  pubKeyHash: '3c',
  scriptHash: '7a',
  wif: '80',
  bip32: {
    public: 0x0488b21e,
    private: 0x0488ade4,
  },
  backend: 'blockbook',
  dustLimit: 546, // min utxo amount
  minFeePerByte: 1000, // min fee per byte
  feePerByte: 1050, // fee per byte
  maxMessage: 80, // 80 bytes in size
  maxTxSize: 100000, // 100,000 vbytes
  rbf: true,
};

const ltc = {
  id: 'ltc',
  libid: 'litecoin',
  name: 'Litecoin',
  symbol: 'LTC',
  decimals: 8,
  slip: 2,
  scriptType: 'p2wsh',
  messagePrefix: '\u0019Litecoin Signed Message:\n',
  pubKeyHash: '30',
  scriptHash: '32',
  wif: 'b0',
  bip32: {
    public: 0x019da462,
    private: 0x019d9cfe,
  },
  backend: 'blockbook',
  bech32: 'ltc',
  dustLimit: 546, // min utxo amount
  minFeePerByte: 1, // min fee per byte
  feePerByte: 20, // fee per byte
  maxMessage: 80, // 80 bytes in size
  maxTxSize: 100000, // 100,000 vbytes
  rbf: true,
};

const btc = {
  id: 'btc',
  libid: 'bitcoin',
  name: 'Bitcoin',
  symbol: 'BTC',
  decimals: 8,
  slip: 0,
  scriptType: 'p2wsh',
  messagePrefix: '\u0018Bitcoin Signed Message:\n',
  pubKeyHash: '00',
  scriptHash: '05',
  wif: '80',
  bip32: {
    public: 0x02aa7ed3,
    private: 0x02aa7a99,
  },
  backend: 'blockbook',
  bech32: 'bc1',
  dustLimit: 546, // min utxo amount
  minFeePerByte: 1, // min fee per byte
  feePerByte: 100, // fee per byte
  maxMessage: 80, // 80 bytes in size
  maxTxSize: 100000, // 100,000 vbytes
  rbf: true,
};

const doge = {
  id: 'doge',
  libid: 'dogecoin',
  name: 'Dogecoin',
  symbol: 'DOGE',
  decimals: 8,
  slip: 3,
  scriptType: 'p2sh',
  messagePrefix: '\u0019Dogecoin Signed Message:\n',
  pubKeyHash: '1e',
  scriptHash: '16',
  wif: '9e',
  bip32: {
    public: 0x02facafd,
    private: 0x02fac398,
  },
  backend: 'blockbook',
  dustLimit: 1000000, // min utxo amount
  minFeePerByte: 1000, // min fee per byte
  feePerByte: 20, // fee per byte
  maxMessage: 80, // 80 bytes in size
  maxTxSize: 100000, // 100,000 vbytes
  rbf: true,
};

const btcTestnet = {
  id: 'btcTestnet',
  libid: 'testnet',
  name: 'Testnet Bitcoin',
  symbol: 'TEST-BTC',
  decimals: 8,
  slip: 1,
  scriptType: 'p2wsh',
  messagePrefix: '\u0018Bitcoin Signed Message:\n',
  pubKeyHash: '6f',
  scriptHash: 'c4',
  wif: 'ef',
  bip32: {
    public: 0x02575483,
    private: 0x02575048,
  },
  backend: 'blockbook',
  bech32: 'tb1',
  dustLimit: 546, // min utxo amount
  minFeePerByte: 1, // min fee per byte
  feePerByte: 5, // fee per byte
  maxMessage: 80, // 80 bytes in size
  maxTxSize: 100000, // 100,000 vbytes
  rbf: true,
};

const btcSignet = {
  id: 'btcSignet',
  libid: 'testnet',
  name: 'Signet Bitcoin',
  symbol: 'TEST-BTC',
  decimals: 8,
  slip: 1,
  scriptType: 'p2wsh',
  messagePrefix: '\u0018Bitcoin Signed Message:\n',
  pubKeyHash: '6f',
  scriptHash: 'c4',
  wif: 'ef',
  bip32: {
    public: 0x02575483,
    private: 0x02575048,
  },
  backend: 'blockbook',
  bech32: 'tb1',
  dustLimit: 546, // min utxo amount
  minFeePerByte: 1, // min fee per byte
  feePerByte: 4, // fee per byte
  maxMessage: 80, // 80 bytes in size
  maxTxSize: 100000, // 100,000 vbytes
  rbf: true,
};

const zec = {
  id: 'zec',
  libid: 'zcash',
  name: 'Zcash',
  symbol: 'ZEC',
  decimals: 8,
  slip: 133,
  scriptType: 'p2sh',
  messagePrefix: '\u0018Zcash Signed Message:\n',
  pubKeyHash: '1cb8',
  scriptHash: '1cbd',
  wif: '80',
  bip32: {
    public: 0x0488b21e,
    private: 0x0488ade4,
  },
  txVersion: 4,
  txGroupID: 0x892f2085,
  backend: 'blockbook',
  dustLimit: 546, // min utxo amount
  minFeePerByte: 1, // min fee per byte
  feePerByte: 2, // fee per byte
  maxMessage: 80, // 80 bytes in size
  maxTxSize: 100000, // 100,000 vbytes
  rbf: false,
  txExpiryHeight: 60, // 1 hour
};

const bch = {
  id: 'bch',
  libid: 'bitcoincash',
  name: 'Bitcoin Cash',
  symbol: 'BCH',
  decimals: 8,
  slip: 145,
  scriptType: 'p2sh',
  messagePrefix: '\u0018Bitcoin Signed Message:\n',
  pubKeyHash: '00',
  scriptHash: '05',
  wif: '80',
  bip32: {
    public: 0x0488b21e,
    private: 0x0488ade4,
  },
  backend: 'blockbook',
  dustLimit: 546, // min utxo amount
  minFeePerByte: 1, // min fee per byte
  feePerByte: 15, // fee per byte
  maxMessage: 80, // 80 bytes in size
  maxTxSize: 100000, // 100,000 vbytes
  rbf: true,
  cashaddr: 'bitcoincash:',
};

const sepolia = {
  id: 'sepolia',
  libid: 'sepolia',
  name: 'Testnet Sepolia',
  symbol: 'TEST-ETH',
  slip: 1,
  decimals: 18,
  bip32: {
    // not specified, use default
    public: 0x0488b21e,
    private: 0x0488ade4,
  },
  scriptType: 'p2sh', // not specified, use default
  chainType: 'evm',
  backend: 'alchemy',
  accountSalt: 'aasalt', // ssp uses this salt for smart accounts
  factorySalt: 'aafactorysalt', // factory uses this salt
  factoryAddress: '0xA76f98D25C9775F67DCf8B9EF9618d454D287467',
  entrypointAddress: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
  baseFee: 120, // 120 gwei
  priorityFee: 5, // 5 gwei
  gasLimit: 500000, // 500k gas
  tokens: tokens.sepolia(),
};

const eth = {
  id: 'eth',
  libid: 'eth',
  name: 'Ethereum',
  symbol: 'ETH',
  slip: 60,
  decimals: 18,
  bip32: {
    // not specified, use default
    public: 0x0488b21e,
    private: 0x0488ade4,
  },
  scriptType: 'p2sh', // not specified, use default
  chainType: 'evm',
  backend: 'alchemy',
  accountSalt: 'aasalt', // ssp uses this salt for smart accounts
  factorySalt: 'aafactorysalt', // factory uses this salt
  factoryAddress: '0xA76f98D25C9775F67DCf8B9EF9618d454D287467',
  entrypointAddress: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
  baseFee: 8, // 8 gwei
  priorityFee: 2, // 2 gwei
  gasLimit: 500000, // 500k gas
  tokens: tokens.eth(),
};

const amoy = {
  id: 'amoy',
  libid: 'polygonAmoy',
  name: 'Testnet Polygon Amoy',
  symbol: 'TEST-POL',
  slip: 1,
  decimals: 18,
  bip32: {
    // not specified, use default
    public: 0x0488b21e,
    private: 0x0488ade4,
  },
  scriptType: 'p2sh', // not specified, use default
  chainType: 'evm',
  chainId: '80002',
  backend: 'alchemy',
  accountSalt: 'aasalt', // ssp uses this salt for smart accounts
  factorySalt: 'aafactorysalt', // factory uses this salt
  factoryAddress: '0x3974821943e9cA3549744D910999332eE387Fda4',
  entrypointAddress: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
  baseFee: 120, // 120 gwei
  priorityFee: 5, // 5 gwei
  gasLimit: 750000, // 750k gas
  tokens: tokens.amoy(),
};

const polygon = {
  id: 'polygon',
  libid: 'polygon',
  name: 'Polygon',
  symbol: 'POL',
  slip: 966,
  decimals: 18,
  bip32: {
    // not specified, use default
    public: 0x0488b21e,
    private: 0x0488ade4,
  },
  scriptType: 'p2sh', // not specified, use default
  chainType: 'evm',
  chainId: '137',
  backend: 'alchemy',
  accountSalt: 'aasalt', // ssp uses this salt for smart accounts
  factorySalt: 'aafactorysalt', // factory uses this salt
  factoryAddress: '0x3974821943e9cA3549744D910999332eE387Fda4',
  entrypointAddress: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
  baseFee: 50, // 50 gwei
  priorityFee: 5, // 5 gwei
  gasLimit: 750000, // 750k gas
  tokens: tokens.polygon(),
  onramperNetwork: 'polygon',
};

const base = {
  id: 'base',
  libid: 'base',
  name: 'Base',
  symbol: 'ETH',
  slip: 8453,
  decimals: 18,
  bip32: {
    // not specified, use default
    public: 0x0488b21e,
    private: 0x0488ade4,
  },
  scriptType: 'p2sh', // not specified, use default
  chainType: 'evm',
  chainId: '8453',
  backend: 'alchemy',
  accountSalt: 'aasalt', // ssp uses this salt for smart accounts
  factorySalt: 'aafactorysalt', // factory uses this salt
  factoryAddress: '0x3974821943e9cA3549744D910999332eE387Fda4',
  entrypointAddress: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
  baseFee: 0.1, // 0.1 gwei
  priorityFee: 0.01, // 0.01 gwei
  gasLimit: 750000, // 750k gas
  tokens: tokens.base(),
  onramperNetwork: 'base',
};

const bsc = {
  id: 'bsc',
  libid: 'bsc',
  name: 'Binance Smart Chain',
  symbol: 'BNB',
  slip: 9006,
  decimals: 18,
  bip32: {
    // not specified, use default
    public: 0x0488b21e,
    private: 0x0488ade4,
  },
  scriptType: 'p2sh', // not specified, use default
  chainType: 'evm',
  chainId: '56',
  backend: 'etherspot',
  accountSalt: 'aasalt', // ssp uses this salt for smart accounts
  factorySalt: 'aafactorysalt', // factory uses this salt
  factoryAddress: '0x3974821943e9cA3549744D910999332eE387Fda4',
  entrypointAddress: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
  baseFee: 3, // 50 gwei
  priorityFee: 1, // 5 gwei
  gasLimit: 750000, // 750k gas
  tokens: tokens.bsc(),
  onramperNetwork: 'bsc',
};

const avax = {
  id: 'avax',
  libid: 'avalanche',
  name: 'Avalanche C-Chain',
  symbol: 'AVAX',
  slip: 9005,
  decimals: 18,
  bip32: {
    // not specified, use default
    public: 0x0488b21e,
    private: 0x0488ade4,
  },
  scriptType: 'p2sh', // not specified, use default
  chainType: 'evm',
  chainId: '43114',
  backend: 'etherspot',
  accountSalt: 'aasalt', // ssp uses this salt for smart accounts
  factorySalt: 'aafactorysalt', // factory uses this salt
  factoryAddress: '0x3974821943e9cA3549744D910999332eE387Fda4',
  entrypointAddress: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
  baseFee: 10, // 50 gwei
  priorityFee: 1, // 5 gwei
  gasLimit: 750000, // 750k gas
  tokens: tokens.avax(),
  onramperNetwork: 'avax',
};

export default {
  btc,
  flux,
  eth,
  bsc,
  doge,
  avax,
  ltc,
  bch,
  polygon,
  base,
  rvn,
  zec,
  btcTestnet,
  btcSignet,
  fluxTestnet,
  sepolia,
  amoy,
};
