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

This is purely a UX layer — the underlying SSP Solana Multisig program enforces all multisig security regardless of who pays fees. See [solana-multisig README](https://github.com/RunOnFlux/Solana-Multisig#how-this-differs-from-squads-v4) for the protocol-level guarantees.

### Endpoints

- `GET /v1/sol/paymaster?chain=solDevnet` — returns `{ status, data: { chain, pubkey } }`. Wallet calls this to learn what address to set as `feePayer` when building a tx.
- `POST /v1/sol/broadcast` — body `{ chain, serializedTxBase64 }`. Accepts a partially-signed tx (signed by both wallet and key members), validates `feePayer` matches paymaster, auto-tops-up member signers if needed, adds paymaster signature, broadcasts to Solana RPC. Returns `{ status, data: { signature } }`.

### Setup

The paymaster keypair is resolved at runtime from one of these sources, in order:

1. **Env var** — `SSP_SOLANA_DEVNET_PAYMASTER_KEY` / `SSP_SOLANA_MAINNET_PAYMASTER_KEY`. Preferred for prod deploys (containers, secret managers).
2. **Local file** — `~/.config/ssp-relay/paymaster-{chain}.json`. Convenient for local dev and single-host deploys.
3. **Auto-generated (devnet only)** — if neither of the above is present, the relay generates a fresh devnet keypair on startup, persists it to (2) with `0o600` mode, and prints its pubkey + funding instructions. Mainnet is **never** auto-generated and must always be explicit.

Both inputs accept either the JSON byte-array form (as `solana-keygen` produces) or a base58-encoded 64-byte secret key.

**Devnet — zero-config**: just start the relay. On first boot you'll see:

```
[solPaymaster] solDevnet: generated new keypair at ~/.config/ssp-relay/paymaster-solDevnet.json — fund 9XYZAbcde123... with ~5 SOL via https://faucet.solana.com before sending
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
mkdir -p ~/.config/ssp-relay
echo '[12,89,...]' > ~/.config/ssp-relay/paymaster-solMainnet.json
chmod 600 ~/.config/ssp-relay/paymaster-solMainnet.json

# B) Or pass via env var (preferred for container deploys)
export SSP_SOLANA_MAINNET_PAYMASTER_KEY='[12,89,...]'
```

Fund the resulting pubkey from a treasury account, then restart the relay. Until you do, mainnet startup logs a loud warning and the mainnet `/v1/sol/paymaster` endpoint returns "not configured" errors:

```
[solPaymaster] solMainnet: NOT CONFIGURED — set SSP_SOLANA_MAINNET_PAYMASTER_KEY env var or place a keypair at ~/.config/ssp-relay/paymaster-solMainnet.json. Solana solMainnet paymaster endpoint will return errors until configured.
```

**Verify** by hitting `GET https://your-relay/v1/sol/paymaster?chain=solDevnet` and confirming the returned pubkey matches.

### Cost expectations

Per user / per send (figures approximate, vary with rent rates):

| Event | SOL cost | Recoverable? | Paid by |
|---|---|---|---|
| First send (init+create+approve+approve+execute) | ~0.01 SOL | Multisig rent: yes (closing program); proposal rent: yes (closing proposal) | Paymaster (auto-top-up + tx fees + init rent) |
| Subsequent sends | ~0.007 SOL | Proposal rent: yes (closing proposal) | Paymaster (auto-top-up of leaf + tx fees) |
| Tx fees alone | ~5,000 lamports = 0.000005 SOL | No (burned by network) | Paymaster |

The auto-top-up mechanism transfers 0.05 SOL to a member's leaf address whenever its balance drops below 0.01 SOL, so most "top-ups" cover ~7 sends. SOL parked in user leaf addresses is recoverable but not auto-reclaimed by the relay — at scale you'd want a periodic sweep.

### Monitoring

Relay logs `[solPaymaster] broadcast {chain} tx {signature}` on every broadcast and `[solPaymaster] top-up {pubkey}` on every leaf funding. Operational priorities:

- **Watch paymaster balance** — set up alerting at e.g. `< 1 SOL` for proactive top-ups
- **Watch tx success rate** — broadcast failures usually indicate insufficient paymaster balance, RPC issues, or malformed user txs (the relay validates `feePayer` but trusts the rest of the user's tx structure)
- **Rate-limit by `wkIdentity`** is not yet implemented — the broadcast endpoint currently uses `optionalWkIdentityAuth`. Adding strict per-user rate limiting + fee budgets is a known follow-up before high traffic

### Disabling / unconfigured behavior

If no paymaster is configured for a chain (mainnet only — devnet auto-generates), the paymaster service throws on first call (`Solana paymaster not configured for {chain}`) and SSP Wallet's Solana send flow fails with a clear error. Solana support effectively becomes unavailable on that chain until configured. Other chains (BTC, EVM, devnet Solana) are unaffected.

---

## Enterprise Module

SSP Relay includes an optional private enterprise module (`ssp-relay-enterprise`) available as a git submodule for **SSP Enterprise** - a Multi-Party Self-Custody Solution built on the proven SSP Wallet foundation, extending 2-of-2 multisig security to multi-party business coordination.

The main relay functions fully without it.

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
