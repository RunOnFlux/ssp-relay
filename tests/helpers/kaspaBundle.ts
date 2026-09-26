// Builds a real kaspa-core SigningBundle (2-of-2 vault, wallet half-signed)
// for the relay's Kaspa tests. Keys are fixed test scalars; nothing is funded.
import * as K from '@runonflux/kaspa-core';

function fixedKey(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}

// P2PK recipient (kaspa:q…) for a fixed test key.
export const KASPA_RECIPIENT = K.scriptPublicKeyToAddress(
  K.p2pkScript(K.xOnlyPublicKey(fixedKey(3))),
  'kaspa',
) as string;

export async function buildKaspaBundle(): Promise<{
  json: string;
  vaultAddress: string;
  recipient: string;
}> {
  const walletSigner = K.localSigner(fixedKey(1));
  const keySigner = K.localSigner(fixedKey(2));
  const vault = K.multisigSpend(
    [walletSigner.xOnlyPublicKey, keySigner.xOnlyPublicKey],
    2,
  );
  const vaultSpk = K.spendScriptPublicKey(vault);
  const vaultAddress = K.scriptPublicKeyToAddress(vaultSpk, 'kaspa') as string;
  const utxo = {
    outpoint: { transactionId: new Uint8Array(32).fill(0xaa), index: 0 },
    entry: {
      amount: 10_00000000n,
      scriptPublicKey: vaultSpk,
      blockDaaScore: 1n,
      isCoinbase: false,
    },
    spend: vault,
  };
  const recipientSpk = K.addressToScriptPublicKey(KASPA_RECIPIENT, 'kaspa');
  const plan = K.planTransaction(
    [utxo],
    [{ scriptPublicKey: recipientSpk, amount: 2_50000000n }],
    { feeRate: 100n, changeSpend: vault, allowChain: false },
  );
  const partials = await K.signTransaction(
    plan.final.tx,
    plan.final.inputs,
    [walletSigner],
    { onlyScripts: [vaultSpk] },
  );
  walletSigner.destroy();
  keySigner.destroy();
  return {
    json: JSON.stringify(
      K.createSigningBundle(plan.final.tx, plan.final.inputs, partials),
    ),
    vaultAddress,
    recipient: KASPA_RECIPIENT,
  };
}
