# Calendar Bridge sync engine — development safety contract

Status: **prototype only; no calendar-writing path is enabled.**

## What exists now

- `sync-planner.js`: pure planner with versioned, per-calendar history, one-to-one identity matching, conservative one-time adoption, duplicate/ambiguous matching detection, manual Google edit preservation, and exclusion tombstones.
- `drive-history.js`: original one-file appDataFolder reader and create-once bootstrap; used by the read-only connection check.
- `history-journal.js` and `drive-journal.js`: **unwired** immutable snapshot history prototype. A complete chain allows recovery and multiple competing branches fail closed; it does not yet provide atomic multi-device locking or a completed writer.
- `test/sync-planner.test.js` and `test/drive-history.test.js`: logic and mocked-API tests.
- `sync-history-sandbox.js` and `test/sync-history-sandbox.test.js`: **not loaded into Chrome**. Simulates loading a Drive history, adopting a uniquely matched pre-existing Google event, verifying a deletion, persisting each history version, and recovering the exclusion. The test uses only a mocked Drive API and performs **no Google Calendar writes**. The sandbox intentionally cannot initialize missing history or write to the primary calendar.
- `sync-create-recovery.js` is an **unwired read-only** Google Calendar event GET-by-ID check for interrupted creation attempts. It requires the expected deterministic ID and verifies ownership markers, event fields, and manual edits. A missing (404/410) event is **not** permission to create; ownership mismatches, recurring instances, edits, and non-success HTTP responses stop. The independent mocked tests are in `test/sync-create-recovery.test.js`.
- `sync-coordinator-sandbox.js` connects the planner, deterministic event identity, read-only lookup and append-only history. It does **not** create, update, or delete Google events. A missing event is left as `needs-explicit-create-authorization`; a previously created, verified event can be recorded after a second read and a validated history append. Stale history or uncertain results stop. Tests: `test/sync-coordinator-sandbox.test.js`.
- `sync-google-read-adapter.js` is a GET-only API adapter for event IDs, independent of the UI. It treats 404/410 as unconfirmed absence, not authorization to create; mismatched event IDs or other API errors stop. Tests: `test/sync-google-read-adapter.test.js`.
- `sync-create-safety.js` prepares deterministic Google event IDs from the account, calendar, and Outlook UID. When that ID is already present, the module returns `reconcile-existing` instead of proposing another creation. It makes **no API calls** and provides no live writer; checking a list alone is NOT sufficient for a real retry and a future writer must perform an event GET by ID.
- GitHub Actions is configured to run all `test/*.test.js` on branch pushes. A successful Actions run has **not yet been independently confirmed** by the GitHub connection.

## Pending-create transaction prototype (not enabled)

- `sync-create-intent.js` adds a third history state, `pending`. The intent and deterministic event ID must be durably saved **before** an event is created; the planner must never consider it a new addition while pending.
- `sync-insert-isolated.js` contains a single-attempt Google Calendar `events.insert` adapter. It is **NOT referenced by any popup, background script or manifest**, and only mocked API tests call it. A timeout, HTTP 409, or failed response is uncertain, never permission to retry automatically.
- `sync-transaction-sandbox.js` simulates the sequence: planner approval → append pending history → GET-by-ID → one insert attempt if unconfirmed → GET-by-ID → verified history completion. On restart it **only GETs** a pending event and never sends a second insert. A cancelled or user-edited event remains pending for review.
- The Google Calendar API warns that custom event IDs may not always detect collisions at insert time. Deterministic IDs plus GET-based reconciliation and durable intent reduce risk but do not replace a verified single-writer and proper source/account checks.
- Simulation tests: `test/sync-create-intent.test.js`, `test/sync-insert-isolated.test.js`, `test/sync-transaction-sandbox.test.js`. A successful GitHub Actions run has not been independently confirmed.

## Verified destination and backup gate (prototype)

- `sync-write-gate.js` requires explicit destination approval, a matching non-primary Google calendar with write access, a verified backup receipt, and a complete source/destination scan receipt. The transaction sandbox refuses to create even a pending record without these inputs and rejects a selected appointment if its fields differ from the full scan.
- A future real UI must **actually generate and verify** the destination metadata, backup and scan receipts. The mocked receipts in unit tests are not security attestations, and do not authorize production use.
- Tests: `test/sync-write-gate.test.js` and extended `test/sync-transaction-sandbox.test.js`. Their GitHub Actions outcome has not been independently confirmed.

## Backup and first-run integration, now available on development branch

- `google-backup.js` reads all selected Google Calendar events through paginated `events.list` requests with `singleEvents=false`, preserving recurring masters and no time-window cap. It hashes the complete JSON payload using SHA-256 and verifies the checksum. `google-backup-ui.js` adds a **Download Google calendar backup** button; it only downloads local JSON and makes no calendar changes.
- `sync-backup-verify.js` and its popup file control verify a *saved* JSON backup locally, check the checksum, and insist that the calendar identity matches the selected **non-primary** destination. This does not issue production write permission.
- `sync-first-run.js` is **not wired to the extension**. Its mocked tests initialize history exactly once for an explicitly approved, empty destination whose verified backup also shows zero events. It refuses to overwrite pre-existing history or initialize against an occupied calendar.
- Google OAuth now also requests `calendar.calendarlist.readonly`, needed for calendar summary, timezone and accessRole metadata. This will require an updated Google consent authorization when installed. Only `calendar.events` and `drive.appdata` were in the previously tested Chrome version.
- Tests for these modules run in the GitHub Actions suite. **The newly added backup and verification code has not yet been exercised against a live user calendar.**

## Integrated read-only preflight

- `sync-readiness.js` combines complete Outlook extraction, Google Calendar content/role verification, and versioned Drive history into a single read-only assessment. The popup now has **Check sync readiness (no changes)**, which uses `sync-readiness-ui.js`. It does not initialize history or approve Calendar writes; it reports concrete blockers. A dedicated calendar with no history requires deliberate first-run migration.
- `test/sync-readiness.test.js` checks incomplete Outlook scans, calendar/account mismatches, nonempty first-run calendars, and saved-history matching.
- `test/release-safety.test.js` asserts that no unfinished writer, transaction runner, or first-run initializer is reachable from the popup, background worker, or Outlook content script.
- GitHub Actions is **confirmed working**: the branch test suite passed on commit `c847dec1cd29a2c0f5b9c1b0798b1bfaa4f10c75` ([run](https://github.com/jeffreyslubin-cloud/calendar-bridge/actions/runs/45504566584)). New commits must be checked independently before reporting success.

## Single-writer safeguards (isolated prototype)

- `sync-first-run.js` now binds a new history to a `writerDeviceId`, separate from the Google account and calendar identity. The transaction sandbox refuses writes from a different browser installation.
- `sync-browser-lock.js` uses the browser Web Locks API to serialize overlapping runs in the same installation; if Web Locks are unavailable, it refuses to run.
- `sync-device-id.js` creates the installation ID once, keeps it in `chrome.storage.local` rather than synced storage, and detects corrupt/lost identity. Reinstalling the extension or clearing local storage could require explicit recovery; it must never silently take over a different writer's history.
- This protects a **single authorized browser installation**, not unrestricted multi-device synchronization. Do not enable live writes on multiple installations; a future controlled owner-transfer workflow would be necessary.
- The identity and lock modules are **not wired into the live popup**. This entire section remains a test-only foundation for future controlled writes.

## History-read performance protection

- `drive-journal.js` now caches unchanged history snapshot bodies within an active session when Drive provides `modifiedTime` and `md5Checksum`. Each operation still relists the hidden folder and validates the full parent chain; modifications to previously cached files cause a hard stop.
- `test/drive-journal-cache.test.js` checks that an eight-snapshot sequence requires only eight media downloads rather than repeatedly redownloading old generations, and that modification of an earlier snapshot is rejected.
- The first load after a browser restart still downloads the complete chain. Snapshot growth, garbage collection and chain-compaction policies are not yet implemented; do not run unattended or high-volume writes before those are addressed.

## Required invariants before enabling real sync

1. Never write to `primary` by default. Require explicit selection of the dedicated destination calendar, display its name and ID, and confirm once.
2. Before any initial import, back up the target calendar and verify the backup. Never erase any calendar automatically.
3. History is scoped to one Google account + calendar. A missing/corrupt history file is a **hard stop**, not a reason to initialize a new empty file or reimport everything.
4. Establish history **before** any event creation; after each successful Google create, commit its mapping durably. On interruption, reconcile server-side metadata before retrying to avoid duplicates.
5. Existing matching events can be adopted only when unambiguous. On mismatches or recurring-instance identity conflicts, refuse to auto-add or auto-update until safe resolution.
6. No event is marked intentionally deleted merely because it is absent from a time-bounded list. Confirm with a cancelled event response, or two missing-event checks plus a successful target-calendar access check. Account changes and permissions failures abort the run.
7. An excluded event stays excluded even while Outlook continues to show it; no automatic re-add. Store exclusion by stable Outlook identity, *not* title alone. Do not prune exclusions while their source could reappear in the scan window.
8. Preserve manual Google Calendar titles, locations, dates and times. Changes after the last synchronized baseline are conflicts, never silently overwritten.
9. Do not delete Google Calendar appointments merely because Outlook no longer displays them. Do not infer deletions from an incomplete Outlook scan.
10. Changes should be idempotent: rerunning sync should not create an additional copy. Enforce a single in-progress sync per account/calendar.
11. Sync should be user-initiated while Outlook Web is available. This browser-extension implementation is not an unattended server service.
12. Before enabling live writes, implement backed-up Drive history updates, crash recovery, cross-device concurrency protection, calendar identity checks, a rollback path, and comprehensive end-to-end tests.

## First import and earlier curated deletions

Past Google-side deletions cannot be reconstructed reliably from the current Outlook/Google comparison. The cleanest migration is **a backed-up, dedicated work calendar**, not deletion of the user's primary calendar. On first import, initialize empty history only after explicit confirmation of that new target, then persist each created Google ID. Subsequent confirmed deletions produce permanent exclusions.

## Google setup still required

**Completed:** Google Drive API enabled, `drive.appdata` authorized, and the separate live diagnostic file was successfully created and read. This does not authorize production synchronization yet.

## Isolated live Drive diagnostic (opt-in)

The popup includes **Test Drive save and read**. It creates a small, uniquely named **test-only** JSON document in Drive appDataFolder, verifies it by ID and marker, and on repeat clicks reads the existing file. It does **not** initialize or update production sync history. A test file is left in Drive for future validation, and failures stop without attempting automatic overwrite. This is a storage connectivity test, not proof that the eventual production journal is crash-safe or race-safe.

## Explicitly not implemented yet

No **enabled** Google Calendar POST/PATCH/DELETE calls, no live persistent history updates, no UI to select a safe destination, no first-import execution, no automated rollback, no unattended sync. The new Drive journal's POST operation exists in an isolated development module but is not loaded into the extension; it has not been executed against a real account. This is NOT an atomic concurrent-write solution, so live sync remains disabled. The existing preview and ICS export remain unchanged.
