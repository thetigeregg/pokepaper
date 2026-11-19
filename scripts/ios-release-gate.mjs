#!/usr/bin/env node
/**
 * Decides how a release reaches the iOS app (docs/ios.md -> TestFlight, OTA
 * updates):
 *
 * - **native** changes (the Xcode project, Capacitor config, native plugins,
 *   iOS build tooling) need a new TestFlight build;
 * - **web** changes (the Angular app and what it's built from) ship as a
 *   signed OTA bundle, but only when nothing native changed since the commit
 *   the installed TestFlight build was made from (`--native-sha`): a bundle
 *   runs on that build's native code, so it mustn't depend on newer plugins.
 *   That also covers a TestFlight build that's still running or failed.
 *
 *   node scripts/ios-release-gate.mjs --head v1.2.0 [--base v1.1.0]
 *     [--native-sha <sha>] [--github-output $GITHUB_OUTPUT]
 *
 * Outputs: testflight, testflight_paths, ota, ota_paths, ota_skipped_reason.
 *
 * Version-only bumps (the manifests' `version`, project.pbxproj's
 * MARKETING_VERSION) count as nothing. Dependency changes are read from the
 * lockfile itself: a Capacitor plugin bump is native, anything else is web.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  diffLines,
  listChangedFiles,
  readManifestDiff,
  resolvePreviousTag,
  writeGithubOutput,
} from './release-diff.mjs';

export const PBXPROJ_PATH = 'ios/App/App.xcodeproj/project.pbxproj';
export const MANIFESTS = ['package.json', 'package-lock.json'];

export const NATIVE_RULE = {
  prefixes: ['ios/'],
  files: new Set([
    'capacitor.config.ts',
    'config/ios-live-update-public.pem',
    'scripts/write-environment-ios.mjs',
    'scripts/lan-host.mjs',
    'scripts/generate-ios-info-plists.mjs',
    'scripts/sync-ios-version.mjs',
    '.github/workflows/ios-testflight.yml',
  ]),
};

export const WEB_RULE = {
  prefixes: ['src/', 'shared/', 'public/'],
  files: new Set([
    '.nvmrc',
    'angular.json',
    'tsconfig.json',
    'tsconfig.app.json',
    'ionic.config.json',
    '.browserslistrc',
  ]),
};

/** npm packages with native iOS code: changing them needs a TestFlight build. */
export const NATIVE_PACKAGE = /^(@capacitor|@capacitor-community|@capawesome|@capgo)\/|^capacitor-/;

const MARKETING_VERSION_LINE = /^\t*MARKETING_VERSION = [^;]+;$/;
const GIT_OPTIONS = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };

function normalize(filePath) {
  return filePath.replace(/\\/g, '/');
}

function matches(rule, filePath) {
  return rule.files.has(filePath) || rule.prefixes.some((prefix) => filePath.startsWith(prefix));
}

/** 'native', 'web', or null for a changed path (manifests are handled separately). */
export function classifyPath(filePath) {
  const normalized = normalize(filePath);
  if (matches(NATIVE_RULE, normalized)) return 'native';
  if (matches(WEB_RULE, normalized)) return 'web';
  return null;
}

export function pbxprojDiffIsMarketingVersionOnly(diff) {
  const lines = diffLines(diff);
  return lines.length > 0 && lines.every((line) => MARKETING_VERSION_LINE.test(line.slice(1)));
}

function packageNameOf(lockKey) {
  const index = lockKey.lastIndexOf('node_modules/');
  return index >= 0 ? lockKey.slice(index + 'node_modules/'.length) : lockKey;
}

function withoutVersion(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  const { version: _version, ...rest } = entry;
  return rest;
}

/**
 * What a manifest change means: 'native' if a native package changed, 'web'
 * for any other change, or null when only `version` fields changed.
 */
export function classifyManifestChange(filePath, before, after) {
  const changed = new Set();
  if (filePath === 'package-lock.json') {
    const beforePackages = before?.packages ?? {};
    const afterPackages = after?.packages ?? {};
    for (const key of new Set([...Object.keys(beforePackages), ...Object.keys(afterPackages)])) {
      // The root entry ("") carries the release version; compare the rest.
      const a = key === '' ? withoutVersion(beforePackages[key]) : beforePackages[key];
      const b = key === '' ? withoutVersion(afterPackages[key]) : afterPackages[key];
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        changed.add(key === '' ? '' : packageNameOf(key));
      }
    }
  } else {
    const fields = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
    fields.delete('version');
    for (const field of fields) {
      const a = before?.[field];
      const b = after?.[field];
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      if (field === 'dependencies' || field === 'devDependencies') {
        for (const name of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
          if (a?.[name] !== b?.[name]) changed.add(name);
        }
      } else {
        changed.add('');
      }
    }
  }
  if (changed.size === 0) return null;
  return [...changed].some((name) => NATIVE_PACKAGE.test(name)) ? 'native' : 'web';
}

/** Changed paths between two refs, split into native and web. */
export function classifyRange({ base, head, execFileSyncFn = execFileSync, cwd = process.cwd() }) {
  const readJson = (ref, filePath) => {
    try {
      return JSON.parse(
        execFileSyncFn('git', ['show', `${ref}:${filePath}`], { cwd, ...GIT_OPTIONS })
      );
    } catch {
      return null; // didn't exist at that ref
    }
  };
  const native = [];
  const web = [];
  for (const raw of listChangedFiles({ base, head, execFileSyncFn, cwd })) {
    const filePath = normalize(raw);
    let kind;
    if (MANIFESTS.includes(filePath)) {
      kind = classifyManifestChange(filePath, readJson(base, filePath), readJson(head, filePath));
    } else if (filePath === PBXPROJ_PATH) {
      const diff = readManifestDiff({ base, head, paths: [filePath], execFileSyncFn, cwd });
      kind = pbxprojDiffIsMarketingVersionOnly(diff) ? null : 'native';
    } else {
      kind = classifyPath(filePath);
    }
    if (kind === 'native') native.push(filePath);
    else if (kind === 'web') web.push(filePath);
  }
  return { native, web };
}

/**
 * The release's routing. `nativeSha` is the commit the installed TestFlight
 * build was made from (unset: no OTA-capable build is known yet).
 */
export function decide({
  head,
  base,
  nativeSha,
  execFileSyncFn = execFileSync,
  cwd = process.cwd(),
}) {
  const previous = base === undefined ? resolvePreviousTag(head, { execFileSyncFn, cwd }) : base;
  if (typeof previous !== 'string' || previous.trim().length === 0) {
    // First release: ship a native build; there's nothing to update over the air.
    return {
      testflight: { deploy: true, paths: ['no-previous-tag'] },
      ota: { deploy: false, paths: [], skippedReason: 'First release: TestFlight only.' },
    };
  }

  const release = classifyRange({ base: previous, head, execFileSyncFn, cwd });
  const testflight = { deploy: release.native.length > 0, paths: release.native };

  const skip = (skippedReason) => ({ deploy: false, paths: [], skippedReason });
  let ota;
  if (release.web.length === 0) {
    ota = skip('No web changes in this release.');
  } else if (release.native.length > 0) {
    ota = skip('This release changes native code: it ships through TestFlight instead.');
  } else if (typeof nativeSha !== 'string' || nativeSha.trim().length === 0) {
    ota = skip('No OTA-capable TestFlight build is recorded yet (IOS_OTA_NATIVE_SHA).');
  } else {
    const sinceNative = classifyRange({ base: nativeSha.trim(), head, execFileSyncFn, cwd });
    ota =
      sinceNative.native.length > 0
        ? skip(
            'Native code changed since the installed TestFlight build was made; waiting for a newer TestFlight build.'
          )
        : { deploy: true, paths: release.web, skippedReason: '' };
  }
  return { testflight, ota };
}

export function parseArgs(argv) {
  const args = { head: 'HEAD', base: undefined, nativeSha: undefined, githubOutput: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = () => {
      index += 1;
      return argv[index] ?? null;
    };
    if (value === '--head') args.head = next();
    else if (value === '--base') args.base = next();
    else if (value === '--native-sha') args.nativeSha = next() ?? undefined;
    else if (value === '--github-output') args.githubOutput = next();
    else throw new Error(`Unknown argument "${value}"`);
  }
  if (typeof args.head !== 'string' || args.head.trim().length === 0) {
    throw new Error('--head must be a non-empty ref (e.g. the release tag)');
  }
  return args;
}

function main() {
  const tag = '[ios-release-gate]';
  try {
    const args = parseArgs(process.argv.slice(2));
    const { testflight, ota } = decide(args);
    console.log(`${tag} testflight=${testflight.deploy} ${testflight.paths.join(',')}`);
    console.log(`${tag} ota=${ota.deploy} ${ota.deploy ? ota.paths.join(',') : ota.skippedReason}`);
    if (args.githubOutput) {
      writeGithubOutput(args.githubOutput, {
        testflight: String(testflight.deploy),
        testflight_paths: testflight.paths.join(','),
        ota: String(ota.deploy),
        ota_paths: ota.paths.join(','),
        ota_skipped_reason: ota.skippedReason,
      });
    }
  } catch (error) {
    console.error(`${tag} ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  main();
}
