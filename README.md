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
