import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PBXPROJ_PATH,
  decide,
  evaluateTestFlightDeploy,
  matchesAppPath,
  parseArgs,
  pbxprojDiffIsMarketingVersionOnly,
} from './ios-testflight-should-deploy.mjs';

test('app inputs: web app, shared types, native shell, and iOS build tooling', () => {
  for (const filePath of [
    'src/app/core/auth/auth.service.ts',
    'shared/src/sync.ts',
    'public/favicon.svg',
    'ios/App/App/Info.shared.plist',
    'ios/fastlane/Fastfile',
    'capacitor.config.ts',
    'angular.json',
    'scripts/write-environment-ios.mjs',
    '.github/workflows/ios-testflight.yml',
    'src\\main.ts',
  ]) {
    assert.equal(matchesAppPath(filePath), true, filePath);
  }
});

test('not app inputs: server, edge, docs, CI, and unrelated scripts', () => {
  for (const filePath of [
    'server/src/app.ts',
    'edge/Caddyfile',
    'docs/ios.md',
    'README.md',
    'CHANGELOG.md',
    '.github/workflows/ci-pr.yml',
    'scripts/image-should-publish.mjs',
    'ngsw-config.json',
    '',
  ]) {
    assert.equal(matchesAppPath(filePath), false, filePath);
  }
});

test('deploys when app inputs changed, skips otherwise, always on the first release', () => {
  assert.deepEqual(
    evaluateTestFlightDeploy({ changedFiles: ['server/src/app.ts', 'src/main.ts'] }),
    {
      shouldDeploy: true,
      matchedPaths: ['src/main.ts'],
      changedFiles: ['server/src/app.ts', 'src/main.ts'],
    }
  );
  assert.equal(
    evaluateTestFlightDeploy({ changedFiles: ['server/src/app.ts', 'docs/ios.md'] }).shouldDeploy,
    false
  );
  assert.deepEqual(evaluateTestFlightDeploy({ hasPreviousTag: false }).matchedPaths, [
    'no-previous-tag',
  ]);
});

const MARKETING_ONLY_PBXPROJ = [
  `--- a/${PBXPROJ_PATH}`,
  `+++ b/${PBXPROJ_PATH}`,
  '-\t\t\t\tMARKETING_VERSION = 0.15.0;',
  '+\t\t\t\tMARKETING_VERSION = 0.16.0;',
  '-\t\t\t\tMARKETING_VERSION = 0.15.0;',
  '+\t\t\t\tMARKETING_VERSION = 0.16.0;',
].join('\n');

test('recognizes a project.pbxproj diff that only changes MARKETING_VERSION', () => {
  assert.equal(pbxprojDiffIsMarketingVersionOnly(MARKETING_ONLY_PBXPROJ), true);
  assert.equal(
    pbxprojDiffIsMarketingVersionOnly(
      `${MARKETING_ONLY_PBXPROJ}\n+\t\t\t\tCODE_SIGN_ENTITLEMENTS = App/App.prod.entitlements;`
    ),
    false
  );
  assert.equal(pbxprojDiffIsMarketingVersionOnly(''), false);
});

test('parses arguments', () => {
  assert.deepEqual(
    parseArgs(['--head', 'v1.1.0', '--base', 'v1.0.0', '--github-output', '/tmp/out']),
    { head: 'v1.1.0', base: 'v1.0.0', githubOutput: '/tmp/out' }
  );
  assert.equal(parseArgs([]).head, 'HEAD');
  assert.throws(() => parseArgs(['--head']), /--head must be a non-empty ref/);
  assert.throws(() => parseArgs(['--bogus']), /Unknown argument/);
});

function releaseGit({ tags = 'v1.1.0\nv1.0.0\n', changed, diffs = {} }) {
  const calls = [];
  const execFileSyncFn = (_cmd, args) => {
    calls.push(args);
    if (args[0] === 'tag') return tags;
    if (args.includes('--name-only')) return changed.join('\n');
    return diffs[args.at(-1)] ?? '';
  };
  return { execFileSyncFn, calls };
}

const VERSION_ONLY_PKG =
  '--- a/package.json\n+++ b/package.json\n-  "version": "1.0.0",\n+  "version": "1.1.0",\n';

test('decide resolves the previous tag and diffs against it', () => {
  const { execFileSyncFn, calls } = releaseGit({ changed: ['src/main.ts'] });

  const decision = decide({ head: 'v1.1.0', execFileSyncFn });

  assert.equal(decision.shouldDeploy, true);
  assert.deepEqual(calls[1], ['diff', '--name-only', 'v1.0.0..v1.1.0']);
});

test('a release that only bumps versions (manifests, Xcode project) deploys nothing', () => {
  const { execFileSyncFn } = releaseGit({
    changed: ['package.json', 'CHANGELOG.md', PBXPROJ_PATH, 'server/src/app.ts'],
    diffs: { 'package.json': VERSION_ONLY_PKG, [PBXPROJ_PATH]: MARKETING_ONLY_PBXPROJ },
  });

  assert.equal(decide({ head: 'v1.1.0', execFileSyncFn }).shouldDeploy, false);
});

test('a dependency change or a real Xcode project change deploys', () => {
  const dependency = releaseGit({
    changed: ['package.json'],
    diffs: {
      'package.json': `${VERSION_ONLY_PKG}-    "@capacitor/core": "^8.6.2",\n+    "@capacitor/core": "^8.7.0",\n`,
    },
  });
  assert.deepEqual(
    decide({ head: 'v1.1.0', execFileSyncFn: dependency.execFileSyncFn }).matchedPaths,
    ['package.json']
  );

  const project = releaseGit({
    changed: [PBXPROJ_PATH],
    diffs: {
      [PBXPROJ_PATH]: `${MARKETING_ONLY_PBXPROJ}\n+\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = 16.0;`,
    },
  });
  assert.deepEqual(
    decide({ head: 'v1.1.0', execFileSyncFn: project.execFileSyncFn }).matchedPaths,
    [PBXPROJ_PATH]
  );
});

test('decide deploys on the first release without diffing, and honors an explicit base', () => {
  const first = releaseGit({ tags: 'v0.1.0\n', changed: [] });
  const decision = decide({ head: 'v0.1.0', execFileSyncFn: first.execFileSyncFn });
  assert.equal(decision.shouldDeploy, true);
  assert.deepEqual(
    first.calls.map((args) => args[0]),
    ['tag']
  );

  const explicit = releaseGit({ changed: ['edge/Caddyfile'] });
  assert.equal(
    decide({ head: 'v1.1.0', base: 'v0.9.0', execFileSyncFn: explicit.execFileSyncFn })
      .shouldDeploy,
    false
  );
  assert.deepEqual(explicit.calls[0], ['diff', '--name-only', 'v0.9.0..v1.1.0']);
});
