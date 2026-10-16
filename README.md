# PocketVault

An offline-first Android app (Expo SDK 57 / React Native 0.86, TypeScript) for saving notes, links, images and documents, with collections, tags, favorites, full-text search, on-device OCR, reminders and local backups. Nothing leaves the device; no account or network service is required.

## Features

- **Capture**: notes (checklists, headings, bold), links, photos, documents, document scans (ML Kit scanner → PDF + OCR), voice notes (on-device transcript on Android 13+), share-to-app with optional Quick Save, home-screen widget.
- **Organize**: collections, tags, favorites, pins, colour labels, swipe actions, list and masonry grid views.
- **Find**: SQLite FTS5 search plus Smart Search ("receipts over 500 last month", "links this week", "#tag", "in:Collection").
- **Smart**: on-device OCR, detected facts (totals, dates, phones, emails, links) with one-tap Smart Actions, spending and activity Insights, daily Rediscover.
- **Links**: rich previews (title, site, image) and an offline reader copy, fetched when online; duplicate-link warning.
- **Private**: fully offline core, app lock (biometric / screen lock), AES-256-GCM secret vault with a Keystore key, password-protected and automatic weekly backups.
- **Reminders**: presets or custom time, local notifications that open the item.

## Project layout

```
src/app/          expo-router screens (home, item/[id], edit, record, scan, reader, vault, insights, shareintent, collections, tags, reminders, settings, onboarding)
src/capture/      document scanner + PDF
src/security/     biometric app lock
src/widgets/      Android home-screen widget (registered in index.ts)
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
- Android won't let apps pick the top-level `Download` folder for folder access; create or choose a subfolder (e.g. `Download/PocketVault backups`) when saving a backup.

## Release & distribution

- **Package ID:** `com.sagarsamanta.pocketvault` (permanent once published).
- **Signing:** `plugins/withReleaseSigning.js` signs release builds with an upload keystore kept outside the repo. It reads `POCKETVAULT_SIGNING_PROPERTIES` or `../keystores/pocketvault-signing.properties` (keys: `storeFile`, `storePassword`, `keyAlias`, `keyPassword`). Without it, release builds fall back to the debug key and print a warning.
- **Build everything:** `npm run build:android:release` → per-ABI + universal APKs in `android/app/build/outputs/apk/release/` and the Play bundle in `android/app/build/outputs/bundle/release/app-release.aab`.
- **Store material:** `store/` (listing text, data-safety answers, release notes, icon, feature graphic, screenshots, step-by-step guides) and `docs/privacy-policy.md` (served via GitHub Pages).

## Known limitations

- When sharing into PocketVault, the page title is read from `EXTRA_TITLE`; apps that only send `EXTRA_SUBJECT` produce a title derived from the shared text instead.

- PDF and Office documents are stored and can be opened/shared, but their text is not extracted for search (plain-text formats are indexed).
- OCR covers Latin script only.
- Backups embed attachments as base64 in one JSON file, so very large libraries produce large backup files.
- Reminder notifications use inexact alarms unless the user grants exact-alarm permission (Android 12+), so they may fire a few minutes late.
- The web build is for development/testing: no attachments, OCR, share intents or system notifications, and only one tab may have the database open.
