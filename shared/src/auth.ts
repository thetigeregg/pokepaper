/** Wire types for passkey authentication (see docs/auth.md). */

/** Web sessions use an httpOnly cookie; the iOS app uses a bearer token. */
export type ClientKind = 'web' | 'ios';

export interface AuthStatusResponse {
  /** At least one passkey exists. */
  registered: boolean;
  /** This request carried a valid session. */
  authenticated: boolean;
  /** No passkey yet and a setup token is configured, so first-time setup is possible. */
  setupAvailable: boolean;
}

export interface RegisterOptionsRequest {
  /** Required for the very first passkey; later passkeys need a signed-in session instead. */
  setupToken?: string;
}

export interface RegisterVerifyRequest {
  /** RegistrationResponseJSON from the authenticator. */
  response: unknown;
  setupToken?: string;
  /** Friendly name shown in the passkey list (e.g. "iPhone"). */
  label?: string;
  client: ClientKind;
}

export interface LoginVerifyRequest {
  /** AuthenticationResponseJSON from the authenticator. */
  response: unknown;
  client: ClientKind;
}

/** Returned when a session is created. `token` is only present for iOS clients. */
export interface SessionCreatedResponse {
  token?: string;
}

export interface RegisterVerifyResponse extends SessionCreatedResponse {
  credential: CredentialSummary;
}

export interface CredentialSummary {
  id: string;
  label: string;
  /** `multiDevice` = synced passkey (e.g. iCloud Keychain). */
  deviceType: 'singleDevice' | 'multiDevice';
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface SessionSummary {
  id: string;
  client: ClientKind;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  /** The session making this request. */
  current: boolean;
}
