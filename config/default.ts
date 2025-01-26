import dbsecrets from './dbsecrets';
import apisecrets from './apisecrets';
import freshdesksecrets from './freshdesksecrets';
import alchemysecrets from './alchemysecrets';

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
  },
  freshdesk: {
    namespace: freshdesksecrets.namespace,
    groupId: freshdesksecrets.groupid,
    ips: freshdesksecrets.ips,
  },
  services: {
    onramp: true,
    offramp: true,
    swap: true,
  },
};
