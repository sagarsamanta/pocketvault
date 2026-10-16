# Play Console answers — PocketVault

Use these when filling the **App content** section of Play Console.

## Data safety

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **No** |
| Is all of the user data collected by your app encrypted in transit? | Not applicable (no data is transmitted) |
| Do you provide a way for users to request that their data is deleted? | Data never leaves the device; users delete it in-app via **Settings → Erase all data** or by uninstalling |

Reasoning: all content is stored only on the device; OCR and voice transcription run on-device; the secret vault is encrypted with a Keystore-held key; no analytics, crash reporting or ads. The only network use is fetching link previews directly from the website the user saved (no data goes to the developer or any third-party service). Backups are created and stored by the user.

If Play asks about "Audio" or "Photos and videos": they are **processed on device only and never collected or shared** — answer "not collected".

## Other App content forms

| Form | Answer |
|---|---|
| Privacy policy | URL from listing.md |
| Ads | No, the app does not contain ads |
| App access | All functionality is available without special access (no login) |
| Content rating (IARC questionnaire) | Category: Utility/Productivity. Answer **No** to violence, sexual content, profanity, drugs, gambling, user-to-user communication and location sharing. Expected rating: Everyone / 3+ |
| Target audience | 18+ (or 13+). Not designed for children |
| News app | No |
| COVID-19 contact tracing | No |
| Government app | No |
| Financial features | None |
| Health | None |

## Permissions declarations

The app requests `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `RECORD_AUDIO` (voice notes, runtime-requested), `USE_BIOMETRIC` (app lock / vault) and `INTERNET` (link previews). None needs a special declaration form. It does **not** request exact alarms, location, camera, contacts, SMS, broad storage access or a foreground service.
