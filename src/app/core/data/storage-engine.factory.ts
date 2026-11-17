import { Injectable, inject } from '@angular/core';
import { DexieStorageEngine } from './dexie-storage-engine';
import { StorageEngine } from './storage-engine';
import { isNativePlatform } from '../utils/native-platform.util';
import type { SqliteConnection } from './sqlite-connection';

/**
 * Selects and initializes the storage engine during app bootstrap: native
 * platforms get SQLite, web keeps Dexie/IndexedDB. If the SQLite database
 * can't be opened, the session falls back to the Dexie engine and retries on
 * next launch. When SQLite opens again, any outbox entries written to Dexie
 * during a fallback session are moved into SQLite so those unsynced changes
 * are still pushed (their full payloads come back via the next pull).
 *
 * initialize() must complete (via provideAppInitializer) before STORAGE_ENGINE
 * is injected anywhere.
 */
@Injectable({ providedIn: 'root' })
export class StorageEngineFactory {
  private readonly dexieEngine = inject(DexieStorageEngine);
  private engine: StorageEngine | null = null;

  async initialize(): Promise<void> {
    if (this.engine) {
      return;
    }

    if (!isNativePlatform()) {
      await this.dexieEngine.initialize();
      this.engine = this.dexieEngine;
      return;
    }

    let connection: SqliteConnection | null = null;

    try {
      const [{ openCapacitorSqliteConnection }, { SqliteStorageEngine }] = await Promise.all([
        import('./sqlite-connection'),
        import('./sqlite-storage-engine'),
      ]);

      connection = await openCapacitorSqliteConnection();

      const sqliteEngine = new SqliteStorageEngine(connection);
      await sqliteEngine.initialize();

      this.engine = sqliteEngine;
      await this.recoverFallbackOutbox(sqliteEngine);
    } catch (error: unknown) {
      if (connection) {
        await connection.close().catch(() => undefined);
      }

      console.error('SQLite unavailable, falling back to Dexie', error);
      await this.dexieEngine.initialize();
      this.engine = this.dexieEngine;
    }
  }

  /**
   * Moves outbox entries left in Dexie by an earlier fallback session into
   * the native engine. Idempotent (entries are keyed by opId), and never
   * blocks startup: on failure the entries stay in Dexie for the next launch.
   */
  private async recoverFallbackOutbox(target: StorageEngine): Promise<void> {
    try {
      const stranded = await this.dexieEngine.listOutboxOrderedByCreatedAt();
      if (stranded.length === 0) {
        return;
      }

      await target.runInTransaction(['outbox'], async () => {
        for (const entry of stranded) {
          await target.putOutboxEntry(entry);
        }
      });
      await this.dexieEngine.bulkDeleteOutbox(stranded.map((entry) => entry.opId));
      console.warn('storage.fallback_outbox_recovered', { count: stranded.length });
    } catch (error: unknown) {
      console.error('storage.fallback_outbox_recovery_failed', error);
    }
  }

  getEngine(): StorageEngine {
    if (!this.engine) {
      throw new Error('StorageEngineFactory.initialize() must complete before engine use.');
    }

    return this.engine;
  }
}
