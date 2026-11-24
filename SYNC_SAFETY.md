# Calendar Bridge sync engine — development safety contract

Status: **prototype only; no calendar-writing path is enabled.**

## What exists now

- `sync-planner.js`: pure planner with versioned, per-calendar history, one-to-one identity matching, conservative one-time adoption, duplicate/ambiguous matching detection, manual Google edit preservation, and exclusion tombstones.
- `drive-history.js`: original one-file appDataFolder reader and create-once bootstrap; used by the read-only connection check.\n- `history-journal.js` and `drive-journal.js`: **unwired** immutable snapshot history prototype. A complete chain allows recovery and multiple competing branches fail closed; it does not yet provide atomic multi-device locking or a completed writer.
- `test/sync-planner.test.js` and `test/drive-history.test.js`: logic and mocked-API tests.
- GitHub Actions runs Node tests on changes to this branch.

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

Enable **Google Drive API** in the existing Cloud project, and authorize
`https://www.googleapis.com/auth/drive.appdata` for the Chrome extension OAuth client. Do not change the current extension's permissions until the integrated flow is ready to test.

## Isolated live Drive diagnostic (opt-in)

The popup includes **Test Drive save and read**. It creates a small, uniquely named **test-only** JSON document in Drive appDataFolder, verifies it by ID and marker, and on repeat clicks reads the existing file. It does **not** initialize or update production sync history. A test file is left in Drive for future validation, and failures stop without attempting automatic overwrite. This is a storage connectivity test, not proof that the eventual production journal is crash-safe or race-safe.

## Explicitly not implemented yet

No Google Calendar POST/PATCH/DELETE calls, no live persistent history updates, no UI to select a safe destination, no first-import execution, no automated rollback, no unattended sync. The new Drive journal's POST operation exists in an isolated development module but is not loaded into the extension; it has not been executed against a real account. This is NOT an atomic concurrent-write solution, so live sync remains disabled. The existing preview and ICS export remain unchanged.
