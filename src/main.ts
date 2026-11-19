import { provideHttpClient, withInterceptors, withInterceptorsFromDi } from '@angular/common/http';
import { inject, provideAppInitializer, provideZoneChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import {
  PreloadAllModules,
  RouteReuseStrategy,
  provideRouter,
  withComponentInputBinding,
  withPreloading,
} from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular';

import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { authTokenInterceptor } from './app/core/auth/auth-token.interceptor';
import { AuthService } from './app/core/auth/auth.service';
import { SettingsSyncApplier } from './app/core/data/settings-sync-applier';
import { CollectionSyncApplier } from './app/core/data/collection-sync-applier';
import { DeckSyncApplier } from './app/core/data/deck-sync-applier';
import { STORAGE_ENGINE } from './app/core/data/storage-engine';
import { StorageEngineFactory } from './app/core/data/storage-engine.factory';
import { SYNC_ENTITY_APPLIERS } from './app/core/data/sync-entity-applier';
import { SYNC_OUTBOX_WRITER } from './app/core/data/sync-outbox-writer';
import { CatalogSyncService } from './app/core/services/catalog-sync.service';
import { LiveUpdateService } from './app/core/services/live-update.service';
import { SyncService } from './app/core/services/sync.service';
import { isNativePlatform } from './app/core/utils/native-platform.util';
import { environment } from './environments/environment';

bootstrapApplication(AppComponent, {
  providers: [
    provideZoneChangeDetection(),
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    provideIonicAngular({ mode: 'ios' }),
    provideRouter(routes, withPreloading(PreloadAllModules), withComponentInputBinding()),
    // authTokenInterceptor: the iOS app's Keychain bearer token (no-op on web).
    provideHttpClient(withInterceptors([authTokenInterceptor]), withInterceptorsFromDi()),
    // Web only: caches the app shell so the browser app opens with no signal.
    // The iOS app ships its bundle locally (and the ios-* build configs don't
    // emit ngsw-worker.js), so it never registers.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-class-instance-assignment -- SwRegistrationOptions is an abstract class used as an options interface; Angular documents passing a literal.
    provideServiceWorker('ngsw-worker.js', {
      enabled: environment.production && !isNativePlatform(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    // Sequenced like go-gather's main.ts: everything that reads
    // STORAGE_ENGINE waits for StorageEngineFactory.initialize(), and sync
    // starts only after local storage is ready, so the app always boots from
    // local data first (offline-capable) and syncs in the background.
    provideAppInitializer(() => {
      const storageEngineFactory = inject(StorageEngineFactory);
      const authService = inject(AuthService);
      const syncService = inject(SyncService);
      const catalogSync = inject(CatalogSyncService);

      // The local signed-in marker (and the iOS session token) must be
      // loaded before the router's first navigation (so the guards pick the
      // right screen, offline too) and before sync starts (sync stays paused
      // while signed out, and its requests need the token).
      return Promise.all([storageEngineFactory.initialize(), authService.initialize()]).then(() => {
        syncService.initialize();
        // The card catalog downloads in the background and never blocks
        // startup; the app works with whatever is already on the device.
        catalogSync.initialize();
      });
    }),
    // OTA web updates (iOS App PROD only; a no-op elsewhere). Independent of
    // the chain above, and voided rather than returned: the native bridge
    // calls behind it have no timeout, so awaiting them could hang startup on
    // a white screen (a bug go-gather hit).
    provideAppInitializer(() => {
      void inject(LiveUpdateService).start();
    }),
    {
      provide: STORAGE_ENGINE,
      useFactory: (engineFactory: StorageEngineFactory) => engineFactory.getEngine(),
      deps: [StorageEngineFactory],
    },
    { provide: SYNC_OUTBOX_WRITER, useExisting: SyncService },
    { provide: SYNC_ENTITY_APPLIERS, useExisting: SettingsSyncApplier, multi: true },
    { provide: SYNC_ENTITY_APPLIERS, useExisting: CollectionSyncApplier, multi: true },
    { provide: SYNC_ENTITY_APPLIERS, useExisting: DeckSyncApplier, multi: true },
  ],
}).catch((err: unknown) => {
  console.error(err);
});
