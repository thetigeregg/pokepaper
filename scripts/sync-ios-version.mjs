import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROD_BUNDLE_ID = 'io.github.thetigeregg.poketcg';
const DEFAULT_PBXPROJ_PATH = resolve(REPO_ROOT, 'ios/App/App.xcodeproj/project.pbxproj');
const DEFAULT_PACKAGE_JSON_PATH = resolve(REPO_ROOT, 'package.json');

export function readPackageVersion(
  packageJsonPath = DEFAULT_PACKAGE_JSON_PATH,
  readFileSyncFn = readFileSync
) {
  const packageJson = JSON.parse(readFileSyncFn(packageJsonPath, 'utf8'));

  if (typeof packageJson.version !== 'string' || packageJson.version.trim().length === 0) {
    throw new Error(`Missing version in ${packageJsonPath}`);
  }

  return packageJson.version.trim();
}

export function updateAllMarketingVersionsInPbxproj(content, { marketingVersion } = {}) {
  if (typeof marketingVersion !== 'string' || marketingVersion.trim().length === 0) {
    throw new Error('marketingVersion is required');
  }

  const normalizedMarketingVersion = marketingVersion.trim();
  const matches = content.match(/^\t\t\t\tMARKETING_VERSION = .*;$/gm);

  if (!matches || matches.length === 0) {
    throw new Error('No MARKETING_VERSION entries found in project.pbxproj');
  }

  return content.replace(
    /^\t\t\t\tMARKETING_VERSION = .*;$/gm,
    `\t\t\t\tMARKETING_VERSION = ${normalizedMarketingVersion};`
  );
}

export function updateProdTargetVersionsInPbxproj(
  content,
  { marketingVersion, buildNumber, prodBundleId = PROD_BUNDLE_ID } = {}
) {
  if (typeof marketingVersion !== 'string' || marketingVersion.trim().length === 0) {
    throw new Error('marketingVersion is required');
  }

  const normalizedMarketingVersion = marketingVersion.trim();

  if (typeof buildNumber !== 'string' && typeof buildNumber !== 'number') {
    throw new Error('buildNumber is required');
  }

  const normalizedBuildNumber = String(buildNumber).trim();
  if (normalizedBuildNumber.length === 0) {
    throw new Error('buildNumber is required');
  }

  if (!/^\d+$/.test(normalizedBuildNumber) || Number(normalizedBuildNumber) < 1) {
    throw new Error(`buildNumber must be a positive integer, got "${normalizedBuildNumber}"`);
  }

  const blockRegex = /(\t\t\tbuildSettings = \{)([\s\S]*?)(\t\t\t\};)/g;
  let updatedBlocks = 0;

  const updated = content.replace(blockRegex, (match, open, body, close) => {
    if (!body.includes(`PRODUCT_BUNDLE_IDENTIFIER = ${prodBundleId};`)) {
      return match;
    }

    updatedBlocks += 1;

    let updatedBody = body.replace(
      /^\t\t\t\tMARKETING_VERSION = .*;$/m,
      `\t\t\t\tMARKETING_VERSION = ${normalizedMarketingVersion};`
    );
    updatedBody = updatedBody.replace(
      /^\t\t\t\tCURRENT_PROJECT_VERSION = .*;$/m,
      `\t\t\t\tCURRENT_PROJECT_VERSION = ${normalizedBuildNumber};`
    );

    return `${open}${updatedBody}${close}`;
  });

  if (updatedBlocks === 0) {
    throw new Error(`No App PROD build settings found for bundle id ${prodBundleId}`);
  }

  return updated;
}

export function syncIosMarketingVersion({
  marketingVersion,
  pbxprojPath = DEFAULT_PBXPROJ_PATH,
  writeFileSyncFn = writeFileSync,
  readFileSyncFn = readFileSync,
} = {}) {
  const resolvedMarketingVersion =
    marketingVersion ?? readPackageVersion(DEFAULT_PACKAGE_JSON_PATH, readFileSyncFn);
  const content = readFileSyncFn(pbxprojPath, 'utf8');
  const updated = updateAllMarketingVersionsInPbxproj(content, {
    marketingVersion: resolvedMarketingVersion,
  });

  const changed = updated !== content;
  if (changed) {
    writeFileSyncFn(pbxprojPath, updated, 'utf8');
  }

  const updatedCount = (content.match(/^\t\t\t\tMARKETING_VERSION = .*;$/gm) ?? []).length;

  return {
    marketingVersion: resolvedMarketingVersion,
    pbxprojPath,
    updatedCount,
    changed,
  };
}

export function syncIosProdVersion({
  marketingVersion,
  buildNumber,
  pbxprojPath = DEFAULT_PBXPROJ_PATH,
  writeFileSyncFn = writeFileSync,
  readFileSyncFn = readFileSync,
} = {}) {
  const resolvedMarketingVersion =
    marketingVersion ?? readPackageVersion(DEFAULT_PACKAGE_JSON_PATH, readFileSyncFn);
  const content = readFileSyncFn(pbxprojPath, 'utf8');
  const updated = updateProdTargetVersionsInPbxproj(content, {
    marketingVersion: resolvedMarketingVersion,
    buildNumber,
  });

  const changed = updated !== content;
  if (changed) {
    writeFileSyncFn(pbxprojPath, updated, 'utf8');
  }

  return {
    marketingVersion: resolvedMarketingVersion,
    buildNumber: String(buildNumber),
    pbxprojPath,
    changed,
  };
}

function readOptionValue(argv, index, flag) {
  const optionValue = argv[index + 1];
  if (
    typeof optionValue !== 'string' ||
    optionValue.trim().length === 0 ||
    optionValue.startsWith('--')
  ) {
    throw new Error(`${flag} requires a value`);
  }

  return optionValue.trim();
}

export function parseSyncIosVersionArgs(argv) {
  const args = {
    marketingVersion: null,
    buildNumber: null,
    marketingOnly: false,
    pbxprojPath: DEFAULT_PBXPROJ_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === '--marketing-version') {
      args.marketingVersion = readOptionValue(argv, index, '--marketing-version');
      index += 1;
      continue;
    }

    if (value === '--build-number') {
      args.buildNumber = readOptionValue(argv, index, '--build-number');
      index += 1;
      continue;
    }

    if (value === '--marketing-only') {
      args.marketingOnly = true;
      continue;
    }

    if (value === '--pbxproj') {
      const pbxprojArg = argv[index + 1];
      if (typeof pbxprojArg !== 'string' || pbxprojArg.trim().length === 0) {
        throw new Error('--pbxproj requires a path');
      }

      args.pbxprojPath = resolve(REPO_ROOT, pbxprojArg);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${value}`);
  }

  return args;
}

function main() {
  let args;
  try {
    args = parseSyncIosVersionArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[sync-ios-version] ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  if (args.marketingOnly) {
    try {
      const result = syncIosMarketingVersion({
        marketingVersion: args.marketingVersion ?? undefined,
        pbxprojPath: args.pbxprojPath,
      });

      console.log(
        result.changed
          ? `[sync-ios-version] Updated ${result.updatedCount} MARKETING_VERSION entries to ${result.marketingVersion}`
          : `[sync-ios-version] MARKETING_VERSION already ${result.marketingVersion}`
      );
    } catch (error) {
      console.error(`[sync-ios-version] ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
    return;
  }

  if (!args.buildNumber) {
    console.error('[sync-ios-version] --build-number is required');
    process.exit(1);
  }

  try {
    const result = syncIosProdVersion({
      marketingVersion: args.marketingVersion ?? undefined,
      buildNumber: args.buildNumber,
      pbxprojPath: args.pbxprojPath,
    });

    console.log(
      `[sync-ios-version] Updated App PROD to ${result.marketingVersion} (${result.buildNumber})`
    );
  } catch (error) {
    console.error(`[sync-ios-version] ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  main();
}
