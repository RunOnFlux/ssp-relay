// Solana paymaster keypairs (per chain), base58-encoded 64-byte secret keys.
//
// PLACEHOLDER VALUES: production deployments must override this file with
// real funded keypairs (one per supported chain). The paymaster wallet
// pays Solana tx fees + first-send rent on behalf of SSP users so they
// don't need to keep SOL in their leaf keypair address.
//
// To generate a fresh keypair for a network:
//   solana-keygen new -o /tmp/paymaster.json --no-bip39-passphrase
//   solana-keygen pubkey /tmp/paymaster.json    # the public pubkey
//   cat /tmp/paymaster.json                     # the JSON byte array
//
// Convert the JSON byte array to base58 for storage here, or just paste
// the JSON-array form — solPaymasterService accepts either.
//
// Cost expectations:
//   First send (init+create+approve+approve+execute):
//     ~0.0024 SOL multisig PDA rent + ~0.007 SOL proposal PDA rent + tx fees
//     ≈ 0.01 SOL per user (one-time)
//   Subsequent sends:
//     ~0.007 SOL proposal PDA rent + tx fees
//     ≈ 0.007 SOL per send (proposal account rent — recoverable on close)

export default {
  solDevnet: {
    // Placeholder — replace in production.
    // Format: base58-encoded 64-byte secret key OR JSON byte array.
    paymasterSecretKey: '',
  },
  solMainnet: {
    // Mainnet paymaster — leave empty until SSP Solana Multisig program
    // has been audited and the mainnet program is deployed. The chain
    // entry itself is also gated; see config/default.ts solana.mainnet.
    paymasterSecretKey: '',
  },
};
