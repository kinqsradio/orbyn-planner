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
- **Tombstones and purge.** Delete sets `deletedAt`; the record stays and can be put back for 30 days. A purge removes the record, removes its pending create or update entry and leaves one `delete` entry for the engine. A purge on load is skipped when the device clock is more than a day past the newest timestamp it can trust, so a clock set far ahead cannot empty the Deleted list. A timestamp the device made within the last minute is not trusted, because it came from the very clock being checked; until sync exists the evidence is the device's older stamps, and once it does the newest server time replaces them. After a long idle spell the purge waits for the next session after a change.
- **Tabs.** After each committed write a tab posts the changed record ids on `BroadcastChannel("orbyn-planner")`; the other tabs re-read those records from IndexedDB. A version change closes the connection and reloads the page, and a blocked upgrade says which tabs must close. The Inbox has a fixed id so two tabs starting together make one.
- **Failures are shown.** A failed or full write, or a database that will not open, sets the store's persistence state to `failed` with a reason; the sync line then reads "Couldn’t save on this device" and nothing claims the changes are saved. A failed open does not fall back to memory. Memory alone is used only where IndexedDB does not exist, and then the line reads "Not saved on this device".
- **Checklist order.** Steps carry a fractional order key (`web/src/store/order.ts`, a port of the engine's `order.rs`), so inserting a step changes no other, and steps sort by key then id.

## Projects, repeats and reminders

- **Projects** hold sections (a fractional order key each, so moving one changes no other) and tasks carry `projectId` and `sectionId`. Deleting a section moves its tasks to "No section". A finished project is `archived`. Stored, a section is three fields of the project (`section.<id>.name`, `.order`, `.removed`), so two devices editing different sections keep both edits.
- **A repeating task** is one record: `repeat` is the engine's Series (its start is the first due date) and `due` is the current occurrence. Completing it moves `due` to the next occurrence at the same time of day and records the completion in `completions`, which feeds "Done this week"; the last occurrence of a count or until end finishes the task. Completing also unticks the checklist for the next time; when the next date is still in the past the toast offers "Skip to next upcoming". Editing the due or repeat asks This task, This and following or All. "This task" skips the date and makes a one-off copy (`overrideOf`) on the new one; "All" moves the series and its weekdays (a move that would split an every-other-week cycle is refused); a changed rule offers only the last two; a repeat needs a due date, so the date of a repeating task cannot be cleared without stopping the repeat first.
- **Reminders** are minutes before the due time (0 is at the due time); a date with no time reminds at 09:00. Notifications use the browser's Notification API only after the person turns reminders on in Settings · Notifications, which is where permission is asked. They fire while the app is open, from one timer per reminder in the next day, rebuilt hourly and whenever the page becomes visible. A reminder inside quiet hours is skipped. "N days before" counts calendar days. With several tabs open, one holds a Web Lock and is the only one to notify. The phone and desktop apps will remind when the app is closed.

## Accounts

Accounts are optional in v1. Signed out, the person sees the landing page, and "Use without an account" keeps everything on this device; Settings · Account offers sign-in later.

- **Crypto is not ours.** OPAQUE and the Ed25519 and X25519 device keys come from the engine's WebAssembly module, orbyn-wasm. `AuthCrypto` (`web/src/api/authCrypto.ts`) mirrors that module's functions name for name, and `WasmAuthCrypto.ts` wires them up. The module is not part of the build yet, so nothing is registered and sign-in says "Sign-in isn't available in this build yet" before it sends anything. `FakeAuthCrypto` and the mock engine are for tests only; a test fails if a file outside `testing/` imports them or if the production bundle contains them.
- **Device keys and the session** live in IndexedDB in their own database, `orbyn-planner-keys`, never in localStorage or in the planner's database. The token is also held in memory, sent as `Authorization: Bearer`, and cleared on a 401. Keys stay when a device signs out, so the next sign-in can prove it is a trusted device.
- **Adding a device.** A new browser signs in as pending and shows a code box. On a trusted device, Settings · Account lists it with Approve: the trusted device signs the pending device's id and keys, the server answers with a six-digit code, and the person types it on the new device (five tries, ten minutes).
- **Not built yet:** passkeys, email verification, recovery, and a name or email taken from the server (the engine has no such route yet, so they are kept from sign-up).

## Calendar feeds

- **Time.** A feed event keeps its wall time and IANA zone; each occurrence is converted to the viewer's zone, so daylight-saving changes in either place land right. UTC (`Z`) UNTIL, EXDATE and RECURRENCE-ID values are converted into the series' zone before their date is taken. A start inside a skipped hour moves forward by the gap and keeps its written length. Expansions are cached per event and range.
- **Repeats.** Only FREQ, INTERVAL, BYDAY (weekly), COUNT and UNTIL are read. Any other rule shows the first date only, with a note, and is listed under "Can't show these repeats" in Calendars; no dates are guessed.
- **Fetching.** With `VITE_ENGINE_URL` set, the engine fetches feeds (`POST /v1/feeds/fetch`, `{url}` answered by `{status, body}`; refusals are `ApiError` codes `invalid_url`, `blocked_address`, `too_large`, `timeout`, `upstream_error`). Without it the web build fetches directly, which many servers refuse; the desktop app, whose page may not fetch other sites, says "Subscriptions need the Orbyn engine".
