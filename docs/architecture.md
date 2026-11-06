# Orbyn Planner architecture

The plan lives in the [Orbyn platform plan](https://claude.ai/artifact/BBhxZSmXRg1DawhLVRbsNc), and the screens in [Orbyn Planner Designs](https://claude.ai/artifact/7DCiHUzLLfBa3t8ojwiPVM). This file is the contract the UI follows. Change it in the same commit as any rule it states.

## Rules

- One UI for web, desktop and phone. Platform code stays in thin shells.
- The planner is for everyone: no student, engineer or business defaults, and no AI in v1.
- Orbyn house style: Geist and JetBrains Mono; Light, Dark and Dim; at most three interface colours: ink, amber when the person must act, and red for failures and removals. A person's list, calendar and project colours are content and keep their colour.
- Wire types come from orbyn-engine's contracts and are generated, never written by hand.
- The app works offline. A sync line always says whether this device is synced, syncing, offline with changes waiting, or unable to sync.

## Local store

The UI talks to a `PlannerStore`. `LocalStore` keeps the records in IndexedDB, one object store per record type, and the Rust engine will later implement the same interface.

- **Patches, not records.** A write is a patch: a create carries the new record, an update or delete only the fields that changed. In one readwrite transaction the store reads the current record, writes it with just those fields applied and folds the change into the outbox. A tab never writes back its own whole copy, so a stale tab's edit to one field cannot revert another tab's edit to a different field.
- **One outbox entry per record.** An entry is `{type, id, op, changedFields, idempotencyKey, createdAt, updatedAt}`. Later edits of the same record merge into it, the latest value winning, and every merge takes a new idempotency key, so changed content is never mistaken for a retry of what was sent before. When sync arrives, an entry being sent is frozen and later edits start a new entry; a retry of the frozen one reuses its key. An entry stays a `create` while it is pending. Purging a record that never synced (its entry is still a `create`) removes the entry and sends nothing. "N changes waiting" counts records. The key (`seq`) is allocated by IndexedDB inside the transaction, never counted in memory.
- **Tombstones and purge.** Delete sets `deletedAt`; the record stays and can be put back for 30 days. A purge removes the record, removes its pending create or update entry and leaves one `delete` entry for the engine. A purge on load is skipped when the device clock is more than a day past the newest record timestamp the device holds, so a clock set far ahead cannot empty the Deleted list. After a long idle spell the purge waits for the next change.
- **Tabs.** After each committed write a tab posts the changed record ids on `BroadcastChannel("orbyn-planner")`; the other tabs re-read those records from IndexedDB. A version change closes the connection and reloads the page, and a blocked upgrade says which tabs must close. The Inbox has a fixed id so two tabs starting together make one.
- **Failures are shown.** A failed or full write, or a database that will not open, sets the store's persistence state to `failed` with a reason; the sync line then reads "Couldn’t save on this device" and nothing claims the changes are saved. A failed open does not fall back to memory. Memory alone is used only where IndexedDB does not exist, and then the line reads "Not saved on this device".
- **Checklist order.** Steps carry a fractional order key (`web/src/store/order.ts`, a port of the engine's `order.rs`), so inserting a step changes no other, and steps sort by key then id.

## Calendar feeds

- **Time.** A feed event keeps its wall time and IANA zone; each occurrence is converted to the viewer's zone, so daylight-saving changes in either place land right. UTC (`Z`) UNTIL, EXDATE and RECURRENCE-ID values are converted into the series' zone before their date is taken. A start inside a skipped hour moves forward by the gap and keeps its written length. Expansions are cached per event and range.
- **Repeats.** Only FREQ, INTERVAL, BYDAY (weekly), COUNT and UNTIL are read. Any other rule shows the first date only, with a note, and is listed under "Can't show these repeats" in Calendars; no dates are guessed.
- **Fetching.** With `VITE_ENGINE_URL` set, the engine fetches feeds (`POST /v1/feeds/fetch`, `{url}` answered by `{status, body}`; refusals are `ApiError` codes `invalid_url`, `blocked_address`, `too_large`, `timeout`, `upstream_error`). Without it the web build fetches directly, which many servers refuse; the desktop app, whose page may not fetch other sites, says "Subscriptions need the Orbyn engine".
