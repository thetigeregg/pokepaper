import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { AuthFlowError, AuthService } from '../core/auth/auth.service';
import { LoginPage } from './login.page';

describe('LoginPage', () => {
  const auth = {
    status: vi.fn(),
    signIn: vi.fn(),
    setUp: vi.fn(),
    adoptExistingSession: vi.fn(() => Promise.resolve()),
    completePendingSignOut: vi.fn(() => Promise.resolve(true)),
  };
  const navigateByUrl = vi.fn(() => Promise.resolve(true));

  async function createPage(): Promise<LoginPage> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: Router, useValue: { navigateByUrl } },
      ],
    });
    TestBed.overrideComponent(LoginPage, { set: { template: '<div></div>' } });
    await TestBed.compileComponents();
    return TestBed.createComponent(LoginPage).componentInstance;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    [{ registered: true, authenticated: false, setupAvailable: false }, 'sign-in'],
    [{ registered: false, authenticated: false, setupAvailable: true }, 'setup'],
    [{ registered: false, authenticated: false, setupAvailable: false }, 'setup-disabled'],
  ])('picks the mode from the server status %o', async (status, mode) => {
    auth.status.mockResolvedValue(status);
    const page = await createPage();

    page.ionViewWillEnter();
    await vi.waitFor(() => {
      expect(page.mode()).toBe(mode);
    });
  });

  it('goes straight to the app when the server already recognizes the session', async () => {
    auth.status.mockResolvedValue({ registered: true, authenticated: true, setupAvailable: false });
    const page = await createPage();

    await page.refresh();

    expect(auth.adoptExistingSession).toHaveBeenCalled();
    expect(navigateByUrl).toHaveBeenCalledWith('/tabs', { replaceUrl: true });
  });

  it('does not adopt a surviving session while a sign-out is still pending', async () => {
    auth.completePendingSignOut.mockResolvedValueOnce(false);
    auth.status.mockResolvedValue({ registered: true, authenticated: true, setupAvailable: false });
    const page = await createPage();

    await page.refresh();

    expect(auth.adoptExistingSession).not.toHaveBeenCalled();
    expect(page.mode()).toBe('sign-in');
  });

  it('explains when the server is unreachable', async () => {
    auth.status.mockRejectedValue(new HttpErrorResponse({ status: 0 }));
    const page = await createPage();

    await page.refresh();

    expect(page.mode()).toBe('unreachable');
    expect(page.unreachableMessage()).toMatch(/Can't reach the server/);
  });

  it('signs in and enters the app', async () => {
    auth.signIn.mockResolvedValue(undefined);
    const page = await createPage();

    await page.signIn();

    expect(navigateByUrl).toHaveBeenCalledWith('/tabs', { replaceUrl: true });
    expect(page.busy()).toBe(false);
  });

  it('shows auth errors and stays put', async () => {
    auth.signIn.mockRejectedValue(
      new AuthFlowError('The passkey prompt was cancelled or timed out.')
    );
    const page = await createPage();

    await page.signIn();

    expect(page.error()).toBe('The passkey prompt was cancelled or timed out.');
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('hides unexpected error details', async () => {
    auth.signIn.mockRejectedValue(new Error('internal detail'));
    const page = await createPage();

    await page.signIn();

    expect(page.error()).toBe('Something went wrong. Please try again.');
  });

  it('requires a setup token, then sets up with a trimmed token and label', async () => {
    auth.setUp.mockResolvedValue(undefined);
    const page = await createPage();

    await page.setUp();
    expect(page.error()).toMatch(/Enter the setup token/);
    expect(auth.setUp).not.toHaveBeenCalled();

    page.setupToken = '  token-123  ';
    page.passkeyLabel = '   ';
    await page.setUp();

    expect(auth.setUp).toHaveBeenCalledWith('token-123', 'My passkey');
    expect(navigateByUrl).toHaveBeenCalledWith('/tabs', { replaceUrl: true });
  });
});
