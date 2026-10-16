# Publishing PocketVault on Google Play

Everything in this folder is ready; these are the steps you do in the browser.

## 0. What you already have

| Item | Where |
|---|---|
| Play upload bundle (AAB) | `android/app/build/outputs/bundle/release/app-release.aab` (copy kept in `E:\personal\pocketvault-release\`) |
| Upload keystore + passwords | `E:\personal\keystores\` — **back this folder up** (USB drive / password manager). Never commit it. |
| Icon, feature graphic | `store/play-icon-512.png`, `store/feature-graphic-1024x500.png` |
| Screenshots | `store/screenshots/` |
| Listing text | `store/listing.md` |
| Data safety / content answers | `store/data-safety.md` |
| Release notes | `store/release-notes.md` |
| Privacy policy | `docs/privacy-policy.md` |

## 1. Publish the privacy policy (free, 2 minutes)

1. Push this repo to GitHub (see the repo README / ask the assistant).
2. GitHub → `pocketvault` repo → **Settings → Pages**.
3. Source: **Deploy from a branch**, Branch: `main`, folder: **/docs** → Save.
4. After ~1 minute the policy is live at `https://sagarsamanta.github.io/pocketvault/privacy-policy`.

## 2. Create the developer account (one-time US$25)

1. Go to <https://play.google.com/console> and sign in with your **personal** Google account.
2. Choose **Personal** account type, pay the one-time registration fee and complete identity verification.

## 3. Create the app

1. **Create app** → App name `PocketVault: Notes & Links`, default language English, **App**, **Free**.
2. Fill **App content** using `data-safety.md` (privacy policy URL, ads = No, data safety = no data collected, content rating, target audience).
3. Fill **Main store listing** using `listing.md` and upload the graphics + screenshots.

## 4. App signing — important decision

Play re-signs your app with an "app signing key". Choose one:

- **Recommended if testers already installed the shared APK:** *Use a different app signing key* → **Export and upload a key from Java keystore**, and upload the key from `pocketvault-upload.jks` with Google's PEPK tool (Play Console shows the exact command). Then Play builds are signed with the **same key as the shared APK**, so testers can update from Play without uninstalling.
- **Simplest:** let Google generate the app signing key. The shared APK and the Play version will then have different signatures, so testers must **back up (Settings → Share/Save backup), uninstall the APK, install from Play, then restore**.

Either way, `pocketvault-upload.jks` stays your **upload key** — every future AAB must be signed with it.

## 5. Closed test (required for new personal accounts)

1. **Testing → Closed testing → Create track**, upload `app-release.aab`, paste release notes, roll out.
2. Add **at least 12 testers** (their Gmail addresses or a Google Group) and share the opt-in link.
3. Keep the test running for **14 days**, then apply for **Production access** from the Dashboard.

(Requirements as of late 2026 — check the Play Console dashboard for the current numbers.)

## 6. Every future update

1. Bump `expo.android.versionCode` (+1) and `expo.version` in `app.json`.
2. Build: `npm run build:android:release` (APKs + AAB, signed with your upload key).
3. Upload the new `.aab` to the same track.
