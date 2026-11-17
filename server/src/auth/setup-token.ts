import { readFileSync } from 'node:fs';
import type { AuthConfig } from '../config.js';
import { constantTimeEquals } from './tokens.js';

/** Shorter tokens are ignored (treated as not configured). */
export const MIN_SETUP_TOKEN_LENGTH = 16;

/**
 * The configured setup token, or null. The file is re-read on every call, so
 * deleting it after the first passkey is registered disables setup without
 * a restart.
 */
export function readSetupToken(
  config: Pick<AuthConfig, 'setupToken' | 'setupTokenFile'>
): string | null {
  let token = config.setupToken;
  if (config.setupTokenFile) {
    try {
      token = readFileSync(config.setupTokenFile, 'utf8').trim();
    } catch {
      token = null;
    }
  }

  return token && token.length >= MIN_SETUP_TOKEN_LENGTH ? token : null;
}

export function setupTokenMatches(
  config: Pick<AuthConfig, 'setupToken' | 'setupTokenFile'>,
  candidate: string | undefined
): boolean {
  const expected = readSetupToken(config);
  return (
    expected !== null && typeof candidate === 'string' && constantTimeEquals(candidate, expected)
  );
}
