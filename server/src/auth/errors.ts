/** An auth failure with the HTTP status and client-safe message to return. */
export class AuthError extends Error {
  override readonly name = 'AuthError';

  constructor(
    readonly statusCode: 400 | 401 | 403 | 404 | 409,
    message: string
  ) {
    super(message);
  }
}
