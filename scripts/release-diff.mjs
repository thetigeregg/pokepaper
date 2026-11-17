import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const GIT_OPTIONS = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };

/** Files changed between two refs (or in `head` alone when there's no base). Ported from go-gather. */
export function listChangedFiles({
  base,
  head,
  execFileSyncFn = execFileSync,
  cwd = process.cwd(),
}) {
  const range = base ? `${base}..${head}` : `${head}^..${head}`;
  const output = execFileSyncFn('git', ['diff', '--name-only', range], { cwd, ...GIT_OPTIONS });

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** `v*` tags, newest version first. */
export function listVersionTags({ execFileSyncFn = execFileSync, cwd = process.cwd() } = {}) {
  const output = execFileSyncFn('git', ['tag', '--list', 'v*', '--sort=-v:refname'], {
    cwd,
    ...GIT_OPTIONS,
  });

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** The release tag before `currentTag`, or null for the first release. */
export function resolvePreviousTag(
  currentTag,
  { execFileSyncFn = execFileSync, cwd = process.cwd() } = {}
) {
  if (typeof currentTag !== 'string' || currentTag.trim().length === 0) {
    return null;
  }

  const tags = listVersionTags({ execFileSyncFn, cwd });
  const index = tags.indexOf(currentTag);
  return index >= 0 && index < tags.length - 1 ? tags[index + 1] : null;
}

export function writeGithubOutput(outputPath, values) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  appendFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
}
