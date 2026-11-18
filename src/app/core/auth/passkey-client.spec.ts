import { TestBed } from '@angular/core/testing';
import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { vi } from 'vitest';
import { environment } from '../../../environments/environment';
import { PASSKEY_REQUEST_IN_PROGRESS, PASSKEY_SETUP_ERROR, PasskeyClient } from './passkey-client';

const isNativePlatformMock = vi.fn<() => boolean>();

vi.mock('../utils/native-platform.util', () => ({
  isNativePlatform: () => isNativePlatformMock(),
}));

vi.mock('@simplewebauthn/browser', () => ({
  startRegistration: vi.fn(),
  startAuthentication: vi.fn(),
}));

const createCredential = vi.fn<(options: unknown) => Promise<unknown>>();
const getCredential = vi.fn<(options: unknown) => Promise<unknown>>();

vi.mock('@capgo/capacitor-passkey', () => ({
  CapacitorPasskey: {
    createCredential: (options: unknown) => createCredential(options),
    getCredential: (options: unknown) => getCredential(options),
  },
}));

const creationOptions = {
  challenge: 'c1',
  rp: { id: 'pokepaper.example.com', name: 'PokePaper' },
  user: { id: 'u1', name: 'pokepaper', displayName: 'PokePaper' },
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
} as PublicKeyCredentialCreationOptionsJSON;
const requestOptions = {
  challenge: 'c2',
  rpId: 'pokepaper.example.com',
} as PublicKeyCredentialRequestOptionsJSON;

/** A Capacitor plugin rejection: the WebAuthn error name travels as `code`. */
function pluginError(
  code: string,
  message = 'The operation was cancelled.',
  nativeCode?: number
): Error {
  return Object.assign(new Error(message), {
    code,
    data: nativeCode === undefined ? { name: code } : { name: code, native: { code: nativeCode } },
  });
}

describe('PasskeyClient', () => {
  let client: PasskeyClient;
  const originalApiUrl = environment.apiUrl;

  beforeEach(() => {
    vi.clearAllMocks();
    client = TestBed.inject(PasskeyClient);
  });

  afterEach(() => {
    environment.apiUrl = originalApiUrl;
  });

  describe('on the web', () => {
    beforeEach(() => isNativePlatformMock.mockReturnValue(false));

    it('registers through the browser WebAuthn API', async () => {
      vi.mocked(startRegistration).mockResolvedValue({ id: 'web-reg' } as never);

      await expect(client.register(creationOptions)).resolves.toEqual({ id: 'web-reg' });
      expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: creationOptions });
      expect(createCredential).not.toHaveBeenCalled();
    });

    it('authenticates through the browser WebAuthn API', async () => {
      vi.mocked(startAuthentication).mockResolvedValue({ id: 'web-auth' } as never);

      await expect(client.authenticate(requestOptions)).resolves.toEqual({ id: 'web-auth' });
      expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: requestOptions });
      expect(getCredential).not.toHaveBeenCalled();
    });
  });

  describe('in the iOS app', () => {
    beforeEach(() => {
      isNativePlatformMock.mockReturnValue(true);
      environment.apiUrl = 'https://pokepaper.example.com';
    });

    it('registers natively with the server origin', async () => {
      createCredential.mockResolvedValue({ id: 'ios-reg' });

      await expect(client.register(creationOptions)).resolves.toEqual({ id: 'ios-reg' });
      expect(createCredential).toHaveBeenCalledWith({
        origin: 'https://pokepaper.example.com',
        publicKey: creationOptions,
      });
      expect(startRegistration).not.toHaveBeenCalled();
    });

    it('authenticates natively, marking the request as a sign-in with `mediation`', async () => {
      getCredential.mockResolvedValue({ id: 'ios-auth' });

      await expect(client.authenticate(requestOptions)).resolves.toEqual({ id: 'ios-auth' });
      expect(getCredential).toHaveBeenCalledWith({
        origin: 'https://pokepaper.example.com',
        publicKey: requestOptions,
        mediation: 'optional',
      });
      expect(startAuthentication).not.toHaveBeenCalled();
    });

    it('names native failures like WebAuthn DOMExceptions', async () => {
      getCredential.mockRejectedValue(pluginError('NotAllowedError'));
      createCredential.mockRejectedValue(pluginError('InvalidStateError'));

      await expect(client.authenticate(requestOptions)).rejects.toMatchObject({
        name: 'NotAllowedError',
        message: 'The operation was cancelled.',
      });
      await expect(client.register(creationOptions)).rejects.toMatchObject({
        name: 'InvalidStateError',
      });
    });

    it('tells a prompt that is already open from an existing passkey', async () => {
      getCredential.mockRejectedValue(
        pluginError('InvalidStateError', 'Another passkey request is already in progress.')
      );

      await expect(client.authenticate(requestOptions)).rejects.toMatchObject({
        name: PASSKEY_REQUEST_IN_PROGRESS,
      });
    });

    it('tells an outright AuthenticationServices failure from a cancel', async () => {
      for (const nativeCode of [1003, 1004]) {
        getCredential.mockRejectedValueOnce(pluginError('NotAllowedError', 'failed', nativeCode));
        await expect(client.authenticate(requestOptions)).rejects.toMatchObject({
          name: PASSKEY_SETUP_ERROR,
        });
      }

      getCredential.mockRejectedValueOnce(pluginError('NotAllowedError', 'canceled', 1001));
      await expect(client.authenticate(requestOptions)).rejects.toMatchObject({
        name: 'NotAllowedError',
      });
    });

    it('passes through failures without a code', async () => {
      const failure = new TypeError('bridge unavailable');
      getCredential.mockRejectedValue(failure);

      await expect(client.authenticate(requestOptions)).rejects.toBe(failure);
    });
  });
});
