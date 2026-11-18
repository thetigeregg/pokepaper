import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { environment } from '../../../environments/environment';
import { LiveUpdateService } from './live-update.service';

const isNativePlatformMock = vi.fn<() => boolean>();
vi.mock('../utils/native-platform.util', () => ({
  isNativePlatform: () => isNativePlatformMock(),
}));

const live = {
  ready:
    vi.fn<
      () => Promise<{ currentBundleId?: string; previousBundleId?: string; rollback: boolean }>
    >(),
  getVersionCode: vi.fn<() => Promise<{ versionCode: string }>>(),
  getCurrentBundle: vi.fn<() => Promise<{ bundleId: string | null }>>(),
  getNextBundle: vi.fn<() => Promise<{ bundleId: string | null }>>(),
  downloadBundle: vi.fn<(options: unknown) => Promise<void>>(),
  setNextBundle: vi.fn<(options: { bundleId: string }) => Promise<void>>(),
  reload: vi.fn<() => Promise<void>>(),
};
vi.mock('@capawesome/capacitor-live-update', () => ({
  LiveUpdate: {
    ready: () => live.ready(),
    getVersionCode: () => live.getVersionCode(),
    getCurrentBundle: () => live.getCurrentBundle(),
    getNextBundle: () => live.getNextBundle(),
    downloadBundle: (options: unknown) => live.downloadBundle(options),
    setNextBundle: (options: { bundleId: string }) => live.setNextBundle(options),
    reload: () => live.reload(),
  },
}));

type StateListener = (state: { isActive: boolean }) => void;
const addListener = vi.fn<(event: string, listener: StateListener) => Promise<unknown>>();
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (event: string, listener: StateListener) => addListener(event, listener),
  },
}));

const ORIGIN = 'https://pokepaper.example.com';
const MANIFEST_URL = `${ORIGIN}/ota/ios/3/manifest.json`;
const manifest = {
  bundleId: 'v0.17.0-b3',
  semver: '0.17.0',
  nativeBuildNumber: '3',
  url: `${ORIGIN}/ota/ios/3/v0.17.0-b3.zip`,
  checksum: 'abc',
  signature: 'sig',
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('LiveUpdateService', () => {
  let service: LiveUpdateService;
  let http: HttpTestingController;
  const original = { ...environment };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    isNativePlatformMock.mockReturnValue(true);
    environment.production = true;
    environment.apiUrl = ORIGIN;
    live.ready.mockResolvedValue({ currentBundleId: 'b1', rollback: false });
    live.getVersionCode.mockResolvedValue({ versionCode: '3' });
    live.getCurrentBundle.mockResolvedValue({ bundleId: null });
    live.getNextBundle.mockResolvedValue({ bundleId: null });
    live.downloadBundle.mockResolvedValue();
    live.setNextBundle.mockResolvedValue();
    live.reload.mockResolvedValue();
    addListener.mockResolvedValue({ remove: vi.fn() });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(LiveUpdateService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    Object.assign(environment, original);
    vi.restoreAllMocks();
  });

  /** Answers the next manifest request (whatever its cache-buster). */
  async function answerManifest(body: unknown, init?: { status: number; statusText: string }) {
    await flush();
    const request = http.expectOne((req) => req.url.startsWith(`${MANIFEST_URL}?t=`));
    request.flush(body, init);
    await flush();
  }

  it('does nothing on the web or outside production builds', async () => {
    isNativePlatformMock.mockReturnValue(false);
    expect(service.isEnabled()).toBe(false);
    await service.checkAndStageUpdate(true);
    await service.markReady();
    await service.reload();
    service.initializeResumeChecks();

    isNativePlatformMock.mockReturnValue(true);
    environment.production = false;
    await service.checkAndStageUpdate(true);

    expect(live.getVersionCode).not.toHaveBeenCalled();
    expect(live.ready).not.toHaveBeenCalled();
    expect(live.reload).not.toHaveBeenCalled();
    expect(addListener).not.toHaveBeenCalled();
  });

  it('downloads, verifies, and stages a new bundle for this native build', async () => {
    const staged: { semver: string }[] = [];
    service.staged$.subscribe((value) => staged.push(value));

    const done = service.checkAndStageUpdate(true);
    await answerManifest(manifest);
    await done;

    expect(live.downloadBundle).toHaveBeenCalledWith({
      url: manifest.url,
      bundleId: 'v0.17.0-b3',
      checksum: 'abc',
      signature: 'sig',
    });
    expect(live.setNextBundle).toHaveBeenCalledWith({ bundleId: 'v0.17.0-b3' });
    expect(staged).toEqual([{ semver: '0.17.0' }]);
  });

  it('treats a missing manifest (404) as no update', async () => {
    const done = service.checkAndStageUpdate(true);
    await answerManifest('Not Found', { status: 404, statusText: 'Not Found' });
    await done;

    expect(live.downloadBundle).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('logs, without throwing or staging, an unreachable server or an invalid manifest', async () => {
    const offline = service.checkAndStageUpdate(true);
    await flush();
    http
      .expectOne((req) => req.url.startsWith(`${MANIFEST_URL}?t=`))
      .error(new ProgressEvent('offline'));
    await expect(offline).resolves.toBeUndefined();

    const invalid = service.checkAndStageUpdate(true);
    await answerManifest({ ...manifest, url: 'https://evil.example.com/b.zip' });
    await invalid;

    expect(live.downloadBundle).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('live_update.check_failed', expect.anything());
    expect(console.error).toHaveBeenCalledWith('live_update.manifest_invalid', expect.anything());
  });

  it('skips bundles that are already active or staged, or built for another native build', async () => {
    live.getCurrentBundle.mockResolvedValue({ bundleId: 'v0.17.0-b3' });
    const active = service.checkAndStageUpdate(true);
    await answerManifest(manifest);
    await active;

    live.getCurrentBundle.mockResolvedValue({ bundleId: null });
    const otherBuild = service.checkAndStageUpdate(true);
    await answerManifest({ ...manifest, nativeBuildNumber: '2' });
    await otherBuild;

    expect(live.downloadBundle).not.toHaveBeenCalled();
  });

  it('skips the check without a version code or an https backend', async () => {
    environment.apiUrl = 'http://192.168.1.50:3000';
    await service.checkAndStageUpdate(true);

    expect(live.getVersionCode).toHaveBeenCalled();
    http.expectNone(() => true);
  });

  it('stages a bundle that is already on disk', async () => {
    live.downloadBundle.mockRejectedValue(new Error('Bundle already exists.'));

    const done = service.checkAndStageUpdate(true);
    await answerManifest(manifest);
    await done;

    expect(live.setNextBundle).toHaveBeenCalledWith({ bundleId: 'v0.17.0-b3' });
  });

  it('does not stage when the download fails for another reason', async () => {
    live.downloadBundle.mockRejectedValue(new Error('Signature verification failed'));

    const done = service.checkAndStageUpdate(true);
    await answerManifest(manifest);
    await done;

    expect(live.setNextBundle).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('live_update.check_failed', {
      error: 'Signature verification failed',
    });
  });

  it('shares an in-flight check, and throttles unforced checks to every 15 minutes', async () => {
    const first = service.checkAndStageUpdate(true);
    const joined = service.checkAndStageUpdate();
    await answerManifest(manifest);
    await Promise.all([first, joined]);
    expect(live.getVersionCode).toHaveBeenCalledTimes(1);

    await service.checkAndStageUpdate();
    expect(live.getVersionCode).toHaveBeenCalledTimes(1);
  });

  it('checks again when the app returns to the foreground, attaching the listener once', async () => {
    service.initializeResumeChecks();
    service.initializeResumeChecks();
    expect(addListener).toHaveBeenCalledTimes(1);
    expect(addListener.mock.calls[0]?.[0]).toBe('appStateChange');

    const listener = addListener.mock.calls[0]?.[1];
    listener({ isActive: false });
    listener({ isActive: true });
    await answerManifest('Not Found', { status: 404, statusText: 'Not Found' });

    expect(live.getVersionCode).toHaveBeenCalledTimes(1);
  });

  it('marks the bundle ready and reloads, logging failures without throwing', async () => {
    await service.markReady();
    await service.reload();
    expect(live.ready).toHaveBeenCalled();
    expect(live.reload).toHaveBeenCalled();

    live.ready.mockRejectedValue(new Error('bridge'));
    live.reload.mockRejectedValue(new Error('bridge'));
    await expect(service.markReady()).resolves.toBeUndefined();
    await expect(service.reload()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith('live_update.ready_failed', { error: 'bridge' });
    expect(console.error).toHaveBeenCalledWith('live_update.reload_failed', { error: 'bridge' });
  });
});
