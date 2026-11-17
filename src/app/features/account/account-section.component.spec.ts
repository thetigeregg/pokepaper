import { TestBed } from '@angular/core/testing';
import { AlertController } from '@ionic/angular';
import type { CredentialSummary, SessionSummary } from '@pokepaper/shared';
import { vi } from 'vitest';
import { AuthFlowError, AuthService } from '../../core/auth/auth.service';
import { AccountSectionComponent } from './account-section.component';

const passkey = (id: string): CredentialSummary => ({
  id,
  label: id,
  deviceType: 'multiDevice',
  backedUp: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastUsedAt: null,
});
const session = (id: string, current = false): SessionSummary => ({
  id,
  client: 'web',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2026-04-01T00:00:00.000Z',
  current,
});

describe('AccountSectionComponent', () => {
  const auth = {
    listPasskeys: vi.fn(),
    listSessions: vi.fn(),
    addPasskey: vi.fn(() => Promise.resolve(passkey('new'))),
    removePasskey: vi.fn(() => Promise.resolve()),
    revokeSession: vi.fn(() => Promise.resolve()),
    signOut: vi.fn(() => Promise.resolve()),
  };
  let dismiss: { role: string; data?: unknown };

  async function create(): Promise<AccountSectionComponent> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: auth },
        {
          provide: AlertController,
          useValue: {
            create: () =>
              Promise.resolve({
                present: () => Promise.resolve(),
                onDidDismiss: () => Promise.resolve(dismiss),
              }),
          },
        },
      ],
    });
    TestBed.overrideComponent(AccountSectionComponent, { set: { template: '<div></div>' } });
    await TestBed.compileComponents();
    const component = TestBed.createComponent(AccountSectionComponent).componentInstance;
    await component.load();
    return component;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    auth.listPasskeys.mockResolvedValue([passkey('a'), passkey('b')]);
    auth.listSessions.mockResolvedValue([session('s1', true), session('s2')]);
    dismiss = { role: 'confirm' };
  });

  it('loads passkeys and sessions', async () => {
    const component = await create();

    expect(component.loaded()).toBe(true);
    expect(component.passkeys().map((p) => p.id)).toEqual(['a', 'b']);
    expect(component.sessions().map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('shows a load failure', async () => {
    auth.listPasskeys.mockRejectedValue(new AuthFlowError("Can't reach the server."));
    const component = await create();

    expect(component.error()).toBe("Can't reach the server.");
    expect(component.loaded()).toBe(false);
  });

  it('adds a named passkey, defaulting a blank name', async () => {
    const component = await create();

    dismiss = { role: 'confirm', data: { values: { label: '  ' } } };
    await component.addPasskey();
    expect(auth.addPasskey).toHaveBeenCalledWith('Passkey');

    dismiss = { role: 'cancel' };
    await component.addPasskey();
    expect(auth.addPasskey).toHaveBeenCalledTimes(1);
  });

  it('removes a passkey only after confirmation', async () => {
    const component = await create();

    dismiss = { role: 'cancel' };
    await component.removePasskey(passkey('b'));
    expect(auth.removePasskey).not.toHaveBeenCalled();

    dismiss = { role: 'confirm' };
    await component.removePasskey(passkey('b'));
    expect(auth.removePasskey).toHaveBeenCalledWith('b');
  });

  it('revokes another session, and signs out for the current one', async () => {
    const component = await create();

    await component.revokeSession(session('s2'));
    expect(auth.revokeSession).toHaveBeenCalledWith('s2');

    await component.revokeSession(session('s1', true));
    expect(auth.signOut).toHaveBeenCalled();
    expect(auth.revokeSession).toHaveBeenCalledTimes(1);
  });

  it('signs out only after confirmation', async () => {
    const component = await create();

    dismiss = { role: 'cancel' };
    await component.signOut();
    expect(auth.signOut).not.toHaveBeenCalled();

    dismiss = { role: 'confirm' };
    await component.signOut();
    expect(auth.signOut).toHaveBeenCalled();
  });

  it('hides unexpected error details', async () => {
    auth.removePasskey.mockRejectedValueOnce(new Error('internal'));
    const component = await create();

    await component.removePasskey(passkey('b'));

    expect(component.error()).toBe('Something went wrong.');
  });
});
