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
 * .nvmrc (whose version the Dockerfile base images must match). The root
 * package.json / package-lock.json only count when something other than the
 * `version` changed: every release bumps the version, which isn't an input.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  listChangedFiles,
  manifestDiffHasNonVersionChanges,
  readManifestDiff,
  resolvePreviousTag,
  writeGithubOutput,
} from './release-diff.mjs';

/** Root manifests whose `version` field every release bumps. */
export const VERSIONED_MANIFESTS = ['package.json', 'package-lock.json'];

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
      // edge/Dockerfile copies it so npm ci sees the workspace layout.
      'server/package.json',
      'angular.json',
      'tsconfig.json',
      'tsconfig.app.json',
      'ionic.config.json',
      'ngsw-config.json',
      '.browserslistrc',
      // The OTA stage (docs/ios.md -> OTA updates) runs these.
      'scripts/ios-live-update-common.mjs',
      'scripts/build-ios-live-update-artifacts.mjs',
      'scripts/write-environment-ios.mjs',
      'scripts/lan-host.mjs',
      'scripts/sync-ios-version.mjs',
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
    else if (value === '--head') args.head = next();
    else if (value === '--base') args.base = next();
    else if (value === '--github-output') args.githubOutput = next();
    else if (value === '--force') args.force = true;
    else throw new Error(`Unknown argument "${value}"`);
  }

  if (!args.image) {
    throw new Error('--image is required');
  }
  if (typeof args.head !== 'string' || args.head.trim().length === 0) {
    throw new Error('--head must be a non-empty ref (e.g. the release tag)');
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
  if (typeof previous !== 'string' || previous.trim().length === 0) {
    // First release: publish without diffing (the first tag may sit on a root commit).
    return evaluateImagePublish({ image, hasPreviousTag: false });
  }

  const changedFiles = listChangedFiles({ base: previous, head, execFileSyncFn, cwd }).filter(
    (filePath) =>
      !VERSIONED_MANIFESTS.includes(filePath) ||
      manifestDiffHasNonVersionChanges(
        readManifestDiff({ base: previous, head, paths: [filePath], execFileSyncFn, cwd })
      )
  );
  return evaluateImagePublish({ image, changedFiles, hasPreviousTag: true });
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
