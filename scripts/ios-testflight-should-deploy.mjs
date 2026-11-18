#!/usr/bin/env node
/**
 * Decides whether a release changes what goes into the iOS app, so the
 * TestFlight workflow only builds and uploads App PROD when it does.
 *
 *   node scripts/ios-testflight-should-deploy.mjs --head v1.2.0 [--base v1.1.0] [--github-output $GITHUB_OUTPUT]
 *
 * Unlike go-gather, PokePaper has no over-the-air web updates: the web app is
 * bundled into the iOS app, so web changes (src/, shared/, …) need a new
 * TestFlight build too. Server, edge, docs, and CI-only releases don't.
 *
 * Like scripts/image-should-publish.mjs, the root package.json and
 * package-lock.json only count when something other than `version` changed,
 * and so does project.pbxproj: builds copy the release version into its
 * MARKETING_VERSION, so a version-only change there isn't an app change.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  diffLines,
  listChangedFiles,
  manifestDiffHasNonVersionChanges,
  readManifestDiff,
  resolvePreviousTag,
  writeGithubOutput,
} from './release-diff.mjs';

/** Root manifests whose `version` field every release bumps. */
export const VERSIONED_MANIFESTS = ['package.json', 'package-lock.json'];

export const PBXPROJ_PATH = 'ios/App/App.xcodeproj/project.pbxproj';

/** Everything that ends up in, or decides how we build, the App PROD bundle. */
export const APP_RULE = {
  prefixes: ['ios/', 'src/', 'public/', 'shared/'],
  files: new Set([
    ...VERSIONED_MANIFESTS,
    '.nvmrc',
    'angular.json',
    'tsconfig.json',
    'tsconfig.app.json',
    'ionic.config.json',
    '.browserslistrc',
    'capacitor.config.ts',
    'scripts/write-environment-ios.mjs',
    'scripts/lan-host.mjs',
    'scripts/generate-ios-info-plists.mjs',
    'scripts/sync-ios-version.mjs',
    '.github/workflows/ios-testflight.yml',
  ]),
};

const MARKETING_VERSION_LINE = /^\t*MARKETING_VERSION = [^;]+;$/;

export function matchesAppPath(filePath) {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    return false;
  }
  const normalized = filePath.replace(/\\/g, '/');
  return (
    APP_RULE.files.has(normalized) ||
    APP_RULE.prefixes.some((prefix) => normalized.startsWith(prefix))
  );
}

/** True when a project.pbxproj diff only changes MARKETING_VERSION lines. */
export function pbxprojDiffIsMarketingVersionOnly(diff) {
  const lines = diffLines(diff);
  return lines.length > 0 && lines.every((line) => MARKETING_VERSION_LINE.test(line.slice(1)));
}

export function evaluateTestFlightDeploy({ changedFiles = [], hasPreviousTag = true } = {}) {
  if (!hasPreviousTag) {
    return { shouldDeploy: true, matchedPaths: ['no-previous-tag'], changedFiles };
  }

  const matchedPaths = changedFiles
    .filter((filePath) => matchesAppPath(filePath))
    .map((filePath) => filePath.replace(/\\/g, '/'));
  return { shouldDeploy: matchedPaths.length > 0, matchedPaths, changedFiles };
}

export function parseArgs(argv) {
  const args = { head: 'HEAD', base: undefined, githubOutput: null };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = () => {
      index += 1;
      return argv[index] ?? null;
    };

    if (value === '--head') args.head = next();
    else if (value === '--base') args.base = next();
    else if (value === '--github-output') args.githubOutput = next();
    else throw new Error(`Unknown argument "${value}"`);
  }

  if (typeof args.head !== 'string' || args.head.trim().length === 0) {
    throw new Error('--head must be a non-empty ref (e.g. the release tag)');
  }
  return args;
}

/**
 * Resolves the previous tag (unless `base` is given) and evaluates the
 * changed files, ignoring version-only changes to the manifests and the
 * Xcode project.
 */
export function decide({ head, base, execFileSyncFn = execFileSync, cwd = process.cwd() }) {
  const previous = base === undefined ? resolvePreviousTag(head, { execFileSyncFn, cwd }) : base;
  if (typeof previous !== 'string' || previous.trim().length === 0) {
    // First release: deploy without diffing (the first tag may sit on a root commit).
    return evaluateTestFlightDeploy({ hasPreviousTag: false });
  }

  const diffOf = (filePath) =>
    readManifestDiff({ base: previous, head, paths: [filePath], execFileSyncFn, cwd });

  const changedFiles = listChangedFiles({ base: previous, head, execFileSyncFn, cwd }).filter(
    (filePath) => {
      if (VERSIONED_MANIFESTS.includes(filePath)) {
        return manifestDiffHasNonVersionChanges(diffOf(filePath));
      }
      if (filePath === PBXPROJ_PATH) {
        return !pbxprojDiffIsMarketingVersionOnly(diffOf(filePath));
      }
      return true;
    }
  );
  return evaluateTestFlightDeploy({ changedFiles, hasPreviousTag: true });
}

function main() {
  const tag = '[ios-testflight-should-deploy]';
  try {
    const args = parseArgs(process.argv.slice(2));
    const decision = decide(args);

    console.log(`${tag} should_deploy=${decision.shouldDeploy}`);
    console.log(`${tag} changed_files=${decision.changedFiles.length}`);
    if (decision.matchedPaths.length > 0) {
      console.log(`${tag} matched_paths=${decision.matchedPaths.join(',')}`);
    }

    if (args.githubOutput) {
      writeGithubOutput(args.githubOutput, {
        should_deploy: String(decision.shouldDeploy),
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
