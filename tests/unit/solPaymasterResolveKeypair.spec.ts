/* eslint-disable @typescript-eslint/no-explicit-any */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { expect } from 'chai';
import sinon from 'sinon';
import bs58 from 'bs58';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Keypair } from '@solana/web3.js';
import { resolveKeypair } from '../../src/services/solPaymasterService';

const ENV_DEVNET = 'SSP_SOLANA_DEVNET_PAYMASTER_KEY';
const ENV_MAINNET = 'SSP_SOLANA_MAINNET_PAYMASTER_KEY';

describe('Solana Paymaster Service — resolveKeypair', function () {
  let tmpHome: string;
  let homedirStub: sinon.SinonStub;
  let savedEnvDev: string | undefined;
  let savedEnvMain: string | undefined;

  beforeEach(function () {
    // Sandbox HOME so we never touch the real ~/.config/ssp-relay/
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ssp-relay-test-'));
    homedirStub = sinon.stub(os, 'homedir').returns(tmpHome);
    // Save + clear env vars so each test starts clean
    savedEnvDev = process.env[ENV_DEVNET];
    savedEnvMain = process.env[ENV_MAINNET];
    delete process.env[ENV_DEVNET];
    delete process.env[ENV_MAINNET];
  });

  afterEach(function () {
    homedirStub.restore();
    fs.rmSync(tmpHome, { recursive: true, force: true });
    if (savedEnvDev === undefined) delete process.env[ENV_DEVNET];
    else process.env[ENV_DEVNET] = savedEnvDev;
    if (savedEnvMain === undefined) delete process.env[ENV_MAINNET];
    else process.env[ENV_MAINNET] = savedEnvMain;
  });

  function paymasterFilePath(chain: string): string {
    return path.join(
      tmpHome,
      '.config',
      'ssp-relay',
      `paymaster-${chain}.json`,
    );
  }

  it('returns env-var keypair when env is set, file is absent', function () {
    const kp = Keypair.generate();
    process.env[ENV_DEVNET] = bs58.encode(kp.secretKey);

    const result = resolveKeypair('solDevnet');
    expect(result).to.not.be.null;
    expect(result!.source).to.equal('env');
    expect(result!.keypair.publicKey.toBase58()).to.equal(
      kp.publicKey.toBase58(),
    );
    // Did NOT auto-create the file
    expect(fs.existsSync(paymasterFilePath('solDevnet'))).to.equal(false);
  });

  it('env wins when both env and file are present', function () {
    const envKp = Keypair.generate();
    const fileKp = Keypair.generate();
    process.env[ENV_DEVNET] = bs58.encode(envKp.secretKey);

    // Pre-populate the file with a different keypair
    const filePath = paymasterFilePath('solDevnet');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(Array.from(fileKp.secretKey)));

    const result = resolveKeypair('solDevnet');
    expect(result!.source).to.equal('env');
    expect(result!.keypair.publicKey.toBase58()).to.equal(
      envKp.publicKey.toBase58(),
    );
  });

  it('reads from file when env var is unset and file exists', function () {
    const kp = Keypair.generate();
    const filePath = paymasterFilePath('solDevnet');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(Array.from(kp.secretKey)));

    const result = resolveKeypair('solDevnet');
    expect(result).to.not.be.null;
    expect(result!.source).to.equal('file');
    expect(result!.keypair.publicKey.toBase58()).to.equal(
      kp.publicKey.toBase58(),
    );
  });

  it('reads file content in base58 form too', function () {
    const kp = Keypair.generate();
    const filePath = paymasterFilePath('solDevnet');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, bs58.encode(kp.secretKey));

    const result = resolveKeypair('solDevnet');
    expect(result!.source).to.equal('file');
    expect(result!.keypair.publicKey.toBase58()).to.equal(
      kp.publicKey.toBase58(),
    );
  });

  it('auto-generates a devnet keypair when nothing is configured', function () {
    const filePath = paymasterFilePath('solDevnet');
    expect(fs.existsSync(filePath)).to.equal(false);

    const result = resolveKeypair('solDevnet');
    expect(result).to.not.be.null;
    expect(result!.source).to.equal('generated');
    expect(fs.existsSync(filePath)).to.equal(true);

    // File must contain a JSON byte array that decodes back to the returned keypair
    const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8')) as number[];
    expect(persisted.length).to.equal(64);
    const reloaded = Keypair.fromSecretKey(Uint8Array.from(persisted));
    expect(reloaded.publicKey.toBase58()).to.equal(
      result!.keypair.publicKey.toBase58(),
    );

    // Persisted file must have 0o600 permissions (owner read/write only)
    const stat = fs.statSync(filePath);

    const perms = stat.mode & 0o777;
    expect(perms).to.equal(0o600);
  });

  it('subsequent resolveKeypair calls re-read the auto-generated file', function () {
    const a = resolveKeypair('solDevnet');
    const b = resolveKeypair('solDevnet');
    expect(a!.source).to.equal('generated');
    expect(b!.source).to.equal('file'); // 2nd call hits the file branch
    expect(a!.keypair.publicKey.toBase58()).to.equal(
      b!.keypair.publicKey.toBase58(),
    );
  });

  it('returns null for mainnet when nothing is configured (no auto-gen)', function () {
    const result = resolveKeypair('solMainnet');
    expect(result).to.be.null;
    // And does NOT create a file
    expect(fs.existsSync(paymasterFilePath('solMainnet'))).to.equal(false);
  });

  it('returns env-var keypair for mainnet when explicitly set', function () {
    const kp = Keypair.generate();
    process.env[ENV_MAINNET] = bs58.encode(kp.secretKey);

    const result = resolveKeypair('solMainnet');
    expect(result).to.not.be.null;
    expect(result!.source).to.equal('env');
    expect(result!.keypair.publicKey.toBase58()).to.equal(
      kp.publicKey.toBase58(),
    );
  });

  it('reads mainnet keypair from file when present, no auto-gen', function () {
    const kp = Keypair.generate();
    const filePath = paymasterFilePath('solMainnet');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(Array.from(kp.secretKey)));

    const result = resolveKeypair('solMainnet');
    expect(result!.source).to.equal('file');
    expect(result!.keypair.publicKey.toBase58()).to.equal(
      kp.publicKey.toBase58(),
    );
  });

  it('throws on malformed env var content', function () {
    process.env[ENV_DEVNET] = '!!!not a valid key!!!';
    expect(() => resolveKeypair('solDevnet')).to.throw();
  });

  it('throws for unsupported chain ids', function () {
    expect(() => resolveKeypair('solTestnet' as any)).to.throw(
      /Unsupported Solana chain/,
    );
  });
});
