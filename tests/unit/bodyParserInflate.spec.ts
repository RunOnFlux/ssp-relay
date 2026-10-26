// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect } from 'chai';
import express from 'express';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import type { AddressInfo } from 'net';

// GHSA-27r3-jxmh-p828: body-parser < 2.4.0 can crash the process on a
// compressed body followed by trailing bytes. The relay refuses compressed
// request bodies outright (inflate: false) so no decompression stream exists.
describe('body parsers refuse compressed request bodies', function () {
  it('every express body parser in server.ts sets inflate: false', function () {
    const server = readFileSync(
      new URL('../../src/lib/server.ts', import.meta.url),
      'utf8',
    );
    const parsers = server.match(
      /express\.(json|urlencoded|text|raw)\([^)]*\)/g,
    );
    expect(parsers).to.have.length.greaterThan(0);
    for (const parser of parsers) {
      expect(parser, parser).to.include('inflate: false');
    }
  });

  describe('inflate: false behaviour', function () {
    let server;
    let baseUrl;

    before(async function () {
      const app = express();
      app.use(express.json({ limit: '15mb', inflate: false }));
      app.post('/x', (req, res) => res.json({ ok: true, body: req.body }));
      app.use((err, req, res, next) => {
        void next;
        res.status(err.status || 500).json({ type: err.type });
      });
      await new Promise((resolve) => {
        server = app.listen(0, resolve);
      });
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    after(function () {
      server.close();
    });

    it('answers 415 to a gzip body with trailing bytes', async function () {
      const body = Buffer.concat([
        gzipSync('{"a":1}'),
        Buffer.from('trailing-bytes'),
      ]);
      const res = await fetch(`${baseUrl}/x`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-encoding': 'gzip',
        },
        body,
      });
      expect(res.status).to.equal(415);
      expect((await res.json()).type).to.equal('encoding.unsupported');
    });

    it('still parses plain JSON', async function () {
      const res = await fetch(`${baseUrl}/x`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"a":1}',
      });
      expect(res.status).to.equal(200);
      expect((await res.json()).body).to.deep.equal({ a: 1 });
    });
  });
});
