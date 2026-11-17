import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  listChangedFiles,
  listVersionTags,
  resolvePreviousTag,
  writeGithubOutput,
} from './release-diff.mjs';

function fakeGit(output) {
  const calls = [];
  const execFileSyncFn = (...args) => {
    calls.push(args);
    return output;
  };
  return { calls, execFileSyncFn };
}

test('listChangedFiles diffs a range, or the head commit alone without a base', () => {
  const ranged = fakeGit('src/a.ts\n\n server/b.ts \n');
  assert.deepEqual(listChangedFiles({ base: 'v1.0.0', head: 'v1.1.0', ...ranged, cwd: '/repo' }), [
    'src/a.ts',
    'server/b.ts',
  ]);
  assert.deepEqual(ranged.calls[0].slice(0, 2), ['git', ['diff', '--name-only', 'v1.0.0..v1.1.0']]);
  assert.equal(ranged.calls[0][2].cwd, '/repo');

  const single = fakeGit('');
  assert.deepEqual(listChangedFiles({ base: null, head: 'v1.0.0', ...single }), []);
  assert.deepEqual(single.calls[0][1], ['diff', '--name-only', 'v1.0.0^..v1.0.0']);
});

test('listVersionTags lists v* tags newest first', () => {
  const git = fakeGit('v1.2.0\nv1.1.0\n');
  assert.deepEqual(listVersionTags(git), ['v1.2.0', 'v1.1.0']);
  assert.deepEqual(git.calls[0][1], ['tag', '--list', 'v*', '--sort=-v:refname']);
});

test('resolvePreviousTag finds the tag before the current one', () => {
  const { execFileSyncFn } = fakeGit('v1.2.0\nv1.1.0\nv1.0.0\n');

  assert.equal(resolvePreviousTag('v1.2.0', { execFileSyncFn }), 'v1.1.0');
  assert.equal(resolvePreviousTag('v1.0.0', { execFileSyncFn }), null);
  assert.equal(resolvePreviousTag('v9.9.9', { execFileSyncFn }), null);
  assert.equal(resolvePreviousTag('', { execFileSyncFn }), null);
});

test('writeGithubOutput appends key=value lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gh-output-'));
  const file = join(dir, 'out');
  try {
    writeGithubOutput(file, { a: '1' });
    writeGithubOutput(file, { b: 'x,y', c: 'true' });
    assert.equal(readFileSync(file, 'utf8'), 'a=1\nb=x,y\nc=true\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
