import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const NODE_IMAGE = /^FROM\s+node:(\d+\.\d+\.\d+)(?:-[\w.-]+)?/gm;

function dockerNodeVersions(path) {
  return [...readFileSync(path, 'utf8').matchAll(NODE_IMAGE)].map((match) => match[1]);
}

test('every Dockerfile Node base image matches .nvmrc', () => {
  const expected = readFileSync('.nvmrc', 'utf8').trim();

  for (const dockerfile of ['server/Dockerfile', 'edge/Dockerfile']) {
    const versions = dockerNodeVersions(dockerfile);
    assert.ok(versions.length > 0, `${dockerfile} has no node:<version> base image`);
    for (const version of versions) {
      assert.equal(
        version,
        expected,
        `${dockerfile} uses node:${version} but .nvmrc says ${expected}; bump them together`
      );
    }
  }
});
