import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PBXPROJ_PATH,
  classifyManifestChange,
  classifyPath,
  decide,
  parseArgs,
  parseNativeBuild,
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
const APP_DEPS = new Set(['@capacitor/core', 'rxjs', '@ionic/angular']);

test('classifies lockfile changes: native plugins, app dependencies, or neither', () => {
  const base = lock({
    '': { name: 'pokepaper', version: '1.0.0' },
    server: { name: '@pokepaper/server', dependencies: { fastify: '^5.0.0' } },
    'node_modules/@capacitor/core': { version: '8.6.2' },
    'node_modules/rxjs': { version: '7.8.2' },
    'node_modules/fastify': { version: '5.0.0' },
    'node_modules/eslint': { version: '10.0.0', dev: true },
  });
  const bump = (key, patch) => {
    const next = structuredClone(base);
    next.packages[key] = { ...next.packages[key], ...patch };
    return next;
  };

  assert.equal(
    classifyManifestChange('package-lock.json', base, bump('', { version: '1.1.0' }), APP_DEPS),
    null
  );
  assert.equal(
    classifyManifestChange(
      'package-lock.json',
      base,
      bump('node_modules/@capacitor/core', { version: '8.7.0' }),
      APP_DEPS
    ),
    'native'
  );
  assert.equal(
    classifyManifestChange(
      'package-lock.json',
      base,
      bump('node_modules/rxjs', { version: '7.8.3' }),
      APP_DEPS
    ),
    'web'
  );
  // Server and dev-tooling bumps don't change the app.
  const serverBump = bump('node_modules/fastify', { version: '5.1.0' });
  serverBump.packages.server.dependencies.fastify = '^5.1.0';
  assert.equal(classifyManifestChange('package-lock.json', base, serverBump, APP_DEPS), null);
  assert.equal(
    classifyManifestChange(
      'package-lock.json',
      base,
      bump('node_modules/eslint', { version: '10.1.0' }),
      APP_DEPS
    ),
    null
  );
  // The Angular toolchain does, even as a devDependency.
  const angular = structuredClone(base);
  angular.packages['node_modules/@angular/build'] = { version: '22.3.0', dev: true };
  assert.equal(classifyManifestChange('package-lock.json', base, angular, APP_DEPS), 'web');
  // Nested native plugins count too.
  const nested = structuredClone(base);
  nested.packages['node_modules/foo/node_modules/@capgo/capacitor-passkey'] = { version: '8.5.10' };
  assert.equal(classifyManifestChange('package-lock.json', base, nested, APP_DEPS), 'native');
});

test('classifies package.json changes by dependency', () => {
  const base = {
    name: 'pokepaper',
    version: '1.0.0',
    scripts: { build: 'ng build' },
    dependencies: { '@capacitor/core': '^8.6.2', rxjs: '~7.8.2' },
    devDependencies: { vitest: '^5.1.0', '@angular/cli': '^22.2.7' },
  };
  const change = (patch) => ({ ...structuredClone(base), ...patch });
  const deps = new Set(Object.keys(base.dependencies));

  assert.equal(
    classifyManifestChange('package.json', base, change({ version: '1.1.0' }), deps),
    null
  );
  assert.equal(
    classifyManifestChange('package.json', base, change({ scripts: { build: 'x' } }), deps),
    null
  );
  assert.equal(
    classifyManifestChange(
      'package.json',
      base,
      change({
        dependencies: { ...base.dependencies, 'capacitor-secure-storage-plugin': '^0.14.2' },
      }),
      deps
    ),
    'native'
  );
  assert.equal(
    classifyManifestChange(
      'package.json',
      base,
      change({ dependencies: { ...base.dependencies, rxjs: '~7.9.0' } }),
      deps
    ),
    'web'
  );
  assert.equal(
    classifyManifestChange(
      'package.json',
      base,
      change({ devDependencies: { ...base.devDependencies, vitest: '^5.2.0' } }),
      deps
    ),
    null
  );
  assert.equal(
    classifyManifestChange(
      'package.json',
      base,
      change({ devDependencies: { ...base.devDependencies, '@angular/cli': '^22.3.0' } }),
      deps
    ),
    'web'
  );
});

test('parses the recorded native build', () => {
  assert.deepEqual(parseNativeBuild('5@abc1234'), { buildNumber: '5', sha: 'abc1234' });
  assert.deepEqual(parseNativeBuild(' 12@0123456789abcdef0123456789abcdef01234567 '), {
    buildNumber: '12',
    sha: '0123456789abcdef0123456789abcdef01234567',
  });
  for (const value of [undefined, '', '5', '@abc1234', '5@xyz', 'v5@abc1234']) {
    assert.equal(parseNativeBuild(value), null, String(value));
  }
});

/**
 * A fake git: tags, `diff --name-only` per range, `git show ref:path`,
 * unified diffs per path, known commits (cat-file), and ancestry
 * (merge-base --is-ancestor) as "ancestor..descendant" pairs.
 */
function fakeGit({
  tags = 'v1.1.0\nv1.0.0\n',
  ranges = {},
  files = {},
  diffs = {},
  commits = ['aaa1111', 'bbb2222'],
  ancestry = [],
}) {
  const calls = [];
  const execFileSyncFn = (_cmd, args) => {
    calls.push(args.join(' '));
    if (args[0] === 'tag') return tags;
    if (args[0] === 'cat-file') {
      if (!commits.includes(args[2].replace('^{commit}', ''))) throw new Error('not a commit');
      return '';
    }
    if (args[0] === 'merge-base') {
      if (!ancestry.includes(`${args[2]}..${args[3]}`)) throw new Error('not an ancestor');
      return '';
    }
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

const NATIVE = '5@aaa1111';

test('native changes since the recorded build go to TestFlight, not OTA', () => {
  const { execFileSyncFn } = fakeGit({
    ranges: { 'aaa1111..v1.1.0': ['ios/App/App/AppDelegate.swift', 'src/main.ts'] },
  });

  const { testflight, ota } = decide({ head: 'v1.1.0', nativeBuild: NATIVE, execFileSyncFn });

  assert.deepEqual(testflight, { deploy: true, paths: ['ios/App/App/AppDelegate.swift'] });
  assert.equal(ota.deploy, false);
  assert.match(ota.skippedReason, /ships through TestFlight/);
});

test('a native change is still built when a web-only release follows it quickly', () => {
  // v1.0.0 (native) wasn't built yet; v1.1.0 is web-only.
  const { execFileSyncFn } = fakeGit({
    ranges: { 'aaa1111..v1.1.0': ['capacitor.config.ts', 'src/main.ts'] },
  });

  assert.equal(
    decide({ head: 'v1.1.0', nativeBuild: NATIVE, execFileSyncFn }).testflight.deploy,
    true
  );
});

test('web changes ship as OTA for the recorded build', () => {
  const { execFileSyncFn } = fakeGit({
    ranges: { 'aaa1111..v1.1.0': ['src/app/app.component.ts', 'server/src/app.ts'] },
  });

  const { testflight, ota } = decide({ head: 'v1.1.0', nativeBuild: NATIVE, execFileSyncFn });

  assert.equal(testflight.deploy, false);
  assert.deepEqual(ota, {
    deploy: true,
    paths: ['src/app/app.component.ts'],
    skippedReason: '',
    nativeBuildNumber: '5',
  });
});

test('OTA only counts web changes since the last bundle made for this build', () => {
  const bundled = fakeGit({
    ranges: {
      'aaa1111..v1.1.0': ['src/main.ts', 'server/src/app.ts'],
      'bbb2222..v1.1.0': ['server/src/app.ts'],
    },
    ancestry: ['aaa1111..bbb2222'],
  });
  const decision = decide({
    head: 'v1.1.0',
    nativeBuild: NATIVE,
    bundleSha: 'bbb2222',
    execFileSyncFn: bundled.execFileSyncFn,
  });
  assert.equal(decision.ota.deploy, false);
  assert.match(decision.ota.skippedReason, /No web changes since the last bundle/);

  // A bundle older than the installed build doesn't count: web changes held
  // back while that TestFlight build was pending still ship.
  const stale = fakeGit({ ranges: { 'aaa1111..v1.1.0': ['src/main.ts'] } });
  assert.equal(
    decide({
      head: 'v1.1.0',
      nativeBuild: NATIVE,
      bundleSha: 'bbb2222',
      execFileSyncFn: stale.execFileSyncFn,
    }).ota.deploy,
    true
  );
});

test('without a usable recorded build, TestFlight ships web changes too', () => {
  const { execFileSyncFn } = fakeGit({
    ranges: { 'v1.0.0..v1.1.0': ['src/main.ts', 'server/src/app.ts'] },
  });

  const unset = decide({ head: 'v1.1.0', execFileSyncFn });
  assert.deepEqual(unset.testflight, { deploy: true, paths: ['src/main.ts'] });
  assert.match(unset.ota.skippedReason, /No OTA-capable TestFlight build/);

  const unknown = decide({ head: 'v1.1.0', nativeBuild: '5@ccc3333', execFileSyncFn });
  assert.equal(unknown.testflight.deploy, true);
  assert.match(unknown.ota.skippedReason, /isn't in this repository's history/);
});

test('OTA failures skip with a reason instead of failing the gate', () => {
  const { execFileSyncFn } = fakeGit({
    ranges: { 'aaa1111..v1.1.0': ['src/main.ts'] },
    ancestry: ['aaa1111..bbb2222'],
  });

  const { ota } = decide({
    head: 'v1.1.0',
    nativeBuild: NATIVE,
    bundleSha: 'bbb2222',
    execFileSyncFn,
  });

  assert.equal(ota.deploy, false);
  assert.match(ota.skippedReason, /OTA check failed: unexpected range bbb2222\.\.v1\.1\.0/);
});

test('server, docs, and version-only releases do nothing', () => {
  const pkg = (version) => ({ name: 'pokepaper', version, dependencies: { rxjs: '~7.8.2' } });
  const { execFileSyncFn } = fakeGit({
    ranges: {
      'aaa1111..v1.1.0': ['package.json', PBXPROJ_PATH, 'CHANGELOG.md', 'server/src/app.ts'],
    },
    files: {
      'aaa1111:package.json': pkg('1.0.0'),
      'v1.1.0:package.json': pkg('1.1.0'),
    },
    diffs: {
      [PBXPROJ_PATH]: '-\t\t\t\tMARKETING_VERSION = 1.0.0;\n+\t\t\t\tMARKETING_VERSION = 1.1.0;\n',
    },
  });

  const { testflight, ota } = decide({ head: 'v1.1.0', nativeBuild: NATIVE, execFileSyncFn });

  assert.equal(testflight.deploy, false);
  assert.equal(ota.deploy, false);
});

test('the first release ships TestFlight only, without diffing', () => {
  const { execFileSyncFn, calls } = fakeGit({ tags: 'v0.1.0\n' });

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
      '--native-build',
      '5@abc1234',
      '--bundle-sha',
      'def5678',
      '--github-output',
      '/tmp/o',
    ]),
    {
      head: 'v1.1.0',
      base: 'v1.0.0',
      nativeBuild: '5@abc1234',
      bundleSha: 'def5678',
      githubOutput: '/tmp/o',
    }
  );
  assert.equal(parseArgs([]).head, 'HEAD');
  assert.throws(() => parseArgs(['--head']), /--head must be a non-empty ref/);
  assert.throws(() => parseArgs(['--bogus']), /Unknown argument/);
});
