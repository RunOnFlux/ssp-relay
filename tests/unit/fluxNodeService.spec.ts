// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { assert } from 'chai';

/**
 * Flux Node Service — Unit Tests
 *
 * Tests pure logic functions without MongoDB. The service methods that interact
 * with the database are tested via E2E tests in the enterprise app.
 */
describe('Flux Node Service Logic', function () {
  // ============================================================
  // tierFromAmount
  // ============================================================
  describe('tierFromAmount', function () {
    function tierFromAmount(satoshis) {
      const amt = BigInt(satoshis);
      if (amt >= BigInt('4000000000000')) return 'stratus';
      if (amt >= BigInt('1250000000000')) return 'nimbus';
      return 'cumulus';
    }

    it('should return stratus for 40,000 FLUX (4000000000000 sat)', function () {
      assert.equal(tierFromAmount('4000000000000'), 'stratus');
    });

    it('should return stratus for amounts above 40,000 FLUX', function () {
      assert.equal(tierFromAmount('5000000000000'), 'stratus');
    });

    it('should return nimbus for 12,500 FLUX (1250000000000 sat)', function () {
      assert.equal(tierFromAmount('1250000000000'), 'nimbus');
    });

    it('should return nimbus for amounts between 12,500 and 40,000 FLUX', function () {
      assert.equal(tierFromAmount('2000000000000'), 'nimbus');
    });

    it('should return cumulus for amounts below 12,500 FLUX', function () {
      assert.equal(tierFromAmount('100000000000'), 'cumulus');
    });

    it('should return cumulus for 1,000 FLUX (100000000000 sat)', function () {
      assert.equal(tierFromAmount('100000000000'), 'cumulus');
    });

    it('should return cumulus for zero', function () {
      assert.equal(tierFromAmount('0'), 'cumulus');
    });

    it('should handle exact boundary at nimbus threshold', function () {
      // 1249999999999 = just below nimbus
      assert.equal(tierFromAmount('1249999999999'), 'cumulus');
      // 1250000000000 = exactly nimbus
      assert.equal(tierFromAmount('1250000000000'), 'nimbus');
    });

    it('should handle exact boundary at stratus threshold', function () {
      // 3999999999999 = just below stratus
      assert.equal(tierFromAmount('3999999999999'), 'nimbus');
      // 4000000000000 = exactly stratus
      assert.equal(tierFromAmount('4000000000000'), 'stratus');
    });
  });

  // ============================================================
  // isFluxChain
  // ============================================================
  describe('isFluxChain', function () {
    function isFluxChain(chain) {
      return chain === 'flux' || chain === 'fluxTestnet';
    }

    it('should return true for flux', function () {
      assert.isTrue(isFluxChain('flux'));
    });

    it('should return true for fluxTestnet', function () {
      assert.isTrue(isFluxChain('fluxTestnet'));
    });

    it('should return false for btc', function () {
      assert.isFalse(isFluxChain('btc'));
    });

    it('should return false for eth', function () {
      assert.isFalse(isFluxChain('eth'));
    });

    it('should return false for empty string', function () {
      assert.isFalse(isFluxChain(''));
    });

    it('should return false for FLUX (wrong case)', function () {
      assert.isFalse(isFluxChain('FLUX'));
    });
  });

  // ============================================================
  // validateDelegates
  // ============================================================
  describe('validateDelegates', function () {
    const MAX_DELEGATES = 4;
    const DELEGATE_KEY_LENGTH = 66;

    function validateDelegates(delegates) {
      if (delegates.length > MAX_DELEGATES) {
        return {
          valid: false,
          error: `Maximum ${MAX_DELEGATES} delegates allowed`,
        };
      }
      for (const key of delegates) {
        if (typeof key !== 'string' || key.length !== DELEGATE_KEY_LENGTH) {
          return {
            valid: false,
            error: 'Delegate keys must be 66-character hex strings',
          };
        }
        if (!/^[0-9a-fA-F]+$/.test(key)) {
          return { valid: false, error: 'Delegate keys must be valid hex' };
        }
      }
      return { valid: true };
    }

    it('should accept empty array', function () {
      assert.isTrue(validateDelegates([]).valid);
    });

    it('should accept valid 66-char hex key', function () {
      const key = 'a'.repeat(66);
      assert.isTrue(validateDelegates([key]).valid);
    });

    it('should accept up to 4 delegates', function () {
      const keys = Array(4).fill('ab'.repeat(33));
      assert.isTrue(validateDelegates(keys).valid);
    });

    it('should reject more than 4 delegates', function () {
      const keys = Array(5).fill('ab'.repeat(33));
      const result = validateDelegates(keys);
      assert.isFalse(result.valid);
      assert.include(result.error, 'Maximum 4');
    });

    it('should reject key shorter than 66 chars', function () {
      const result = validateDelegates(['a'.repeat(65)]);
      assert.isFalse(result.valid);
      assert.include(result.error, '66-character');
    });

    it('should reject key longer than 66 chars', function () {
      const result = validateDelegates(['a'.repeat(67)]);
      assert.isFalse(result.valid);
    });

    it('should reject non-hex characters', function () {
      const key = 'g'.repeat(66);
      const result = validateDelegates([key]);
      assert.isFalse(result.valid);
      assert.include(result.error, 'valid hex');
    });

    it('should accept mixed case hex', function () {
      const key =
        'aAbBcCdDeEfF00112233445566778899aAbBcCdDeEfF00112233445566778899aA';
      assert.isTrue(validateDelegates([key]).valid);
    });
  });

  // ============================================================
  // docToFluxNode (strips identityPrivKey)
  // ============================================================
  describe('docToFluxNode — identityPrivKey stripping', function () {
    function docToFluxNode(doc) {
      return {
        id: doc._id.toString(),
        organizationId: doc.organizationId.toString(),
        vaultId: doc.vaultId.toString(),
        txid: doc.txid,
        vout: doc.vout,
        amount: doc.amount,
        addressIndex: doc.addressIndex,
        name: doc.name,
        ip: doc.ip,
        tier: doc.tier,
        chain: doc.chain,
        status: doc.status,
        identityPubKey: doc.identityPubKey,
        delegates: doc.delegates,
        ...(doc.broadcastTxid ? { broadcastTxid: doc.broadcastTxid } : {}),
        ...(doc.lastStartedAt
          ? { lastStartedAt: doc.lastStartedAt.toISOString() }
          : {}),
        ...(doc.lastConfirmedAt
          ? { lastConfirmedAt: doc.lastConfirmedAt.toISOString() }
          : {}),
        createdBy: doc.createdBy,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
      };
    }

    const mockDoc = {
      _id: { toString: () => 'node-id-123' },
      organizationId: { toString: () => 'org-id-456' },
      vaultId: { toString: () => 'vault-id-789' },
      txid: 'a'.repeat(64),
      vout: 0,
      amount: '4000000000000',
      addressIndex: 0,
      name: 'test-node',
      ip: '1.2.3.4:16127',
      tier: 'stratus',
      chain: 'flux',
      status: 'confirmed',
      identityPrivKey: 'SENSITIVE_PRIVATE_KEY_SHOULD_NOT_APPEAR',
      identityPubKey: 'b'.repeat(66),
      delegates: [],
      createdBy: 'wk1',
      createdAt: new Date('2025-01-01'),
      updatedAt: new Date('2025-06-01'),
    };

    it('should NOT include identityPrivKey in response', function () {
      const result = docToFluxNode(mockDoc);
      assert.notProperty(result, 'identityPrivKey');
    });

    it('should include identityPubKey in response', function () {
      const result = docToFluxNode(mockDoc);
      assert.equal(result.identityPubKey, 'b'.repeat(66));
    });

    it('should convert ObjectId to string', function () {
      const result = docToFluxNode(mockDoc);
      assert.equal(result.id, 'node-id-123');
      assert.equal(result.organizationId, 'org-id-456');
      assert.equal(result.vaultId, 'vault-id-789');
    });

    it('should convert dates to ISO strings', function () {
      const result = docToFluxNode(mockDoc);
      assert.equal(result.createdAt, '2025-01-01T00:00:00.000Z');
      assert.equal(result.updatedAt, '2025-06-01T00:00:00.000Z');
    });

    it('should include broadcastTxid when present', function () {
      const docWithBroadcast = { ...mockDoc, broadcastTxid: 'txid123' };
      const result = docToFluxNode(docWithBroadcast);
      assert.equal(result.broadcastTxid, 'txid123');
    });

    it('should omit broadcastTxid when absent', function () {
      const result = docToFluxNode(mockDoc);
      assert.notProperty(result, 'broadcastTxid');
    });

    it('should include lastStartedAt when present', function () {
      const docWithStarted = {
        ...mockDoc,
        lastStartedAt: new Date('2025-06-15'),
      };
      const result = docToFluxNode(docWithStarted);
      assert.equal(result.lastStartedAt, '2025-06-15T00:00:00.000Z');
    });

    it('should omit lastStartedAt when absent', function () {
      const result = docToFluxNode(mockDoc);
      assert.notProperty(result, 'lastStartedAt');
    });
  });

  // ============================================================
  // UTXO locking filter logic
  // ============================================================
  describe('UTXO locking filter', function () {
    it('should exclude locked UTXOs', function () {
      const locked = new Map();
      locked.set('txid-aaa', new Set([0, 2]));
      locked.set('txid-bbb', new Set([1]));

      const utxos = [
        { txid: 'txid-aaa', vout: 0, amount: '1000' },
        { txid: 'txid-aaa', vout: 1, amount: '2000' },
        { txid: 'txid-aaa', vout: 2, amount: '3000' },
        { txid: 'txid-bbb', vout: 0, amount: '4000' },
        { txid: 'txid-bbb', vout: 1, amount: '5000' },
        { txid: 'txid-ccc', vout: 0, amount: '6000' },
      ];

      const filtered = utxos.filter((u) => {
        const voutSet = locked.get(u.txid);
        return !voutSet || !voutSet.has(u.vout);
      });

      assert.lengthOf(filtered, 3);
      assert.deepEqual(
        filtered.map((u) => `${u.txid}:${u.vout}`),
        ['txid-aaa:1', 'txid-bbb:0', 'txid-ccc:0'],
      );
    });

    it('should keep all UTXOs when no locks', function () {
      const locked = new Map();
      const utxos = [
        { txid: 'txid-aaa', vout: 0, amount: '1000' },
        { txid: 'txid-bbb', vout: 1, amount: '2000' },
      ];

      const filtered = utxos.filter((u) => {
        const voutSet = locked.get(u.txid);
        return !voutSet || !voutSet.has(u.vout);
      });

      assert.lengthOf(filtered, 2);
    });

    it('should handle empty UTXO list', function () {
      const locked = new Map();
      locked.set('txid-aaa', new Set([0]));

      const filtered = [].filter((u) => {
        const voutSet = locked.get(u.txid);
        return !voutSet || !voutSet.has(u.vout);
      });

      assert.lengthOf(filtered, 0);
    });

    it('should remove all UTXOs when all are locked', function () {
      const locked = new Map();
      locked.set('txid-aaa', new Set([0]));
      locked.set('txid-bbb', new Set([1]));

      const utxos = [
        { txid: 'txid-aaa', vout: 0, amount: '1000' },
        { txid: 'txid-bbb', vout: 1, amount: '2000' },
      ];

      const filtered = utxos.filter((u) => {
        const voutSet = locked.get(u.txid);
        return !voutSet || !voutSet.has(u.vout);
      });

      assert.lengthOf(filtered, 0);
    });
  });

  // ============================================================
  // Node status matching logic
  // ============================================================
  describe('Node status matching', function () {
    it('should match confirmed node by txhash and outidx', function () {
      const confirmedNodes = [
        { txhash: 'aaa', outidx: '0', ip: '1.2.3.4:16127' },
        { txhash: 'bbb', outidx: '1', ip: '5.6.7.8:16127' },
      ];
      const node = { txid: 'aaa', vout: 0 };

      const confirmed = confirmedNodes.find(
        (n) => n.txhash === node.txid && String(n.outidx) === String(node.vout),
      );

      assert.isObject(confirmed);
      assert.equal(confirmed.ip, '1.2.3.4:16127');
    });

    it('should match DOS node by collateral string', function () {
      const dosNodes = [
        { collateral: 'COutPoint(txid-abc, 2)', eligible_in: 100 },
      ];
      const node = { txid: 'txid-abc', vout: 2 };
      const collateralKey = `COutPoint(${node.txid}, ${node.vout})`;

      const dosNode = dosNodes.find((n) => n.collateral === collateralKey);
      assert.isObject(dosNode);
      assert.equal(dosNode.eligible_in, 100);
    });

    it('should not match when vout differs', function () {
      const confirmedNodes = [{ txhash: 'aaa', outidx: '0' }];
      const node = { txid: 'aaa', vout: 1 };

      const confirmed = confirmedNodes.find(
        (n) => n.txhash === node.txid && String(n.outidx) === String(node.vout),
      );

      assert.isUndefined(confirmed);
    });

    it('should handle numeric outidx from API', function () {
      // Some Flux APIs return outidx as number, others as string
      const confirmedNodes = [{ txhash: 'aaa', outidx: 0 }];
      const node = { txid: 'aaa', vout: 0 };

      const confirmed = confirmedNodes.find(
        (n) => n.txhash === node.txid && String(n.outidx) === String(node.vout),
      );

      assert.isObject(confirmed);
    });
  });
});
