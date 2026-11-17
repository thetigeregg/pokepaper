import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 32 random bytes, base64url: the session bearer secret. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Random public identifier (session ids shown in lists). */
export function generateId(): string {
  return randomBytes(12).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time string comparison (hashes first, so lengths don't leak either). */
export function constantTimeEquals(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest()
  );
}
