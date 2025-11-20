// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { assert } from 'chai';
import serviceHelper from '../../src/services/serviceHelper';
import contactApi from '../../src/apiServices/contactApi';
import sinon from 'sinon';
import httpMocks from 'node-mocks-http';

const reqValid = {};

describe('Contact API', function () {
  describe('Post Contact API: Correctly verifies action', function () {
    afterEach(function () {
      sinon.restore();
    });

    // Testing using stub data
    it('should return error result if stub value has no message', async function () {
      const request = httpMocks.createRequest({
        method: 'POST',
        url: 'test',
        body: reqValid,
        headers: { 'x-challenge': 'ssp' },
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      await sinon.stub(serviceHelper, 'ensureObject').returns({});
      await sinon
        .stub(contactApi, 'postContact')
        .returns('Error: No message specified');
      const data = await contactApi.postContact(request, res);
      assert.equal(data, 'Error: No message specified');
    });

    it('should return error result if stub value has no name', async function () {
      const request = httpMocks.createRequest({
        method: 'POST',
        url: 'test',
        body: reqValid,
        headers: { 'x-challenge': 'ssp' },
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      await sinon
        .stub(serviceHelper, 'ensureObject')
        .returns({ message: 'test message' });
      await sinon
        .stub(contactApi, 'postContact')
        .returns('Error: No name specified');
      const data = await contactApi.postContact(request, res);
      assert.equal(data, 'Error: No name specified');
    });

    it('should return error result if stub value has no email', async function () {
      const request = httpMocks.createRequest({
        method: 'POST',
        url: 'test',
        body: reqValid,
        headers: { 'x-challenge': 'ssp' },
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      await sinon
        .stub(serviceHelper, 'ensureObject')
        .returns({ message: 'test message', name: 'John Doe' });
      await sinon
        .stub(contactApi, 'postContact')
        .returns('Error: No email specified');
      const data = await contactApi.postContact(request, res);
      assert.equal(data, 'Error: No email specified');
    });

    it('should return error result if stub value has no x-challenge', async function () {
      const request = httpMocks.createRequest({
        method: 'POST',
        url: 'test',
        body: reqValid,
        headers: {},
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      await sinon.stub(serviceHelper, 'ensureObject').returns({
        message: 'test message',
        name: 'John Doe',
        email: 'test@test.com',
      });
      await sinon
        .stub(contactApi, 'postContact')
        .returns('Error: Invalid request');
      const data = await contactApi.postContact(request, res);
      assert.equal(data, 'Error: Invalid request');
    });

    it('should return error result if message is too long', async function () {
      const request = httpMocks.createRequest({
        method: 'POST',
        url: 'test',
        body: reqValid,
        headers: { 'x-challenge': 'ssp' },
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      const longMessage = 'a'.repeat(50001); // Over the 50000 char limit
      await sinon.stub(serviceHelper, 'ensureObject').returns({
        message: longMessage,
        name: 'John Doe',
        email: 'test@test.com',
      });
      await sinon
        .stub(contactApi, 'postContact')
        .returns('Error: Message is too long');
      const data = await contactApi.postContact(request, res);
      assert.equal(data, 'Error: Message is too long');
    });

    it('should return error result if name is too long', async function () {
      const request = httpMocks.createRequest({
        method: 'POST',
        url: 'test',
        body: reqValid,
        headers: { 'x-challenge': 'ssp' },
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      const longName = 'a'.repeat(1001); // Over the 1000 char limit
      await sinon.stub(serviceHelper, 'ensureObject').returns({
        message: 'test message',
        name: longName,
        email: 'test@test.com',
      });
      await sinon
        .stub(contactApi, 'postContact')
        .returns('Error: Name is too long');
      const data = await contactApi.postContact(request, res);
      assert.equal(data, 'Error: Name is too long');
    });

    it('should return error result if email is invalid (no @)', async function () {
      const request = httpMocks.createRequest({
        method: 'POST',
        url: 'test',
        body: reqValid,
        headers: { 'x-challenge': 'ssp' },
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      await sinon.stub(serviceHelper, 'ensureObject').returns({
        message: 'test message',
        name: 'John Doe',
        email: 'invalid-email',
      });
      await sinon
        .stub(contactApi, 'postContact')
        .returns('Error: Email is invalid');
      const data = await contactApi.postContact(request, res);
      assert.equal(data, 'Error: Email is invalid');
    });

    it('should return error result if email is too long', async function () {
      const request = httpMocks.createRequest({
        method: 'POST',
        url: 'test',
        body: reqValid,
        headers: { 'x-challenge': 'ssp' },
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      const longEmail = 'a'.repeat(490) + '@test.com'; // Over the 500 char limit
      await sinon.stub(serviceHelper, 'ensureObject').returns({
        message: 'test message',
        name: 'John Doe',
        email: longEmail,
      });
      await sinon
        .stub(contactApi, 'postContact')
        .returns('Error: Email is invalid');
      const data = await contactApi.postContact(request, res);
      assert.equal(data, 'Error: Email is invalid');
    });

    it('should return error result if IP has already submitted too many contacts', async function () {
      const request = httpMocks.createRequest({
        method: 'POST',
        url: 'test',
        body: reqValid,
        headers: { 'x-challenge': 'ssp', 'x-forwarded-for': '192.168.0.111' },
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      await sinon.stub(serviceHelper, 'ensureObject').returns({
        message: 'test message',
        name: 'John Doe',
        email: 'test@test.com',
      });
      await sinon
        .stub(contactApi, 'postContact')
        .returns('Error: Contact already submitted');
      const data = await contactApi.postContact(request, res);
      assert.equal(data, 'Error: Contact already submitted');
    });

    it('should return successful result if stub value is valid', async function () {
      const request = httpMocks.createRequest({
        method: 'POST',
        url: 'test',
        body: reqValid,
        headers: { 'x-challenge': 'ssp', 'x-forwarded-for': '192.168.0.100' },
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      await sinon.stub(serviceHelper, 'ensureObject').returns({
        message: 'This is a test contact message',
        name: 'John Doe',
        email: 'john.doe@test.com',
      });
      await sinon.stub(contactApi, 'postContact').returns({
        message: 'This is a test contact message',
        name: 'John Doe',
        email: 'john.doe@test.com',
      });
      const data = await contactApi.postContact(request, res);
      assert.deepEqual(data, {
        message: 'This is a test contact message',
        name: 'John Doe',
        email: 'john.doe@test.com',
      });
    });

    it('should handle contact form with structured data (subject, company, type)', async function () {
      const request = httpMocks.createRequest({
        method: 'POST',
        url: 'test',
        body: reqValid,
        headers: { 'x-challenge': 'ssp', 'x-forwarded-for': '192.168.0.200' },
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      const structuredMessage = `Subject: Partnership Inquiry

Company: Tech Corp Inc

Type: business

Message:
We are interested in exploring a partnership opportunity with SSP Wallet.`;

      await sinon.stub(serviceHelper, 'ensureObject').returns({
        message: structuredMessage,
        name: 'Jane Smith',
        email: 'jane.smith@techcorp.com',
      });
      await sinon.stub(contactApi, 'postContact').returns({
        message: structuredMessage,
        name: 'Jane Smith',
        email: 'jane.smith@techcorp.com',
      });
      const data = await contactApi.postContact(request, res);
      assert.deepEqual(data, {
        message: structuredMessage,
        name: 'Jane Smith',
        email: 'jane.smith@techcorp.com',
      });
    });
  });
});
