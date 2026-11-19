import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decide,
  evaluateImagePublish,
  matchesImagePath,
  parseArgs,
} from './image-should-publish.mjs';

test('server image inputs', () => {
  for (const path of [
    'server/src/app.ts',
    'shared/src/sync.ts',
    'package-lock.json',
    'package.json',
    '.nvmrc',
  ]) {
    assert.equal(matchesImagePath('server', path), true, path);
  }
  for (const path of ['src/main.ts', 'edge/Caddyfile', 'docs/auth.md', 'README.md', '']) {
    assert.equal(matchesImagePath('server', path), false, path);
  }
});

test('edge image inputs', () => {
  for (const path of [
    'edge/Caddyfile',
    'src/app/app.routes.ts',
    'public/favicon.svg',
    'shared/src/auth.ts',
    'angular.json',
    'ngsw-config.json',
    'package-lock.json',
    '.browserslistrc',
    'server/package.json',
    'scripts/build-ios-live-update-artifacts.mjs',
    'scripts/write-environment-ios.mjs',
  ]) {
    assert.equal(matchesImagePath('edge', path), true, path);
  }
  for (const path of [
    'server/src/app.ts',
    'docs/nas-deployment.md',
    'tsconfig.spec.json',
    'scripts/x.mjs',
  ]) {
    assert.equal(matchesImagePath('edge', path), false, path);
  }
});

test('normalizes Windows separators', () => {
  assert.equal(matchesImagePath('server', 'server\\src\\app.ts'), true);
});

test('rejects unknown images', () => {
  assert.throws(() => matchesImagePath('worker', 'x'), /Unknown image "worker"/);
});

test('publishes when inputs changed, skips otherwise', () => {
  assert.deepEqual(
    evaluateImagePublish({ image: 'server', changedFiles: ['docs/a.md', 'server/src/b.ts'] }),
    {
      shouldPublish: true,
      matchedPaths: ['server/src/b.ts'],
      changedFiles: ['docs/a.md', 'server/src/b.ts'],
    }
  );
  assert.equal(
    evaluateImagePublish({ image: 'server', changedFiles: ['docs/a.md'] }).shouldPublish,
    false
  );
});

test('always publishes on the first release or when forced', () => {
  assert.deepEqual(evaluateImagePublish({ image: 'edge', hasPreviousTag: false }).matchedPaths, [
    'no-previous-tag',
  ]);
  assert.deepEqual(evaluateImagePublish({ image: 'edge', force: true }).matchedPaths, ['force']);
});

test('parses arguments', () => {
  assert.deepEqual(
    parseArgs(['--image', 'edge', '--head', 'v1.0.0', '--github-output', '/tmp/o', '--force']),
    {
      image: 'edge',
      head: 'v1.0.0',
      base: undefined,
      githubOutput: '/tmp/o',
      force: true,
    }
  );
  assert.throws(() => parseArgs(['--head', 'v1']), /--image is required/);
  assert.throws(
    () => parseArgs(['--image', 'edge', '--head', '']),
    /--head must be a non-empty ref/
  );
  assert.throws(() => parseArgs(['--image', 'edge', '--head']), /--head must be a non-empty ref/);
  assert.throws(() => parseArgs(['--image', 'edge', '--bogus']), /Unknown argument/);
});

test('decide resolves the previous tag and diffs against it', () => {
  const calls = [];
  const execFileSyncFn = (_cmd, args) => {
    calls.push(args);
    if (args[0] === 'tag') return 'v1.1.0\nv1.0.0\n';
    return 'src/main.ts\n';
  };

  const edge = decide({ image: 'edge', head: 'v1.1.0', execFileSyncFn });
  const server = decide({ image: 'server', head: 'v1.1.0', execFileSyncFn });

  assert.equal(edge.shouldPublish, true);
  assert.equal(server.shouldPublish, false);
  assert.deepEqual(calls[1], ['diff', '--name-only', 'v1.0.0..v1.1.0']);
});

test('decide publishes everything on the first release, without diffing', () => {
  const calls = [];
  const execFileSyncFn = (_cmd, args) => {
    calls.push(args);
    if (args[0] === 'tag') return 'v0.1.0\n';
    throw new Error('v0.1.0^ does not exist (root commit)');
  };

  const decision = decide({ image: 'server', head: 'v0.1.0', execFileSyncFn });

  assert.equal(decision.shouldPublish, true);
  assert.deepEqual(decision.matchedPaths, ['no-previous-tag']);
  assert.deepEqual(
    calls.map((args) => args[0]),
    ['tag']
  );
});

function releaseGit({ changed, manifestDiffs }) {
  return (_cmd, args) => {
    if (args[0] === 'tag') return 'v1.1.0\nv1.0.0\n';
    if (args.includes('--name-only')) return changed.join('\n');
    return manifestDiffs[args.at(-1)] ?? '';
  };
}

const VERSION_ONLY_PKG =
  '--- a/package.json\n+++ b/package.json\n-  "version": "1.0.0",\n+  "version": "1.1.0",\n';
const VERSION_ONLY_LOCK =
  '--- a/package-lock.json\n+++ b/package-lock.json\n-  "version": "1.0.0",\n+  "version": "1.1.0",\n-      "version": "1.0.0",\n+      "version": "1.1.0",\n';

test('a release that only bumps the version publishes nothing', () => {
  const execFileSyncFn = releaseGit({
    changed: ['docs/auth.md', 'package.json', 'package-lock.json', 'CHANGELOG.md'],
    manifestDiffs: { 'package.json': VERSION_ONLY_PKG, 'package-lock.json': VERSION_ONLY_LOCK },
  });

  assert.equal(decide({ image: 'server', head: 'v1.1.0', execFileSyncFn }).shouldPublish, false);
  assert.equal(decide({ image: 'edge', head: 'v1.1.0', execFileSyncFn }).shouldPublish, false);
});

test('a dependency change in the manifests publishes both images', () => {
  const execFileSyncFn = releaseGit({
    changed: ['package.json', 'package-lock.json'],
    manifestDiffs: {
      'package.json': VERSION_ONLY_PKG,
      'package-lock.json':
        VERSION_ONLY_LOCK +
        '-      "resolved": "https://r/x-1.tgz",\n+      "resolved": "https://r/x-2.tgz",\n',
    },
  });

  assert.deepEqual(decide({ image: 'server', head: 'v1.1.0', execFileSyncFn }).matchedPaths, [
    'package-lock.json',
  ]);
  assert.equal(decide({ image: 'edge', head: 'v1.1.0', execFileSyncFn }).shouldPublish, true);
});

test('decide honors an explicit base and force, and validates the image first', () => {
  const execFileSyncFn = (_cmd, args) => (args[0] === 'tag' ? '' : 'edge/Caddyfile\n');

  assert.equal(
    decide({ image: 'edge', head: 'HEAD', base: 'v1.0.0', execFileSyncFn }).shouldPublish,
    true
  );
  assert.equal(
    decide({ image: 'server', head: 'HEAD', force: true, execFileSyncFn }).shouldPublish,
    true
  );
  assert.throws(() => decide({ image: 'nope', head: 'HEAD', execFileSyncFn }), /Unknown image/);
});
