// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
/**
 * C-1 (SOL-2 / RLY-1) regression suite: the paymaster signs bundled SSP
 * multisig transactions as FEE PAYER, so its signature is visible to every
 * outer instruction. validateBundledPaymasterTx must accept only the exact
 * SSP bundle shape, bound to this chain's multisig program, one proposal PDA
 * and the multisig's own nonce. The first three describe blocks are the
 * review's PoC (poc/poc_sol_drain.mts) turned into tests.
 */
import { expect } from 'chai';
import { createHash } from 'crypto';
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  validateBundledPaymasterTx,
  parseCreateTransactionData,
  FEE_SCHEDULE,
  multisigProgramId,
  enforceComputeBudgetCaps,
  inspectProposalInstructions,
} from '../../src/services/solPaymasterService';
import { buildBundle, assemble, wireRoundTrip } from './helpers/solBundle';

const SYSTEM = SystemProgram.programId;
const ATA = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const MIN = FEE_SCHEDULE.minReimbursementLamports;
const CREATE_DISC = createHash('sha256')
  .update('global:create_transaction')
  .digest()
  .subarray(0, 8);

const paymaster = Keypair.generate().publicKey;

async function validate(ixs, chain = 'solDevnet') {
  const tx = wireRoundTrip(assemble(ixs, paymaster));
  return validateBundledPaymasterTx(tx, paymaster, chain, MIN);
}

async function expectReject(ixs, pattern, chain = 'solDevnet') {
  let err: Error | null = null;
  try {
    await validate(ixs, chain);
  } catch (e) {
    err = e as Error;
  }
  expect(err, 'expected the bundle to be rejected').to.not.equal(null);
  if (pattern) expect(err!.message).to.match(pattern);
}

// The PoC's attacker instruction: a foreign program whose data starts with
// the create_transaction discriminator and carries a fake inner message that
// merely CLAIMS a reimbursement, with the paymaster as a writable SIGNER so
// the program can CPI system_program::transfer(paymaster → attacker).
function pocDrainIx(attackerProgram: PublicKey, attacker: PublicKey) {
  const keys = [attacker, paymaster, SYSTEM];
  const parts: Buffer[] = [Buffer.from([0]), Buffer.from([1, 1, 1])];
  const kl = Buffer.alloc(4);
  kl.writeUInt32LE(keys.length);
  parts.push(kl, ...keys.map((k) => k.toBuffer()));
  const ixl = Buffer.alloc(4);
  ixl.writeUInt32LE(1);
  parts.push(ixl);
  const tdata = Buffer.alloc(12);
  tdata.writeUInt32LE(2, 0);
  tdata.writeBigUInt64LE(BigInt(MIN), 4);
  const ai = Buffer.alloc(4);
  ai.writeUInt32LE(2);
  const dl = Buffer.alloc(4);
  dl.writeUInt32LE(tdata.length);
  parts.push(Buffer.from([2]), ai, Buffer.from([0, 1]), dl, tdata);
  const alt = Buffer.alloc(4);
  alt.writeUInt32LE(0);
  parts.push(alt);
  return new TransactionInstruction({
    programId: attackerProgram,
    keys: [
      { pubkey: paymaster, isSigner: true, isWritable: true },
      { pubkey: attacker, isSigner: false, isWritable: true },
      { pubkey: SYSTEM, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([CREATE_DISC, ...parts]),
  });
}

function rogueAtaIx() {
  return new TransactionInstruction({
    programId: ATA,
    keys: [
      { pubkey: paymaster, isSigner: true, isWritable: true },
      {
        pubkey: Keypair.generate().publicKey,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: Keypair.generate().publicKey,
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: Keypair.generate().publicKey,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: SYSTEM, isSigner: false, isWritable: false },
      { pubkey: TOKEN, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

describe('Solana Paymaster — bundled tx allowlist (C-1)', function () {
  describe('PoC regression: custom-program drain', function () {
    it('rejects the PoC transaction (attacker program + fake discriminator only)', async function () {
      const drain = pocDrainIx(
        Keypair.generate().publicKey,
        Keypair.generate().publicKey,
      );
      await expectReject([drain], /instruction count|non-allowlisted/);
    });

    it('rejects a legit bundle with the attacker instruction appended', async function () {
      const { ixs } = await buildBundle({ paymaster });
      const drain = pocDrainIx(
        Keypair.generate().publicKey,
        Keypair.generate().publicKey,
      );
      await expectReject([...ixs, drain], /non-allowlisted program/);
      // …or slipped in before execute
      const mid = [...ixs];
      mid.splice(mid.length - 2, 0, drain);
      await expectReject(mid, /non-allowlisted program/);
    });
  });

  describe('PoC regression: ATA rent drain', function () {
    it('rejects 4x ATA createIdempotent paid by the paymaster', async function () {
      const { ixs } = await buildBundle({ paymaster });
      const withAtas = [
        ixs[0],
        rogueAtaIx(),
        rogueAtaIx(),
        rogueAtaIx(),
        rogueAtaIx(),
        ...ixs.slice(1),
      ];
      // Too big for one packet once a full bundle is attached, so validate
      // the Transaction object directly (the PoC's own variant carried no
      // bundle at all and is covered by the size/count checks).
      let err: Error | null = null;
      try {
        await validateBundledPaymasterTx(
          assemble(withAtas, paymaster),
          paymaster,
          'solDevnet',
          MIN,
        );
      } catch (e) {
        err = e as Error;
      }
      expect(err?.message).to.match(/at most one ATA/);
      // Two are already refused and fit in a packet.
      await expectReject(
        [ixs[0], rogueAtaIx(), rogueAtaIx(), ...ixs.slice(1)],
        /at most one ATA/,
      );
    });

    it('rejects a single ATA create that is not the proposal SPL destination', async function () {
      const { ixs } = await buildBundle({ paymaster });
      await expectReject(
        [ixs[0], rogueAtaIx(), ...ixs.slice(1)],
        /canonical ATA|SPL TransferChecked destination/,
      );
    });

    it('rejects a canonical ATA create for an attacker-chosen owner/mint not used by the proposal', async function () {
      const { ixs } = await buildBundle({ paymaster, spl: true });
      const {
        createAssociatedTokenAccountIdempotentInstruction,
        getAssociatedTokenAddressSync,
      } = await import('@solana/spl-token');
      const attacker = Keypair.generate().publicKey;
      const mint = Keypair.generate().publicKey;
      const ata = getAssociatedTokenAddressSync(mint, attacker, true);
      const swapped = ixs.map((ix) =>
        ix.programId.equals(ATA)
          ? createAssociatedTokenAccountIdempotentInstruction(
              paymaster,
              ata,
              attacker,
              mint,
            )
          : ix,
      );
      await expectReject(swapped, /SPL TransferChecked destination/);
    });

    it('rejects an ATA create paid by the paymaster AFTER execute', async function () {
      const { ixs } = await buildBundle({ paymaster, spl: true });
      const ataIx = ixs.find((ix) => ix.programId.equals(ATA));
      const rest = ixs.filter((ix) => ix !== ataIx);
      await expectReject(
        [...rest.slice(0, -1), ataIx, rest[rest.length - 1]],
        /out of order/,
      );
    });
  });

  describe('PoC regression: discriminator from a foreign program', function () {
    it('rejects create_transaction issued by a program that is not the SSP multisig', async function () {
      const { ixs } = await buildBundle({ paymaster });
      const foreign = Keypair.generate().publicKey;
      const swapped = ixs.map((ix) =>
        ix.data.length >= 8 && ix.data.subarray(0, 8).equals(CREATE_DISC)
          ? new TransactionInstruction({
              programId: foreign,
              keys: ix.keys,
              data: ix.data,
            })
          : ix,
      );
      await expectReject(swapped, /non-allowlisted program/);
    });

    it("rejects a bundle for the other cluster's multisig program", async function () {
      const { ixs } = await buildBundle({ paymaster, chain: 'solMainnet' });
      await expectReject(ixs, /non-allowlisted program/, 'solDevnet');
    });
  });

  describe('legit bundles are accepted', function () {
    it('accepts a consumer SOL bundle (wallet shape)', async function () {
      const { ixs, ctx } = await buildBundle({ paymaster, priorityFee: true });
      const r = await validate(ixs);
      expect(r.totalToPaymaster).to.equal(100_000);
      expect(r.splDestAta).to.equal(undefined);
      expect(r.multisig.equals(ctx.multisig)).to.equal(true);
      expect(r.transactionPda.equals(ctx.transactionAddress)).to.equal(true);
      expect(r.approvals).to.equal(2);
    });

    it('accepts a consumer SPL bundle and binds the ATA to the inner destination', async function () {
      const { ixs, ctx } = await buildBundle({
        paymaster,
        spl: true,
        reimbursementLamports: 3_000_000,
      });
      const r = await validate(ixs);
      expect(r.splDestAta.equals(ctx.destAta)).to.equal(true);
    });

    it('accepts a mainnet bundle validated for solMainnet', async function () {
      const { ixs } = await buildBundle({ paymaster, chain: 'solMainnet' });
      const r = await validate(ixs, 'solMainnet');
      expect(r.approvals).to.equal(2);
    });

    it('accepts an enterprise-shaped bundle (3 approvals, paymaster executor, vault index 1)', async function () {
      const { ixs } = await buildBundle({
        paymaster,
        extraApprovers: 1,
        executor: 'paymaster',
        vaultIndex: 1,
      });
      const r = await validate(ixs);
      expect(r.approvals).to.equal(3);
    });
  });

  describe('structure and binding', function () {
    it('rejects a reimbursement below the floor', async function () {
      const { ixs } = await buildBundle({
        paymaster,
        reimbursementLamports: MIN - 1,
      });
      await expectReject(ixs, /must reimburse paymaster/);
    });

    it('refuses transfers to the paymaster that are not from the vault', async function () {
      const { ixs } = await buildBundle({
        paymaster,
        mutateMessage: (msg) => {
          const other = Keypair.generate().publicKey;
          msg.accountKeys.push(other);
          // reimbursement now claims to come from `other`, not the vault
          msg.instructions[1].accountIndexes = new Uint8Array([
            msg.accountKeys.length - 1,
            2,
          ]);
        },
      });
      await expectReject(ixs, /Transfer from the vault PDA/);
    });

    it('rejects a signer-borrow proposal (num_signers > 1)', async function () {
      const { ixs } = await buildBundle({
        paymaster,
        mutateMessage: (msg) => {
          msg.numSigners = 2;
          msg.numWritableSigners = 2;
        },
      });
      await expectReject(ixs, /num_signers must be 1/);
    });

    it('rejects a proposal whose account_keys[0] is not the vault PDA', async function () {
      const { ixs } = await buildBundle({
        paymaster,
        mutateMessage: (msg, ctx) => {
          msg.accountKeys[0] = ctx.paymaster;
        },
      });
      await expectReject(
        ixs,
        /vault PDA|paymaster cannot be the proposal signer/,
      );
    });

    it('rejects a bundle without close_transaction (rent would stay locked)', async function () {
      const { ixs } = await buildBundle({ paymaster });
      await expectReject(
        ixs.slice(0, -1),
        /instruction count|execute and close/,
      );
      const { ixs: ixs2 } = await buildBundle({ paymaster, priorityFee: true });
      await expectReject(ixs2.slice(0, -1), /execute and close/);
    });

    it('rejects a bundle without execute_transaction (reimbursement would never run)', async function () {
      const { ixs } = await buildBundle({ paymaster, priorityFee: true });
      const noExec = ixs.filter((_, i) => i !== ixs.length - 2);
      await expectReject(noExec, /execute and close/);
    });

    it('rejects an approval for a different proposal', async function () {
      const { ixs, ctx } = await buildBundle({ paymaster });
      const otherIndex = 7n;
      const [otherPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('transaction'),
          ctx.multisig.toBuffer(),
          Buffer.from(new BigUint64Array([otherIndex]).buffer),
        ],
        ctx.programId,
      );
      const rogue = await ctx.client.buildApproveTransactionInstruction({
        multisigAddress: ctx.multisig,
        transactionAddress: otherPda,
        transactionIndex: otherIndex,
        member: ctx.key.publicKey,
      });
      const swapped = [...ixs];
      swapped[swapped.length - 3] = rogue; // replace the Key's approval
      await expectReject(swapped, /different/);
    });

    it('rejects duplicate approvals by the same member', async function () {
      const { ixs } = await buildBundle({ paymaster });
      const dup = [...ixs];
      dup[dup.length - 3] = dup[dup.length - 4];
      await expectReject(dup, /Duplicate approve_transaction/);
    });

    it("rejects advancing a nonce that is not the multisig's own", async function () {
      const { ixs } = await buildBundle({ paymaster });
      const foreignNonce = SystemProgram.nonceAdvance({
        noncePubkey: Keypair.generate().publicKey,
        authorizedPubkey: paymaster,
      });
      await expectReject([foreignNonce, ...ixs.slice(1)], /own durable nonce/);
    });

    it('requires AdvanceNonceAccount at instruction[0]', async function () {
      const { ixs } = await buildBundle({ paymaster, priorityFee: true });
      const swapped = [ixs[1], ixs[0], ...ixs.slice(2)];
      await expectReject(swapped, /SystemProgram/);
    });

    it('rejects any other outer SystemProgram instruction (e.g. a transfer from the paymaster)', async function () {
      const { ixs } = await buildBundle({ paymaster });
      const drain = SystemProgram.transfer({
        fromPubkey: paymaster,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1_000_000_000n,
      });
      await expectReject(
        [...ixs.slice(0, -1), drain, ixs[ixs.length - 1]],
        /SystemProgram/,
      );
    });

    it('rejects a priority fee above the cap and duplicate ComputeBudget instructions', async function () {
      const { ixs } = await buildBundle({ paymaster });
      const pricey = [
        ixs[0],
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 }),
        ...ixs.slice(1),
      ];
      await expectReject(pricey, /Priority fee/);
      const dup = [
        ixs[0],
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
        ...ixs.slice(1),
      ];
      await expectReject(dup, /Duplicate ComputeBudget/);
    });

    it('rejects close_transaction refunding rent to someone other than the paymaster', async function () {
      const { ixs, ctx } = await buildBundle({ paymaster });
      const close = await ctx.client.buildCloseTransactionInstruction({
        multisigAddress: ctx.multisig,
        transactionAddress: ctx.transactionAddress,
        transactionIndex: ctx.transactionIndex,
        payer: Keypair.generate().publicKey,
      });
      await expectReject(
        [...ixs.slice(0, -1), close],
        /refund the proposal rent to the paymaster/,
      );
    });

    it('rejects execute remaining_accounts that differ from the proposal', async function () {
      const { ixs } = await buildBundle({ paymaster });
      const exec = ixs[ixs.length - 2];
      const keys = exec.keys.map((k, i) =>
        i === 4 ? { ...k, pubkey: Keypair.generate().publicKey } : k,
      );
      const swapped = [...ixs];
      swapped[swapped.length - 2] = new TransactionInstruction({
        programId: exec.programId,
        keys,
        data: exec.data,
      });
      await expectReject(swapped, /remaining_accounts/);
    });

    it('rejects other multisig-program instructions (e.g. initialize_multisig)', async function () {
      const { ixs, ctx } = await buildBundle({ paymaster });
      const { instruction: init } =
        await ctx.client.buildInitializeMultisigInstruction({
          members: [ctx.wallet.publicKey, ctx.key.publicKey],
          threshold: 2,
          payer: paymaster,
        });
      await expectReject(
        [ixs[0], init, ...ixs.slice(1)],
        /non-allowlisted multisig program instruction/,
      );
    });
  });

  describe('fee drain via bundles that land and fail (inner allowlist, signer slots, floor)', function () {
    const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
    const TOKEN_2022 = new PublicKey(
      'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
    );

    function addMemo(text: Buffer, accounts: number[] = []) {
      return (msg) => {
        msg.accountKeys.push(MEMO);
        msg.instructions.push({
          programIdIndex: msg.accountKeys.length - 1,
          accountIndexes: new Uint8Array(accounts),
          data: new Uint8Array(text),
        });
      };
    }

    it('accepts the SSP memo (SPL Memo v2, no accounts, UTF-8) on SOL and SPL bundles', async function () {
      const sol = await buildBundle({
        paymaster,
        mutateMessage: addMemo(Buffer.from('invoice 42 ✓', 'utf8')),
      });
      await validate(sol.ixs);
      const spl = await buildBundle({
        paymaster,
        spl: true,
        reimbursementLamports: 3_000_000,
        mutateMessage: addMemo(Buffer.from('pay', 'utf8')),
      });
      // (the SPL + memo + ATA bundle is close to the packet limit; the
      // allowlist itself does not depend on the wire size)
      await validateBundledPaymasterTx(
        assemble(spl.ixs, paymaster),
        paymaster,
        'solDevnet',
        MIN,
      );
    });

    it('refuses an inner instruction from any other program (a program that can fail at will)', async function () {
      const rogue = Keypair.generate().publicKey;
      const { ixs } = await buildBundle({
        paymaster,
        mutateMessage: (msg) => {
          msg.accountKeys.push(rogue);
          msg.instructions.push({
            programIdIndex: msg.accountKeys.length - 1,
            accountIndexes: new Uint8Array([]),
            data: new Uint8Array([1, 2, 3]),
          });
        },
      });
      await expectReject(ixs, /non-allowlisted program/);
    });

    it('refuses inner SystemProgram instructions other than a vault Transfer', async function () {
      const { ixs } = await buildBundle({
        paymaster,
        mutateMessage: (msg) => {
          // SystemProgram Assign(vault → owner) — tag 1
          const data = Buffer.alloc(36);
          data.writeUInt32LE(1, 0);
          msg.instructions.push({
            programIdIndex: 3,
            accountIndexes: new Uint8Array([0]),
            data: new Uint8Array(data),
          });
        },
      });
      await expectReject(ixs, /Transfer from the vault PDA/);
    });

    it('refuses a transfer to a read-only account (fails at execute)', async function () {
      const { ixs } = await buildBundle({
        paymaster,
        mutateMessage: (msg) => {
          // recipient demoted to read-only: execute would fail on-chain
          msg.numWritableNonSigners = 1;
          msg.accountKeys = [
            msg.accountKeys[0],
            msg.accountKeys[2], // paymaster stays writable
            msg.accountKeys[1], // recipient now read-only
            msg.accountKeys[3],
          ];
          msg.instructions[0].accountIndexes = new Uint8Array([0, 2]);
          msg.instructions[1].accountIndexes = new Uint8Array([0, 1]);
        },
      });
      await expectReject(ixs, /destination must be writable/);
    });

    it('refuses a TransferChecked that is not from the vault ATA, not vault-authorised, or carries extra accounts', async function () {
      const notVaultAta = await buildBundle({
        paymaster,
        spl: true,
        reimbursementLamports: 3_000_000,
        mutateMessage: (msg) => {
          msg.accountKeys[1] = Keypair.generate().publicKey;
        },
      });
      await expectReject(notVaultAta.ixs, /vault's own token account/);

      const otherAuthority = await buildBundle({
        paymaster,
        spl: true,
        reimbursementLamports: 3_000_000,
        mutateMessage: (msg) => {
          msg.instructions[0].accountIndexes = new Uint8Array([1, 4, 2, 3]);
        },
      });
      await expectReject(otherAuthority.ixs, /authority must be the vault/);

      const hookAccounts = await buildBundle({
        paymaster,
        spl: true,
        reimbursementLamports: 3_000_000,
        mutateMessage: (msg) => {
          msg.instructions[0].accountIndexes = new Uint8Array([1, 4, 2, 0, 6]);
        },
      });
      await expectReject(hookAccounts.ixs, /plain TransferChecked/);

      const legacyTransfer = await buildBundle({
        paymaster,
        spl: true,
        reimbursementLamports: 3_000_000,
        mutateMessage: (msg) => {
          // SPL Transfer (tag 3), no decimals check
          const data = Buffer.alloc(9);
          data[0] = 3;
          data.writeBigUInt64LE(1000n, 1);
          msg.instructions[0] = {
            programIdIndex: 5,
            accountIndexes: new Uint8Array([1, 2, 0]),
            data: new Uint8Array(data),
          };
        },
      });
      await expectReject(legacyTransfer.ixs, /plain TransferChecked/);
    });

    it('binds a Token-2022 source to the Token-2022 vault ATA', async function () {
      const { ixs } = await buildBundle({
        paymaster,
        spl: true,
        reimbursementLamports: 3_000_000,
        mutateMessage: (msg) => {
          // program swapped to Token-2022 but the source is the legacy ATA
          msg.accountKeys[5] = TOKEN_2022;
        },
      });
      await expectReject(ixs, /vault's own token account/);
    });

    it('refuses memos with accounts, empty data, oversized data or invalid UTF-8', async function () {
      for (const [mutate, pattern] of [
        [addMemo(Buffer.from('hi'), [0]), /must not reference accounts/],
        [addMemo(Buffer.alloc(0)), /invalid length/],
        [addMemo(Buffer.from([0xff, 0xfe, 0x41])), /not valid UTF-8/],
      ]) {
        const { ixs } = await buildBundle({ paymaster, mutateMessage: mutate });
        await expectReject(ixs, pattern);
      }
      // oversized: checked on the parsed message (it cannot fit a packet)
      const { ixs } = await buildBundle({ paymaster });
      const create = ixs.find(
        (ix) =>
          ix.programId.equals(multisigProgramId('solDevnet')) &&
          ix.data.subarray(0, 8).equals(CREATE_DISC),
      );
      const msg = parseCreateTransactionData(create.data);
      msg.accountKeys.push(MEMO);
      msg.instructions.push({
        programIdIndex: msg.accountKeys.length - 1,
        accountIndexes: [],
        data: Buffer.alloc(600, 0x61),
      });
      expect(() =>
        inspectProposalInstructions(msg, msg.accountKeys[0], paymaster),
      ).to.throw(/invalid length/);
    });

    it('refuses an extra signer slot (e.g. a remaining account marked as signer)', async function () {
      const { ixs, ctx } = await buildBundle({ paymaster });
      const exec = ixs[ixs.length - 2];
      const keys = exec.keys.map((k) =>
        k.pubkey.equals(ctx.recipient) ? { ...k, isSigner: true } : k,
      );
      const padded = [...ixs];
      padded[padded.length - 2] = new TransactionInstruction({
        programId: exec.programId,
        keys,
        data: exec.data,
      });
      await expectReject(padded, /extra signer slots/);
    });

    it('refuses an executor that is not the paymaster or an approving member', async function () {
      const { ixs, ctx } = await buildBundle({ paymaster });
      const exec = await ctx.client.buildExecuteTransactionInstruction({
        multisigAddress: ctx.multisig,
        transactionAddress: ctx.transactionAddress,
        transactionIndex: ctx.transactionIndex,
        executor: Keypair.generate().publicKey,
        remainingAccounts: ixs[ixs.length - 2].keys.slice(3),
      });
      const swapped = [...ixs];
      swapped[swapped.length - 2] = exec;
      await expectReject(swapped, /executor must be/);
    });

    it('refuses a creator that does not also approve', async function () {
      const { ixs, ctx } = await buildBundle({ paymaster });
      // drop the wallet's (= creator's) approval
      const walletApprovalIdx = ixs.findIndex(
        (ix) =>
          ix.keys.length === 3 &&
          ix.keys[2].pubkey.equals(ctx.wallet.publicKey) &&
          ix.programId.equals(ctx.programId) &&
          !ix.data.subarray(0, 8).equals(CREATE_DISC),
      );
      expect(walletApprovalIdx).to.be.greaterThan(0);
      const without = ixs.filter((_, i) => i !== walletApprovalIdx);
      await expectReject(without, /creator must also approve/);
    });

    it('requires the reimbursement to cover signatures x 5000 + the priority fee', async function () {
      // 3 signatures (15k) + 200k CU x 250k µlamports (50k) = 65k > 50k base floor
      const withPrice = (ixs) => [
        ixs[0],
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 250_000 }),
        ...ixs.slice(1),
      ];
      const short = await buildBundle({
        paymaster,
        reimbursementLamports: 60_000,
      });
      await expectReject(withPrice(short.ixs), /at least 65000 lamports/);
      const ok = await buildBundle({
        paymaster,
        reimbursementLamports: 65_000,
      });
      const r = await validate(withPrice(ok.ixs));
      expect(r.maxNetworkFeeLamports).to.equal(65_000);
      // enterprise shape: 4 approving members + paymaster = 5 signatures
      const ent = await buildBundle({
        paymaster,
        extraApprovers: 2,
        executor: 'paymaster',
        priorityFee: true,
      });
      const e = await validate(ent.ixs);
      expect(e.maxNetworkFeeLamports).to.equal(5 * 5_000 + 10_000);
    });

    it('bills a price-only ComputeBudget at 200k CU per instruction (capped at 1.4M)', async function () {
      const { ixs } = await buildBundle({ paymaster, priceOnly: true });
      // 7 instructions x 200k = 1.4M CU x 50k µlamports = 70k > 50k cap
      await expectReject(ixs, /Priority fee 70000 lamports exceeds/);
      expect(
        enforceComputeBudgetCaps([
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
        ]),
      ).to.equal(10_000);
      expect(
        enforceComputeBudgetCaps([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
        ]),
      ).to.equal(5_000);
    });
  });

  describe('parseCreateTransactionData', function () {
    it('rejects address table lookups and trailing bytes', async function () {
      const { ixs } = await buildBundle({ paymaster });
      const create = ixs.find(
        (ix) =>
          ix.programId.equals(multisigProgramId('solDevnet')) &&
          ix.data.subarray(0, 8).equals(CREATE_DISC),
      );
      expect(() => parseCreateTransactionData(create.data)).to.not.throw();
      const trailing = Buffer.concat([create.data, Buffer.from([0])]);
      expect(() => parseCreateTransactionData(trailing)).to.throw(/trailing/);
      const withAlt = Buffer.from(create.data);
      withAlt.writeUInt32LE(1, withAlt.length - 4);
      expect(() => parseCreateTransactionData(withAlt)).to.throw(
        /address table/,
      );
      expect(() =>
        parseCreateTransactionData(create.data.subarray(0, 20)),
      ).to.throw(/truncated/);
    });
  });
});
