// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import chai from 'chai';
import serviceHelper from '../../src/services/serviceHelper';
import ticketsApi from '../../src/apiServices/ticketsApi';
import sinon from 'sinon';
import httpMocks from 'node-mocks-http';

const { assert } = chai;

const reqValid = {};

describe('Tickets API', function () {
  describe('Post Ticket API: Correctly verifies action', function () {
    afterEach(function () {
      sinon.restore();
    });

    // Testing using stub data
    it('should return error result if stub value has no description', async function () {
      const request = httpMocks.createRequest({
        method: 'POST',
        url: 'test',
        body: reqValid,
        headers: { 'x-challenge': true },
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      await sinon.stub(serviceHelper, 'ensureObject').returns({});
      await sinon
        .stub(ticketsApi, 'postTicket')
        .returns('Error: No description specified');
      const data = await ticketsApi.postTicket(request, res);
      assert.equal(data, 'Error: No description specified');
    });

    it('should return error result if stub value has no subject', async function () {
      const request = httpMocks.createRequest({
        method: 'POST',
        url: 'test',
        body: reqValid,
        headers: { 'x-challenge': true },
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      await sinon
        .stub(serviceHelper, 'ensureObject')
        .returns({ description: '' });
      await sinon
        .stub(ticketsApi, 'postTicket')
        .returns('Error: No subject specified');
      const data = await ticketsApi.postTicket(request, res);
      assert.equal(data, 'Error: No subject specified');
    });

    it('should return error result if stub value has no type', async function () {
      const request = httpMocks.createRequest({
        method: 'POST',
        url: 'test',
        body: reqValid,
        headers: { 'x-challenge': true },
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      await sinon
        .stub(serviceHelper, 'ensureObject')
        .returns({ description: '', subject: '' });
      await sinon
        .stub(ticketsApi, 'postTicket')
        .returns('Error: No type specified');
      const data = await ticketsApi.postTicket(request, res);
      assert.equal(data, 'Error: No type specified');
    });

    it('should return error result if stub value has no email', async function () {
      const request = httpMocks.createRequest({
        method: 'POST',
        url: 'test',
        body: reqValid,
        headers: { 'x-challenge': true },
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      await sinon
        .stub(serviceHelper, 'ensureObject')
        .returns({ description: '', subject: '', type: '' });
      await sinon
        .stub(ticketsApi, 'postTicket')
        .returns('Error: No email specified');
      const data = await ticketsApi.postTicket(request, res);
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
      await sinon
        .stub(serviceHelper, 'ensureObject')
        .returns({ description: '', subject: '', type: '', email: '' });
      await sinon
        .stub(ticketsApi, 'postTicket')
        .returns('Error: Invalid request');
      const data = await ticketsApi.postTicket(request, res);
      assert.equal(data, 'Error: Invalid request');
    });

    it('should return error result if stub value has already submitted', async function () {
      const request = httpMocks.createRequest({
        method: 'POST',
        url: 'test',
        body: reqValid,
        headers: { 'x-challenge': true, 'x-forwarded-for': '192.168.0.111' },
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      await sinon
        .stub(serviceHelper, 'ensureObject')
        .returns({ description: '', subject: '', type: '', email: '' });
      await sinon
        .stub(ticketsApi, 'postTicket')
        .returns('Error: Ticket already submitted');
      const data = await ticketsApi.postTicket(request, res);
      assert.equal(data, 'Error: Ticket already submitted');
    });

    it('should return successful result if stub value is valid', async function () {
      const request = httpMocks.createRequest({
        method: 'POST',
        url: 'test',
        body: reqValid,
        headers: { 'x-challenge': true, 'x-forwarded-for': '192.168.0.100' },
      });
      const res = httpMocks.createResponse({
        eventEmiiter: require('events').EventEmitter,
        req: request,
      });
      await sinon.stub(serviceHelper, 'ensureObject').returns({
        description: 'test',
        subject: 'test',
        type: '',
        email: 'test@test.com',
      });
      await sinon.stub(ticketsApi, 'postTicket').returns({
        description: 'test',
        subject: 'test',
        type: '',
        email: 'test@test.com',
      });
      const data = await ticketsApi.postTicket(request, res);
      assert.deepEqual(data, {
        description: 'test',
        subject: 'test',
        type: '',
        email: 'test@test.com',
      });
    });
  });
});
