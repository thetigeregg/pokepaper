# Sync

PokePaper is local-first: the app reads and writes on-device storage and works fully offline. A background sync loop exchanges changes with the server whenever it's reachable. This document covers the rules both sides must follow. Wire types live in `shared/src/sync.ts`.

## Client (implemented: `src/app/core/services/sync.service.ts`)

**Writes.** A repository writes the entity to its local store and appends an outbox entry in the same storage transaction (`LocalUserDataRepository`). Operations carry the **full entity state** (`upsert` with the whole entity, or `delete`), never partial patches.

**Cycle.** Push the outbox, then pull the change log. A cycle runs on app start, every 30 seconds, when the browser comes back online, and after every local write. A trigger that arrives mid-cycle schedules exactly one follow-up cycle.

**Push.**

- Only the newest queued operation per entity (`entityType` + `entityId`) is sent. Older ones are superseded and deleted unsent, since replaying them could only reapply stale state.
- Operations go in batches of 200, oldest first.
- `applied` / `duplicate` results remove the entry. A `failed` result increments `attemptCount`, keeps the entry, and puts sync status in `error`.
- After 5 failed attempts the operation is dropped, the pull cursor is reset to `0` so a full re-pull restores the server's state, and Settings shows a "rejected and reverted" notice.

**Pull.**

- Pages are pulled from the stored cursor while `hasMore` is true. Each page commits atomically together with the new cursor.
- A pulled change is **skipped if the same entity still has a queued outbox entry**: the local write wins until it's pushed, and the server echoes it back in a later pull.
- Changes for entity types this build can't apply are skipped. The set of known types is stored, and when a new build adds a type the cursor resets to `0`, so earlier changes for it are pulled again.

**Auth.** A 401 sets status `unauthorized` and stops syncing (the outbox is kept) until `SyncService.resumeAfterReauth()` is called after sign-in.

## Server requirements (Phase 2: `server/`)

1. **Idempotent push.** Record every applied `opId`. A repeated `opId` returns `duplicate` and changes nothing.
2. **Last-writer-wins per entity by `clientTimestamp`.** Apply an operation only if its `clientTimestamp` is not older than the entity's stored one; otherwise return `applied` without changing state. Combined with client-side superseding, this guarantees an older operation can never overwrite a newer one, whatever order they arrive in.
3. **`failed` only for permanent rejections** (validation errors, unknown entity type). Transient problems should be HTTP 5xx, which the client retries without counting an attempt.
4. **Change log.** Every applied operation appends `{ entityType, entityId, operation, payload, serverTimestamp }` with a monotonically increasing sequence number. The pull cursor is that sequence number as a string. Return at most one page per request with `hasMore`.
5. **Compaction.** A pull from cursor `0` should cost roughly the current state, not the full history: keep only the latest log row per entity (or serve a snapshot), because clients re-pull from `0` after rejections and when new entity types ship.
6. **Echo.** A client's own operations appear in its later pulls; that's how queued-then-skipped entities converge.
