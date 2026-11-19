import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PBXPROJ_PATH,
  classifyManifestChange,
  classifyPath,
  decide,
  parseArgs,
  pbxprojDiffIsMarketingVersionOnly,
} from './ios-release-gate.mjs';

test('classifies paths as native, web, or neither', () => {
  for (const filePath of [
    'ios/App/App/Info.shared.plist',
    'ios/fastlane/Fastfile',
    'capacitor.config.ts',
    'config/ios-live-update-public.pem',
    'scripts/write-environment-ios.mjs',
    '.github/workflows/ios-testflight.yml',
  ]) {
    assert.equal(classifyPath(filePath), 'native', filePath);
  }
  for (const filePath of [
    'src/app/app.component.ts',
    'src\\main.ts',
    'shared/src/sync.ts',
    'public/favicon.svg',
    'angular.json',
    '.browserslistrc',
  ]) {
    assert.equal(classifyPath(filePath), 'web', filePath);
  }
  for (const filePath of [
    'server/src/app.ts',
    'edge/Caddyfile',
    'docs/ios.md',
    'CHANGELOG.md',
    '.github/workflows/release-publish.yml',
    'scripts/build-ios-live-update-artifacts.mjs',
    'ngsw-config.json',
  ]) {
    assert.equal(classifyPath(filePath), null, filePath);
  }
});

test('recognizes a version-only project.pbxproj diff', () => {
  const versionOnly =
    '-\t\t\t\tMARKETING_VERSION = 0.16.0;\n+\t\t\t\tMARKETING_VERSION = 0.17.0;\n';
  assert.equal(pbxprojDiffIsMarketingVersionOnly(versionOnly), true);
  assert.equal(
    pbxprojDiffIsMarketingVersionOnly(
      `${versionOnly}+\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = 16.0;\n`
    ),
    false
  );
  assert.equal(pbxprojDiffIsMarketingVersionOnly(''), false);
});

const lock = (packages) => ({ name: 'pokepaper', lockfileVersion: 3, packages });

test('classifies lockfile changes by package: native plugins vs everything else', () => {
  const base = lock({
    '': { name: 'pokepaper', version: '1.0.0', dependencies: { '@capacitor/core': '^8.6.2' } },
    'node_modules/@capacitor/core': { version: '8.6.2', resolved: 'r1' },
    'node_modules/rxjs': { version: '7.8.2', resolved: 'r2' },
  });
  const bump = (key, version) => {
    const next = structuredClone(base);
    next.packages[key] = { ...next.packages[key], version };
    return next;
  };
  const versionOnly = structuredClone(base);
  versionOnly.packages[''].version = '1.1.0';

  assert.equal(classifyManifestChange('package-lock.json', base, versionOnly), null);
  assert.equal(
    classifyManifestChange(
      'package-lock.json',
      base,
      bump('node_modules/@capacitor/core', '8.7.0')
    ),
    'native'
  );
  assert.equal(
    classifyManifestChange('package-lock.json', base, bump('node_modules/rxjs', '7.8.3')),
    'web'
  );

  const nested = structuredClone(base);
  nested.packages['node_modules/foo/node_modules/@capgo/capacitor-passkey'] = { version: '8.5.10' };
  assert.equal(classifyManifestChange('package-lock.json', base, nested), 'native');
});

test('classifies package.json changes by dependency', () => {
  const base = {
    name: 'pokepaper',
    version: '1.0.0',
    scripts: { build: 'ng build' },
    dependencies: { '@capacitor/core': '^8.6.2', rxjs: '~7.8.2' },
    devDependencies: { vitest: '^5.1.0' },
  };
  const change = (patch) => ({ ...structuredClone(base), ...patch });

  assert.equal(classifyManifestChange('package.json', base, change({ version: '1.1.0' })), null);
  assert.equal(
    classifyManifestChange(
      'package.json',
      base,
      change({
        dependencies: { ...base.dependencies, 'capacitor-secure-storage-plugin': '^0.14.2' },
      })
    ),
    'native'
  );
  assert.equal(
    classifyManifestChange('package.json', base, change({ devDependencies: { vitest: '^5.2.0' } })),
    'web'
  );
  assert.equal(
    classifyManifestChange('package.json', base, change({ scripts: { build: 'ng build --x' } })),
    'web'
  );
});

/**
 * A fake git: tags, `diff --name-only` per range, `git show ref:path`
 * contents, and unified diffs per path.
 */
function fakeGit({ tags = 'v1.1.0\nv1.0.0\n', ranges, files = {}, diffs = {} }) {
  const calls = [];
  const execFileSyncFn = (_cmd, args) => {
    calls.push(args.join(' '));
    if (args[0] === 'tag') return tags;
    if (args[0] === 'show') {
      const content = files[args[1]];
      if (content === undefined) throw new Error(`no ${args[1]}`);
      return typeof content === 'string' ? content : JSON.stringify(content);
    }
    if (args.includes('--name-only')) {
      const range = args.at(-1);
      if (!(range in ranges)) throw new Error(`unexpected range ${range}`);
      return ranges[range].join('\n');
    }
    return diffs[args.at(-1)] ?? '';
  };
  return { execFileSyncFn, calls };
}

test('a native release goes to TestFlight, not OTA', () => {
  const { execFileSyncFn } = fakeGit({
    ranges: { 'v1.0.0..v1.1.0': ['ios/App/App/AppDelegate.swift', 'src/main.ts'] },
  });

  const { testflight, ota } = decide({ head: 'v1.1.0', nativeSha: 'abc', execFileSyncFn });

  assert.deepEqual(testflight, { deploy: true, paths: ['ios/App/App/AppDelegate.swift'] });
  assert.equal(ota.deploy, false);
  assert.match(ota.skippedReason, /changes native code/);
});

test('a web-only release ships OTA when nothing native changed since the installed build', () => {
  const { execFileSyncFn, calls } = fakeGit({
    ranges: {
      'v1.0.0..v1.1.0': ['src/app/app.component.ts', 'server/src/app.ts'],
      'abc..v1.1.0': ['src/app/app.component.ts', 'docs/ios.md'],
    },
  });

  const { testflight, ota } = decide({ head: 'v1.1.0', nativeSha: 'abc', execFileSyncFn });

  assert.equal(testflight.deploy, false);
  assert.deepEqual(ota, { deploy: true, paths: ['src/app/app.component.ts'], skippedReason: '' });
  assert.ok(calls.includes('diff --name-only abc..v1.1.0'));
});

test('OTA waits while native changes since the installed build have no TestFlight build yet', () => {
  const { execFileSyncFn } = fakeGit({
    ranges: {
      'v1.0.0..v1.1.0': ['src/main.ts'],
      'abc..v1.1.0': ['src/main.ts', 'capacitor.config.ts'],
    },
  });

  const { ota } = decide({ head: 'v1.1.0', nativeSha: 'abc', execFileSyncFn });

  assert.equal(ota.deploy, false);
  assert.match(ota.skippedReason, /waiting for a newer TestFlight build/);
});

test('OTA is skipped without a recorded OTA-capable build, or without web changes', () => {
  const web = fakeGit({ ranges: { 'v1.0.0..v1.1.0': ['src/main.ts'] } });
  assert.match(
    decide({ head: 'v1.1.0', nativeSha: ' ', execFileSyncFn: web.execFileSyncFn }).ota
      .skippedReason,
    /No OTA-capable TestFlight build/
  );

  const serverOnly = fakeGit({ ranges: { 'v1.0.0..v1.1.0': ['server/src/app.ts'] } });
  const decision = decide({
    head: 'v1.1.0',
    nativeSha: 'abc',
    execFileSyncFn: serverOnly.execFileSyncFn,
  });
  assert.equal(decision.testflight.deploy, false);
  assert.match(decision.ota.skippedReason, /No web changes/);
});

test('version-only bumps of the manifests and the Xcode project count as nothing', () => {
  const pkg = (version) => ({ name: 'pokepaper', version, dependencies: { rxjs: '~7.8.2' } });
  const { execFileSyncFn } = fakeGit({
    ranges: { 'v1.0.0..v1.1.0': ['package.json', PBXPROJ_PATH, 'CHANGELOG.md'] },
    files: { 'v1.0.0:package.json': pkg('1.0.0'), 'v1.1.0:package.json': pkg('1.1.0') },
    diffs: {
      [PBXPROJ_PATH]: '-\t\t\t\tMARKETING_VERSION = 1.0.0;\n+\t\t\t\tMARKETING_VERSION = 1.1.0;\n',
    },
  });

  const { testflight, ota } = decide({ head: 'v1.1.0', nativeSha: 'abc', execFileSyncFn });

  assert.equal(testflight.deploy, false);
  assert.equal(ota.deploy, false);
});

test('a dependency bump routes by package', () => {
  const lockAt = (coreVersion, rxjsVersion) => ({
    packages: {
      '': { name: 'pokepaper', version: '1.0.0' },
      'node_modules/@capacitor/core': { version: coreVersion },
      'node_modules/rxjs': { version: rxjsVersion },
    },
  });
  const native = fakeGit({
    ranges: { 'v1.0.0..v1.1.0': ['package-lock.json'] },
    files: {
      'v1.0.0:package-lock.json': lockAt('8.6.2', '7.8.2'),
      'v1.1.0:package-lock.json': lockAt('8.7.0', '7.8.2'),
    },
  });
  assert.deepEqual(
    decide({ head: 'v1.1.0', nativeSha: 'abc', execFileSyncFn: native.execFileSyncFn }).testflight,
    {
      deploy: true,
      paths: ['package-lock.json'],
    }
  );

  const web = fakeGit({
    ranges: { 'v1.0.0..v1.1.0': ['package-lock.json'], 'abc..v1.1.0': ['package-lock.json'] },
    files: {
      'v1.0.0:package-lock.json': lockAt('8.6.2', '7.8.2'),
      'v1.1.0:package-lock.json': lockAt('8.6.2', '7.8.3'),
      'abc:package-lock.json': lockAt('8.6.2', '7.8.2'),
    },
  });
  const decision = decide({ head: 'v1.1.0', nativeSha: 'abc', execFileSyncFn: web.execFileSyncFn });
  assert.equal(decision.testflight.deploy, false);
  assert.equal(decision.ota.deploy, true);
});

test('the first release ships TestFlight only, without diffing', () => {
  const { execFileSyncFn, calls } = fakeGit({ tags: 'v0.1.0\n', ranges: {} });

  const { testflight, ota } = decide({ head: 'v0.1.0', execFileSyncFn });

  assert.equal(testflight.deploy, true);
  assert.equal(ota.deploy, false);
  assert.deepEqual(calls, ['tag --list v* --sort=-v:refname']);
});

test('parses arguments', () => {
  assert.deepEqual(
    parseArgs([
      '--head',
      'v1.1.0',
      '--base',
      'v1.0.0',
      '--native-sha',
      'abc',
      '--github-output',
      '/tmp/o',
    ]),
    { head: 'v1.1.0', base: 'v1.0.0', nativeSha: 'abc', githubOutput: '/tmp/o' }
  );
  assert.equal(parseArgs([]).head, 'HEAD');
  assert.throws(() => parseArgs(['--head']), /--head must be a non-empty ref/);
  assert.throws(() => parseArgs(['--bogus']), /Unknown argument/);
});
