# Sync

PokePaper is local-first: the app reads and writes on-device storage and works fully offline. A background sync loop exchanges changes with the server whenever it's reachable. This document covers the rules both sides must follow. Wire types live in `shared/src/sync.ts`. Synced entity types: `settings` and `collectionEntry` ([`collection.md`](collection.md)).

## Client (implemented: `src/app/core/services/sync.service.ts`)

**Writes.** A repository writes the entity to its local store and appends an outbox entry in the same storage transaction (`LocalUserDataRepository`). Operations carry the **full entity state** (`upsert` with the whole entity, or `delete`), never partial patches. Each entry's `createdAt` is strictly later than the previous one's (1 ms later when written within the same millisecond, e.g. a batch), so the outbox order, and which operation per entity is newest, never depends on how storage breaks ties.

**Cycle.** Push the outbox, then pull the change log. A cycle runs on app start, every 30 seconds, when the browser comes back online, and after every local write. A trigger that arrives mid-cycle schedules exactly one follow-up cycle.

**Push.**

- Only the newest queued operation per entity (`entityType` + `entityId`) is sent. Older ones are superseded and deleted unsent, since replaying them could only reapply stale state.
- Operations go in batches of 200, oldest first.
- `applied` / `duplicate` results remove the entry. A `failed` result keeps the entry and puts sync status in `error`. It increments `attemptCount` unless the result is marked `retryable`.
- After 5 counted failed attempts the operation is dropped, the pull cursor is reset to `0` so a full re-pull restores the server's state, and Settings shows a "rejected and reverted" notice.

**Pull.**

- Pages are pulled from the stored cursor while `hasMore` is true. Each page commits atomically together with the new cursor. The cursor is **opaque**: stored and echoed verbatim, never parsed.
- A pulled change is **skipped if the same entity still has a queued outbox entry**: the local write wins until it's pushed, and the server echoes it back in a later pull.
- Changes for entity types this build can't apply are skipped. The set of known types is stored, and when a new build adds a type the cursor resets to `0`, so earlier changes for it are pulled again.

**Auth.** A 401 sets status `unauthorized` and stops syncing (the outbox is kept) until `SyncService.resumeAfterReauth()` is called after sign-in.

## Server (implemented: `server/src/sync/`)

`SyncStore` stores each entity's current state in `entity_changes`, which doubles as the compacted change log: every write replaces the entity's row with a fresh `seq` (`INSERT OR REPLACE` with `AUTOINCREMENT`, so a seq is never reused). Deletes stay as tombstones. Applied `opId`s live in `applied_operations`. Per-entity validation is in `validation.ts`.

### Requirements

1. **Idempotent push.** Record every applied `opId`. A repeated `opId` returns `duplicate` and changes nothing.
2. **Last-writer-wins per entity by `clientTimestamp`.** Apply an operation only if its `clientTimestamp` is not older than the entity's stored one. `clientTimestamp` must be the exact UTC form `toISOString()` produces (`2026-01-01T00:00:00.000Z`); anything else is rejected, so comparisons never depend on the server's time zone.
3. **A losing operation re-issues the winner.** When an operation is stale, the server returns `applied` _and_ rewrites the winning row with a fresh `seq`. The sender may have skipped that winning change in an earlier pull (it had this operation queued), so this is what brings the winner back to it. Without it, the sender would keep its losing value forever.
4. **Per-operation rejection.** The request schema only checks what's needed to answer per operation (an object with a string `opId`, at most 500 per push). Every other field is validated per operation, so one bad operation returns `failed` instead of a 400 that would block every push containing it. Transient problems are HTTP 5xx, which the client retries without counting an attempt.
5. **Rejections aren't remembered.** Only applied `opId`s are recorded. A rejected operation is re-validated on every attempt, so a newer server can accept what an older one rejected. Unknown entity types come back `failed` with `retryable: true` (a newer client may be ahead of this server), and clients don't count those attempts.
6. **Paged, compacted change log.** At most one page (500 rows) per pull, with `hasMore`. A pull from `'0'` costs roughly the current state, not history, because clients re-pull from the start after rejections and when new entity types ship.
7. **Epoch-scoped cursors.** Cursors are `<epoch>:<seq>`. The epoch (`server_meta.epoch`) identifies one physical database. Every backup snapshot gets a fresh epoch when it's written, so a database restored from it never matches a client's cursor, even after new writes push its `seq` past the client's. A cursor from another epoch, a malformed one, or one beyond the highest issued `seq` gets `{ cursor: '0', changes: [], hasMore: true }`, and the client immediately re-pulls everything.
8. **Echo.** A client's own operations appear in its later pulls; that's how queued-then-skipped entities converge.
