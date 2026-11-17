import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { AuthConfig } from '../config.js';
import { AuthError } from './errors.js';
import type { AuthStore, NewCredential } from './store.js';

const CEREMONY_TIMEOUT_MS = 120_000;

/**
 * WebAuthn ceremonies for the single PokePaper account. Passkeys must be
 * discoverable (resident) and user-verified (Face ID / Touch ID / PIN), so
 * sign-in needs no username. Challenges are stored server-side and consumed
 * exactly once.
 */
export class PasskeyService {
  constructor(
    private readonly store: AuthStore,
    private readonly config: Pick<AuthConfig, 'rpId' | 'rpName' | 'publicOrigin'>
  ) {}

  async registrationOptions(): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const options = await generateRegistrationOptions({
      rpName: this.config.rpName,
      rpID: this.config.rpId,
      userName: 'pokepaper',
      userDisplayName: 'PokePaper',
      userID: this.store.userId() as Uint8Array<ArrayBuffer>,
      timeout: CEREMONY_TIMEOUT_MS,
      attestationType: 'none',
      excludeCredentials: this.store.credentialDescriptors(),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    this.store.saveChallenge(options.challenge, 'register');
    return options;
  }

  /** Verifies a registration response. Throws AuthError (400) when it doesn't check out. */
  async verifyRegistration(
    response: RegistrationResponseJSON,
    label: string
  ): Promise<NewCredential> {
    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: (challenge) => this.store.consumeChallenge(challenge, 'register'),
        expectedOrigin: this.config.publicOrigin,
        expectedRPID: this.config.rpId,
        requireUserVerification: true,
      });
    } catch {
      throw new AuthError(400, 'Passkey registration could not be verified');
    }

    if (!verification.verified) {
      throw new AuthError(400, 'Passkey registration could not be verified');
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    return {
      id: credential.id,
      publicKey: credential.publicKey,
      counter: credential.counter,
      transports: credential.transports,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      label,
    };
  }

  async authenticationOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const options = await generateAuthenticationOptions({
      rpID: this.config.rpId,
      timeout: CEREMONY_TIMEOUT_MS,
      userVerification: 'required',
    });
    this.store.saveChallenge(options.challenge, 'login');
    return options;
  }

  /** Verifies a sign-in response and returns the credential id. Throws AuthError (401). */
  async verifyAuthentication(response: AuthenticationResponseJSON): Promise<string> {
    const credential = this.store.findCredential(response.id);
    if (!credential) {
      throw new AuthError(401, 'Unknown passkey');
    }

    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: (challenge) => this.store.consumeChallenge(challenge, 'login'),
        expectedOrigin: this.config.publicOrigin,
        expectedRPID: this.config.rpId,
        credential: {
          id: credential.id,
          publicKey: credential.publicKey as Uint8Array<ArrayBuffer>,
          counter: credential.counter,
          transports: credential.transports,
        },
        requireUserVerification: true,
      });
    } catch {
      throw new AuthError(401, 'Passkey sign-in could not be verified');
    }

    if (!verification.verified) {
      throw new AuthError(401, 'Passkey sign-in could not be verified');
    }

    this.store.recordCredentialUse(credential.id, verification.authenticationInfo.newCounter);
    return credential.id;
  }
}
