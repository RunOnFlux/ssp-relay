import dbsecrets from './dbsecrets';
import apisecrets from './apisecrets';
import freshdesksecrets from './freshdesksecrets';
import helpdesksecrets from './helpdesksecrets';
import alchemysecrets from './alchemysecrets';
import onrampersecrets from './onrampersecrets';
import emailsecrets from './emailsecrets';

export default {
  server: {
    port: 9876,
    // Number of trusted proxy hops in front of the relay, used by Express to
    // resolve req.ip from X-Forwarded-For. Production sits behind Cloudflare →
    // FDM/HAProxy → relay, so 2. Overridable at runtime with the TRUST_PROXY
    // env var (a number, or an express trust-proxy string like a CIDR). Setting
    // this too high lets a client spoof req.ip via a prepended XFF entry; the
    // rate limiter no longer depends on it (it keys off CF-Connecting-IP via
    // clientIpKey), but morgan access logs and any other req.ip reader do.
    trustProxy: 2,
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
    v1recoverypub: 'v1recoverypub', // object of w-k identity and recoveryXpub (public account xpub) + its detached signature. Persistent.
  },
  keys: {
    cmc: apisecrets.cmcApiKey,
    cmcb: apisecrets.cmcApiKeyB,
    freshdesk: freshdesksecrets.apikey,
    alchemy: alchemysecrets.alchemyApiKey,
    onramper: onrampersecrets.secretKey,
    // Onramper Signature V2 Ed25519 private key (PEM). The same key pair as
    // ZelCore's backend, since both use the same Onramper API key.
    // ONRAMPER_SIGN_V2_PRIVATE_KEY overrides it at runtime.
    onramperSignV2: onrampersecrets.signV2PrivateKey,
    coingecko: apisecrets.coingeckoApiKey,
  },
  freshdesk: {
    namespace: freshdesksecrets.namespace,
    groupId: freshdesksecrets.groupid,
    ips: freshdesksecrets.ips,
  },
  // The Flux Helpdesk (support.runonflux.io), which replaces Freshdesk. Tickets go there
  // once both are set in helpdesksecrets.ts; while either is empty they go to Freshdesk.
  helpdesk: {
    url: helpdesksecrets.url,
    token: helpdesksecrets.token,
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
  onramper: {
    // Public widget API key, shared with ZelCore (not a secret: it is in every
    // widget URL).
    apiKey: 'pk_prod_01JDMCZ0ZRZ14VBRW20B4HC04V',
    widgetEndpoint: 'https://buy.onramper.com',
    // Widget URL signing for POST /v1/onramper/url: 'v1' (legacy HMAC) or 'v2'
    // (Ed25519 + endUserIpHash). 'v2' needs keys.onramperSignV2 on every relay
    // instance; Onramper registered the public key on 2026-11-16, and ZelCore's
    // backend signs with the same key pair. ONRAMPER_SIGNATURE_VERSION=v1
    // rolls back at runtime.
    signatureVersion: 'v2',
    // V2 only: bind each checkout to the caller's IP (endUserIpHash). Kill
    // switch if users hit IP-mismatch 403s; ONRAMPER_BIND_END_USER_IP=false
    // overrides it at runtime.
    bindEndUserIp: true,
  },
  services: {
    onramp: true,
    offramp: true,
    swap: true,
  },
  solana: {
    // Per-chain RPC endpoints. The paymaster keypair itself is resolved at
    // runtime by solPaymasterService — see resolveKeypair() for the
    // full lookup chain (env var → ~/.config/ssp-relay/paymaster-{chain}.json
    // → auto-generate, devnet only). Mainnet operators should also override
    // `rpc` here with a paid endpoint (Helius, Triton, etc.) — the public
    // mainnet-beta endpoint is rate-limited and unsuitable for production.
    //
    // `priorityFeeMicroLamports` is a ComputeBudget compute-unit price applied
    // to the transactions the paymaster builds AND signs itself (multisig/nonce
    // setup, nonce-pool top-ups). On mainnet, base-fee-only transactions are
    // deprioritised under load and routinely dropped outright — the signature
    // simply never lands — so a non-zero value is required there. Devnet is
    // uncontended, hence 0. Our instructions burn ~10k CU, so 50k µlamports/CU
    // costs ~500 lamports per tx: negligible against the reimbursement floors
    // in FEE_SCHEDULE, and cheap insurance against a stuck setup.
    devnet: {
      rpc: 'https://api.devnet.solana.com',
      priorityFeeMicroLamports: 0,
    },
    mainnet: {
      // Branded endpoint: the ssp-backends-proxy Worker holds the provider
      // credential and fronts it as node-solana.sspwallet.io, so no token
      // lives in this repo or in any client bundle. Requests carrying
      // SSP_RELAY_PROXY_KEY land in the Worker's higher relay rate-limit
      // bucket instead of the per-IP one (we poll every vault from one IP).
      rpc: 'https://node-solana.sspwallet.io',
      priorityFeeMicroLamports: 50000,
    },
  },
};
