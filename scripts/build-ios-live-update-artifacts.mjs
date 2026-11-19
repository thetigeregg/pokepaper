#!/usr/bin/env node
/**
 * Builds a signed iOS OTA bundle (docs/ios.md -> OTA updates):
 *
 *   ota/ios/<build>/manifest.json
 *   ota/ios/<build>/v<version>-b<build>.zip
 *
 * Runs inside edge/Dockerfile's OTA stage (ported from go-gather's server
 * image step). Environment:
 * - IOS_OTA_NATIVE_BUILD_NUMBER: the TestFlight build the bundle is for.
 * - IOS_BACKEND_ORIGIN_PROD: the public origin (apiUrl, and the bundle URL).
 * - IOS_LIVE_UPDATE_PRIVATE_KEY_PATH (or IOS_LIVE_UPDATE_PRIVATE_KEY): the
 *   RSA private key matching config/ios-live-update-public.pem.
 *
 * It writes the ios-prod environment and runs `ng build` directly rather than
 * `npm run build:ios:prod`, whose prebuild steps need the ios/ project.
 * Logs never include the origin (public CI logs).
 *
 *   node scripts/build-ios-live-update-artifacts.mjs --output-root <dir>
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  buildIosLiveUpdateBundleId,
  buildIosLiveUpdateManifest,
  computeBundleChecksum,
  signBundleBuffer,
} from './ios-live-update-common.mjs';
import { readPackageVersion } from './sync-ios-version.mjs';
import { generateEnvironmentIos, resolveProdBackendOrigin } from './write-environment-ios.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function resolveNativeBuildNumber(envValues = process.env) {
  const build = envValues.IOS_OTA_NATIVE_BUILD_NUMBER?.trim() ?? '';
  if (!/^\d+$/.test(build) || Number(build) < 1) {
    throw new Error(
      `IOS_OTA_NATIVE_BUILD_NUMBER must be the TestFlight build number (got "${build}")`
    );
  }
  return build;
}

export function resolvePrivateKeyPem(envValues = process.env, readFileSyncFn = readFileSync) {
  const inline = envValues.IOS_LIVE_UPDATE_PRIVATE_KEY?.trim();
  if (inline) {
    return inline;
  }
  const keyPath = envValues.IOS_LIVE_UPDATE_PRIVATE_KEY_PATH?.trim();
  if (keyPath) {
    return readFileSyncFn(resolve(keyPath), 'utf8').trim();
  }
  throw new Error(
    'Missing signing key: set IOS_LIVE_UPDATE_PRIVATE_KEY_PATH or IOS_LIVE_UPDATE_PRIVATE_KEY'
  );
}

/**
 * Angular's `--output-path` override nests the app under `browser/` (it
 * doesn't inherit angular.json's empty `outputPath.browser`), so look there
 * first.
 */
export function resolveWebDir(outputPath, existsSyncFn = existsSync) {
  const nested = join(outputPath, 'browser');
  if (existsSyncFn(join(nested, 'index.html'))) {
    return nested;
  }
  if (existsSyncFn(join(outputPath, 'index.html'))) {
    return outputPath;
  }
  throw new Error(`No index.html in the ios-prod build output (${outputPath})`);
}

export function buildIosLiveUpdateArtifacts({
  outputRoot,
  envValues = process.env,
  cwd = REPO_ROOT,
  execFileSyncFn = execFileSync,
  readFileSyncFn = readFileSync,
  writeFileSyncFn = writeFileSync,
  existsSyncFn = existsSync,
  buildDir = mkdtempSync(join(tmpdir(), 'ios-ota-')),
} = {}) {
  // Validate everything before the (slow) build.
  const nativeBuildNumber = resolveNativeBuildNumber(envValues);
  const backendOrigin = resolveProdBackendOrigin(envValues);
  const privateKeyPem = resolvePrivateKeyPem(envValues, readFileSyncFn);
  const semver = readPackageVersion(resolve(cwd, 'package.json'), readFileSyncFn);
  const bundleId = buildIosLiveUpdateBundleId(semver, nativeBuildNumber);

  generateEnvironmentIos({ variant: 'prod', envValues, writeFileSyncFn });
  const webOutput = join(buildDir, 'web');
  execFileSyncFn(
    'npx',
    ['ng', 'build', '--configuration', 'ios-prod', '--output-path', webOutput],
    {
      cwd,
      stdio: 'inherit',
    }
  );
  const webDir = resolveWebDir(webOutput, existsSyncFn);

  const outputDir = resolve(outputRoot, nativeBuildNumber);
  const zipPath = join(outputDir, `${bundleId}.zip`);
  mkdirSync(outputDir, { recursive: true });
  rmSync(zipPath, { force: true });
  // index.html at the zip root, as the plugin expects.
  execFileSyncFn('zip', ['-qr', zipPath, '.'], { cwd: webDir, stdio: ['ignore', 'pipe', 'pipe'] });

  const zip = readFileSyncFn(zipPath);
  const manifest = buildIosLiveUpdateManifest({
    bundleId,
    semver,
    nativeBuildNumber,
    backendOrigin,
    checksum: computeBundleChecksum(zip),
    signature: signBundleBuffer(zip, privateKeyPem),
  });
  writeFileSyncFn(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  return { bundleId, nativeBuildNumber, outputDir, zipPath, manifest, sizeBytes: zip.length };
}

export function parseArgs(argv) {
  if (argv.length !== 2 || argv[0] !== '--output-root' || !argv[1]?.trim()) {
    throw new Error('Usage: node scripts/build-ios-live-update-artifacts.mjs --output-root <dir>');
  }
  return { outputRoot: resolve(argv[1]) };
}

function main() {
  const tag = '[build-ios-live-update-artifacts]';
  try {
    const { outputRoot } = parseArgs(process.argv.slice(2));
    const result = buildIosLiveUpdateArtifacts({ outputRoot });
    console.log(
      `${tag} built ${result.bundleId} for native build ${result.nativeBuildNumber} (${result.sizeBytes} bytes)`
    );
  } catch (error) {
    console.error(`${tag} ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  main();
}
