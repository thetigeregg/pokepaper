import { Injectable } from '@angular/core';
import {
  CapacitorPasskey,
  type PasskeyAuthenticationCredential,
  type PasskeyPublicKeyCredentialCreationOptionsJSON,
  type PasskeyPublicKeyCredentialRequestOptionsJSON,
  type PasskeyRegistrationCredential,
} from '@capgo/capacitor-passkey';
import {
  startAuthentication,
  startRegistration,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import { environment } from '../../../environments/environment';
import { isNativePlatform } from '../utils/native-platform.util';

/** Error name (iOS): another passkey prompt is still open. */
export const PASSKEY_REQUEST_IN_PROGRESS = 'PasskeyRequestInProgressError';
/**
 * Error name (iOS): AuthenticationServices failed outright rather than being
 * cancelled, which usually means the app isn't associated with the relying
 * party's domain (entitlement or apple-app-site-association).
 */
export const PASSKEY_SETUP_ERROR = 'PasskeySetupError';

/** ASAuthorizationError codes reported as NotAllowedError that aren't a cancel. */
const AUTHORIZATION_NOT_HANDLED = 1003;
const AUTHORIZATION_FAILED = 1004;

/** What the server's `/register/verify` expects (WebAuthn JSON). */
export type PasskeyRegistrationResponse = RegistrationResponseJSON | PasskeyRegistrationCredential;
/** What the server's `/login/verify` expects (WebAuthn JSON). */
export type PasskeyAuthenticationResponse =
  AuthenticationResponseJSON | PasskeyAuthenticationCredential;

/**
 * Runs passkey ceremonies with the WebAuthn JSON options from the server.
 *
 * - Web: the browser's WebAuthn API, through SimpleWebAuthn.
 * - iOS: the app's web view can't use WebAuthn (its origin is
 *   `capacitor://localhost`), so `@capgo/capacitor-passkey` runs the
 *   ceremony natively with AuthenticationServices. The app's associated
 *   domain (`webcredentials:`, docs/ios.md) lets it use passkeys for the
 *   server's relying party, and `origin` (the server's public origin) is
 *   what ends up in `clientDataJSON` for the server to verify.
 *
 * Failures reject with an Error whose `name` is the WebAuthn DOMException
 * name (`NotAllowedError`, `InvalidStateError`, …) on both platforms, plus
 * two iOS-only names that the plugin otherwise folds into those:
 * PASSKEY_REQUEST_IN_PROGRESS and PASSKEY_SETUP_ERROR.
 */
@Injectable({ providedIn: 'root' })
export class PasskeyClient {
  register(
    optionsJSON: PublicKeyCredentialCreationOptionsJSON
  ): Promise<PasskeyRegistrationResponse> {
    if (!isNativePlatform()) {
      return startRegistration({ optionsJSON });
    }
    return withWebAuthnErrorNames(() =>
      CapacitorPasskey.createCredential({
        origin: environment.apiUrl,
        publicKey: optionsJSON as PasskeyPublicKeyCredentialCreationOptionsJSON,
      })
    );
  }

  authenticate(
    optionsJSON: PublicKeyCredentialRequestOptionsJSON
  ): Promise<PasskeyAuthenticationResponse> {
    if (!isNativePlatform()) {
      return startAuthentication({ optionsJSON });
    }
    return withWebAuthnErrorNames(() =>
      CapacitorPasskey.getCredential({
        origin: environment.apiUrl,
        publicKey: optionsJSON as PasskeyPublicKeyCredentialRequestOptionsJSON,
        // Required, not just a default: the plugin tells sign-in requests
        // from registration requests by the presence of `mediation`.
        mediation: 'optional',
      })
    );
  }
}

interface PluginRejection {
  code?: unknown;
  message?: unknown;
  data?: { native?: { code?: unknown } };
}

/**
 * Native plugin rejections are CapacitorExceptions carrying the WebAuthn
 * error name as their `code`. Re-throw them with that as the Error `name`,
 * as a browser's DOMException would have it, except for two cases the
 * plugin reports under misleading names:
 * - "Another passkey request is already in progress" (InvalidStateError,
 *   which otherwise means the passkey already exists);
 * - AuthenticationServices failing outright (NotAllowedError, which
 *   otherwise means cancelled).
 */
async function withWebAuthnErrorNames<T>(ceremony: () => Promise<T>): Promise<T> {
  try {
    return await ceremony();
  } catch (error: unknown) {
    const rejection = (error ?? {}) as PluginRejection;
    const code = rejection.code;
    if (typeof code !== 'string' || code.length === 0) {
      throw error;
    }
    const message = typeof rejection.message === 'string' ? rejection.message : code;
    const nativeCode = rejection.data?.native?.code;
    let name = code;
    if (code === 'InvalidStateError' && message.includes('already in progress')) {
      name = PASSKEY_REQUEST_IN_PROGRESS;
    } else if (
      code === 'NotAllowedError' &&
      (nativeCode === AUTHORIZATION_FAILED || nativeCode === AUTHORIZATION_NOT_HANDLED)
    ) {
      name = PASSKEY_SETUP_ERROR;
    }
    const named = new Error(message);
    named.name = name;
    throw named;
  }
}
