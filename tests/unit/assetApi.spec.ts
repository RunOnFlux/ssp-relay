/* eslint-disable @typescript-eslint/no-unused-expressions */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import chai from 'chai';
import assetApi from '../../src/apiServices/assetApi';
import sinon from 'sinon';
import httpMocks from 'node-mocks-http';

const { expect } = chai;

describe('Asset API', function () {
  describe('Asset API: Correctly verifies asset data', function () {
    afterEach(function () {
      sinon.restore();
    });

    it('should return getFiatAssets successful result if value is valid', async function () {
        const request = httpMocks.createRequest({
            method: 'GET',
            url: 'test',
        });
        const res = httpMocks.createResponse({
            eventEmiiter: require('events').EventEmitter,
            req: request,
        });
        await assetApi.getFiatAssets(request, res);
        expect(JSON.parse(res._getData())).to.have.property('status');
        expect(JSON.parse(res._getData())).to.have.property('data');
    });

    it('should return getCryptoAssets successful result if value is valid', async function () {
        const request = httpMocks.createRequest({
            method: 'GET',
            url: 'test',
        });
        const res = httpMocks.createResponse({
            eventEmiiter: require('events').EventEmitter,
            req: request,
        });
        await assetApi.getCryptoAssets(request, res);
        expect(JSON.parse(res._getData())).to.have.property('status');
        expect(JSON.parse(res._getData())).to.have.property('data');
        expect(JSON.parse(res._getData()).data[0]).to.have.property('idzelcore');
        expect(JSON.parse(res._getData()).data[0]).to.have.property('ticker');
        expect(JSON.parse(res._getData()).data[0]).to.have.property('name');
        expect(JSON.parse(res._getData()).data[0]).to.have.property('contract');
        expect(JSON.parse(res._getData()).data[0]).to.have.property('chain');
        expect(JSON.parse(res._getData()).data[0]).to.have.property('idguardarian');
        expect(JSON.parse(res._getData()).data[0]).to.have.property('idguardarianlimit');
    });

    it('should return getPurchaseDetailsByPurchaseId successful result if value is valid', async function () {
        const request = httpMocks.createRequest({
            method: 'GET',
            url: 'test',
            params: {
                purchaseid: "58f9cce7-abcb-4468-96f1-d0bc75000ec4"
            }
        });
        const res = httpMocks.createResponse({
            eventEmiiter: require('events').EventEmitter,
            req: request,
        });
        await assetApi.getPurchaseDetailsByPurchaseId(request, res);
        expect(JSON.parse(res._getData())).to.have.property('status');
        expect(JSON.parse(res._getData())).to.have.property('data');
        expect(JSON.parse(res._getData()).data).to.have.property('purchaseId');
        expect(JSON.parse(res._getData()).data).to.have.property('buyAddress');
        expect(JSON.parse(res._getData()).data).to.have.property('buyAmount');
        expect(JSON.parse(res._getData()).data).to.have.property('buyAsset');
        expect(JSON.parse(res._getData()).data).to.have.property('buyTxid');
        expect(JSON.parse(res._getData()).data).to.have.property('cardId');
        expect(JSON.parse(res._getData()).data).to.have.property('country');

        expect(JSON.parse(res._getData()).data).to.have.property('createdAt');
        expect(JSON.parse(res._getData()).data).to.have.property('networkFee');
        expect(JSON.parse(res._getData()).data).to.have.property('providerBuyAssetId');
        expect(JSON.parse(res._getData()).data).to.have.property('providerCustomerId');
        expect(JSON.parse(res._getData()).data).to.have.property('providerId');
        expect(JSON.parse(res._getData()).data).to.have.property('providerSellAssetId');
        expect(JSON.parse(res._getData()).data).to.have.property('rate');

        expect(JSON.parse(res._getData()).data).to.have.property('sellAmount');
        expect(JSON.parse(res._getData()).data).to.have.property('sellAsset');
        expect(JSON.parse(res._getData()).data).to.have.property('status');
        expect(JSON.parse(res._getData()).data).to.have.property('transactionFee');
        expect(JSON.parse(res._getData()).data).to.have.property('zelid');
        expect(JSON.parse(res._getData()).data).to.have.property('providerCardId');
    });

    it('should return sendPurchase successful result if value is valid', async function () {
        const request = httpMocks.createRequest({
            method: 'GET',
            url: 'test',
            params: {
                purchaseid: "58f9cce7-abcb-4468-96f1-d0bc75000ec4",
                providerid: "idmoonpay"
            }
        });
        const response = httpMocks.createResponse({
            eventEmiiter: require('events').EventEmitter,
            req: request,
        });
        await sinon
            .stub(assetApi, 'sendPurchase')
            .returns({
                "status": "success",
                "data": {
                    "purchaseId": "58f9cce7-abcb-4468-96f1-d0bc75000ec4",
                    "buyAddress": "0x88ede65cb154660a84d996467bdef80e17de1576",
                    "buyAmount": "0.15800000",
                    "buyAsset": "ethereum",
                    "buyTxid": "0x978458e5dc7d3f449051da2e6be702df754370e4fd29f526d6a8eb0b206dd18b",
                    "cardId": "d7b631c8-0ffe-499f-a661-93869e4d3454",
                    "country": "CZE",
                    "createdAt": 1670426311349,
                    "networkFee": "9.89000000",
                    "providerBuyAssetId": "eth",
                    "providerCustomerId": "271170dd-8db6-472c-9828-67e0df5b609a",
                    "providerId": "idmoonpay",
                    "providerSellAssetId": "czk",
                    "rate": "30224.43037975",
                    "sellAmount": "5000.25000000",
                    "sellAsset": "CZK",
                    "status": "finished",
                    "transactionFee": "214.90000000",
                    "zelid": "1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC",
                    "providerCardId": "d7b631c8-0ffe-499f-a661-93869e4d3454"
                }
            });
        const res = await assetApi.sendPurchase(request, response);
        expect(res).to.have.property('status');
        expect(res).to.have.property('data');
        expect(res.data).to.have.property('purchaseId');
        expect(res.data).to.have.property('buyAddress');
        expect(res.data).to.have.property('buyAmount');
        expect(res.data).to.have.property('buyAsset');
        expect(res.data).to.have.property('buyTxid');
        expect(res.data).to.have.property('cardId');
        expect(res.data).to.have.property('country');

        expect(res.data).to.have.property('createdAt');
        expect(res.data).to.have.property('networkFee');
        expect(res.data).to.have.property('providerBuyAssetId');
        expect(res.data).to.have.property('providerCustomerId');
        expect(res.data).to.have.property('providerId');
        expect(res.data).to.have.property('providerSellAssetId');
        expect(res.data).to.have.property('rate');

        expect(res.data).to.have.property('sellAmount');
        expect(res.data).to.have.property('sellAsset');
        expect(res.data).to.have.property('status');
        expect(res.data).to.have.property('transactionFee');
        expect(res.data).to.have.property('zelid');
        expect(res.data).to.have.property('providerCardId');
    });

    it('should return sendPurchase unsuccessful result if value is valid', async function () {
        const request = httpMocks.createRequest({
            method: 'GET',
            url: 'test',
            params: {
                purchaseid: "58f9cce7-abcb-4468-96f1-d0bc75000ec4",
                providerid: "idmoonpay"
            }
        });
        const response = httpMocks.createResponse({
            eventEmiiter: require('events').EventEmitter,
            req: request,
        });
        await assetApi.sendPurchase(request, response);
        expect(JSON.parse(response._getData())).to.have.property('status');
        expect(JSON.parse(response._getData())).to.have.property('data');
        expect(JSON.parse(response._getData()).data).to.have.property('name');
        expect(JSON.parse(response._getData()).data).to.have.property('message');
    });

    it('should return getAllPurchase successful result if value is valid', async function () {
        const request = httpMocks.createRequest({
            method: 'GET',
            url: 'test',
            params: {
                zelid: "1BoatSLRHtKNngkdXEeobR76b53LETtpyT"
            }
        });
        const response = httpMocks.createResponse({
            eventEmiiter: require('events').EventEmitter,
            req: request,
        });
        await sinon
            .stub(assetApi, 'getAllPurchase')
            .returns({
                "status": "success",
                "data": [{
                    "purchaseId": "58f9cce7-abcb-4468-96f1-d0bc75000ec4",
                    "buyAddress": "0x88ede65cb154660a84d996467bdef80e17de1576",
                    "buyAmount": "0.15800000",
                    "buyAsset": "ethereum",
                    "buyTxid": "0x978458e5dc7d3f449051da2e6be702df754370e4fd29f526d6a8eb0b206dd18b",
                    "cardId": "d7b631c8-0ffe-499f-a661-93869e4d3454",
                    "country": "CZE",
                    "createdAt": 1670426311349,
                    "networkFee": "9.89000000",
                    "providerBuyAssetId": "eth",
                    "providerCustomerId": "271170dd-8db6-472c-9828-67e0df5b609a",
                    "providerId": "idmoonpay",
                    "providerSellAssetId": "czk",
                    "rate": "30224.43037975",
                    "sellAmount": "5000.25000000",
                    "sellAsset": "CZK",
                    "status": "finished",
                    "transactionFee": "214.90000000",
                    "zelid": "1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC",
                    "providerCardId": "d7b631c8-0ffe-499f-a661-93869e4d3454"
                }]
            });
        const res = await assetApi.getAllPurchase(request, response);
        expect(res).to.have.property('status');
        expect(res).to.have.property('data');
        expect(res.data[0]).to.have.property('purchaseId');
        expect(res.data[0]).to.have.property('buyAddress');
        expect(res.data[0]).to.have.property('buyAmount');
        expect(res.data[0]).to.have.property('buyAsset');
        expect(res.data[0]).to.have.property('buyTxid');
        expect(res.data[0]).to.have.property('cardId');
        expect(res.data[0]).to.have.property('country');

        expect(res.data[0]).to.have.property('createdAt');
        expect(res.data[0]).to.have.property('networkFee');
        expect(res.data[0]).to.have.property('providerBuyAssetId');
        expect(res.data[0]).to.have.property('providerCustomerId');
        expect(res.data[0]).to.have.property('providerId');
        expect(res.data[0]).to.have.property('providerSellAssetId');
        expect(res.data[0]).to.have.property('rate');

        expect(res.data[0]).to.have.property('sellAmount');
        expect(res.data[0]).to.have.property('sellAsset');
        expect(res.data[0]).to.have.property('status');
        expect(res.data[0]).to.have.property('transactionFee');
        expect(res.data[0]).to.have.property('zelid');
        expect(res.data[0]).to.have.property('providerCardId');
    });

    it('should return getAllPurchase unsuccessful result if value is valid', async function () {
        const request = httpMocks.createRequest({
            method: 'GET',
            url: 'test',
            params: {
                purchaseid: "58f9cce7-abcb-4468-96f1-d0bc75000ec4",
                providerid: "idmoonpay"
            }
        });
        const response = httpMocks.createResponse({
            eventEmiiter: require('events').EventEmitter,
            req: request,
        });
        await assetApi.getAllPurchase(request, response);
        expect(JSON.parse(response._getData())).to.have.property('status');
        expect(JSON.parse(response._getData())).to.have.property('data');
        expect(JSON.parse(response._getData()).data).to.have.property('name');
        expect(JSON.parse(response._getData()).data).to.have.property('message');
    });

    it('should return getAllPurchaseDetails successful result if value is valid', async function () {
        const request = httpMocks.createRequest({
            method: 'POST',
            url: 'test',
            data: {
                sellAsset: "EUR",
                buyAsset: "litecoin"
            }
        });
        const response = httpMocks.createResponse({
            eventEmiiter: require('events').EventEmitter,
            req: request,
        });
        await sinon
            .stub(assetApi, 'getAllPurchaseDetails')
            .returns({
                "status": "success",
                "data": {
                    "buyAsset": "litecoin",
                    "sellAsset": "EUR",
                    "providers": [
                    {
                        "providerId": "idmoonpay",
                        "minSellAmount": "30.00000000",
                        "maxSellAmount": "10000.00000000",
                        "rate": "62.27019339",
                        "precision": "2",
                        "networkFee": "0.06000000",
                        "transactionFee": "3.99000000"
                    }
                    ]
                }
            });
        const res = await assetApi.getAllPurchaseDetails(request, response);
        expect(res).to.have.property('status');
        expect(res).to.have.property('data');
        expect(res.data).to.have.property('buyAsset');
        expect(res.data).to.have.property('sellAsset');
        expect(res.data.providers[0]).to.have.property('providerId');
        expect(res.data.providers[0]).to.have.property('minSellAmount');
        expect(res.data.providers[0]).to.have.property('maxSellAmount');
        expect(res.data.providers[0]).to.have.property('rate');
        expect(res.data.providers[0]).to.have.property('precision');
        expect(res.data.providers[0]).to.have.property('networkFee');
        expect(res.data.providers[0]).to.have.property('transactionFee');
    });

    it('should return getAllPurchaseDetails unsuccessful result if value is valid', async function () {
        const request = httpMocks.createRequest({
            method: 'GET',
            url: 'test',
            params: {
                purchaseid: "58f9cce7-abcb-4468-96f1-d0bc75000ec4",
                providerid: "idmoonpay"
            }
        });
        const response = httpMocks.createResponse({
            eventEmiiter: require('events').EventEmitter,
            req: request,
        });
        await assetApi.getAllPurchaseDetails(request, response);
        expect(JSON.parse(response._getData())).to.have.property('status');
        expect(JSON.parse(response._getData())).to.have.property('data');
        expect(JSON.parse(response._getData()).data).to.have.property('name');
        expect(JSON.parse(response._getData()).data).to.have.property('message');
    });

    it('should return getPurchaseDetailsOnSelectedAsset successful result if value is valid', async function () {
        const request = httpMocks.createRequest({
            method: 'POST',
            url: 'test',
            data: {
                sellAsset: "EUR",
                buyAsset: "litecoin",
                sellAmount: "450.00"
            }
        });
        const response = httpMocks.createResponse({
            eventEmiiter: require('events').EventEmitter,
            req: request,
        });
        await sinon
            .stub(assetApi, 'getPurchaseDetailsOnSelectedAsset')
            .returns({
                "status": "success",
                "data": {
                    "buyAsset": "litecoin",
                    "sellAsset": "EUR",
                    "providers": [
                    {
                        "providerId": "idmoonpay",
                        "minSellAmount": "30.00000000",
                        "maxSellAmount": "10000.00000000",
                        "sellAmount": "450.00",
                        "buyAmount": "6.901",
                        "rate": "62.38709614",
                        "precision": "2",
                        "networkFee": "0.06000000",
                        "transactionFee": "19.38000000"
                    }
                    ]
                }
            });
        const res = await assetApi.getPurchaseDetailsOnSelectedAsset(request, response);
        expect(res).to.have.property('status');
        expect(res).to.have.property('data');
        expect(res.data).to.have.property('buyAsset');
        expect(res.data).to.have.property('sellAsset');
        expect(res.data.providers[0]).to.have.property('providerId');
        expect(res.data.providers[0]).to.have.property('minSellAmount');
        expect(res.data.providers[0]).to.have.property('maxSellAmount');
        expect(res.data.providers[0]).to.have.property('sellAmount');
        expect(res.data.providers[0]).to.have.property('buyAmount');
        expect(res.data.providers[0]).to.have.property('rate');
        expect(res.data.providers[0]).to.have.property('precision');
        expect(res.data.providers[0]).to.have.property('networkFee');
        expect(res.data.providers[0]).to.have.property('transactionFee');
    });

    it('should return getPurchaseDetailsOnSelectedAsset unsuccessful result if value is valid', async function () {
        const request = httpMocks.createRequest({
            method: 'GET',
            url: 'test',
            params: {
                purchaseid: "58f9cce7-abcb-4468-96f1-d0bc75000ec4",
                providerid: "idmoonpay"
            }
        });
        const response = httpMocks.createResponse({
            eventEmiiter: require('events').EventEmitter,
            req: request,
        });
        await assetApi.getPurchaseDetailsOnSelectedAsset(request, response);
        expect(JSON.parse(response._getData())).to.have.property('status');
        expect(JSON.parse(response._getData())).to.have.property('data');
        expect(JSON.parse(response._getData()).data).to.have.property('name');
        expect(JSON.parse(response._getData()).data).to.have.property('message');
    });

    it('should return createPurchaseDetails successful result if value is valid', async function () {
        const request = httpMocks.createRequest({
            method: 'POST',
            url: 'test',
            params: {
                zelid: "1BoatSLRHtKNngkdXEeobR76b53LETtpyT"
            },
            data: {
                providerId: "idmoonpay",
                sellAsset: "USD",
                buyAsset: "bitcoin",
                sellAmount: "300",
                buyAddress: "1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC"
            }
        });
        const response = httpMocks.createResponse({
            eventEmiiter: require('events').EventEmitter,
            req: request,
        });
        await sinon
            .stub(assetApi, 'createPurchaseDetails')
            .returns({
                "status": "success",
                "data": {
                    "providerId": "idmoonpay",
                    "zelid": "1BoatSLRHtKNngkdXEeobR76b53LETtpyT",
                    "createdAt": 1671365683080,
                    "status": "new",
                    "sellAsset": "USD",
                    "providerSellAssetId": "usd",
                    "buyAsset": "bitcoin",
                    "providerBuyAssetId": "btc",
                    "buyAddress": "1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC",
                    "buyAddressExtraId": null,
                    "sellAmount": "300.00",
                    "buyAmount": "0.01657",
                    "rate": "17313.08623661",
                    "widget": "https://buy-sandbox.moonpay.com?apiKey=pk_test_1LCSMjhCP0H5FSywT0MJSPPNjLmJvv&theme=dark&currencyCode=btc&baseCurrencyCode=usd&walletAddress=1CbErtneaX2QVyUfwU7JGB7VzvPgrgc3uC&baseCurrencyAmount=300.00&walletAddressTag=1BoatSLRHtKNngkdXEeobR76b53LETtpyT&redirectURL=zel%3A&colorCode=#C556E2&signature=38770a45323a97a63aef2f0c0875af2a95d49305971078882cebec986491517e"
                }
            });
        const res = await assetApi.createPurchaseDetails(request, response);
        expect(res).to.have.property('status');
        expect(res).to.have.property('data');
        expect(res.data).to.have.property('providerId');
        expect(res.data).to.have.property('zelid');
        expect(res.data).to.have.property('status');
        expect(res.data).to.have.property('sellAsset');
        expect(res.data).to.have.property('providerSellAssetId');
        expect(res.data).to.have.property('buyAsset');
        expect(res.data).to.have.property('providerBuyAssetId');
        expect(res.data).to.have.property('buyAddress');
        expect(res.data).to.have.property('buyAddressExtraId');
        expect(res.data).to.have.property('sellAmount');
        expect(res.data).to.have.property('buyAmount');
        expect(res.data).to.have.property('rate');
        expect(res.data).to.have.property('widget');
    });

    it('should return createPurchaseDetails unsuccessful result if value is valid', async function () {
        const request = httpMocks.createRequest({
            method: 'GET',
            url: 'test',
            params: {
                purchaseid: "58f9cce7-abcb-4468-96f1-d0bc75000ec4",
                providerid: "idmoonpay"
            }
        });
        const response = httpMocks.createResponse({
            eventEmiiter: require('events').EventEmitter,
            req: request,
        });
        await assetApi.createPurchaseDetails(request, response);
        expect(JSON.parse(response._getData())).to.have.property('status');
        expect(JSON.parse(response._getData())).to.have.property('data');
        expect(JSON.parse(response._getData()).data).to.have.property('name');
        expect(JSON.parse(response._getData()).data).to.have.property('message');
    });

    it('should return getAllPurchaseStatus successful result if value is valid', async function () {
        const request = httpMocks.createRequest({
            method: 'POST',
            url: 'test',
            data: {
                providerId: "idmoonpay",
                purchaseId: "58f9cce7-abcb-4468-96f1-d0bc75000ec4"
            }
        });
        const response = httpMocks.createResponse({
            eventEmiiter: require('events').EventEmitter,
            req: request,
        });
        await sinon
            .stub(assetApi, 'getAllPurchaseStatus')
            .returns({
                "status": "success",
                "data": "finished"
            });
        const res = await assetApi.getAllPurchaseStatus(request, response);
        expect(res).to.have.property('status');
        expect(res).to.have.property('data');
    });

    it('should return getAllPurchaseStatus unsuccessful result if value is valid', async function () {
        const request = httpMocks.createRequest({
            method: 'GET',
            url: 'test',
            params: {
                purchaseid: "58f9cce7-abcb-4468-96f1-d0bc75000ec4",
                providerid: "idmoonpay"
            }
        });
        const response = httpMocks.createResponse({
            eventEmiiter: require('events').EventEmitter,
            req: request,
        });
        await assetApi.getAllPurchaseStatus(request, response);
        expect(JSON.parse(response._getData())).to.have.property('status');
        expect(JSON.parse(response._getData())).to.have.property('data');
        expect(JSON.parse(response._getData()).data).to.have.property('name');
        expect(JSON.parse(response._getData()).data).to.have.property('message');
    });
  });
});
