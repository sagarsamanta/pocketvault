# Sharing the PocketVault APK (beta, without Play Store)

## Which file to send

| File | Size (approx.) | Works on |
|---|---|---|
| `PocketVault-1.0.0-arm64.apk` | smallest | **Almost all phones from 2017 onwards** — send this one by default |
| `PocketVault-1.0.0-armv7.apk` | small | Very old / budget 32-bit phones |
| `PocketVault-1.0.0-universal.apk` | largest | Any phone — use if unsure |

All files are in `E:\personal\pocketvault-release\`. Share via WhatsApp, Telegram, Google Drive, email, etc.

## How testers install it

1. Download the `.apk` on the Android phone and tap it.
2. If Android says the source isn't allowed, tap **Settings → Allow from this source**, then go back and tap **Install**.
3. If Play Protect warns that the app is unrecognised, tap **More details → Install anyway** (normal for apps not yet on Play Store).
4. Open **PocketVault**.

Requires Android 7.0 or newer.

## Updating testers

Build a new version with a higher `versionCode` (see `release-notes.md`) and send the new APK — installing it over the old one keeps all their data (same signing key).

## Moving testers to Play Store later

See step 4 in `PLAY_STORE_GUIDE.md`. If you upload your own key to Play App Signing, testers simply update from Play. Otherwise they should back up in **Settings**, uninstall, install from Play and restore.
