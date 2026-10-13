import dbsecrets from './dbsecrets';
import apisecrets from './apisecrets';
import freshdesksecrets from './freshdesksecrets';
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
    tronSponsorOps: 'tron_sponsor_ops', // every sponsored TRON broadcast (audit data, NO TTL). Read directly by the dashboard.
    tronNonceReservations: 'tron_nonce_reservations', // TRON quote nonce reservations + quoted energy, TTL on expiresAt (= Op deadline)
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
  kaspa: {
    // kaspa-rest-server hosts, tried in order. The branded host is the
    // ssp-backends-proxy Worker (→ api.kas.zelcore.io); api.kaspa.org is the
    // public fallback. Used only for the relay's fee estimate.
    rest: ['https://api-kaspa.sspwallet.io', 'https://api.kaspa.org'],
  },
  tron: {
    // TRON sponsor (tronSponsorService). Relayer keys, the kill switch and
    // rental credentials are ENV ONLY (see README "TRON sponsor"); nothing
    // secret lives here.
    //
    // energyPriceSun: what SSP currently pays per unit of energy (sun) — the
    // procurement price of rented/pooled energy, NOT the 100 sun burn price.
    // Every quote is `energy × energyPriceSun + bandwidthBytes × 1000`, times
    // `markup`, and every broadcast must pay at least that cost (no markup)
    // at today's simulation. Raise it the moment procurement gets dearer,
    // otherwise sponsored sends run at a loss. Env TRON_ENERGY_PRICE_SUN
    // overrides it without a code change (read at start: restart the relay).
    energyPriceSun: 45,
    // Default quote markup for consumer sends (enterprise passes its own).
    markup: 1.15,
    // Launch cap (plan §8.2): sponsored Ops per vault per rolling 24 h.
    // 0 disables the cap.
    maxOpsPerVaultPerDay: 50,
    // Circuit breaker: once sponsored transactions of PROVEN vaults (vaults
    // that had paid `newVaultPaidOps` sponsored fees) that FAILED on-chain
    // burned this much of S's energy in the rolling hour, and those failures
    // come from at least 3 distinct vaults, the relay refuses new sponsored
    // broadcasts on that chain until the window rolls (logged as an error).
    // The failure events live in Mongo (`tronNonceReservations`, kept 24 h),
    // so the budget is shared by every relay process and survives restarts.
    // A vault's owner can always force a revert the relay cannot foresee (a
    // self-paid Op racing the sponsored one, code deployed at a recipient),
    // so this bounds what that costs. ≈ 2 max-size failures; 0 disables it.
    // (The per-vault, per-signer and per-client failure limits are fixed in
    // tronSponsorService and are not configured here.)
    maxFailedEnergyPerHour: 2_500_000,
    // The same budget for failures of NEW (unproven) vaults, kept apart so
    // that free fresh vaults cannot stop sponsorship for everyone: exhausting
    // it refuses only vaults without paid sponsored history; proven vaults
    // keep being sponsored. ≈ 3–4 failed races of fresh 2-of-2 vaults.
    // Integer in [0, 100000000]; 0 = no separate pool (new-vault failures
    // count toward maxFailedEnergyPerHour instead). Env
    // TRON_MAX_NEW_VAULT_FAILED_ENERGY_PER_HOUR overrides it; read at start.
    maxNewVaultFailedEnergyPerHour: 1_500_000,
    // New-vault energy cap (TRX-1): vaults and signers are free, so until a
    // vault has paid `newVaultPaidOps` confirmed sponsored fees, a sponsored
    // Op may simulate to at most `newVaultMaxSponsoredEnergy` energy instead
    // of the 1.2M launch cap. 350k admits one transfer of any kind on first
    // use of a 2-of-2 vault (a first send costs 172k–305k), so a fresh
    // 2-of-2 vault can put at most 1.25 × 350k of S's energy at stake per
    // failed race. Vaults with a larger threshold get +4,650 per signature
    // above 2 (the measured cost of verifying it; 20-of-40: 433,700).
    // Integer in [50000, 1200000]; env TRON_NEW_VAULT_MAX_ENERGY overrides it.
    newVaultMaxSponsoredEnergy: 350_000,
    // Confirmed, fee-paying sponsored Ops after which a vault gets the full
    // launch cap. Integer in [0, 1000]; 0 disables the new-vault cap. Env
    // TRON_NEW_VAULT_PAID_OPS overrides it. Both are read at start: restart
    // the relay after changing them.
    newVaultPaidOps: 3,
    // Per network: `node` = full-node HTTP API (/wallet/*, /walletsolidity/*),
    // `api` = TronGrid v1. Both are the ssp-backends-proxy Worker, which gets
    // the X-SSP-Relay-Key header like the Solana path.
    //
    // factory / implementation / sponsor / feeCollector are OVERRIDES for
    // Nile or local-chain testing only. The SDK's pinned NETWORKS table wins:
    // an override may only fill a value the SDK has as null, and an override
    // that disagrees with a pinned value stops the relay at startup.
    mainnet: {
      node: 'https://node-tron.sspwallet.io',
      api: 'https://api-tron.sspwallet.io',
      factory: null,
      implementation: null,
      sponsor: null,
      feeCollector: null,
    },
    nile: {
      node: 'https://node-tronnile.sspwallet.io',
      api: 'https://api-tronnile.sspwallet.io',
      factory: null,
      implementation: null,
      sponsor: null,
      feeCollector: null,
    },
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
