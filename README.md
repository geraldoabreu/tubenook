# TubeNook

**TubeNook** is a Manifest V3 Chrome Extension that transforms YouTube into a clean, organized workspace for your subscriptions, playlists, and courses.

Organize channels into topic collections, customize every playlist's icon/color/cover inside TubeNook, browse updates in a multi-column Deck view, study with Courses Mode & timestamped notes, filter out distractions with Focus Mode, and sync your setup across devices via Chrome Sync or Google Drive.

## Features

- **Organized Subscriptions** — Group your YouTube channels into flat, customizable collections with icons, colors, and custom images directly inside the YouTube sidebar while keeping YouTube's native "You" and "Subscriptions" sections clean.
- **Customizable Playlists (Native + Custom)** — View and customize the layout (icon, color, cover image) of ALL your YouTube playlists inside TubeNook using the exact same unified editor as Subscriptions, with 1-click Save-to-Playlist modal injection, Watch/Shorts quick bar, multi-select bulk actions, duration & watched `%` stats, and 1-click row actions.
- **Multi-Column Deck View** — View and filter recent uploads across multiple subscription groups, channels, and playlists side-by-side without endless scrolling.
- **Courses Mode with Auto-Sequencing** — Turn any playlist or set of videos into a structured course with automatic module/lesson ordering, completion checkboxes, next/previous lesson navigation, and progress tracking.
- **Notes & Timestamps** — Take study notes linked to exact video timestamps and jump back with a single click.
- **Auto-Tagging, Smart Rules & Advanced Filters** — Automatically categorize channels by rules, filter by unlimited tags (AND/OR/Exclude), duration, Shorts, or watch status, and hide distracting keywords.
- **Focus Mode & Library Insights** — Hide YouTube distractions with 1 click and monitor watch time, channel health, and course progress.
- **Lightweight MV3 Performance** — Single bundled content script + native MV3 CSS injection, scoped observers, and zero external tracking.
- **Cloud Sync & Backup** — Keep collections, playlists, courses, notes, watch progress, and preferences (`language`, `focusMode`, `statusConfig`) synced via **Chrome Sync**, **Google Drive (`appDataFolder`)**, or JSON/CSV export & import.

## Supported Languages

TubeNook natively supports 4 locales (switchable in settings and synced across devices):

| Locale | Language |
| --- | --- |
| `pt-BR` | Português (Brasil) |
| `pt-PT` | Português (Portugal) |
| `en` | English |
| `es` | Español |

## Installation

### Chrome Web Store

Install **TubeNook** directly from the Chrome Web Store *(link coming soon upon publication)*.

### From Source (Developer Mode)

1. Clone this repository:
   ```bash
   git clone https://github.com/geraldoabreu/tubenook.git
   cd tubenook
   ```
2. Build the extension:
   ```bash
   npm run build
   ```
3. Open Chrome and navigate to `chrome://extensions/`.
4. Enable **Developer mode** in the top-right corner.
5. Click **Load unpacked** and select the generated `dist/` directory.

## Development

TubeNook uses pure ES modules with zero runtime dependencies and Node's built-in test runner.

```bash
# Run the test suite
npm test

# Build the unpacked extension into dist/
npm run build

# Package a release zip into release/tubenook-v1.0.0.zip
npm run package
```

## Google Drive Sync Setup

TubeNook supports backing up and syncing your full state (folders, playlists, watched history, auto-tag rules, and settings) to your personal Google Drive using the hidden `appDataFolder` scope (so TubeNook can only access its own sync file).

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/) and enable the **Google Drive API**.
2. Configure the **OAuth consent screen** (External or Internal) and add the `https://www.googleapis.com/auth/drive.appdata` scope.
3. Under **Credentials**, create an **OAuth 2.0 Client ID** of type **Chrome Extension**, using your extension's ID from `chrome://extensions/`.
4. Add the `oauth2` block to `manifest.json` (or configure your Client ID in TubeNook's Options page under **Sync -> Google Drive**):
   ```json
   "oauth2": {
     "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
     "scopes": [
       "https://www.googleapis.com/auth/drive.appdata"
     ]
   }
   ```
5. Reload the extension, open **TubeNook Options -> Sync**, click **Connect Google Drive**, and use **Push** / **Pull** to sync across devices.

## Feedback & Suggestions

Have an idea, bug report, or feature suggestion? Reach out anytime at **[dev@aevren.si](mailto:dev@aevren.si)** or open an issue on GitHub.

## Support TubeNook

If TubeNook helps keep your YouTube organized and focused, consider supporting development:

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-aevren-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/aevren)

https://buymeacoffee.com/aevren

## License

This project is licensed under the **MIT License** — see the [LICENSE](./LICENSE) file for details.
