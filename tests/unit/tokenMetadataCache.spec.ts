import { expect } from 'chai';
import sinon from 'sinon';
import axios from 'axios';
import {
  clearTokenMetadataCache,
  getFromAlchemy,
} from '../../src/services/tokenServices';

/**
 * /v1/tokeninfo is public; each miss is a metered provider call. Found
 * tokens are cached per network + address, misses are not.
 */
describe('tokenServices.getFromAlchemy cache', function () {
  const MINT = 'So11111111111111111111111111111111111111112';
  let post: sinon.SinonStub;

  function mintAnswer(decimals: number | null) {
    return {
      data: {
        result: {
          value:
            decimals === null
              ? null
              : { data: { parsed: { info: { decimals, supply: '1' } } } },
        },
      },
    };
  }

  beforeEach(function () {
    clearTokenMetadataCache();
    post = sinon.stub(axios, 'post');
  });

  afterEach(function () {
    sinon.restore();
  });

  it('answers a found token from cache for 24 h', async function () {
    // Mint account, then the (absent) Metaplex metadata account.
    post.onCall(0).resolves(mintAnswer(9));
    post.onCall(1).resolves({ data: { result: { value: null } } });
    const t0 = Date.UTC(2026, 10, 19);
    const first = await getFromAlchemy(MINT, 'solMainnet', t0);
    const second = await getFromAlchemy(MINT, 'solMainnet', t0 + 60_000);
    expect(second).to.deep.equal(first);
    expect(post.callCount).to.equal(2);

    post.resolves(mintAnswer(9));
    await getFromAlchemy(MINT, 'solMainnet', t0 + 25 * 60 * 60 * 1000);
    expect(post.callCount).to.be.greaterThan(2);
  });

  it('does not cache a miss', async function () {
    post.resolves(mintAnswer(null));
    const t0 = Date.UTC(2026, 10, 19);
    for (const offset of [0, 1000]) {
      try {
        await getFromAlchemy(MINT, 'solMainnet', t0 + offset);
      } catch {
        // "Mint account not found"
      }
    }
    expect(post.callCount).to.equal(2);
  });

  it('keeps networks apart', async function () {
    post.resolves(mintAnswer(6));
    const t0 = Date.UTC(2026, 10, 19);
    await getFromAlchemy(MINT, 'solMainnet', t0);
    const before = post.callCount;
    await getFromAlchemy(MINT, 'solDevnet', t0);
    expect(post.callCount).to.be.greaterThan(before);
  });
});
