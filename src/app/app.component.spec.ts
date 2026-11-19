import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { Subject } from 'rxjs';
import { vi, type Mock } from 'vitest';
import { AppComponent } from './app.component';
import { LiveUpdateService } from './core/services/live-update.service';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('AppComponent', () => {
  let staged: Subject<{ semver: string }>;
  let liveUpdate: { reload: Mock; staged$: Subject<{ semver: string }> };
  let alertCreate: Mock;
  let dismissRole: string;
  let dismiss: () => void;

  beforeEach(async () => {
    staged = new Subject();
    liveUpdate = {
      reload: vi.fn(() => Promise.resolve()),
      staged$: staged,
    };
    dismissRole = 'cancel';
    alertCreate = vi.fn(() =>
      Promise.resolve({
        present: vi.fn(() => Promise.resolve()),
        onDidDismiss: () =>
          new Promise<{ role: string }>((resolve) => {
            dismiss = () => {
              resolve({ role: dismissRole });
            };
          }),
      })
    );

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: LiveUpdateService, useValue: liveUpdate },
        { provide: AlertController, useValue: { create: alertCreate } },
      ],
    });
    TestBed.overrideComponent(AppComponent, { set: { template: '<div></div>' } });
    await TestBed.compileComponents();
  });

  function createApp(): AppComponent {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('creates', () => {
    expect(createApp()).toBeTruthy();
    expect(alertCreate).not.toHaveBeenCalled();
  });

  it('offers to reload when an update is staged, and reloads on confirm', async () => {
    createApp();

    staged.next({ semver: '0.17.0' });
    await flush();

    expect(alertCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        header: 'Update Ready',
        message: 'A new version (0.17.0) is ready. Reload now to apply it?',
      })
    );
    dismissRole = 'confirm';
    dismiss();
    await flush();
    expect(liveUpdate.reload).toHaveBeenCalled();
  });

  it('leaves the update for the next launch on "Later", and shows one prompt at a time', async () => {
    createApp();

    staged.next({ semver: '0.17.0' });
    await flush();
    staged.next({ semver: '0.17.1' });
    await flush();
    expect(alertCreate).toHaveBeenCalledTimes(1);

    dismiss();
    await flush();
    expect(liveUpdate.reload).not.toHaveBeenCalled();

    staged.next({ semver: '0.17.1' });
    await flush();
    expect(alertCreate).toHaveBeenCalledTimes(2);
  });
});
