#!/usr/bin/env node
/**
 * Decides whether a release changes what goes into a Docker image, so CI only
 * rebuilds and republishes images whose inputs changed since the previous
 * release tag.
 *
 *   node scripts/image-should-publish.mjs --image server --head v1.2.0 [--github-output $GITHUB_OUTPUT] [--force]
 *
 * One script for both images (go-gather has a near-copy per image). Each rule
 * lists every input of that image's Dockerfile, including the lockfile and
 * .nvmrc (whose version the Dockerfile base images must match).
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { listChangedFiles, resolvePreviousTag, writeGithubOutput } from './release-diff.mjs';

const SHARED_ROOT_FILES = ['package.json', 'package-lock.json', '.nvmrc'];

export const IMAGE_RULES = {
  server: {
    prefixes: ['server/', 'shared/'],
    files: new Set(SHARED_ROOT_FILES),
  },
  edge: {
    prefixes: ['edge/', 'src/', 'public/', 'shared/'],
    files: new Set([
      ...SHARED_ROOT_FILES,
      'angular.json',
      'tsconfig.json',
      'tsconfig.app.json',
      'ionic.config.json',
      'ngsw-config.json',
      '.browserslistrc',
    ]),
  },
};

export function matchesImagePath(image, filePath) {
  const rule = IMAGE_RULES[image];
  if (!rule) {
    throw new Error(
      `Unknown image "${image}" (expected one of: ${Object.keys(IMAGE_RULES).join(', ')})`
    );
  }
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    return false;
  }

  const normalized = filePath.replace(/\\/g, '/');
  return (
    rule.files.has(normalized) || rule.prefixes.some((prefix) => normalized.startsWith(prefix))
  );
}

export function evaluateImagePublish({
  image,
  changedFiles = [],
  hasPreviousTag = true,
  force = false,
}) {
  if (force) {
    return { shouldPublish: true, matchedPaths: ['force'], changedFiles };
  }
  if (!hasPreviousTag) {
    return { shouldPublish: true, matchedPaths: ['no-previous-tag'], changedFiles };
  }

  const matchedPaths = changedFiles
    .filter((filePath) => matchesImagePath(image, filePath))
    .map((filePath) => filePath.replace(/\\/g, '/'));
  return { shouldPublish: matchedPaths.length > 0, matchedPaths, changedFiles };
}

export function parseArgs(argv) {
  const args = { image: null, head: 'HEAD', base: undefined, githubOutput: null, force: false };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = () => {
      index += 1;
      return argv[index] ?? null;
    };

    if (value === '--image') args.image = next();
    else if (value === '--head') args.head = next() ?? 'HEAD';
    else if (value === '--base') args.base = next();
    else if (value === '--github-output') args.githubOutput = next();
    else if (value === '--force') args.force = true;
    else throw new Error(`Unknown argument "${value}"`);
  }

  if (!args.image) {
    throw new Error('--image is required');
  }
  return args;
}

/** Resolves the previous tag (unless `base` is given) and evaluates the changed files. */
export function decide({
  image,
  head,
  base,
  force = false,
  execFileSyncFn = execFileSync,
  cwd = process.cwd(),
}) {
  matchesImagePath(image, 'validate-image-name');
  if (force) {
    return evaluateImagePublish({ image, force: true });
  }

  const previous = base === undefined ? resolvePreviousTag(head, { execFileSyncFn, cwd }) : base;
  const hasPreviousTag = typeof previous === 'string' && previous.trim().length > 0;
  const changedFiles = listChangedFiles({
    base: hasPreviousTag ? previous : null,
    head,
    execFileSyncFn,
    cwd,
  });
  return evaluateImagePublish({ image, changedFiles, hasPreviousTag });
}

function main() {
  const tag = '[image-should-publish]';
  try {
    const args = parseArgs(process.argv.slice(2));
    const decision = decide(args);

    console.log(`${tag} image=${args.image} should_publish=${decision.shouldPublish}`);
    console.log(`${tag} changed_files=${decision.changedFiles.length}`);
    if (decision.matchedPaths.length > 0) {
      console.log(`${tag} matched_paths=${decision.matchedPaths.join(',')}`);
    }

    if (args.githubOutput) {
      writeGithubOutput(args.githubOutput, {
        should_publish: String(decision.shouldPublish),
        matched_paths: decision.matchedPaths.join(','),
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
