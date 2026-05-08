import dbsecrets from './dbsecrets';
import apisecrets from './apisecrets';
import freshdesksecrets from './freshdesksecrets';
import alchemysecrets from './alchemysecrets';
import onrampersecrets from './onrampersecrets';
import emailsecrets from './emailsecrets';
import solanasecrets from './solanasecrets';

export default {
  server: {
    port: 9876,
  },
  database: {
    url: '127.0.0.1',
    port: 27017,
    database: dbsecrets.dbname,
    username: dbsecrets.dbusername,
    password: dbsecrets.dbpassword,
  },
  collections: {
    v1sync: 'v1sync', // object of chain, walletIdentity (wallet only identity), keyXpub (key xpub) and wkIdentity (entire multisig ssp identity address). 15 min expiration
    v1action: 'v1action', // object of chain, path (derivation path), w-k identity (wallet-key identity), type: tpe of action (only tx now), payload: (txhex for tx action to sign). 15 min expiration
    v1token: 'v1token', // object of w-k identity and keytoken, wallettoken. Persistent. Used for push notifications
  },
  keys: {
    cmc: apisecrets.cmcApiKey,
    cmcb: apisecrets.cmcApiKeyB,
    freshdesk: freshdesksecrets.apikey,
    alchemy: alchemysecrets.alchemyApiKey,
    onramper: onrampersecrets.secretKey,
    coingecko: apisecrets.coingeckoApiKey,
  },
  freshdesk: {
    namespace: freshdesksecrets.namespace,
    groupId: freshdesksecrets.groupid,
    ips: freshdesksecrets.ips,
  },
  email: {
    smtp: {
      host: emailsecrets.smtp.host,
      port: emailsecrets.smtp.port,
      secure: emailsecrets.smtp.secure,
      user: emailsecrets.smtp.user,
      pass: emailsecrets.smtp.pass,
    },
    from: emailsecrets.from,
    to: emailsecrets.to,
  },
  services: {
    onramp: true,
    offramp: true,
    swap: true,
  },
  solana: {
    // Per-chain paymaster keypairs + RPC endpoints. The paymaster signs
    // tx feePayer slot for SSP users so they don't need SOL in their leaf
    // keypair; relay broadcasts the resulting fully-signed tx.
    devnet: {
      rpc: 'https://api.devnet.solana.com',
      paymasterSecretKey: solanasecrets.solDevnet.paymasterSecretKey,
    },
    // Mainnet — disabled until the SSP Solana Multisig program is audited
    // and deployed to mainnet. Operators should override `rpc` with a paid
    // RPC (Helius, Triton, etc.) and set `paymasterSecretKey` before going
    // live; the public mainnet-beta endpoint is rate-limited and unsuitable
    // for production traffic.
    mainnet: {
      rpc: 'https://api.mainnet-beta.solana.com',
      paymasterSecretKey: solanasecrets.solMainnet.paymasterSecretKey,
    },
  },
};
