#!/usr/bin/env node
/**
 * Decides how a release reaches the iOS app (docs/ios.md -> TestFlight, OTA
 * updates). Two recorded commits drive it:
 *
 * - `--native-build <number>@<sha>` (repo variable IOS_OTA_NATIVE_BUILD): the
 *   last TestFlight build of main, recorded by ios-testflight.yml.
 * - `--bundle-sha <sha>` (IOS_OTA_BUNDLE_SHA): the release the last OTA
 *   bundle was built from, recorded by release-publish.yml.
 *
 * Decisions:
 * - **TestFlight** when native code (the Xcode project, Capacitor config,
 *   native plugins, iOS build tooling) changed since the recorded build, so
 *   a change is never lost to a quick follow-up release. Before any build is
 *   recorded, web changes count too: there's no OTA-capable build yet.
 * - **OTA bundle** when nothing native changed since the recorded build (a
 *   bundle runs on that build's native code) and web code (the Angular app
 *   and its runtime dependencies) changed since the later of the recorded
 *   build and the last bundle, so web changes held back while a TestFlight
 *   build was pending still ship. OTA problems never fail the gate: they
 *   skip with a reason, so image publishing isn't blocked.
 *
 *   node scripts/ios-release-gate.mjs --head v1.2.0 [--base v1.1.0]
 *     [--native-build 5@<sha>] [--bundle-sha <sha>] [--github-output $GITHUB_OUTPUT]
 *
 * Outputs: testflight, testflight_paths, ota, ota_paths, ota_skipped_reason,
 * ota_native_build_number.
 *
 * Version-only bumps (the manifests' `version`, project.pbxproj's
 * MARKETING_VERSION) count as nothing. Dependency changes are read from the
 * lockfile and package.json themselves.
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
/** Build toolchain packages that change the bundle even as devDependencies. */
export const WEB_TOOLCHAIN_PACKAGE = /^@angular(-devkit)?\/|^@ionic\/|^typescript$/;

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
  return index >= 0 ? lockKey.slice(index + 'node_modules/'.length) : null;
}

/**
 * Classifies changed package names: 'native' if any is a native plugin,
 * 'web' if any ships in the app (a root runtime dependency, or the Angular /
 * Ionic toolchain), else null (server or tooling-only: eslint, vitest, …).
 */
function classifyPackages(names, appDependencies) {
  if (names.some((name) => NATIVE_PACKAGE.test(name))) return 'native';
  if (names.some((name) => appDependencies.has(name) || WEB_TOOLCHAIN_PACKAGE.test(name))) {
    return 'web';
  }
  return null;
}

/**
 * What a manifest change means for the iOS app. `appDependencies` are the
 * root package.json `dependencies` (at either ref).
 */
export function classifyManifestChange(filePath, before, after, appDependencies) {
  const names = [];
  if (filePath === 'package-lock.json') {
    const beforePackages = before?.packages ?? {};
    const afterPackages = after?.packages ?? {};
    for (const key of new Set([...Object.keys(beforePackages), ...Object.keys(afterPackages)])) {
      const name = packageNameOf(key);
      // Workspace entries ("", "server", "shared") aren't packages.
      if (name === null) continue;
      if (JSON.stringify(beforePackages[key]) !== JSON.stringify(afterPackages[key])) {
        names.push(name);
      }
    }
  } else {
    for (const field of ['dependencies', 'devDependencies']) {
      const a = before?.[field] ?? {};
      const b = after?.[field] ?? {};
      for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (a[name] !== b[name]) names.push(name);
      }
    }
  }
  return classifyPackages(names, appDependencies);
}

function gitShowJson(ref, filePath, execFileSyncFn, cwd) {
  try {
    return JSON.parse(
      execFileSyncFn('git', ['show', `${ref}:${filePath}`], { cwd, ...GIT_OPTIONS })
    );
  } catch {
    return null; // didn't exist at that ref
  }
}

function gitSucceeds(args, execFileSyncFn, cwd) {
  try {
    execFileSyncFn('git', args, { cwd, ...GIT_OPTIONS });
    return true;
  } catch {
    return false;
  }
}

/** Changed paths between two refs, split into native and web. */
export function classifyRange({ base, head, execFileSyncFn = execFileSync, cwd = process.cwd() }) {
  const appDependencies = new Set(
    [base, head].flatMap((ref) =>
      Object.keys(gitShowJson(ref, 'package.json', execFileSyncFn, cwd)?.dependencies ?? {})
    )
  );
  const native = [];
  const web = [];
  for (const raw of listChangedFiles({ base, head, execFileSyncFn, cwd })) {
    const filePath = normalize(raw);
    let kind;
    if (MANIFESTS.includes(filePath)) {
      kind = classifyManifestChange(
        filePath,
        gitShowJson(base, filePath, execFileSyncFn, cwd),
        gitShowJson(head, filePath, execFileSyncFn, cwd),
        appDependencies
      );
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

/** `<number>@<sha>` → { buildNumber, sha }, or null if unset or malformed. */
export function parseNativeBuild(value) {
  const match = /^\s*(\d+)@([0-9a-f]{7,40})\s*$/.exec(value ?? '');
  return match ? { buildNumber: match[1], sha: match[2] } : null;
}

/**
 * The release's routing (see the file comment). `nativeBuild` is the
 * `<number>@<sha>` string; `bundleSha` the last bundled commit.
 */
export function decide({
  head,
  base,
  nativeBuild,
  bundleSha,
  execFileSyncFn = execFileSync,
  cwd = process.cwd(),
}) {
  const isCommit = (sha) => gitSucceeds(['cat-file', '-e', `${sha}^{commit}`], execFileSyncFn, cwd);
  const skip = (skippedReason) => ({
    deploy: false,
    paths: [],
    skippedReason,
    nativeBuildNumber: '',
  });

  const previous = base === undefined ? resolvePreviousTag(head, { execFileSyncFn, cwd }) : base;
  if (typeof previous !== 'string' || previous.trim().length === 0) {
    // First release: ship a native build; there's nothing to update over the air.
    return {
      testflight: { deploy: true, paths: ['no-previous-tag'] },
      ota: skip('First release: TestFlight only.'),
    };
  }

  const recorded = parseNativeBuild(nativeBuild);
  const native = recorded && isCommit(recorded.sha) ? recorded : null;

  if (native === null) {
    // No usable record of an OTA-capable build: TestFlight ships everything.
    const release = classifyRange({ base: previous, head, execFileSyncFn, cwd });
    const paths = [...release.native, ...release.web];
    return {
      testflight: { deploy: paths.length > 0, paths },
      ota: skip(
        recorded
          ? `The recorded TestFlight build's commit (${recorded.sha}) isn't in this repository's history.`
          : 'No OTA-capable TestFlight build is recorded yet (IOS_OTA_NATIVE_BUILD).'
      ),
    };
  }

  const sinceNative = classifyRange({ base: native.sha, head, execFileSyncFn, cwd });
  const testflight = { deploy: sinceNative.native.length > 0, paths: sinceNative.native };
  if (testflight.deploy) {
    return {
      testflight,
      ota: skip(
        'Native code changed since the installed TestFlight build: it ships through TestFlight.'
      ),
    };
  }

  let ota;
  try {
    // Web changes not yet in the installed build or the last bundle.
    const bundleIsNewer =
      typeof bundleSha === 'string' &&
      /^[0-9a-f]{7,40}$/.test(bundleSha.trim()) &&
      isCommit(bundleSha.trim()) &&
      gitSucceeds(
        ['merge-base', '--is-ancestor', native.sha, bundleSha.trim()],
        execFileSyncFn,
        cwd
      );
    const webBase = bundleIsNewer ? bundleSha.trim() : native.sha;
    const pending =
      webBase === native.sha
        ? sinceNative
        : classifyRange({ base: webBase, head, execFileSyncFn, cwd });
    ota =
      pending.web.length > 0
        ? {
            deploy: true,
            paths: pending.web,
            skippedReason: '',
            nativeBuildNumber: native.buildNumber,
          }
        : skip('No web changes since the last bundle or TestFlight build.');
  } catch (error) {
    ota = skip(`OTA check failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { testflight, ota };
}

export function parseArgs(argv) {
  const args = {
    head: 'HEAD',
    base: undefined,
    nativeBuild: undefined,
    bundleSha: undefined,
    githubOutput: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = () => {
      index += 1;
      return argv[index] ?? null;
    };
    if (value === '--head') args.head = next();
    else if (value === '--base') args.base = next();
    else if (value === '--native-build') args.nativeBuild = next() ?? undefined;
    else if (value === '--bundle-sha') args.bundleSha = next() ?? undefined;
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
        ota_native_build_number: ota.nativeBuildNumber,
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
