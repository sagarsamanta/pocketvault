# Stash

An offline-first Android app (Expo SDK 57 / React Native 0.86, TypeScript) for saving notes, links, images and documents, with collections, tags, favorites, full-text search, on-device OCR, reminders and local backups. Nothing leaves the device; no account or network service is required.

## Features

- **Save anything**: notes, links, images (multi-select from the photo picker) and documents (any file type).
- **Share into the app** from any Android app (text, URLs, images, files — single or multiple).
- **Organize**: collections (create/rename/delete — items are kept), tags (assign/rename/delete), favorites.
- **Search** titles, notes, URLs, tags, attachment names, OCR text and text-document contents (SQLite FTS5, prefix matching, all terms required).
- **OCR**: on-device ML Kit text recognition (bundled Latin model, works offline) with status, error display and retry.
- **Reminders**: presets or a custom date/time; edit, complete, cancel; local notifications that open the item; works (in-app only) when notification permission is denied.
- **Backup/restore**: single JSON file (records, relationships, attachments, settings) saved to a chosen folder or shared; restore replaces data atomically.
- **Themes**: system / light / dark.

## Project layout

```
src/app/          expo-router screens (_layout, index, item/[id], edit, shareintent, collections, tags, reminders, settings, onboarding)
src/components/   UI kit, dialogs/toasts, sheets, item card, tag/collection pickers, date picker (native + web)
src/db/           SQLite adapter, migrations, repository (all SQL), FTS query builder
src/services/     AppServices (coordinates DB + files + notifications + OCR), backup, file store, platform adapters
src/share/        Android share-intent bridge, notification tap routing
src/theme/        palettes and ThemeProvider
e2e/              Playwright tests for the web build
```

Platform-specific modules use `.web.ts(x)` siblings; web builds stub out native-only features (files, OCR, notifications, share intents).

### Data safety

- Schema changes are append-only migrations tracked with `PRAGMA user_version`; each runs in a transaction.
- Every multi-step write runs in a serialized `BEGIN IMMEDIATE` transaction.
- File imports are all-or-nothing; orphaned files from an interrupted import are removed at next launch.
- Restore stages files first, swaps all rows in one transaction, then moves files; an interrupted restore is completed at next launch. An invalid or failing backup leaves existing data untouched.
- Missing attachment files are reported in the UI and skipped (not fatal) in backups.

## Requirements

- Node 20+ (tested with Node 24) and npm
- JDK 17 and the Android SDK (platform 36, build-tools 36, NDK 27.1 — Gradle downloads what is missing)
- An Android emulator or device (Android 7.0 / API 24+)

Set `JAVA_HOME` to a JDK 17 and `ANDROID_HOME` to the SDK.

## Commands

```bash
npm install
npm run typecheck        # tsc --noEmit
npm run lint             # expo lint (ESLint 9 flat config)
npm test                 # Jest: repository, search, migrations, backup, services, performance

npx expo prebuild --platform android      # generate android/ (Continuous Native Generation)
npm run android                           # build, install and launch the debug app (starts Metro)
npm run android:release                   # release variant (signed with the debug keystore — configure a real keystore before publishing)

npm run web              # Expo web build (uses expo-sqlite wasm; no FTS5 → LIKE search fallback)
npm run test:e2e         # Playwright against the web build (uses installed Chrome; set E2E_BROWSER_CHANNEL=msedge to use Edge)
```

On machines with limited RAM, build a single ABI with limited parallelism:

```bash
cd android && ./gradlew assembleDebug -PreactNativeArchitectures=x86_64 --max-workers=2
```

### Patched dependency

`patches/expo-share-intent+8.0.1.patch` (applied automatically by `patch-package` on `npm install`) fixes a crash in `expo-share-intent` when a sharing app's content provider returns an empty cursor or no MIME type. Remove it once the upstream package handles this.

### Development notes

- `CI=1 npx expo start` disables Metro's file watcher — restart it after code changes.
- Android won't let apps pick the top-level `Download` folder for folder access; create or choose a subfolder (e.g. `Download/Stash backups`) when saving a backup.

## Known limitations

- When sharing into Stash, the page title is read from `EXTRA_TITLE`; apps that only send `EXTRA_SUBJECT` produce a title derived from the shared text instead.

- PDF and Office documents are stored and can be opened/shared, but their text is not extracted for search (plain-text formats are indexed).
- OCR covers Latin script only.
- Backups embed attachments as base64 in one JSON file, so very large libraries produce large backup files.
- Reminder notifications use inexact alarms unless the user grants exact-alarm permission (Android 12+), so they may fire a few minutes late.
- The web build is for development/testing: no attachments, OCR, share intents or system notifications, and only one tab may have the database open.
