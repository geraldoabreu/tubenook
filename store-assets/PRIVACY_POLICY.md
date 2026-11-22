# TubeNook — Privacy Policy

**Last updated:** 2026-11-22  
**Contact:** dev@aevren.si

TubeNook ("the Extension") is designed with a **local-first, privacy-by-default** architecture. We believe your YouTube organization, study notes, and watch history belong strictly to you.

---

## 1. Data We Do NOT Collect
TubeNook has **no backend servers** and collects **zero personal data**:
- No analytics, telemetry, or crash reporting.
- No third-party trackers, cookies, pixels, or advertising SDKs.
- No selling, renting, or sharing of user data with third parties.
- No remote code execution — all extension logic runs locally inside your browser.

---

## 2. Data Stored Locally on Your Device
To provide its features, TubeNook stores the following user-created data locally in your browser via `chrome.storage.local` (with `unlimitedStorage` so large libraries and watched histories are not truncated):
- Subscription groups, nested folders, colors, icons, and channel assignments.
- Custom playlists, tags, and filter preferences.
- Courses Mode structure, lesson completion status, and resume timestamps.
- Video notes and timestamps authored by you.
- Watched video IDs and local library insights.
- UI preferences (language, Focus Mode toggles, Deck column layout).

This data never leaves your device unless you explicitly enable optional synchronization or export a backup file.

---

## 3. Optional Synchronization & Backups

### A. Chrome Sync (`chrome.storage.sync`) — Optional
If you choose to enable Chrome Sync in TubeNook settings, your configuration and lightweight library metadata are synchronized across your Chrome profiles using Google Chrome's built-in sync infrastructure, governed by your Google Chrome account settings.

### B. Google Drive Backup (`appDataFolder`) — Optional
If you explicitly choose to connect Google Drive backup:
- TubeNook uses Chrome's `chrome.identity` OAuth2 API to request access **exclusively** to the hidden `https://www.googleapis.com/auth/drive.appdata` scope (`appDataFolder`).
- TubeNook **cannot** see, read, modify, or delete any of your regular Google Drive files or folders. It only reads and writes its own backup file inside the isolated application data folder.
- You can disconnect Google Drive and revoke OAuth access at any time from TubeNook settings or your Google Account security page.

---

## 4. Access to YouTube Pages (`*://*.youtube.com/*`)
TubeNook runs content scripts exclusively on `youtube.com` pages to:
- Inject the TubeNook sidebar, Deck view, Courses view, Focus Mode CSS rules, and timestamp note tools.
- Read visible channel names, video titles, playlist items, and player playback time locally in the browser DOM so you can organize them.

TubeNook never transmits your YouTube browsing activity to any external server.

---

## 5. User Control, Export & Deletion
You remain in full control of your data at all times:
- **Export:** Export your entire TubeNook library as a standard JSON file at any time.
- **Delete:** Clear all extension data from TubeNook's settings page, or uninstall the extension to remove all local storage immediately.

---

## 6. Changes & Contact
If this Privacy Policy is ever updated, the revised version will be published in the extension repository and on the TubeNook website with an updated date.

For any privacy questions or requests, contact: **dev@aevren.si**.
