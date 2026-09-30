// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect } from 'chai';
import {
  approveCall,
  selfCall,
  toHex20,
  trc10TransferCall,
  trc20TransferCall,
  trxTransferCall,
} from '@runonflux/tron-multisig';
import {
  acceptAndBroadcast,
  assertSponsorableCalls,
} from '../../src/services/tronSponsorService';
import {
  IMPLEMENTATION,
  RECIPIENT,
  USDT,
  broadcastRequest,
  makeOp,
  makeRuntime,
  testVault,
} from '../helpers/tronRuntime';

// A contract whose behaviour could differ between simulation and execution.
const HOSTILE = 'TSvjcijsjWBkG4b1Gw2pGfyGHmL427rLzG';
// A non-whitelisted TRC-20.
const RANDOM_TOKEN = 'TGjtodRV2nm6tQd9hsxiecLNN9QmhhVbbD';
const OTHER_VAULT = 'TFhcYVArFkJW6bPUDid4AFCAjKmh6Ez3vv';

function cloneRuntime(impl: string) {
  return (
    '363d3d373d3d3d363d73' +
    toHex20(impl).replace(/^0x/, '') +
    '5af43d82803e903d91602b57fd5bf3' +
    'ab'.repeat(32)
  );
}

async function refused(p: Promise<unknown>, re: RegExp) {
  try {
    await p;
  } catch (e) {
    expect((e as Error).name).to.equal('TronSponsorRefusal');
    expect((e as Error).message).to.match(re);
    return;
  }
  expect.fail('expected a refusal');
}

describe('TRON sponsor: sponsorable-call policy', () => {
  it('sponsors TRX to a plain account, TRC-20 transfer on a whitelisted token, TRC-10 to a plain account and vault self-calls', async () => {
    const { rt } = makeRuntime();
    const v = testVault();
    await assertSponsorableCalls(rt, v.vault, [
      trxTransferCall(RECIPIENT, 1_000_000n),
      trc20TransferCall(USDT, RECIPIENT, 5_000_000n),
      trc10TransferCall(RECIPIENT, 1000001n, 10n),
      selfCall(v.vault, { action: 'invalidateNonces', word: 0n, mask: 1n }),
      selfCall(v.vault, {
        action: 'freezeBalanceV2',
        amount: 1_000_000n,
        resource: 'ENERGY',
      }),
    ]);
  });

  it('sponsors TRX to another SSP vault clone of our implementation', async () => {
    const { rt, node } = makeRuntime();
    node.state.contracts.set(OTHER_VAULT, {
      runtimecode: cloneRuntime(IMPLEMENTATION),
    });
    await assertSponsorableCalls(rt, testVault().vault, [
      trxTransferCall(OTHER_VAULT, 1n),
    ]);
  });

  it('refuses TRX / TRC-10 to an arbitrary contract (its receive code could diverge)', async () => {
    const { rt, node } = makeRuntime();
    node.state.contracts.set(HOSTILE, { runtimecode: '6080604052' });
    const v = testVault();
    await refused(
      assertSponsorableCalls(rt, v.vault, [trxTransferCall(HOSTILE, 1n)]),
      /TRX transfer to a contract/,
    );
    await refused(
      assertSponsorableCalls(rt, v.vault, [
        trc10TransferCall(HOSTILE, 1000001n, 1n),
      ]),
      /TRC-10 transfer to a contract/,
    );
  });

  it('refuses a clone of a DIFFERENT implementation', async () => {
    const { rt, node } = makeRuntime();
    node.state.contracts.set(OTHER_VAULT, {
      runtimecode: cloneRuntime(RECIPIENT),
    });
    await refused(
      assertSponsorableCalls(rt, testVault().vault, [
        trxTransferCall(OTHER_VAULT, 1n),
      ]),
      /to a contract/,
    );
  });

  it('refuses arbitrary contract calls, approvals and non-whitelisted tokens', async () => {
    const { rt } = makeRuntime();
    const v = testVault();
    await refused(
      assertSponsorableCalls(rt, v.vault, [
        {
          to: HOSTILE,
          value: 0n,
          data: new Uint8Array([1, 2, 3, 4]),
          tokenId: 0n,
          tokenValue: 0n,
        },
      ]),
      /only TRX, TRC-10 and whitelisted TRC-20 transfers/,
    );
    await refused(
      assertSponsorableCalls(rt, v.vault, [approveCall(USDT, RECIPIENT, 1n)]),
      /whitelisted TRC-20/,
    );
    await refused(
      assertSponsorableCalls(rt, v.vault, [
        trc20TransferCall(RANDOM_TOKEN, RECIPIENT, 1n),
      ]),
      /whitelisted TRC-20/,
    );
  });

  it('refuses TRX / TRC-10 to the vault itself (the vault would revert it)', async () => {
    const { rt } = makeRuntime();
    const v = testVault();
    await refused(
      assertSponsorableCalls(rt, v.vault, [trxTransferCall(v.vault, 1n)]),
      /to the vault itself/,
    );
    await refused(
      assertSponsorableCalls(rt, v.vault, [
        trc10TransferCall(v.vault, 1000001n, 1n),
      ]),
      /to the vault itself/,
    );
  });

  it('refuses a malformed self-call', async () => {
    const { rt } = makeRuntime();
    const v = testVault();
    await refused(
      assertSponsorableCalls(rt, v.vault, [
        {
          to: v.vault,
          value: 0n,
          data: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
          tokenId: 0n,
          tokenValue: 0n,
        },
      ]),
      /unsupported vault self-call/,
    );
  });

  it('broadcast refuses a non-sponsorable Op before simulating it', async () => {
    const { rt, node } = makeRuntime();
    node.state.contracts.set(HOSTILE, { runtimecode: '6080604052' });
    const v = testVault();
    const op = makeOp({ calls: [trxTransferCall(HOSTILE, 1_000n)] });
    const before = node.state.simulations?.length ?? 0;
    await refused(
      acceptAndBroadcast(rt, broadcastRequest(v, op)),
      /TRX transfer to a contract/,
    );
    expect(node.state.simulations?.length ?? 0).to.equal(before);
  });
});
