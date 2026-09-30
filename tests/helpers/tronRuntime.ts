// Shared TRON sponsor test fixtures: the cross-repo vectors
// (~/repos/tron-ssp-vectors.json, copied to tests/fixtures), a fake node, the
// fake collections and a fully injected TronRuntime.
import {
  buildConfig,
  buildOp,
  deriveVault,
  localSigner,
  opDigest,
  opToJson,
  trxFee,
  trc20Fee,
  bytesToHex,
  type Call,
  type Op,
} from '@runonflux/tron-multisig';
import vectors from '../fixtures/tron-ssp-vectors.json';
import { createFakeNode } from './fakeTronNode';
import { fakeTronCollections } from './fakeMongo';
import type { TronOpJson } from '../../src/types/tron';
import {
  parseRelayerKeys,
  resolveTronNetwork,
  type TronRuntime,
} from '../../src/services/tronSponsorService';

export { vectors };

export const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
export const COLLECTOR = vectors.consumerOp.op.fee.recipient;
export const FACTORY = vectors.network.factory;
export const IMPLEMENTATION = vectors.network.implementation;
export const SPONSOR = localSigner(new Uint8Array(32).fill(0x22)).address;
export const S_ORIGIN = localSigner(new Uint8Array(32).fill(0x21)).address;
export const RELAYER_KEY_HEX = '11'.repeat(32);
export const RELAYER = localSigner(new Uint8Array(32).fill(0x11)).address;
export const RECIPIENT = localSigner(new Uint8Array(32).fill(0x41)).address;

/** 1,000 s before the vectors' Op deadline (1790000000). */
export const NOW_MS = 1_789_999_000_000;

export const NETWORK = resolveTronNetwork('tron', {
  factory: FACTORY,
  implementation: IMPLEMENTATION,
  sponsor: SPONSOR,
  feeCollector: COLLECTOR,
});

export function makeRuntime(overrides: Partial<TronRuntime> = {}) {
  const node = createFakeNode();
  const cols = fakeTronCollections();
  const clock = { now: NOW_MS };
  const rt: TronRuntime = {
    chain: 'tron',
    network: NETWORK,
    client: node.client,
    relayers: parseRelayerKeys(RELAYER_KEY_HEX, 'test'),
    relayerSource: 'env',
    relayerError: null,
    energyPriceSun: 45n,
    defaultMarkup: 1.15,
    maxOpsPerVaultPerDay: 50,
    maxFailedEnergyPerHour: 2_500_000,
    failures: [],
    committedEnergy: [],
    rental: null,
    killSwitchOn: () => true,
    collections: async () =>
      cols as unknown as Awaited<ReturnType<TronRuntime['collections']>>,
    rates: () => ({ trxUsd: 0.338, usdtUsd: 1 }),
    nowMs: () => clock.now,
    sleep: async () => undefined,
    confirm: { intervalMs: 0, attempts: 3 },
    rrIndex: 0,
    sponsorMeta: null,
    ...overrides,
  };
  node.state.contracts.set(SPONSOR, {
    runtimecode: 'aa',
    origin: S_ORIGIN,
    percent: 0,
    originEnergyLimit: 1_500_000,
  });
  node.state.contracts.set(USDT, { runtimecode: 'bb' });
  node.state.resources.set(S_ORIGIN, { EnergyLimit: 5_000_000, EnergyUsed: 0 });
  node.state.accounts.set(RELAYER, { balance: 100_000_000n });
  node.state.resources.set(RELAYER, { NetLimit: 10_000, NetUsed: 0 });
  node.state.relayers.add(RELAYER);
  return { rt, node, cols, clock };
}

/** A 2-of-2 vault from fixed test keys (not the vectors), for custom Ops. */
export function testVault(seedA = 0x31, seedB = 0x32) {
  const a = localSigner(new Uint8Array(32).fill(seedA));
  const b = localSigner(new Uint8Array(32).fill(seedB));
  const config = buildConfig([a.address, b.address], 2);
  const vault = deriveVault(NETWORK, config).address;
  function sign(op: Op): string[] {
    const d = opDigest(NETWORK.chainId, vault, op);
    return [a, b].map((s) => `0x${bytesToHex(s.signDigest(d))}`);
  }
  return { a, b, config, vault, sign };
}

export function makeOp(p: {
  calls: Call[];
  nonce?: bigint;
  deadline?: bigint;
  feeAmount?: bigint;
  feeToken?: 'TRX' | 'USDT';
  recipient?: string;
}): Op {
  const amount = p.feeAmount ?? 6_300_000n;
  const recipient = p.recipient ?? COLLECTOR;
  return buildOp({
    calls: p.calls,
    nonce: p.nonce ?? 0n,
    deadline: p.deadline ?? 1_790_000_000n,
    fee:
      p.feeToken === 'USDT'
        ? trc20Fee(USDT, amount, recipient)
        : trxFee(amount, recipient),
  });
}

export function broadcastRequest(
  v: ReturnType<typeof testVault>,
  op: Op,
  signatures = v.sign(op),
) {
  return {
    chain: 'tron' as const,
    signers: [...v.config.signers],
    threshold: v.config.threshold,
    op: opToJson(op) as unknown as TronOpJson,
    signatures,
  };
}
