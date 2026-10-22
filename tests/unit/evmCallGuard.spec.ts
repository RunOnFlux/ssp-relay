// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
/**
 * C-4 stopgap: the relay refuses consumer EVM `tx` requests whose userOp
 * calls the smart account itself or upgrades it (see src/lib/evmCallGuard.ts).
 */
import { expect } from 'chai';
import sinon from 'sinon';
import httpMocks from 'node-mocks-http';
import { encodeFunctionData, erc20Abi, parseAbi } from 'viem';
import {
  checkUserOpPayload,
  evmCallGuardMode,
  guardConsumerEvmTx,
  EXECUTE_SELECTOR,
  EXECUTE_BATCH_SELECTOR,
} from '../../src/lib/evmCallGuard';
import actionApi from '../../src/apiServices/actionApi';
import actionService from '../../src/services/actionService';
import notificationService from '../../src/services/notificationService';
import enterpriseHooks from '../../src/services/enterpriseHooks';
import blockchains from '../../src/services/blockchains';
import socket from '../../src/lib/socket';
import log from '../../src/lib/log';
import {
  SENDER,
  RECIPIENT,
  USDC,
  ROUTER,
  EVIL_IMPL,
  walletPayloads,
} from './helpers/evmUserOpFixtures';

const ACCOUNT_ABI = parseAbi([
  'function execute(address dest, uint256 value, bytes func)',
  'function executeBatch(address[] dest, bytes[] func)',
  'function upgradeTo(address newImplementation)',
  'function upgradeToAndCall(address newImplementation, bytes data) payable',
  'function withdrawDepositTo(address withdrawAddress, uint256 amount)',
  'function grantRole(bytes32 role, address account)',
  'function addDeposit() payable',
]);
const ATTACKER = '0x000000000000000000000000000000000000dEaD';
const WK = 'bc1qwkidentityfortheevmguardtests000000000000000000';

const upgradeToAndCall = (impl = EVIL_IMPL) =>
  encodeFunctionData({
    abi: ACCOUNT_ABI,
    functionName: 'upgradeToAndCall',
    args: [impl, '0x8129fc1c'],
  });
const upgradeTo = (impl = EVIL_IMPL) =>
  encodeFunctionData({
    abi: ACCOUNT_ABI,
    functionName: 'upgradeTo',
    args: [impl],
  });
const withdrawDepositTo = () =>
  encodeFunctionData({
    abi: ACCOUNT_ABI,
    functionName: 'withdrawDepositTo',
    args: [ATTACKER, 10n ** 18n],
  });
const grantRole = () =>
  encodeFunctionData({
    abi: ACCOUNT_ABI,
    functionName: 'grantRole',
    args: [`0x${'00'.repeat(32)}`, ATTACKER],
  });
const erc20Transfer = (to = RECIPIENT, amount = 1000000n) =>
  encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [to, amount],
  });
const execute = (target, value, data) =>
  encodeFunctionData({
    abi: ACCOUNT_ABI,
    functionName: 'execute',
    args: [target, value, data],
  });
const executeBatch = (targets, datas) =>
  encodeFunctionData({
    abi: ACCOUNT_ABI,
    functionName: 'executeBatch',
    args: [targets, datas],
  });

/**
 * A real wallet-built payload (SDK 1.3.0 toJson shape: id, opHash,
 * userOpRequest, combinedPubKey, publicKeys, publicNonces, signatures) with
 * its userOpRequest fields overridden.
 */
function withUserOp(overrides, base = walletPayloads.nativeSend) {
  const parsed = JSON.parse(base);
  parsed.userOpRequest = { ...parsed.userOpRequest, ...overrides };
  return JSON.stringify(parsed);
}
const withCallData = (callData) => withUserOp({ callData });

function txBody(payload, chain = 'sepolia') {
  return { action: 'tx', chain, path: '0-0', wkIdentity: WK, payload };
}

describe('EVM call guard (C-4)', function () {
  let savedMode;
  beforeEach(function () {
    savedMode = process.env.RELAY_EVM_CALL_GUARD_MODE;
    delete process.env.RELAY_EVM_CALL_GUARD_MODE;
  });
  afterEach(function () {
    if (savedMode === undefined) delete process.env.RELAY_EVM_CALL_GUARD_MODE;
    else process.env.RELAY_EVM_CALL_GUARD_MODE = savedMode;
    sinon.restore();
  });

  describe('fixtures built with the released wallet SDK (1.3.0)', function () {
    it('only ever uses execute(address,uint256,bytes) at the top level', function () {
      for (const [name, payload] of Object.entries(walletPayloads)) {
        const { callData } = JSON.parse(payload).userOpRequest;
        expect(callData.slice(0, 10), name).to.equal(EXECUTE_SELECTOR);
      }
    });

    for (const name of [
      'nativeSend',
      'erc20Transfer',
      'wcApprove',
      'wcRouterSwap',
      'deploymentSend',
      'selfValueSend',
    ]) {
      it(`allows the legit ${name} payload`, function () {
        expect(checkUserOpPayload(walletPayloads[name])).to.deep.equal({
          allowed: true,
          calls: 1,
        });
      });
    }

    it('the deployment send really carries initCode', function () {
      const { initCode } = JSON.parse(
        walletPayloads.deploymentSend,
      ).userOpRequest;
      expect(initCode.length).to.be.greaterThan(42);
    });

    it('refuses the WalletConnect self upgradeToAndCall attack', function () {
      const result = checkUserOpPayload(walletPayloads.attackSelfUpgrade);
      expect(result.allowed).to.equal(false);
      expect(result.reason).to.include('upgradeToAndCall');
      expect(result.reason).to.include('inner call #0');
    });

    it('refuses the attack when the dApp spells the sender in lower case', function () {
      const result = checkUserOpPayload(walletPayloads.attackSelfUpgradeLower);
      expect(result.allowed).to.equal(false);
    });
  });

  describe('self-calls inside execute', function () {
    it('refuses any non-empty calldata to the account itself', function () {
      for (const data of [withdrawDepositTo(), grantRole(), '0xdeadbeef']) {
        for (const target of [SENDER, SENDER.toLowerCase()]) {
          const result = checkUserOpPayload(
            withCallData(execute(target, 0n, data)),
          );
          expect(result.allowed, data).to.equal(false);
          expect(result.reason).to.include('calls the account itself');
        }
      }
    });

    it('refuses calldata shorter than a selector to self', function () {
      const result = checkUserOpPayload(
        withCallData(execute(SENDER, 1n, '0x01')),
      );
      expect(result.allowed).to.equal(false);
    });

    it('refuses addDeposit() on self even with value', function () {
      const data = encodeFunctionData({
        abi: ACCOUNT_ABI,
        functionName: 'addDeposit',
      });
      const result = checkUserOpPayload(
        withCallData(execute(SENDER, 10n ** 15n, data)),
      );
      expect(result.allowed).to.equal(false);
    });

    it('allows a plain value transfer to self (empty calldata)', function () {
      expect(
        checkUserOpPayload(withCallData(execute(SENDER, 10n ** 15n, '0x')))
          .allowed,
      ).to.equal(true);
    });

    it('compares the sender case-insensitively both ways', function () {
      const payload = withUserOp({
        sender: SENDER.toLowerCase(),
        callData: execute(SENDER, 1n, withdrawDepositTo()),
      });
      expect(checkUserOpPayload(payload).allowed).to.equal(false);
    });
  });

  describe('upgrade selectors', function () {
    it('refuses upgradeToAndCall / upgradeTo on ANY target', function () {
      for (const data of [upgradeToAndCall(), upgradeTo()]) {
        for (const target of [SENDER, ROUTER, EVIL_IMPL]) {
          const result = checkUserOpPayload(
            withCallData(execute(target, 0n, data)),
          );
          expect(result.allowed, `${target} ${data.slice(0, 10)}`).to.equal(
            false,
          );
          expect(result.reason).to.match(/upgradeTo/);
        }
      }
    });

    it('refuses a top-level upgradeToAndCall / upgradeTo', function () {
      for (const callData of [upgradeToAndCall(), upgradeTo()]) {
        const result = checkUserOpPayload(withCallData(callData));
        expect(result.allowed).to.equal(false);
        expect(result.reason).to.include('top-level');
        expect(result.reason).to.match(/upgradeTo/);
      }
    });

    it('does not refuse AccessControl calls on third-party contracts', function () {
      expect(
        checkUserOpPayload(withCallData(execute(ROUTER, 0n, grantRole())))
          .allowed,
      ).to.equal(true);
    });
  });

  describe('executeBatch', function () {
    it('allows a batch of third-party calls', function () {
      const result = checkUserOpPayload(
        withCallData(
          executeBatch(
            [USDC, RECIPIENT, SENDER],
            [erc20Transfer(), '0x', '0x'],
          ),
        ),
      );
      expect(result).to.deep.equal({ allowed: true, calls: 3 });
    });

    it('refuses a batch containing a self-call', function () {
      const result = checkUserOpPayload(
        withCallData(
          executeBatch([USDC, SENDER], [erc20Transfer(), withdrawDepositTo()]),
        ),
      );
      expect(result.allowed).to.equal(false);
      expect(result.reason).to.include('inner call #1');
      expect(result.reason).to.include('withdrawDepositTo');
    });

    it('refuses a batch containing a self upgradeToAndCall', function () {
      const result = checkUserOpPayload(
        withCallData(
          executeBatch([USDC, SENDER], [erc20Transfer(), upgradeToAndCall()]),
        ),
      );
      expect(result.allowed).to.equal(false);
      expect(result.reason).to.include('upgradeToAndCall');
    });

    it('refuses a batch whose arrays differ in length', function () {
      const good = executeBatch([USDC], [erc20Transfer()]);
      // Patch the dest[] length word (head: 2 offsets, then dest length).
      const lengthWordStart = 10 + 64 * 2;
      const callData =
        good.slice(0, lengthWordStart) +
        '2'.padStart(64, '0') +
        good.slice(lengthWordStart + 64);
      expect(checkUserOpPayload(withCallData(callData)).allowed).to.equal(
        false,
      );
    });
  });

  describe('top-level selector allowlist', function () {
    it('only execute and executeBatch are accepted', function () {
      for (const callData of [
        withdrawDepositTo(),
        grantRole(),
        erc20Transfer(),
        '0xdeadbeef',
        '0x',
        '0xb61d27',
      ]) {
        const result = checkUserOpPayload(withCallData(callData));
        expect(result.allowed, callData).to.equal(false);
        expect(result.reason).to.include('top-level');
      }
      expect(EXECUTE_BATCH_SELECTOR).to.equal('0x18dfb3c7');
    });
  });

  describe('malformed payloads fail closed', function () {
    for (const [label, payload] of [
      ['non-JSON', 'not json'],
      ['JSON array', '[]'],
      ['JSON string', '"0xb61d27f6"'],
      ['no userOpRequest', JSON.stringify({ opHash: '0x00' })],
      ['userOpRequest array', JSON.stringify({ userOpRequest: [] })],
      ['bad sender', withUserOp({ sender: 'not-an-address' })],
      ['missing sender', withUserOp({ sender: undefined })],
      ['non-hex callData', withUserOp({ callData: 'b61d27f6' })],
      ['odd-length callData', withUserOp({ callData: '0xb61d27f60' })],
      ['numeric callData', withUserOp({ callData: 12 })],
      [
        'truncated execute args',
        withCallData(`${EXECUTE_SELECTOR}${'00'.repeat(40)}`),
      ],
      ['non-string payload', 42],
    ]) {
      it(`refuses ${label}`, function () {
        expect(checkUserOpPayload(payload).allowed).to.equal(false);
      });
    }
  });

  describe('guardConsumerEvmTx (applicability, mode, logging)', function () {
    it('defaults to enforce; only the exact value "log" relaxes it', function () {
      expect(evmCallGuardMode()).to.equal('enforce');
      for (const value of ['', 'off', 'LOG', 'enforce', 'false']) {
        process.env.RELAY_EVM_CALL_GUARD_MODE = value;
        expect(evmCallGuardMode(), value).to.equal('enforce');
      }
      process.env.RELAY_EVM_CALL_GUARD_MODE = 'log';
      expect(evmCallGuardMode()).to.equal('log');
    });

    it('refuses the attack on every EVM chain in the relay config', function () {
      const evmChains = Object.keys(blockchains).filter(
        (c) => blockchains[c].chainType === 'evm',
      );
      expect(evmChains).to.include.members([
        'eth',
        'sepolia',
        'polygon',
        'amoy',
        'base',
        'bsc',
        'avax',
      ]);
      sinon.stub(log, 'warn');
      for (const chain of evmChains) {
        expect(
          guardConsumerEvmTx(txBody(walletPayloads.attackSelfUpgrade, chain))
            .refused,
          chain,
        ).to.equal(true);
        expect(
          guardConsumerEvmTx(txBody(walletPayloads.nativeSend, chain)).refused,
          chain,
        ).to.equal(false);
      }
    });

    it('logs refusals with [EVM-GUARD], identity, chain and reason — never payload or signatures', function () {
      const warn = sinon.stub(log, 'warn');
      const verdict = guardConsumerEvmTx(
        txBody(walletPayloads.attackSelfUpgrade),
      );
      expect(verdict.refused).to.equal(true);
      expect(warn.calledOnce).to.equal(true);
      const line = warn.firstCall.args[0];
      expect(line).to.match(/^\[EVM-GUARD\] REFUSED /);
      expect(line).to.include(WK);
      expect(line).to.include('sepolia');
      expect(line).to.include(verdict.reason);
      const parsed = JSON.parse(walletPayloads.attackSelfUpgrade);
      const walletSig = Object.values(parsed.signatures)[0];
      for (const secretish of [
        parsed.opHash,
        parsed.combinedPubKey,
        walletSig.signature,
        walletSig.challenge,
        parsed.userOpRequest.callData,
      ]) {
        expect(line).to.not.include(secretish);
      }
    });

    it('does not log anything for legit sends', function () {
      const warn = sinon.stub(log, 'warn');
      for (const payload of Object.values(walletPayloads).slice(0, 6)) {
        expect(guardConsumerEvmTx(txBody(payload)).refused).to.equal(false);
      }
      expect(warn.called).to.equal(false);
    });

    it('leaves non-EVM chains untouched', function () {
      const warn = sinon.stub(log, 'warn');
      for (const [chain, payload] of [
        ['btc', '0200000001abcdef'],
        ['flux', 'deadbeef'],
        ['solMainnet', 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
        ['solDevnet', JSON.stringify({ unsignedTxBase64: 'AQ==' })],
        // even a userOp-shaped payload on a known non-EVM chain: the Key
        // decodes it with that chain's (non-EVM) logic.
        ['btc', walletPayloads.attackSelfUpgrade],
      ]) {
        expect(guardConsumerEvmTx(txBody(payload, chain)).refused).to.equal(
          false,
        );
      }
      expect(warn.called).to.equal(false);
    });

    it('only inspects the tx action', function () {
      sinon.stub(log, 'warn');
      for (const action of [
        'evmsigningrequest',
        'publicnoncesrequest',
        'txid',
        'enterprisevaultsign',
      ]) {
        expect(
          guardConsumerEvmTx({
            ...txBody(walletPayloads.attackSelfUpgrade),
            action,
          }).refused,
          action,
        ).to.equal(false);
      }
    });

    it('fails closed on an unparseable payload on an EVM chain', function () {
      sinon.stub(log, 'warn');
      expect(guardConsumerEvmTx(txBody('{"foo":1}')).refused).to.equal(true);
    });

    it('guards userOp payloads on chains the relay does not know', function () {
      sinon.stub(log, 'warn');
      for (const chain of ['newevmchain', 'constructor', '__proto__']) {
        expect(
          guardConsumerEvmTx(txBody(walletPayloads.attackSelfUpgrade, chain))
            .refused,
          chain,
        ).to.equal(true);
        expect(
          guardConsumerEvmTx(txBody(walletPayloads.nativeSend, chain)).refused,
          chain,
        ).to.equal(false);
        expect(
          guardConsumerEvmTx(txBody('deadbeef', chain)).refused,
          chain,
        ).to.equal(false);
      }
    });

    it('log mode reports but lets the request through', function () {
      process.env.RELAY_EVM_CALL_GUARD_MODE = 'log';
      const warn = sinon.stub(log, 'warn');
      const verdict = guardConsumerEvmTx(
        txBody(walletPayloads.attackSelfUpgrade),
      );
      expect(verdict.refused).to.equal(false);
      expect(verdict.reason).to.include('upgradeToAndCall');
      expect(warn.calledOnce).to.equal(true);
      expect(warn.firstCall.args[0]).to.match(
        /^\[EVM-GUARD\] WOULD REFUSE \(RELAY_EVM_CALL_GUARD_MODE=log, delivered\)/,
      );
    });
  });

  describe('POST /v1/action', function () {
    function signedRequest(payload, chain = 'sepolia') {
      const req = httpMocks.createRequest({
        method: 'POST',
        body: txBody(payload, chain),
      });
      req.isAuthenticated = true;
      req.verifiedIdentity = WK;
      return req;
    }
    function response(req) {
      return httpMocks.createResponse({
        eventEmitter: require('events').EventEmitter,
        req,
      });
    }
    function stubDelivery() {
      const posted = sinon.stub(actionService, 'postAction').resolves({
        ok: true,
      });
      const onAction = sinon.stub(enterpriseHooks, 'onAction').resolves();
      const notified = sinon
        .stub(notificationService, 'sendNotificationKey')
        .resolves();
      const emitted = [];
      sinon.stub(socket, 'getIOKey').returns({
        to: (room) => ({ emit: (ev) => emitted.push([room, ev]) }),
      });
      const walletEmitted = [];
      sinon.stub(socket, 'getIOWallet').returns({
        to: (room) => ({
          emit: (ev, data) => walletEmitted.push([room, ev, data]),
        }),
      });
      sinon.stub(log, 'warn');
      sinon.stub(log, 'info');
      return { posted, onAction, notified, emitted, walletEmitted };
    }

    it('refuses the attack with 403 and the standard error envelope, before storing or delivering it', async function () {
      const d = stubDelivery();
      const req = signedRequest(walletPayloads.attackSelfUpgrade);
      const res = response(req);
      await actionApi.postAction(req, res);
      expect(res.statusCode).to.equal(403);
      const body = res._getJSONData();
      expect(body.status).to.equal('error');
      expect(body.data.code).to.equal('EVM_CALL_REFUSED');
      expect(body.data.name).to.equal('ForbiddenError');
      expect(body.data.message).to.include('upgradeToAndCall');
      expect(d.posted.called).to.equal(false);
      expect(d.onAction.called).to.equal(false);
      expect(d.notified.called).to.equal(false);
      expect(d.emitted).to.deep.equal([]);
    });

    it('tells the released wallet the tx was rejected, as SSP Key would, so no QR hand-off is offered', async function () {
      const d = stubDelivery();
      const req = signedRequest(walletPayloads.attackSelfUpgrade);
      const res = response(req);
      await actionApi.postAction(req, res);
      expect(res.statusCode).to.equal(403);
      expect(d.walletEmitted).to.have.length(1);
      const [room, event, data] = d.walletEmitted[0];
      expect(room).to.equal(WK);
      expect(event).to.equal('txrejected');
      expect(data).to.deep.equal({
        action: 'txrejected',
        payload: walletPayloads.attackSelfUpgrade,
        wkIdentity: WK,
        chain: 'sepolia',
        path: req.body.path,
      });
      expect(d.emitted).to.deep.equal([]);
    });

    it('delivers legit sends to the Key unchanged', async function () {
      for (const name of [
        'nativeSend',
        'erc20Transfer',
        'wcApprove',
        'wcRouterSwap',
        'deploymentSend',
        'selfValueSend',
      ]) {
        sinon.restore();
        const d = stubDelivery();
        const req = signedRequest(walletPayloads[name]);
        const res = response(req);
        await actionApi.postAction(req, res);
        expect(res.statusCode, name).to.equal(200);
        expect(d.posted.calledOnce, name).to.equal(true);
        expect(d.posted.firstCall.args[0].payload).to.equal(
          walletPayloads[name],
        );
        expect(d.emitted).to.deep.equal([[WK, 'tx']]);
        expect(d.walletEmitted, name).to.deep.equal([]);
      }
    });

    it('delivers the attack in log mode (kill switch)', async function () {
      process.env.RELAY_EVM_CALL_GUARD_MODE = 'log';
      const d = stubDelivery();
      const req = signedRequest(walletPayloads.attackSelfUpgrade);
      const res = response(req);
      await actionApi.postAction(req, res);
      expect(res.statusCode).to.equal(200);
      expect(d.posted.calledOnce).to.equal(true);
      expect(d.emitted).to.deep.equal([[WK, 'tx']]);
    });

    it('does not touch UTXO tx actions', async function () {
      const d = stubDelivery();
      const req = signedRequest('0200000001abcdef', 'btc');
      const res = response(req);
      await actionApi.postAction(req, res);
      expect(res.statusCode).to.equal(200);
      expect(d.posted.calledOnce).to.equal(true);
    });
  });
});
