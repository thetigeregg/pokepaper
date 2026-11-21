import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DEFAULT_SETTINGS, type UserSettings } from '@pokepaper/shared';
import { LocalUserDataRepository } from '../data/local-user-data-repository';
import { SyncService } from './sync.service';

/**
 * The user's settings (synced across devices as one entity), held in memory
 * for the services that read them (catalog languages, currency). Changes
 * show at once and are saved in order, each merged into what's stored;
 * pulled changes reload them.
 */
@Injectable({ providedIn: 'root' })
export class UserSettingsService {
  private readonly repository = inject(LocalUserDataRepository);
  private readonly _settings = signal<UserSettings>({ ...DEFAULT_SETTINGS });
  /** Changes are saved one at a time, each merged into the stored settings. */
  private saves: Promise<void> = Promise.resolve();
  /** Changes not yet saved: loads meanwhile are dropped (they'd show stale settings). */
  private pending = 0;
  /** Bumped by each change, so a load that started before it is dropped too. */
  private generation = 0;

  readonly settings = this._settings.asReadonly();

  constructor() {
    void this.load();
    inject(SyncService)
      .dataChanged$.pipe(takeUntilDestroyed())
      .subscribe((types) => {
        if (types.has('settings')) {
          void this.load();
        }
      });
  }

  /**
   * Applies `change`: shown at once, then saved locally (and synced). It's
   * applied again to the stored settings, not the in-memory copy (which may
   * not have loaded yet), so concurrent changes all land. If saving fails,
   * it's logged as `failureLog` and the saved settings are shown again.
   */
  async update(
    change: (settings: UserSettings) => UserSettings,
    failureLog: string
  ): Promise<void> {
    this.generation++;
    this.pending++;
    this._settings.update(change);
    const save = this.saves.then(async () => {
      await this.repository.updateSettings(change(await this.repository.getSettings()));
    });
    this.saves = save.catch(() => undefined);
    try {
      await save;
    } catch (error: unknown) {
      console.error(failureLog, error);
    } finally {
      this.pending--;
      if (this.pending === 0) {
        await this.load(); // What was actually saved (rolls back a failed change).
      }
    }
  }

  private async load(): Promise<void> {
    const generation = this.generation;
    try {
      const stored = await this.repository.getSettings();
      if (generation === this.generation && this.pending === 0) {
        this._settings.set(stored);
      }
    } catch (error: unknown) {
      console.error('settings.load_failed', error);
    }
  }
}
