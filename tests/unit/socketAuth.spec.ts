// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
/**
 * RA-1 (H-10 / RLY-2) and RLY-9: socket join requires auth; listeners can't
 * crash the process.
 */
import { expect } from 'chai';
import utxolib from '@runonflux/utxo-lib';
import bitcoinMessage from 'bitcoinjs-message';
import { EventEmitter } from 'events';
import sinon from 'sinon';
import socketModule, {
  verifySocketAuth,
  parseJoinData,
  safeListener,
  isAllowedSocketOrigin,
  recoveryRoom,
} from '../../src/lib/socket';
import enterpriseHooks from '../../src/services/enterpriseHooks';
import socketService from '../../src/services/socketService';
import {
  deriveP2WSHAddress,
  createSignaturePayload,
} from '../../src/lib/identityAuth';

const WIF = 'L1TnU2zbNaAqMoVh65Cyvmcjzbrj41Gs9iTLcWbpJCMynXuap6UN';
const PUB =
  '0278d4aa2a1c643fc68a0de5454e47c520cf59643526474e63b320144de9e0d59a';
const PUB2 =
  '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const SCRIPT = Buffer.from(
  utxolib.script.multisig.output.encode(
    2,
    [PUB, PUB2].sort().map((k) => Buffer.from(k, 'hex')),
  ),
).toString('hex');
const WK = deriveP2WSHAddress(SCRIPT, 'mainnet');

function signedJoin(action = 'join', identity = WK) {
  const message = JSON.stringify(
    createSignaturePayload(action, identity, 'ab'.repeat(32)),
  );
  const kp = utxolib.ECPair.fromWIF(WIF, utxolib.networks.bitcoin);
  const signature = bitcoinMessage
    .sign(message, kp.d.toBuffer(32), kp.compressed)
    .toString('base64');
  return {
    wkIdentity: WK,
    signature,
    message,
    publicKey: PUB,
    witnessScript: SCRIPT,
  };
}

describe('Socket join auth (RA-1)', function () {
  it('accepts a valid signed join', function () {
    expect(verifySocketAuth(signedJoin())).to.deep.equal({ valid: true });
  });

  it('does NOT accept a join without auth fields (no backward-compat branch)', function () {
    const r = verifySocketAuth({ wkIdentity: WK });
    expect(r.valid).to.equal(false);
    expect(r.unauthenticated).to.equal(true);
  });

  it('refuses partial auth, wrong action, wrong identity, bad signature and replay', function () {
    const good = signedJoin();
    expect(
      verifySocketAuth({ wkIdentity: WK, signature: good.signature }).valid,
    ).to.equal(false);
    expect(
      verifySocketAuth({ ...good, witnessScript: undefined }).valid,
    ).to.equal(false);
    expect(verifySocketAuth(signedJoin('action')).valid).to.equal(false);
    const other = signedJoin(
      'join',
      'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
    );
    expect(verifySocketAuth({ ...other, wkIdentity: WK }).valid).to.equal(
      false,
    );
    expect(
      verifySocketAuth({ ...signedJoin(), signature: good.signature }).valid,
    ).to.equal(false);
    // replay of an accepted join
    const once = signedJoin();
    expect(verifySocketAuth(once).valid).to.equal(true);
    expect(verifySocketAuth(once).valid).to.equal(false);
  });

  it('refuses a join for a non-multisig identity', function () {
    const r = verifySocketAuth({
      ...signedJoin(),
      wkIdentity: '15hETetDmcXm1mM4sEf7U2KXC9hDHFMSzz',
    });
    expect(r.valid).to.equal(false);
  });

  it('parseJoinData rejects null / non-object / bad identity payloads', function () {
    for (const bad of [
      null,
      undefined,
      'x',
      42,
      [],
      {},
      { wkIdentity: 1 },
      { wkIdentity: 'short' },
    ]) {
      expect('error' in parseJoinData(bad), JSON.stringify(bad)).to.equal(true);
    }
    expect(parseJoinData({ wkIdentity: WK })).to.deep.equal({ wkIdentity: WK });
  });

  it('names the recovery-only room distinctly from the identity room', function () {
    expect(recoveryRoom(WK)).to.equal(`recovery:${WK}`);
    expect(recoveryRoom(WK)).to.not.equal(WK);
  });
});

describe('safeListener (RLY-9)', function () {
  it('swallows a synchronous throw from a listener', function () {
    const listener = safeListener('test', (data) => {
      const { wkIdentity } = data; // TypeError on null
      return wkIdentity;
    });
    expect(() => listener(null)).to.not.throw();
  });

  it('swallows a rejected promise from an async listener (no unhandledRejection)', async function () {
    let unhandled = false;
    const onUnhandled = () => {
      unhandled = true;
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const listener = safeListener('test', async (data) => {
        const { wkIdentity } = data;
        return wkIdentity;
      });
      listener(null);
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).to.equal(false);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

describe('wallet socket CORS origins', function () {
  afterEach(function () {
    delete process.env.RELAY_SOCKET_CORS_ORIGINS;
  });

  it('allows extensions, SSP sites and non-browser clients only', function () {
    expect(isAllowedSocketOrigin(undefined)).to.equal(true);
    expect(
      isAllowedSocketOrigin('chrome-extension://abcdefghijklmnop'),
    ).to.equal(true);
    expect(
      isAllowedSocketOrigin(
        'moz-extension://1b2c3d4e-0000-1111-2222-333344445555',
      ),
    ).to.equal(true);
    expect(isAllowedSocketOrigin('https://enterprise.sspwallet.com')).to.equal(
      true,
    );
    expect(isAllowedSocketOrigin('https://sspwallet.io')).to.equal(true);
    expect(isAllowedSocketOrigin('https://evil.example')).to.equal(false);
    expect(isAllowedSocketOrigin('https://sspwallet.io.evil.example')).to.equal(
      false,
    );
    expect(isAllowedSocketOrigin('http://enterprise.sspwallet.com')).to.equal(
      false,
    );
  });

  it('honours the RELAY_SOCKET_CORS_ORIGINS override', function () {
    process.env.RELAY_SOCKET_CORS_ORIGINS =
      'https://a.example, https://b.example';
    expect(isAllowedSocketOrigin('https://a.example')).to.equal(true);
    expect(isAllowedSocketOrigin('chrome-extension://abc')).to.equal(false);
    process.env.RELAY_SOCKET_CORS_ORIGINS = '*';
    expect(isAllowedSocketOrigin('https://evil.example')).to.equal(true);
  });
});

describe('socket handshake client IP for the enterprise hooks', function () {
  const CF_EDGE = '172.70.10.20';
  afterEach(function () {
    sinon.restore();
  });

  function fakeSocket(headers) {
    const listeners = {};
    return {
      id: 'sock-1',
      handshake: { address: '10.0.0.5', headers },
      on: (ev, fn) => {
        listeners[ev] = fn;
      },
      join: () => {},
      leave: () => {},
      emit: () => {},
      disconnect: () => {},
      listeners,
    };
  }

  async function joinAndLeave(init, namespaceHeaders) {
    const join = sinon.stub(enterpriseHooks, 'onSocketJoin').resolves();
    const leave = sinon.stub(enterpriseHooks, 'onSocketLeave').resolves();
    sinon.stub(socketService, 'getAction').resolves(null);
    const io = init();
    const sock = fakeSocket(namespaceHeaders);
    EventEmitter.prototype.emit.call(io.sockets, 'connection', sock);
    await sock.listeners.join(signedJoin());
    await sock.listeners.leave({ wkIdentity: WK });
    await new Promise((r) => setImmediate(r));
    io.close();
    return { join, leave };
  }

  for (const [label, init] of [
    ['key', () => socketModule.initIOKey()],
    ['wallet', () => socketModule.initIOWallet()],
  ]) {
    it(`passes sspClientIp / sspViaCloudflare on ${label} join and leave`, async function () {
      const viaCf = await joinAndLeave(init, {
        'x-forwarded-for': `198.51.100.7, ${CF_EDGE}`,
        'cf-connecting-ip': '203.0.113.9',
      });
      for (const stub of [viaCf.join, viaCf.leave]) {
        expect(stub.calledOnce, label).to.equal(true);
        const handshake = stub.firstCall.args[3];
        expect(handshake.sspClientIp).to.equal('203.0.113.9');
        expect(handshake.sspViaCloudflare).to.equal(true);
        expect(handshake.address).to.equal('10.0.0.5');
      }
      sinon.restore();
      const forged = await joinAndLeave(init, {
        'x-forwarded-for': '192.0.2.66',
        'cf-connecting-ip': '203.0.113.9',
      });
      const handshake = forged.join.firstCall.args[3];
      expect(handshake.sspClientIp).to.equal('192.0.2.66');
      expect(handshake.sspViaCloudflare).to.equal(false);
    });
  }
});
