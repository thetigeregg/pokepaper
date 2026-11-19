import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildIosLiveUpdateArtifacts,
  parseArgs,
  resolveNativeBuildNumber,
  resolvePrivateKeyPem,
  resolveWebDir,
} from './build-ios-live-update-artifacts.mjs';
import {
  buildIosLiveUpdateBundleId,
  buildIosLiveUpdateManifest,
  computeBundleChecksum,
  signBundleBuffer,
} from './ios-live-update-common.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

test('checksums and signs a bundle the way the plugin verifies it', () => {
  const zip = Buffer.from('zip bytes');
  assert.match(computeBundleChecksum(zip), /^[0-9a-f]{64}$/);
  assert.notEqual(computeBundleChecksum(zip), computeBundleChecksum(Buffer.from('other bytes')));

  const signature = signBundleBuffer(zip, PRIVATE_PEM);
  const verifier = createVerify('RSA-SHA256');
  verifier.update(zip);
  assert.equal(verifier.verify(publicKey, signature, 'base64'), true);
});

test('builds bundle ids and manifests', () => {
  assert.equal(buildIosLiveUpdateBundleId('0.17.0', 4), 'v0.17.0-b4');
  assert.throws(() => buildIosLiveUpdateBundleId('', '4'), /semver is required/);
  assert.throws(() => buildIosLiveUpdateBundleId('0.17.0', 'x'), /positive integer/);

  assert.deepEqual(
    buildIosLiveUpdateManifest({
      bundleId: 'v0.17.0-b4',
      semver: ' 0.17.0 ',
      nativeBuildNumber: 4,
      backendOrigin: 'https://pokepaper.example.com',
      checksum: 'c',
      signature: 's',
    }),
    {
      bundleId: 'v0.17.0-b4',
      semver: '0.17.0',
      nativeBuildNumber: '4',
      url: 'https://pokepaper.example.com/ota/ios/4/v0.17.0-b4.zip',
      checksum: 'c',
      signature: 's',
    }
  );
});

test('requires a numeric native build number and a signing key', () => {
  assert.equal(resolveNativeBuildNumber({ IOS_OTA_NATIVE_BUILD_NUMBER: ' 4 ' }), '4');
  for (const value of [undefined, '', '0', 'b4']) {
    assert.throws(
      () => resolveNativeBuildNumber({ IOS_OTA_NATIVE_BUILD_NUMBER: value }),
      /IOS_OTA_NATIVE_BUILD_NUMBER/
    );
  }

  assert.equal(
    resolvePrivateKeyPem({ IOS_LIVE_UPDATE_PRIVATE_KEY: ` ${PRIVATE_PEM} ` }),
    PRIVATE_PEM.trim()
  );
  assert.equal(
    resolvePrivateKeyPem({ IOS_LIVE_UPDATE_PRIVATE_KEY_PATH: '/run/secrets/key' }, (path) => {
      assert.equal(path, '/run/secrets/key');
      return `${PRIVATE_PEM}\n`;
    }),
    PRIVATE_PEM.trim()
  );
  assert.throws(() => resolvePrivateKeyPem({}), /Missing signing key/);
});

test('finds the web build whether or not Angular nested it under browser/', () => {
  const exists = (paths) => (path) => paths.includes(path);
  assert.equal(resolveWebDir('/out', exists(['/out/browser/index.html'])), '/out/browser');
  assert.equal(resolveWebDir('/out', exists(['/out/index.html'])), '/out');
  assert.throws(() => resolveWebDir('/out', exists([])), /No index.html/);
});

test('parses arguments', () => {
  assert.match(parseArgs(['--output-root', 'ota/ios']).outputRoot, /ota\/ios$/);
  assert.throws(() => parseArgs([]), /Usage/);
  assert.throws(() => parseArgs(['--output-root']), /Usage/);
});

test('builds a signed bundle and manifest (ng build and zip faked)', () => {
  const root = mkdtempSync(join(tmpdir(), 'ota-test-'));
  try {
    const outputRoot = join(root, 'ota');
    const buildDir = join(root, 'build');
    const written = {};
    const calls = [];
    const execFileSyncFn = (cmd, args, options) => {
      calls.push([cmd, ...args].join(' '));
      if (cmd === 'npx') {
        const out = join(args.at(-1), 'browser');
        mkdirSync(out, { recursive: true });
        writeFileSync(join(out, 'index.html'), '<html></html>');
      }
      if (cmd === 'zip') {
        assert.ok(options.cwd.endsWith('/web/browser'));
        writeFileSync(args[1], 'fake zip');
      }
      return '';
    };

    const result = buildIosLiveUpdateArtifacts({
      outputRoot,
      buildDir,
      execFileSyncFn,
      envValues: {
        IOS_OTA_NATIVE_BUILD_NUMBER: '4',
        IOS_BACKEND_ORIGIN_PROD: 'https://pokepaper.example.com',
        IOS_LIVE_UPDATE_PRIVATE_KEY: PRIVATE_PEM,
      },
      readFileSyncFn: (path, encoding) =>
        path.endsWith('package.json')
          ? JSON.stringify({ version: '0.17.0' })
          : readFileSync(path, encoding),
      writeFileSyncFn: (path, contents) => {
        written[path] = contents;
        if (!path.includes('environment.ios')) writeFileSync(path, contents);
      },
    });

    assert.equal(result.bundleId, 'v0.17.0-b4');
    assert.deepEqual(
      calls.map((call) => call.split(' ').slice(0, 4).join(' ')),
      ['npx ng build --configuration', `zip -qr ${join(outputRoot, '4', 'v0.17.0-b4.zip')} .`]
    );
    const environment = Object.entries(written).find(([path]) =>
      path.endsWith('environment.ios.prod.ts')
    );
    assert.match(environment?.[1] ?? '', /apiUrl: 'https:\/\/pokepaper\.example\.com'/);

    const manifest = JSON.parse(readFileSync(join(outputRoot, '4', 'manifest.json'), 'utf8'));
    assert.equal(manifest.url, 'https://pokepaper.example.com/ota/ios/4/v0.17.0-b4.zip');
    const verifier = createVerify('RSA-SHA256');
    verifier.update(Buffer.from('fake zip'));
    assert.equal(verifier.verify(publicKey, manifest.signature, 'base64'), true);
    assert.equal(manifest.checksum, computeBundleChecksum(Buffer.from('fake zip')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('validates inputs before building anything', () => {
  const calls = [];
  assert.throws(
    () =>
      buildIosLiveUpdateArtifacts({
        outputRoot: '/tmp/never',
        buildDir: '/tmp/never-build',
        execFileSyncFn: (cmd) => calls.push(cmd),
        envValues: {
          IOS_OTA_NATIVE_BUILD_NUMBER: '4',
          IOS_BACKEND_ORIGIN_PROD: 'http://insecure.example.com',
        },
      }),
    /must use https/
  );
  assert.deepEqual(calls, []);
  assert.equal(existsSync('/tmp/never'), false);
});
