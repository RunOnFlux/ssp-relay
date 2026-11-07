// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect } from 'chai';
import express from 'express';
import type { AddressInfo } from 'net';
import { timeoutHandler } from '../../src/lib/errorHandler';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('timeoutHandler', function () {
  let server;
  let baseUrl;
  let lateError;
  let handlerFinished;

  before(async function () {
    const app = express();
    app.use(timeoutHandler(50));
    // Same shape as the enterpriseApi pass-through handlers: try/catch around
    // res.json, invoked from a route wrapper that does not await it.
    const slowHandler = async (_req, res) => {
      try {
        await sleep(150);
        res.json({ status: 'success', data: { ok: true } });
      } catch (error) {
        res.json({ status: 'error', data: { message: error.message } });
      } finally {
        handlerFinished = true;
      }
    };
    app.get('/slow', (req, res) => {
      slowHandler(req, res).catch((error) => {
        lateError = error;
      });
    });
    app.get('/fast', (_req, res) => {
      res.json({ status: 'success', data: { ok: true } });
    });
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(function () {
    server.close();
  });

  beforeEach(function () {
    lateError = undefined;
    handlerFinished = false;
  });

  it('answers 408 and swallows the late handler response', async function () {
    const res = await fetch(`${baseUrl}/slow`);
    expect(res.status).to.equal(408);
    expect((await res.json()).data.name).to.equal('TIMEOUT');

    await sleep(200);
    expect(handlerFinished).to.equal(true);
    expect(lateError).to.equal(undefined);
  });

  it('leaves fast responses untouched', async function () {
    const res = await fetch(`${baseUrl}/fast`);
    expect(res.status).to.equal(200);
    expect((await res.json()).data.ok).to.equal(true);
  });
});
