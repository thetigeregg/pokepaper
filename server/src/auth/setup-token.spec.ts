import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIN_SETUP_TOKEN_LENGTH, readSetupToken, setupTokenMatches } from './setup-token.js';
import { constantTimeEquals } from './tokens.js';

const TOKEN = 'a'.repeat(MIN_SETUP_TOKEN_LENGTH);

describe('setup token', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pokepaper-setup-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads a literal token', () => {
    expect(readSetupToken({ setupToken: TOKEN, setupTokenFile: null })).toBe(TOKEN);
  });

  it('prefers the file, re-reading it on every call', () => {
    const file = join(dir, 'setup_token');
    writeFileSync(file, `${TOKEN}\n`);
    const config = { setupToken: 'literal-token-ignored-here', setupTokenFile: file };

    expect(readSetupToken(config)).toBe(TOKEN);

    rmSync(file);
    expect(readSetupToken(config)).toBeNull();
  });

  it('ignores tokens shorter than the minimum', () => {
    expect(readSetupToken({ setupToken: 'short', setupTokenFile: null })).toBeNull();
  });

  it('is unavailable when nothing is configured', () => {
    expect(readSetupToken({ setupToken: null, setupTokenFile: null })).toBeNull();
  });

  it('matches only the exact token', () => {
    const config = { setupToken: TOKEN, setupTokenFile: null };

    expect(setupTokenMatches(config, TOKEN)).toBe(true);
    expect(setupTokenMatches(config, `${TOKEN}x`)).toBe(false);
    expect(setupTokenMatches(config, undefined)).toBe(false);
    expect(setupTokenMatches({ setupToken: null, setupTokenFile: null }, TOKEN)).toBe(false);
  });

  it('compares strings in constant time without length leaks', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true);
    expect(constantTimeEquals('abc', 'abcd')).toBe(false);
  });
});
