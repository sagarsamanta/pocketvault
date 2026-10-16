# PocketVault — Privacy Policy

_Last updated: 16 October 2026_

PocketVault ("the app") is a personal note, bookmark and document keeper developed by Sagar Samanta. This policy explains how the app handles your information.

## Summary

**PocketVault does not collect, sell or share any personal data with the developer or with third parties.** There is no account, no analytics, no advertising and no tracking. Everything you save stays on your device.

## What the app stores — only on your device

Notes, links, photos, scans, documents, voice recordings and transcripts, tags, collections, reminders and settings are stored in a private database and folder on your phone. This data:

- never leaves your device unless **you** export a backup or share an item;
- is not accessible to the developer;
- is deleted with **Settings → Erase all data** or when you uninstall the app.

## Secret vault and app lock

- Items you move to the **secret vault** are encrypted on your device with AES-256-GCM. The encryption key is kept in Android's hardware-backed Keystore and never leaves the device.
- **App lock** uses Android's fingerprint, face or screen-lock prompt. The app never sees or stores your biometric data — Android only tells it whether verification succeeded.
- **Password-protected backups** are encrypted with a key derived from your password (PBKDF2-SHA-256). The password is not stored anywhere.

## On-device intelligence

- **Text recognition (OCR)** in photos and scans runs on your device using Google ML Kit's bundled model.
- **Voice note transcription** only uses Android's on-device speech recognition. If no offline speech model is installed, the app records audio without a transcript rather than sending your voice to a server.
- **Smart actions and spending insights** (detected amounts, dates, phone numbers, emails) are computed locally.

## Network use

The app works fully offline. It only connects to the internet to create **link previews**: when you save a web link, the app downloads that page (and its preview image) directly from the website, so it can show a title, image and an offline reading copy. This request goes only to the website you saved, like opening it in a browser. The developer does not receive it. Previews are skipped while you are offline.

## Document scanner

Scanning uses Google Play services' document scanner on your device. The app does not request camera permission itself; the scanner returns only the pages you confirm.

## Permissions

| Permission | Why |
|---|---|
| Microphone | Recording voice notes (asked when you first record). |
| Notifications | Showing reminders you set. Optional. |
| Run at startup | Restoring scheduled reminders after a restart. |
| Biometrics | App lock and the secret vault (Android's system prompt). |
| Internet | Link previews only. |
| Photos / files (system pickers) | Only the specific items you pick are shared with the app. |

The app does not request location, contacts, camera, SMS or account access.

## Backups

Backups are files you create and keep yourself (for example in your Downloads folder or a cloud drive you choose). Automatic weekly backups are written only to the folder you select. Without a password, backups are readable JSON files and leave out secret-vault items — keep them private.

## Children

The app is not directed at children under 13 and does not knowingly collect any data from anyone.

## Changes

Updates to this policy will be published on this page with a new "Last updated" date.

## Contact

Questions about this policy: **sagarsamanta390@gmail.com**
