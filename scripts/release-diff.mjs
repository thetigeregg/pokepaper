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

/** Unified diff of `paths` between two refs (or in `head` alone without a base). Ported from go-gather. */
export function readManifestDiff({
  base,
  head,
  paths,
  execFileSyncFn = execFileSync,
  cwd = process.cwd(),
}) {
  const range = base ? `${base}..${head}` : `${head}^..${head}`;
  return execFileSyncFn('git', ['diff', range, '--', ...paths], { cwd, ...GIT_OPTIONS });
}

/** Added/removed lines of a unified diff, excluding the file headers. */
export function diffLines(diff) {
  if (typeof diff !== 'string' || diff.trim().length === 0) {
    return [];
  }
  return diff
    .split('\n')
    .filter((line) => line.startsWith('+') || line.startsWith('-'))
    .filter((line) => !line.startsWith('+++') && !line.startsWith('---'));
}

/**
 * True when a manifest diff changes anything besides `"version"` fields. A
 * release only bumps versions; dependency changes also touch other lines
 * (dependency ranges in package.json; `resolved`/`integrity` in the lockfile).
 */
export function manifestDiffHasNonVersionChanges(diff) {
  return diffLines(diff).some((line) => !/^[+-]\s*"version":/.test(line));
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
