// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect } from 'chai';
import sinon from 'sinon';
import axios from 'axios';
import {
  probeNetwork,
  refreshBaseline,
  getOnrampNetworks,
  NATIVE_ASSETS,
  _resetOnrampAvailability,
} from '../../src/services/onrampAvailabilityService';

const OK_QUOTE = [{ ramp: 'banxa', payout: 0.0024 }];
const NO_QUOTE = [
  { ramp: 'moonpay', errors: [{ message: 'does not support' }] },
  { ramp: 'banxa', availablePaymentMethods: [] },
];

function stubQuotes(byAsset: Record<string, unknown>) {
  return sinon.stub(axios, 'get').callsFake(async (url: string) => {
    const asset = url.split('/').pop();
    if (asset in byAsset) {
      const v = byAsset[asset];
      if (v instanceof Error) throw v;
      return { data: v };
    }
    return { data: OK_QUOTE };
  });
}

describe('onrampAvailabilityService', function () {
  beforeEach(function () {
    _resetOnrampAvailability();
  });
  afterEach(function () {
    sinon.restore();
  });

  describe('probeNetwork', function () {
    it('is true when a provider returns a payout', async function () {
      stubQuotes({ btc: OK_QUOTE });
      expect(await probeNetwork('btc', 'us')).to.equal(true);
    });

    it('is false when every provider errors or has no payout', async function () {
      stubQuotes({ flux_flux: NO_QUOTE });
      expect(await probeNetwork('flux_flux', 'us')).to.equal(false);
    });

    it('ignores a payout that also carries errors', async function () {
      stubQuotes({
        flux_flux: [{ ramp: 'x', payout: 1, errors: [{ message: 'no' }] }],
      });
      expect(await probeNetwork('flux_flux', 'us')).to.equal(false);
    });

    it('is unknown (null) on a non-list body or a failed request', async function () {
      stubQuotes({ btc: { message: 'not available in your country' } });
      expect(await probeNetwork('btc', 'gb')).to.equal(null);
      sinon.restore();
      stubQuotes({ btc: new Error('timeout') });
      expect(await probeNetwork('btc', 'us')).to.equal(null);
    });
  });

  describe('getOnrampNetworks', function () {
    it('returns undefined before anything has been checked', function () {
      stubQuotes({});
      expect(getOnrampNetworks(undefined)).to.equal(undefined);
    });

    it('baseline marks FLUX unavailable and the rest available', async function () {
      stubQuotes({ flux_flux: NO_QUOTE });
      await refreshBaseline();
      const nets = getOnrampNetworks(undefined);
      expect(nets.flux).to.equal(false);
      expect(nets.bitcoin).to.equal(true);
      expect(Object.keys(nets)).to.have.length(
        Object.keys(NATIVE_ASSETS).length,
      );
    });

    it('omits networks whose check failed (wallet treats as available)', async function () {
      stubQuotes({ zec_zcash: new Error('down') });
      await refreshBaseline();
      expect(getOnrampNetworks(undefined)).to.not.have.property('zcash');
    });

    it('baseline is available if any baseline country has a provider', async function () {
      sinon.stub(axios, 'get').callsFake(async (url, opts) => {
        const asset = url.split('/').pop();
        if (asset === 'flux_flux' && opts.params.country === 'us') {
          return { data: NO_QUOTE };
        }
        return { data: OK_QUOTE };
      });
      await refreshBaseline();
      expect(getOnrampNetworks(undefined).flux).to.equal(true);
    });

    it('uses the cached country result and falls back to baseline for unknown countries', async function () {
      stubQuotes({});
      await refreshBaseline(); // caches us + de, all available
      sinon.restore();
      stubQuotes({ flux_flux: NO_QUOTE });
      // first request for FR: baseline returned, FR probed in background
      expect(getOnrampNetworks('FR').flux).to.equal(true);
      await new Promise((r) => setTimeout(r, 20));
      expect(getOnrampNetworks('FR').flux).to.equal(false);
      // US is cached from the baseline run
      expect(getOnrampNetworks('US').flux).to.equal(true);
      // Cloudflare unknown / Tor and junk fall back to baseline
      expect(getOnrampNetworks('XX').flux).to.equal(true);
      expect(getOnrampNetworks('T1').flux).to.equal(true);
      expect(getOnrampNetworks('not-a-country').flux).to.equal(true);
    });

    it('probes a new country only once while a check is in flight', async function () {
      const stub = stubQuotes({});
      getOnrampNetworks('cz');
      getOnrampNetworks('cz');
      getOnrampNetworks('CZ');
      await new Promise((r) => setTimeout(r, 20));
      expect(stub.callCount).to.equal(Object.keys(NATIVE_ASSETS).length);
    });
  });
});
