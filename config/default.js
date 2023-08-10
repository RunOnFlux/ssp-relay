const secrets = require('./secrets');

module.exports = {
  server: {
    port: 9876,
  },
  database: {
    url: '127.0.0.1',
    port: 27017,
    database: secrets.dbname,
    username: secrets.dbusername,
    password: secrets.dbpassword,
  },
  collections: {
    v1sync: 'v1sync', // object of chain, walletIdentity (wallet only identity), keyXpub (key xpub) and sspIdentity (entire multisig ssp identity address). 15 min expiration
    v1action: 'v1action', // object of chain, w-k identity (wallet-key identity), type: tpe of action (only tx now), payload: (txhex for tx action to sign). 15 min expiration
  },
};
