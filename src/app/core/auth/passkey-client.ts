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
 * name (`NotAllowedError`, `InvalidStateError`, …) on both platforms.
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

/**
 * Native plugin rejections are CapacitorExceptions carrying the WebAuthn
 * error name as their `code`. Re-throw them with that as the Error `name`,
 * as a browser's DOMException would have it.
 */
async function withWebAuthnErrorNames<T>(ceremony: () => Promise<T>): Promise<T> {
  try {
    return await ceremony();
  } catch (error: unknown) {
    const code = (error as { code?: unknown } | null)?.code;
    if (typeof code === 'string' && code.length > 0) {
      const named = new Error(error instanceof Error ? error.message : code);
      named.name = code;
      throw named;
    }
    throw error;
  }
}
