# SSP Relay

[![codecov](https://codecov.io/gh/RunOnFlux/ssp-relay/graph/badge.svg?token=75xdbQxCch)](https://codecov.io/gh/RunOnFlux/ssp-relay)  
[![DeepScan grade](https://deepscan.io/api/teams/13348/projects/27694/branches/888993/badge/grade.svg)](https://deepscan.io/dashboard#view=project&tid=13348&pid=27694&bid=888993)  
[![CodeFactor](https://www.codefactor.io/repository/github/runonflux/ssp-relay/badge)](https://www.codefactor.io/repository/github/runonflux/ssp-relay)

---

## Overview

**SSP Relay** is the communication backbone of the **[SSP Wallet](https://sspwallet.io)** ecosystem, enabling seamless interaction between **SSP Wallet** and **SSP Key**. By acting as a secure relay server, it facilitates synchronization, multisignature transaction management, and reliable communication without ever compromising private keys or sensitive data.

### Key Features

- **Secure Communication**: Ensures encrypted and authenticated data transfer between SSP Wallet and SSP Key.
- **Multisignature Support**: Powers the **2-of-2 multisignature architecture**, enhancing the security of user transactions.
- **True Self-Custody**: Operates without storing or accessing private keys, maintaining the user's self-custody.
- **Scalable and Reliable**: Built with modern technologies to handle large-scale usage efficiently.

---

## Requirements

To run SSP Relay, ensure your environment meets the following prerequisites:

- **Node.js**: Version 24 or higher
- **MongoDB**: A running MongoDB instance for data storage and processing

---

## Installation

Follow these steps to set up and run SSP Relay:

1. **Clone the Repository**

   ```bash
   git clone https://github.com/RunOnFlux/ssp-relay.git
   cd ssp-relay
   ```

2. **Install Dependencies**  
   Use Yarn to install the necessary packages:

   ```bash
   yarn install
   ```

3. **Configure MongoDB**  
   Ensure you have a MongoDB instance running and accessible. Update the configuration file with the appropriate MongoDB connection details.

4. **Start the Service**  
   Run the following command to start the SSP Relay server:

   ```bash
   yarn start
   ```

   By default, the service will start at `http://127.0.0.1:9876`.

---

## Usage

SSP Relay is designed to work seamlessly with SSP Wallet and SSP Key. It plays a critical role in:

1. **Synchronization**: Facilitating secure exchange of public keys between SSP Wallet and SSP Key.
2. **Transaction Signing**: Relaying partially signed transactions for final signing and broadcast.

For more details on how SSP Relay integrates with SSP Wallet and SSP Key, refer to the [SSP Documentation](https://sspwallet.gitbook.io/docs).

---

## Security configuration (environment variables)

| Variable                                  | Values                          | Default                                               | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------- | ------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RELAY_LEGACY_UNAUTH_MODE`                | `log` \| `deny`                 | `log`                                                 | Unsigned requests to the POST endpoints that released clients (wallet 2.1.3, Key 2.1.1) do not sign (`/v1/sync`, `/v1/nonces`, `/v1/nonces/validate`, `/v1/nonces/reconcile`, `/v1/sol/broadcast`, `/v1/sol/setup`). `log` (default) lets them through unauthenticated (`req.legacyUnauthenticated = true`, no `req.verifiedIdentity`), logs each one and prints a startup WARNING; `deny` refuses them with 401. Any other value is treated as `deny`. The enterprise module reads it the same way for the nonce endpoints, so unset means `log` there too. **Flip to `deny` once the new SSP Wallet and SSP Key have reached adoption** — under `deny`, pairing, chain sync, nonce replenish and consumer Solana sends break for released clients. `/v1/action`, `/v1/token`, `/v1/recoverypub` and socket joins always require a signature; the wallet-recovery request is the only unsigned action, by design.                                                          |
| `RELAY_READ_AUTH_MODE`                    | `log` \| `enforce`              | `log`                                                 | Unsigned reads of `GET /v1/action/:id`, `GET /v1/sync/:id` and `GET /v1/nonces/status/:id`. `log` serves and logs them (startup WARNING); `enforce` refuses them with 401. A present but invalid read signature is refused in both modes. Flip to `enforce` after the new clients reach adoption.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `RELAY_EVM_CALL_GUARD_MODE`               | `enforce` \| `log`              | `enforce`                                             | Consumer EVM sends (`POST /v1/action`, `action: 'tx'`, userOp payload) are decoded before they are stored or reach SSP Key (finding C-4: released wallet 2.1.3 / Key 2.1.1 show a dApp's `execute(self, value, upgradeToAndCall(...))` as a tiny self-send). Refused with 403 `EVM_CALL_REFUSED`: an inner call to the account itself (the userOp `sender`) with non-empty calldata (a plain value transfer to self stays allowed); an `upgradeTo` / `upgradeToAndCall` call to any target; a top-level callData other than `execute` / `executeBatch`; and, on EVM chains, a payload that does not parse as a userOp (the released Key cannot sign one either). Every violation is logged with `[EVM-GUARD]` (identity, chain, reason). `log` only logs and delivers the request (startup WARNING) — a kill switch if a legitimate send is ever blocked. Any value other than `log` enforces. UTXO and Solana payloads and the enterprise vault actions are not inspected. |
| `RELAY_NONCE_CACHE_MAX_ENTRIES`           | integer                         | `250000`                                              | Upper bound on remembered auth nonces (~250 bytes each). Nonces are never evicted before their payload expires; when the cache is full of live nonces, signed requests get 503 `AUTH_UNAVAILABLE` until entries expire.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `RELAY_OWN_PROXY_HOPS`                    | integer                         | `1`                                                   | SSP-operated proxies between Cloudflare and the relay (Cloudflare → FDM/HAProxy → relay = 1). Used to find the peer that connected to our edge; `CF-Connecting-IP` is honoured only when that peer is a Cloudflare address.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `RELAY_CLOUDFLARE_IP_RANGES`              | comma-separated CIDRs           | built-in list (fetched 2026-10-12)                    | Replaces the embedded Cloudflare edge ranges.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `RELAY_SOCKET_CORS_ORIGINS`               | comma-separated origins, or `*` | extension origins + `https://*.sspwallet.com` / `.io` | Browser origins allowed on the wallet socket's polling transport.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `SSP_RELAY_PROXY_KEY`                     | secret                          | unset                                                 | Sent as `X-SSP-Relay-Key` only to SSP's own `*.sspwallet.io` proxies, never to third-party hosts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `ENTERPRISE_APP_URL`                      | URL                             | `https://enterprise.sspwallet.com`                    | The exact enterprise app origin. Enterprise login and critical-action challenges are bound to it (enterprise module).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `ENTERPRISE_CHALLENGE_TOKEN_MODE`         | `log` \| `enforce`              | `log`                                                 | Whether consumers of an enterprise login challenge (e.g. `POST /v1/enterprise/auth/wk`) must present the `challengeToken` returned with the challenge (enterprise module). `log` (default; unset or empty) logs a missing or wrong token and lets the login proceed, because the released enterprise app does not send one. Any other value enforces. **Flip to `enforce` once an app that sends the token is live and open tabs have reloaded.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `SSP_SOLANA_PRIORITY_FEE`                 | µlamports per CU                | unset (off)                                           | ComputeBudget priority fee on enterprise mainnet Solana vault transactions (enterprise module). Off by default: released wallets (2.1.3) and Keys (2.1.1) refuse vault bundles with ComputeBudget instructions. Set it (e.g. `50000`) once wallet and Key releases that accept them are adopted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `SSP_SOLANA_SETUP_PER_IP_HOURLY`          | non-negative integer            | `3`                                                   | Paymaster-funded Solana vault setups (`POST /v1/sol/setup`) allowed per client IP (`clientIpKey`: CF-Connecting-IP behind Cloudflare, IPv6 per /56) per rolling hour. A setup makes the paymaster pay ~0.0029 SOL of permanent multisig + durable-nonce rent, and its vault balance gate can be satisfied over and over with the same SOL moved between fresh vaults, so paid setups are budgeted. Only setups that send a paymaster transaction are counted (the idempotent already-provisioned path, balance-gate refusals and RPC/preflight refusals are free), and they are charged at the point of spend, so aborting the request does not dodge the count. The released wallet calls setup once per new vault, on its first send. `0` refuses all per-IP setups. Setup requests are additionally capped at 30 per hour per IP at the route.                                                                                                                           |
| `SSP_SOLANA_SETUP_PER_IP_DAILY`           | non-negative integer            | `10`                                                  | Same, per client IP per rolling 24 hours (room for retries after a rare landed-but-failed or timed-out setup, and for several users behind one shared/CGNAT address).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `SSP_SOLANA_SETUP_GLOBAL_HOURLY`          | non-negative integer            | `20`                                                  | Paid setups across all clients per rolling hour. When it (or the lamport budget below) is exhausted every new paid setup is refused with a "try again later" error and one ERROR line `[solPaymaster] ALERT global Solana setup budget exhausted ...` is logged per hour. Bounds the worst case (an attacker with many IPs) to about 20 × 0.003 SOL per hour; already-provisioned vaults keep sending normally. `0` disables paymaster-funded setups (emergency stop).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `SSP_SOLANA_SETUP_GLOBAL_HOURLY_LAMPORTS` | lamports                        | `75000000` (0.075 SOL)                                | Lamports the paymaster may spend on setups per rolling hour. Each setup is charged an estimate (3.2M) up front and then the cost measured from its confirmed transaction (`meta.preBalances`/`postBalances`). Binds only when setups cost more than expected (priority fee, rent change).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `UTXO_RESERVATIONS`                       | `log` \| `enforce` \| `off`     | `log`                                                 | Parallel proposals on UTXO vaults (enterprise module). `log` (default; unset or unknown) records which coins each in-flight proposal uses and logs conflicts without refusing anything. `enforce` makes new proposals skip coins reserved by other proposals and refuse a conflicting claim; at startup it also marks in-flight proposals that share a coin as stale. `off` is the previous behaviour. **Switch to `enforce` once the conflict logs look right.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `EVM_NONCE_KEYS`                          | `on` \| `off`                   | `off`                                                 | Parallel proposals on EVM vaults (enterprise module). `on` gives each proposal its own EntryPoint nonce lane (2D nonce key = proposal id) so several pending proposals can all land. Off by default until one testnet run (Sepolia/Amoy) confirms the bundler accepts non-zero nonce keys and several pending ops per sender. Released wallets and Keys sign both forms.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

**Wallet password recovery (the one unsigned flow, by design).** A recovering wallet has no decrypted keys, so it cannot sign. The exception is deliberately narrow and holds in every mode:

- `POST /v1/action` without auth is accepted only for `action: 'recoveryrequest'` whose payload is exactly `{ pkEph, nonce, timestamp, recoveryIndex[, version] }` (33-byte compressed hex key, 32–128 hex nonce, timestamp within 5 minutes, integer index < 2^31). It is rate-limited per IP (10 per 10 min) and per wkIdentity (5 per 10 min). It never clobbers what someone is waiting for in that identity's single action slot: it is refused while a live action of any other kind is pending, while a `recoveryresponse` / `recoverydenied` is less than 5 minutes old (the recovering wallet is polling for it), and while another recovery request with a different `pkEph` is still inside the Key's 5-minute window (the same `pkEph` may retry). A failure to read the slot refuses the request.
- An unsigned socket `join` on the wallet namespace is admitted only to the room `recovery:<wkIdentity>`, which receives nothing but `recoveryresponse` / `recoverydenied`. The key namespace never admits unsigned joins.
- Under `RELAY_READ_AUTH_MODE=enforce`, an unsigned `GET /v1/action/:id` returns the stored action only if it is `recoveryresponse` or `recoverydenied` (the payload is encrypted to the requester's ephemeral key); anything else, including "nothing pending", is a 401.

Operational requirements: the relay's own port must only be reachable through the SSP proxy (firewall the origin), and the proxy must append `X-Forwarded-For`; otherwise a direct client controls the addresses used for rate limiting.

**Solana paymaster monitoring.** Alert on `[solPaymaster] ALERT` (the global setup budget is exhausted: possible rent grind) and `[solPaymaster] LOSS` (ERROR level: a confirmed sponsored transaction cost the paymaster more than its network fee net of the vault's reimbursement, measured from the transaction's own `meta.preBalances`/`postBalances` — e.g. the recipient closed its token account between the relay's simulation and execution, so the bundled ATA create paid the rent again). Losses count towards the paymaster failure breaker like landed failures: sponsorship (sends and new setups) stops for a multisig after 3 and for a client IP after 5 such events in 24 hours.

**Single process.** Run the relay as ONE process. The auth replay-protection nonce cache, the Solana paymaster failure/loss breaker and setup budget, and the socket.io rooms are all in-process; a second instance behind a load balancer would accept a nonce the first one already spent (signed requests could be replayed against the other instance) and would not see the other's rooms. A multi-instance deployment needs sticky routing per client plus a shared nonce store (e.g. Mongo with a unique index on the nonce and a TTL index) before it is safe. A restart clears the nonce cache: a signed request captured before the restart and still inside its 10-minute timestamp window could be replayed once afterwards.

**Signed POSTs** (`requireAuth`): the signed payload must carry `data` (sha256 hex of `JSON.stringify(body minus signature, message, publicKey, witnessScript)`) and the `action` the route expects: `'action'` for `/v1/action`, `/v1/nonces*`, `/v1/sol/*` and `/v1/enterprise/*`; `'sync'` for `/v1/sync` and `/v1/recoverypub`; `'token'` for `/v1/token`. Both are checked before the signature is verified, so a mis-routed or tampered request never spends the nonce of the honest one. Every client that signs (wallet 2.1.3+, Key 2.1.1+) already sends these.

**Sync records** (`POST /v1/sync`): a live record (< 15 min) for a `walletIdentity` can only be rewritten for the same `wkIdentity`, and an unsigned (legacy) write never replaces a live signed one. Re-pairing a wallet with a different SSP Key waits until the previous record expires (at most 15 minutes).

**Read-auth headers** (`requireReadAuth`): `x-ssp-signature` (base64 Bitcoin message signature), `x-ssp-message` (JSON `{ action: 'read', identity: <:id>, timestamp, nonce, data }`, where `data` is the sha256 hex of the UTF-8 string `GET <path>`, path without the query string), `x-ssp-publickey` (66 hex) and `x-ssp-witnessscript` (hex, required for wkIdentity reads). Send all of them or none.

---

## Development

### Running in Development Mode

To run SSP Relay in development mode, use:

```bash
yarn dev
```

### Testing

SSP Relay includes a suite of tests to ensure reliability. Run the tests using:

```bash
yarn test
```

---

## Solana Paymaster

SSP Relay runs an optional Solana paymaster service that sponsors transaction fees on behalf of SSP Wallet users on Solana chains. This solves a UX gap unique to Solana: SSP shows users their multisig vault PDA as the deposit address, but Solana transactions require a feePayer keypair (PDAs cannot sign). Without a paymaster, users would have to keep SOL in a separate "leaf" keypair address that's never shown to them — confusing and error-prone.

The paymaster:

- **Pays Solana tx fees** by signing the `feePayer` slot on user transactions
- **Auto-tops-up member signers** for proposal account rent (~0.05 SOL per top-up, covers ~7 sends per fund)
- **Validates** that incoming txs have `feePayer` set to the paymaster pubkey before signing
- **Sponsors only SSP bundles** (`/v1/sol/broadcast`, enterprise bundled broadcast): a positive allowlist of the outer instructions AND of the proposal's inner instructions (vault SystemProgram transfers, SPL `TransferChecked` from the vault's own ATA, SPL Memo v2 — nothing else), exactly the signer slots the bundle needs (paymaster + approving members), and a reimbursement of at least max(50,000, signatures × 5,000 + priority fee) lamports (+2.5M when it creates the recipient ATA). A price-only ComputeBudget is billed at 200k CU per instruction. A simulation backstop refuses anything that would cost the paymaster more than its fee.
- **Failure breaker**: a sponsored bundle that lands but fails on-chain still costs its fee. After 3 such failures for one multisig, or 5 for one client IP, within 24 hours, sponsorship for that key is refused. Counts are in-process (see "Single process" above) and reset on restart.

This is purely a UX layer — the underlying SSP Solana Multisig program enforces all multisig security regardless of who pays fees. See [solana-multisig README](https://github.com/RunOnFlux/Solana-Multisig#how-this-differs-from-squads-v4) for the protocol-level guarantees.

### Endpoints

- `GET /v1/sol/paymaster?chain=solDevnet` — returns `{ status, data: { chain, pubkey } }`. Wallet calls this to learn what address to set as `feePayer` when building a tx.
- `POST /v1/sol/broadcast` — body `{ chain, serializedTxBase64 }`. Accepts a partially-signed tx (signed by both wallet and key members), validates `feePayer` matches paymaster, auto-tops-up member signers if needed, adds paymaster signature, broadcasts to Solana RPC. Returns `{ status, data: { signature } }`.

### Setup

The paymaster keypair is resolved at runtime from one of these sources, in order:

1. **Env var** — `SSP_SOLANA_DEVNET_PAYMASTER_KEY` / `SSP_SOLANA_MAINNET_PAYMASTER_KEY`. Preferred for prod deploys (containers, secret managers).
2. **Local file** — `~/.config/solana/ssp-paymaster-{devnet|mainnet}.json`. Convenient for local dev and single-host deploys.
3. **Auto-generated (devnet only)** — if neither of the above is present, the relay generates a fresh devnet keypair on startup, persists it to (2) with `0o600` mode, and prints its pubkey + funding instructions. Mainnet is **never** auto-generated and must always be explicit.

Both inputs accept either the JSON byte-array form (as `solana-keygen` produces) or a base58-encoded 64-byte secret key.

**Devnet — zero-config**: just start the relay. On first boot you'll see:

```
[solPaymaster] solDevnet: generated new keypair at ~/.config/solana/ssp-paymaster-devnet.json — fund 9XYZAbcde123... with ~5 SOL via https://faucet.solana.com before sending
```

Fund it (devnet faucet caps at ~2 SOL/req, rate-limited):

```bash
# via the public devnet RPC (works with Solana CLI)
solana airdrop 2 9XYZAbcde123... --url devnet

# or paste the pubkey at https://faucet.solana.com (web UI, captcha)
```

Subsequent restarts log:

```
[solPaymaster] solDevnet ready, paymaster=9XYZAbcde123... balance=4.9821 SOL (source: file)
```

**Mainnet — explicit setup required**. Generate a keypair on a secure machine (or via `solana-keygen new`), then either:

```bash
# A) Place at the standard path
mkdir -p ~/.config/solana
echo '[12,89,...]' > ~/.config/solana/ssp-paymaster-mainnet.json
chmod 600 ~/.config/solana/ssp-paymaster-mainnet.json

# B) Or pass via env var (preferred for container deploys)
export SSP_SOLANA_MAINNET_PAYMASTER_KEY='[12,89,...]'
```

Fund the resulting pubkey from a treasury account, then restart the relay. Until you do, mainnet startup logs a loud warning and the mainnet `/v1/sol/paymaster` endpoint returns "not configured" errors:

```
[solPaymaster] solMainnet: NOT CONFIGURED — set SSP_SOLANA_MAINNET_PAYMASTER_KEY env var or place a keypair at ~/.config/solana/ssp-paymaster-mainnet.json. Solana solMainnet paymaster endpoint will return errors until configured.
```

**Verify** by hitting `GET https://your-relay/v1/sol/paymaster?chain=solDevnet` and confirming the returned pubkey matches.

### Cost expectations

Per user / per send (figures approximate, vary with rent rates):

| Event                                            | SOL cost                       | Recoverable?                                                                | Paid by                                       |
| ------------------------------------------------ | ------------------------------ | --------------------------------------------------------------------------- | --------------------------------------------- |
| First send (init+create+approve+approve+execute) | ~0.01 SOL                      | Multisig rent: yes (closing program); proposal rent: yes (closing proposal) | Paymaster (auto-top-up + tx fees + init rent) |
| Subsequent sends                                 | ~0.007 SOL                     | Proposal rent: yes (closing proposal)                                       | Paymaster (auto-top-up of leaf + tx fees)     |
| Tx fees alone                                    | ~5,000 lamports = 0.000005 SOL | No (burned by network)                                                      | Paymaster                                     |

The auto-top-up mechanism transfers 0.05 SOL to a member's leaf address whenever its balance drops below 0.01 SOL, so most "top-ups" cover ~7 sends. SOL parked in user leaf addresses is recoverable but not auto-reclaimed by the relay — at scale you'd want a periodic sweep.

### Monitoring

Relay logs `[solPaymaster] broadcast {chain} tx {signature}` on every broadcast and `[solPaymaster] top-up {pubkey}` on every leaf funding. Operational priorities:

- **Watch paymaster balance** — set up alerting at e.g. `< 1 SOL` for proactive top-ups
- **Watch tx success rate** — broadcast failures usually indicate insufficient paymaster balance, RPC issues, or malformed user txs (the relay validates `feePayer` but trusts the rest of the user's tx structure)
- **Rate-limit by `wkIdentity`** is not yet implemented — the broadcast endpoint currently uses `optionalWkIdentityAuth`. Adding strict per-user rate limiting + fee budgets is a known follow-up before high traffic

### Disabling / unconfigured behavior

If no paymaster is configured for a chain (mainnet only — devnet auto-generates), the paymaster service throws on first call (`Solana paymaster not configured for {chain}`) and SSP Wallet's Solana send flow fails with a clear error. Solana support effectively becomes unavailable on that chain until configured. Other chains (BTC, EVM, devnet Solana) are unaffected.

---

## TRON Sponsor

SSP TRON vaults are CREATE2 contract accounts (`@runonflux/tron-multisig`). By default, SSP pays the **energy** of every vault operation, and the vault pays SSP a fee (TRX, or USDT when the vault has no TRX) inside the same signed Op. Energy is billed to SSP's energy account **S** even when the transaction reverts, so the relay simulates every Op first and refuses anything it would lose money on. The code is `src/services/tronSponsorService.ts`; the acceptance rule is documented at the top of that file.

How it works on-chain:

- The `SSPSponsor` contract is deployed **by S** with `consume_user_resource_percent = 0`. TRON then bills the energy of the whole call tree (factory deploy, vault clone, token frames) to S's staked, delegated or rented energy.
- **Relayers** (hot EOAs held by this relay) call `sponsor.execute(...)` with `fee_limit` omitted. They pay bandwidth only and can never burn TRX for energy. If S is short of energy, the transaction fails instead of charging the relayer.
- Only allow-listed relayers may call the sponsor (`setRelayer`, owner only).

### Endpoints (`{status, data}` envelope)

- `GET /v1/tron/sponsor?chain=tron|tronNile`: returns `{enabled, chain, chainId, factory, implementation, sponsor, feeCollector, ceilings:{trx, usdt}}`.
- `POST /v1/tron/quote` (30/min/IP): takes `{chain, signers, threshold, calls, feeToken?, deadline?, max?}` and returns `{vault, deployed, nonce, deadline, fee, feeOptions, energy:{estimate}, maxSendable?, sponsorAvailable, unavailableReason?}`.
  - The relay derives the vault itself; it never accepts one from the client.
  - It picks the lowest free nonce and reserves it until the deadline (`tron_nonce_reservations`, TTL on `expiresAt`). The deadline defaults to now + 30 min and can be at most 2 h.
  - The public route refuses `nonce` and `markup`. Only the enterprise hook may set them.
  - For a send-max, pass `max: {token}` (`TRX` or a TRC-20 address) and put the full balance in that call. `maxSendable` is the balance minus the fee when the fee is paid in the same token, otherwise the full balance.
  - `sponsorAvailable: false` means the vault can't pay the fee in any accepted token. `unavailableReason` starts with `INSUFFICIENT_FEE_BALANCE`.
  - Price: `energy × energyPriceSun + bandwidthBytes × 1000`, × markup (1.15). The floor is 2 TRX or 1 USDT. USDT is converted at the relay's TRX/USD rate (`/v1/rates`); with no usable rate, only TRX is offered.
- `POST /v1/tron/broadcast` (10/min/IP, `requireWkIdentityAuthLegacyGated`): takes `{chain, signers, threshold, op, signatures}` and returns `{txid}`. Every broadcast is recorded in `tron_sponsor_ops` (no TTL; the dashboard reads it). Confirmation is polled from `walletsolidity/gettransactioninfobyid` in the background, and the record moves `broadcast → confirmed | failed`.

Network fees for TRON are not in `/v1/networkfees`: the quote is the fee.

### Configuration

`config/default.ts` → `tron`:

| Key                                                                  | Meaning                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `energyPriceSun` (45)                                                | What SSP currently **pays** per unit of energy (rental or pool price, not the 100 sun burn price). Quotes and the broadcast cost check both use it. Raise it as soon as procurement gets dearer. Env `TRON_ENERGY_PRICE_SUN` overrides it without a code change (read at start, so restart the relay). |
| `markup` (1.15)                                                      | Consumer quote markup. Enterprise passes its own (1.5).                                                                                                                                                                                                                                                |
| `maxOpsPerVaultPerDay` (50)                                          | Launch cap on sponsored Ops per vault per rolling 24 h. 0 disables it.                                                                                                                                                                                                                                 |
| `maxFailedEnergyPerHour` (2,500,000)                                 | Circuit breaker. Once sponsored transactions that **failed on-chain** burned this much of S's energy in the rolling hour, the relay refuses new sponsored broadcasts on that chain until the window rolls (per relay process, logged as an error). 0 disables it.                                      |
| `mainnet` / `nile` `.node` / `.api`                                  | Branded ssp-backends-proxy hosts. Calls carry `X-SSP-Relay-Key` from `SSP_RELAY_PROXY_KEY`, as on Solana.                                                                                                                                                                                              |
| `mainnet` / `nile` `.factory/.implementation/.sponsor/.feeCollector` | **Overrides for Nile or local testing only.** An override may only fill a value the SDK's pinned `NETWORKS` table has as `null`. An override that differs from a pinned value **stops the relay at startup**.                                                                                          |

Environment (secrets live **only** here):

| Variable                                                       | Meaning                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TRON_SPONSOR_ENABLED`                                         | Kill switch, **off by default**. Set `true` / `1` to sponsor. While off (or while the contracts aren't deployed, or while no relayer key is set), `enabled:false` and quote/broadcast refuse cleanly.                                                                                                                                   |
| `SSP_TRON_MAINNET_RELAYER_KEYS` / `SSP_TRON_NILE_RELAYER_KEYS` | Comma-separated 32-byte hex private keys (optional `0x`). Used round-robin; a relayer without bandwidth or TRX is skipped. Fallback: `~/.config/ssp-relay/tron-relayers-{mainnet,nile}.txt`. **Mainnet never auto-generates**; Nile generates one key into that file (mode 0600) on first start. Keys are never logged, only addresses. |
| `TRON_ENERGY_RENTAL=catfee`                                    | Optional 1 h energy rental for S when it is short (default off, which means refuse). Needs `CATFEE_API_KEY` / `CATFEE_API_SECRET` for mainnet (api.catfee.io) or `CATFEE_NILE_API_KEY` / `CATFEE_NILE_API_SECRET` for Nile (nile.catfee.io). Whitelist the relay IP in CatFee. Circuit breaker: `TRON_ENERGY_RENTAL_MAX_PER_HOUR` (30). |

### Setting up S, the sponsor and the relayers

1. **S (energy account)**: a cold EOA. It signs only the sponsor deployment and `UpdateEnergyLimit`. Keep a few TRX for those.
2. **Deploy `SSPSponsor` from S** with `consume_user_resource_percent = 0` and `origin_energy_limit = 1,250,000` (the per-transaction blast-radius cap; the relay also refuses anything above 1.2M). Pin its address, the factory, the implementation and the fee collector in the SDK `NETWORKS` table. Until they are pinned, use the `tron.nile` overrides for Nile only.
3. **Energy for S**: stake TRX for ENERGY on S, or delegate energy to S (JustLend, a rental, or the treasury). Never delegate to the sponsor or vault addresses: contracts can't receive delegations. The relay checks S's available energy (`EnergyLimit − EnergyUsed`) before every broadcast. With `TRON_ENERGY_RENTAL=catfee` it rents at least 65k energy for 1 h; otherwise it refuses with "sponsor temporarily unavailable".
4. **Relayers**: create 2+ EOAs, activate them, and give them bandwidth. Either delegate BANDWIDTH to them (then they pay 0 TRX) or keep a TRX float, since each transaction burns about 1.1–1.4k bytes. Allow-list each one with `sponsor.setRelayer(relayer, true)` from the sponsor owner. The startup banner prints every relayer's TRX, bandwidth and `allow-listed=` status, and S's energy.
5. **Fee collector**: an SSP TRON vault that already holds USDT, so USDT fee transfers never pay the new-holder cost.
6. Set `TRON_SPONSOR_ENABLED=true` and restart. Check `GET /v1/tron/sponsor?chain=tron` → `enabled: true`.

### What the relay refuses (acceptance rule)

The relay derives the vault from `signers`/`threshold`, and the signatures must assemble for it. Then it refuses unless all of these hold:

- the fee recipient is the fee collector, and the fee token is TRX or the network USDT;
- the Op has at most 16 calls;
- the deadline is at least 60 s away and at most 31 days away;
- the chain's failure circuit breaker (`maxFailedEnergyPerHour`) is closed;
- acceptance is serialized per vault (a lock document in `tron_nonce_reservations`), so the checks below can't be raced by concurrent requests;
- the per-vault daily cap holds, and the vault has fewer than 2 sponsored Ops that failed **on-chain** in the last 24 h (retries of the same Op included; they are kept in the record's `priorFailures`);
- in-flight bound: no second Op with the same nonce in flight, and the vault's previous sponsored Op is already in a block (each Op is simulated against the head state, so two Ops admitted together could collide on funds or nonce and S would pay for the loser; a dropped transaction stops counting 2 minutes after it was built);
- the nonce is unused on-chain;
- the sponsor is sane: percent is 0 and `origin_energy_limit > 0`;
- the **full simulation of `sponsor.execute` from the chosen relayer** succeeds (`ret[0].ret === 'FAILED'` counts as failure even though `result.result` is `true`);
- the Op deadline outlasts the transaction's expiry (reference block + 60 s, chain time);
- **fee ≥ today's cost without markup**;
- simulated energy is at most the quoted estimate × 1.25 (the quote on record for this vault and nonce, and only if it was for the same calls, amounts aside; otherwise the relay re-estimates), at most 1.2M, and at most `origin_energy_limit`;
- S has that much energy on top of what this relay process committed to broadcasts of the last 15 s (so two vaults checked at the same moment can't both count on the same energy and leave one to run OUT_OF_ENERGY).

Failures are fed to the circuit breaker from the **in-block** receipt (≈3 s after broadcast), not only from the solidified one (≈1 min), so a burst of forced reverts trips it quickly.

Duplicates, detected by the Op digest (unique index), return the existing txid instead of broadcasting again. A failed record may be retried.

---

## Enterprise Module

SSP Relay includes an optional private enterprise module (`ssp-relay-enterprise`) available as a git submodule for **SSP Enterprise** - a Multi-Party Self-Custody Solution built on the proven SSP Wallet foundation, extending 2-of-2 multisig security to multi-party business coordination.

The main relay functions fully without it.

### Solana enterprise integration

The relay bridges enterprise Solana vaults to the public paymaster service via two callbacks injected at boot from `enterpriseHooks.ts`:

- **`solanaPaymasterBroadcast`** — takes a partial-signed tx (all member ed25519 sigs already stamped by enterprise) and delegates the final paymaster `feePayer` sig + RPC submission to `solPaymasterService.broadcastWithPaymaster`. Enterprise never sees the paymaster keypair.
- **`getSolanaPaymasterContext`** — returns `{paymasterPubkey, minPaymasterFeeLamports}` for proposal create/sign. Server-resolved (env or file), never from the request body.

Per-vault wire-budget caps (M ≤ 2 dual / M ≤ 4 single) come from
the bundled-tx smoke test in
`solana-multisig/sdk/examples/enterprise-bundle-smoke.ts`. See
`ssp-relay-enterprise/SOLANA_ARCHITECTURE.md` for full lifecycle.

### TRON enterprise integration

Enterprise never holds TRON relayer keys. `enterpriseHooks.ts` injects three callbacks:

- **`getTronSponsorContext(chain)`**: the same object as `GET /v1/tron/sponsor`.
- **`tronQuote(req)`**: a _trusted_ quote. Enterprise may pass its own `nonce` (a per-vault counter with no relay reservation), a `deadline` up to 31 days (the proposal expiry) and its own `markup` (1.5).
- **`tronSponsorBroadcast({chain, signers, threshold, op, signatures})`**: returns `{txid}` after the full acceptance rule and throws `Error(message)` on refusal. Confirmation continues in the background into `tron_sponsor_ops`.

---

## Contribution

We welcome contributions to improve SSP Relay! Please review the [Contributing Guidelines](CONTRIBUTING.md) before getting started.

---

## Important Links

- **SSP Wallet Documentation**: [https://sspwallet.gitbook.io/docs](https://sspwallet.gitbook.io/docs)
- **Code of Conduct**: [View here](CODE_OF_CONDUCT.md)
- **Contributing Guidelines**: [View here](CONTRIBUTING.md)

---

## Disclaimer

By using SSP Relay, you agree to the terms outlined in the [Disclaimer](DISCLAIMER.md). SSP Relay is a part of the SSP ecosystem and should be used in conjunction with SSP Wallet and SSP Key for optimal performance and security.

---

## 🔒 Security Audits

Our security is a top priority. All critical components of the SSP ecosystem have undergone rigorous security audits by [Halborn](https://halborn.com/), ensuring the highest standards of protection.

- **SSP Wallet, SSP Key, and SSP Relay** were thoroughly audited, with the final report completed in **March 2025**.
- **Shnorr Multisig Account Abstraction Smart Contracts and SDK** underwent a comprehensive audit, finalized in **February 2025**.

### 📜 Audit Reports

📄 **SSP Wallet, SSP Key, SSP Relay Audit**

- **[Halborn Audit Report – SSP Wallet, Key, Relay](https://github.com/RunOnFlux/ssp-relay/blob/master/SSP_Security_Audit_HALBORN_2025.pdf)** (GitHub)
- **[Halborn Public Report – SSP Wallet, Key, Relay](https://www.halborn.com/audits/influx-technologies/ssp-wallet-relay-and-key)** (Halborn)

📄 **Smart Contracts Audit**

- **[Halborn Audit Report – Smart Contracts](https://github.com/RunOnFlux/ssp-relay/blob/master/Account_Abstraction_Schnorr_MultiSig_SmartContracts_SecAudit_HALBORN_2025.pdf)** (GitHub)
- **[Halborn Public Report – Smart Contracts](https://www.halborn.com/audits/influx-technologies/account-abstraction-schnorr-multisig)** (Halborn)

📄 **SDK Audit**

- **[Halborn Audit Report – SDK](https://github.com/RunOnFlux/ssp-relay/blob/master/Account_Abstraction_Schnorr_MultiSig_SDK_SecAudit_HALBORN_2025.pdf)** (GitHub)
- **[Halborn Public Report – SDK](https://www.halborn.com/audits/influx-technologies/account-abstraction-schnorr-signatures-sdk)** (Halborn)
