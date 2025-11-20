// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { assert } from 'chai';
import blockchains from '../../src/services/blockchains';

describe('Blockchain', function () {
  describe('Correctly verifies data', function () {
    it('should return valid btc data', async function () {
      assert.equal(blockchains.btc.id, 'btc');
      assert.equal(blockchains.btc.libid, 'bitcoin');
      assert.equal(blockchains.btc.name, 'Bitcoin');
      assert.equal(blockchains.btc.symbol, 'BTC');
      assert.equal(blockchains.btc.decimals, 8);
      assert.equal(blockchains.btc.slip, 0);
      assert.equal(blockchains.btc.scriptType, 'p2wsh');
      assert.equal(
        blockchains.btc.messagePrefix,
        '\u0018Bitcoin Signed Message:\n',
      );
      assert.equal(blockchains.btc.pubKeyHash, '00');
      assert.equal(blockchains.btc.scriptHash, '05');
      assert.equal(blockchains.btc.wif, '80');
      assert.equal(blockchains.btc.bip32.public, 0x02aa7ed3);
      assert.equal(blockchains.btc.bip32.private, 0x02aa7a99);
      assert.equal(blockchains.btc.backend, 'blockbook');
      assert.equal(blockchains.btc.bech32, 'bc1');
      assert.equal(blockchains.btc.dustLimit, 546);
      assert.equal(blockchains.btc.minFeePerByte, 1);
      assert.equal(blockchains.btc.feePerByte, 100);
      assert.equal(blockchains.btc.maxMessage, 80);
      assert.equal(blockchains.btc.maxTxSize, 100000);
      assert.equal(blockchains.btc.rbf, true);
    });

    it('should return valid flux data', async function () {
      assert.equal(blockchains.flux.id, 'flux');
      assert.equal(blockchains.flux.libid, 'flux');
      assert.equal(blockchains.flux.name, 'Flux');
      assert.equal(blockchains.flux.symbol, 'FLUX');
      assert.equal(blockchains.flux.decimals, 8);
      assert.equal(blockchains.flux.slip, 19167);
      assert.equal(blockchains.flux.scriptType, 'p2sh');
      assert.equal(
        blockchains.flux.messagePrefix,
        '\u0018Zelcash Signed Message:\n',
      );
      assert.equal(blockchains.flux.pubKeyHash, '1cb8');
      assert.equal(blockchains.flux.scriptHash, '1cbd');
      assert.equal(blockchains.flux.wif, '80');
      assert.equal(blockchains.flux.bip32.public, 0x0488b21e);
      assert.equal(blockchains.flux.bip32.private, 0x0488ade4);
      assert.equal(blockchains.flux.txVersion, 4);
      assert.equal(blockchains.flux.txGroupID, 0x892f2085);
      assert.equal(blockchains.flux.backend, 'insight');
      assert.equal(blockchains.flux.dustLimit, 546);
      assert.equal(blockchains.flux.minFeePerByte, 1);
      assert.equal(blockchains.flux.feePerByte, 1);
      assert.equal(blockchains.flux.maxMessage, 80);
      assert.equal(blockchains.flux.maxTxSize, 1800000);
      assert.equal(blockchains.flux.rbf, false);
      assert.equal(blockchains.flux.txExpiryHeight, 30);
    });

    it('should return valid doge data', async function () {
      assert.equal(blockchains.doge.id, 'doge');
      assert.equal(blockchains.doge.libid, 'dogecoin');
      assert.equal(blockchains.doge.name, 'Dogecoin');
      assert.equal(blockchains.doge.symbol, 'DOGE');
      assert.equal(blockchains.doge.decimals, 8);
      assert.equal(blockchains.doge.slip, 3);
      assert.equal(blockchains.doge.scriptType, 'p2sh');
      assert.equal(
        blockchains.doge.messagePrefix,
        '\u0019Dogecoin Signed Message:\n',
      );
      assert.equal(blockchains.doge.pubKeyHash, '1e');
      assert.equal(blockchains.doge.scriptHash, '16');
      assert.equal(blockchains.doge.wif, '9e');
      assert.equal(blockchains.doge.bip32.public, 0x02facafd);
      assert.equal(blockchains.doge.bip32.private, 0x02fac398);
      assert.equal(blockchains.doge.backend, 'blockbook');
      assert.equal(blockchains.doge.dustLimit, 1000000);
      assert.equal(blockchains.doge.minFeePerByte, 1000);
      assert.equal(blockchains.doge.feePerByte, 20);
      assert.equal(blockchains.doge.maxMessage, 80);
      assert.equal(blockchains.doge.maxTxSize, 100000);
      assert.equal(blockchains.doge.rbf, true);
    });

    it('should return valid ltc data', async function () {
      assert.equal(blockchains.ltc.id, 'ltc');
      assert.equal(blockchains.ltc.libid, 'litecoin');
      assert.equal(blockchains.ltc.name, 'Litecoin');
      assert.equal(blockchains.ltc.symbol, 'LTC');
      assert.equal(blockchains.ltc.decimals, 8);
      assert.equal(blockchains.ltc.slip, 2);
      assert.equal(blockchains.ltc.scriptType, 'p2wsh');
      assert.equal(
        blockchains.ltc.messagePrefix,
        '\u0019Litecoin Signed Message:\n',
      );
      assert.equal(blockchains.ltc.pubKeyHash, '30');
      assert.equal(blockchains.ltc.scriptHash, '32');
      assert.equal(blockchains.ltc.wif, 'b0');
      assert.equal(blockchains.ltc.bip32.public, 0x019da462);
      assert.equal(blockchains.ltc.bip32.private, 0x019d9cfe);
      assert.equal(blockchains.ltc.backend, 'blockbook');
      assert.equal(blockchains.ltc.bech32, 'ltc');
      assert.equal(blockchains.ltc.dustLimit, 546);
      assert.equal(blockchains.ltc.minFeePerByte, 1);
      assert.equal(blockchains.ltc.feePerByte, 20);
      assert.equal(blockchains.ltc.maxMessage, 80);
      assert.equal(blockchains.ltc.maxTxSize, 100000);
      assert.equal(blockchains.ltc.rbf, true);
    });

    it('should return valid bch data', async function () {
      assert.equal(blockchains.bch.id, 'bch');
      assert.equal(blockchains.bch.libid, 'bitcoincash');
      assert.equal(blockchains.bch.name, 'Bitcoin Cash');
      assert.equal(blockchains.bch.symbol, 'BCH');
      assert.equal(blockchains.bch.decimals, 8);
      assert.equal(blockchains.bch.slip, 145);
      assert.equal(blockchains.bch.scriptType, 'p2sh');
      assert.equal(
        blockchains.bch.messagePrefix,
        '\u0018Bitcoin Signed Message:\n',
      );
      assert.equal(blockchains.bch.pubKeyHash, '00');
      assert.equal(blockchains.bch.scriptHash, '05');
      assert.equal(blockchains.bch.wif, '80');
      assert.equal(blockchains.bch.bip32.public, 0x0488b21e);
      assert.equal(blockchains.bch.bip32.private, 0x0488ade4);
      assert.equal(blockchains.bch.backend, 'blockbook');
      assert.equal(blockchains.bch.dustLimit, 546);
      assert.equal(blockchains.bch.minFeePerByte, 1);
      assert.equal(blockchains.bch.feePerByte, 15);
      assert.equal(blockchains.bch.maxMessage, 80);
      assert.equal(blockchains.bch.maxTxSize, 100000);
      assert.equal(blockchains.bch.rbf, true);
      assert.equal(blockchains.bch.cashaddr, 'bitcoincash:');
    });

    it('should return valid rvn data', async function () {
      assert.equal(blockchains.rvn.id, 'rvn');
      assert.equal(blockchains.rvn.libid, 'ravencoin');
      assert.equal(blockchains.rvn.name, 'Ravencoin');
      assert.equal(blockchains.rvn.symbol, 'RVN');
      assert.equal(blockchains.rvn.decimals, 8);
      assert.equal(blockchains.rvn.slip, 175);
      assert.equal(blockchains.rvn.scriptType, 'p2sh');
      assert.equal(
        blockchains.rvn.messagePrefix,
        '\u0016Raven Signed Message:\n',
      );
      assert.equal(blockchains.rvn.pubKeyHash, '3c');
      assert.equal(blockchains.rvn.scriptHash, '7a');
      assert.equal(blockchains.rvn.wif, '80');
      assert.equal(blockchains.rvn.bip32.public, 0x0488b21e);
      assert.equal(blockchains.rvn.bip32.private, 0x0488ade4);
      assert.equal(blockchains.rvn.backend, 'blockbook');
      assert.equal(blockchains.rvn.dustLimit, 546);
      assert.equal(blockchains.rvn.minFeePerByte, 1000);
      assert.equal(blockchains.rvn.feePerByte, 1050);
      assert.equal(blockchains.rvn.maxMessage, 80);
      assert.equal(blockchains.rvn.maxTxSize, 100000);
      assert.equal(blockchains.rvn.rbf, true);
    });

    it('should return valid zec data', async function () {
      assert.equal(blockchains.zec.id, 'zec');
      assert.equal(blockchains.zec.libid, 'zcash');
      assert.equal(blockchains.zec.name, 'Zcash');
      assert.equal(blockchains.zec.symbol, 'ZEC');
      assert.equal(blockchains.zec.decimals, 8);
      assert.equal(blockchains.zec.slip, 133);
      assert.equal(blockchains.zec.scriptType, 'p2sh');
      assert.equal(
        blockchains.zec.messagePrefix,
        '\u0018Zcash Signed Message:\n',
      );
      assert.equal(blockchains.zec.pubKeyHash, '1cb8');
      assert.equal(blockchains.zec.scriptHash, '1cbd');
      assert.equal(blockchains.zec.wif, '80');
      assert.equal(blockchains.zec.bip32.public, 0x0488b21e);
      assert.equal(blockchains.zec.bip32.private, 0x0488ade4);
      assert.equal(blockchains.zec.txVersion, 4);
      assert.equal(blockchains.zec.txGroupID, 0x892f2085);
      assert.equal(blockchains.zec.backend, 'blockbook');
      assert.equal(blockchains.zec.dustLimit, 546);
      assert.equal(blockchains.zec.minFeePerByte, 1);
      assert.equal(blockchains.zec.feePerByte, 2);
      assert.equal(blockchains.zec.maxMessage, 80);
      assert.equal(blockchains.zec.maxTxSize, 100000);
      assert.equal(blockchains.zec.rbf, false);
      assert.equal(blockchains.zec.txExpiryHeight, 60);
    });

    it('should return valid btcTestnet data', async function () {
      assert.equal(blockchains.btcTestnet.id, 'btcTestnet');
      assert.equal(blockchains.btcTestnet.libid, 'testnet');
      assert.equal(blockchains.btcTestnet.name, 'Testnet Bitcoin');
      assert.equal(blockchains.btcTestnet.symbol, 'TEST-BTC');
      assert.equal(blockchains.btcTestnet.decimals, 8);
      assert.equal(blockchains.btcTestnet.slip, 1);
      assert.equal(blockchains.btcTestnet.scriptType, 'p2wsh');
      assert.equal(
        blockchains.btcTestnet.messagePrefix,
        '\u0018Bitcoin Signed Message:\n',
      );
      assert.equal(blockchains.btcTestnet.pubKeyHash, '6f');
      assert.equal(blockchains.btcTestnet.scriptHash, 'c4');
      assert.equal(blockchains.btcTestnet.wif, 'ef');
      assert.equal(blockchains.btcTestnet.bip32.public, 0x02575483);
      assert.equal(blockchains.btcTestnet.bip32.private, 0x02575048);
      assert.equal(blockchains.btcTestnet.backend, 'blockbook');
      assert.equal(blockchains.btcTestnet.bech32, 'tb1');
      assert.equal(blockchains.btcTestnet.dustLimit, 546);
      assert.equal(blockchains.btcTestnet.minFeePerByte, 1);
      assert.equal(blockchains.btcTestnet.feePerByte, 5);
      assert.equal(blockchains.btcTestnet.maxMessage, 80);
      assert.equal(blockchains.btcTestnet.maxTxSize, 100000);
      assert.equal(blockchains.btcTestnet.rbf, true);
    });

    it('should return valid btcSignet data', async function () {
      assert.equal(blockchains.btcSignet.id, 'btcSignet');
      assert.equal(blockchains.btcSignet.libid, 'testnet');
      assert.equal(blockchains.btcSignet.name, 'Signet Bitcoin');
      assert.equal(blockchains.btcSignet.symbol, 'TEST-BTC');
      assert.equal(blockchains.btcSignet.decimals, 8);
      assert.equal(blockchains.btcSignet.slip, 1);
      assert.equal(blockchains.btcSignet.scriptType, 'p2wsh');
      assert.equal(
        blockchains.btcSignet.messagePrefix,
        '\u0018Bitcoin Signed Message:\n',
      );
      assert.equal(blockchains.btcSignet.pubKeyHash, '6f');
      assert.equal(blockchains.btcSignet.scriptHash, 'c4');
      assert.equal(blockchains.btcSignet.wif, 'ef');
      assert.equal(blockchains.btcSignet.bip32.public, 0x02575483);
      assert.equal(blockchains.btcSignet.bip32.private, 0x02575048);
      assert.equal(blockchains.btcSignet.backend, 'blockbook');
      assert.equal(blockchains.btcSignet.bech32, 'tb1');
      assert.equal(blockchains.btcSignet.dustLimit, 546);
      assert.equal(blockchains.btcSignet.minFeePerByte, 1);
      assert.equal(blockchains.btcSignet.feePerByte, 4);
      assert.equal(blockchains.btcSignet.maxMessage, 80);
      assert.equal(blockchains.btcSignet.maxTxSize, 100000);
      assert.equal(blockchains.btcSignet.rbf, true);
    });

    it('should return valid fluxTestnet data', async function () {
      assert.equal(blockchains.fluxTestnet.id, 'fluxTestnet');
      assert.equal(blockchains.fluxTestnet.libid, 'fluxtestnet');
      assert.equal(blockchains.fluxTestnet.name, 'Testnet Flux');
      assert.equal(blockchains.fluxTestnet.symbol, 'TEST-FLUX');
      assert.equal(blockchains.fluxTestnet.decimals, 8);
      assert.equal(blockchains.fluxTestnet.slip, 1);
      assert.equal(blockchains.fluxTestnet.scriptType, 'p2sh');
      assert.equal(
        blockchains.fluxTestnet.messagePrefix,
        '\u0018Zelcash Signed Message:\n',
      );
      assert.equal(blockchains.fluxTestnet.pubKeyHash, '1d25');
      assert.equal(blockchains.fluxTestnet.scriptHash, '1cba');
      assert.equal(blockchains.fluxTestnet.wif, 'ef');
      assert.equal(blockchains.fluxTestnet.bip32.public, 0x043587cf);
      assert.equal(blockchains.fluxTestnet.bip32.private, 0x04358394);
      assert.equal(blockchains.fluxTestnet.txVersion, 4);
      assert.equal(blockchains.fluxTestnet.txGroupID, 0x892f2085);
      assert.equal(blockchains.fluxTestnet.backend, 'insight');
      assert.equal(blockchains.fluxTestnet.dustLimit, 546);
      assert.equal(blockchains.fluxTestnet.minFeePerByte, 1);
      assert.equal(blockchains.fluxTestnet.feePerByte, 1);
      assert.equal(blockchains.fluxTestnet.maxMessage, 80);
      assert.equal(blockchains.fluxTestnet.maxTxSize, 1800000);
      assert.equal(blockchains.fluxTestnet.rbf, false);
      assert.equal(blockchains.fluxTestnet.txExpiryHeight, 30);
    });

    it('should return valid sepolia data', async function () {
      assert.equal(blockchains.sepolia.id, 'sepolia');
      assert.equal(blockchains.sepolia.libid, 'sepolia');
      assert.equal(blockchains.sepolia.name, 'Testnet Sepolia');
      assert.equal(blockchains.sepolia.symbol, 'TEST-ETH');
      assert.equal(blockchains.sepolia.decimals, 18);
      assert.equal(blockchains.sepolia.slip, 1);
      assert.equal(blockchains.sepolia.scriptType, 'p2sh');
      assert.equal(blockchains.sepolia.bip32.public, 0x0488b21e);
      assert.equal(blockchains.sepolia.bip32.private, 0x0488ade4);
      assert.equal(blockchains.sepolia.chainType, 'evm');
      assert.equal(blockchains.sepolia.backend, 'alchemy');
      assert.equal(blockchains.sepolia.accountSalt, 'aasalt');
      assert.equal(blockchains.sepolia.factorySalt, 'aafactorysalt');
      assert.equal(
        blockchains.sepolia.factoryAddress,
        '0xA76f98D25C9775F67DCf8B9EF9618d454D287467',
      );
      assert.equal(
        blockchains.sepolia.entrypointAddress,
        '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
      );
      assert.equal(blockchains.sepolia.baseFee, 120);
      assert.equal(blockchains.sepolia.priorityFee, 5);
      assert.equal(blockchains.sepolia.gasLimit, 500000);
      assert.equal(blockchains.sepolia.tokens[0].contract, '');
      assert.equal(
        blockchains.sepolia.tokens[0].name,
        'Testnet Ethereum Sepolia',
      );
      assert.equal(blockchains.sepolia.tokens[0].symbol, 'TEST-ETH');
      assert.equal(blockchains.sepolia.tokens[0].decimals, 18);
      assert.equal(
        blockchains.sepolia.tokens[1].contract,
        '0x690cc0235aBEA2cF89213E30D0F0Ea0fC054B909',
      );
      assert.equal(blockchains.sepolia.tokens[1].name, 'Fake Flux');
      assert.equal(blockchains.sepolia.tokens[1].symbol, 'TEST-FLUX');
      assert.equal(blockchains.sepolia.tokens[1].decimals, 8);
    });

    it('should return valid eth data', async function () {
      assert.equal(blockchains.eth.id, 'eth');
      assert.equal(blockchains.eth.libid, 'eth');
      assert.equal(blockchains.eth.name, 'Ethereum');
      assert.equal(blockchains.eth.symbol, 'ETH');
      assert.equal(blockchains.eth.decimals, 18);
      assert.equal(blockchains.eth.slip, 60);
      assert.equal(blockchains.eth.scriptType, 'p2sh');
      assert.equal(blockchains.eth.bip32.public, 0x0488b21e);
      assert.equal(blockchains.eth.bip32.private, 0x0488ade4);
      assert.equal(blockchains.eth.chainType, 'evm');
      assert.equal(blockchains.eth.backend, 'alchemy');
      assert.equal(blockchains.eth.accountSalt, 'aasalt');
      assert.equal(blockchains.eth.factorySalt, 'aafactorysalt');
      assert.equal(
        blockchains.eth.factoryAddress,
        '0xA76f98D25C9775F67DCf8B9EF9618d454D287467',
      );
      assert.equal(
        blockchains.eth.entrypointAddress,
        '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
      );
      assert.equal(blockchains.eth.baseFee, 8);
      assert.equal(blockchains.eth.priorityFee, 2);
      assert.equal(blockchains.eth.gasLimit, 500000);
      assert.equal(blockchains.eth.tokens[0].contract, '');
      assert.equal(blockchains.eth.tokens[0].name, 'Ethereum');
      assert.equal(blockchains.eth.tokens[0].symbol, 'ETH');
      assert.equal(blockchains.eth.tokens[0].decimals, 18);
      assert.equal(
        blockchains.eth.tokens[1].contract,
        '0x720cd16b011b987da3518fbf38c3071d4f0d1495',
      );
      assert.equal(blockchains.eth.tokens[1].name, 'Flux');
      assert.equal(blockchains.eth.tokens[1].symbol, 'FLUX');
      assert.equal(blockchains.eth.tokens[1].decimals, 8);
      assert.equal(
        blockchains.eth.tokens[2].contract,
        '0xdac17f958d2ee523a2206206994597c13d831ec7',
      );
      assert.equal(blockchains.eth.tokens[2].name, 'Tether');
      assert.equal(blockchains.eth.tokens[2].symbol, 'USDT');
      assert.equal(blockchains.eth.tokens[2].decimals, 6);
      assert.equal(
        blockchains.eth.tokens[3].contract,
        '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      );
      assert.equal(blockchains.eth.tokens[3].name, 'USD Coin');
      assert.equal(blockchains.eth.tokens[3].symbol, 'USDC');
      assert.equal(blockchains.eth.tokens[3].decimals, 6);
    });
  });
});
