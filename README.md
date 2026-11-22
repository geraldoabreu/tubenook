# TubeNook

**TubeNook** is a Manifest V3 Chrome Extension that transforms YouTube into a clean, organized workspace for your subscriptions, playlists, and courses.

Organize channels and playlists into nested folders, browse updates in a multi-column Deck view, auto-tag videos, track unlimited watch history and course progress, filter out distractions with Focus Mode, and sync your setup across devices via Chrome Sync or Google Drive.

## Features

- **Nested Folders for Subscriptions & Playlists** — Group your YouTube channels and playlists into customizable folders with icons, colors, and sub-folders directly inside the YouTube sidebar.
- **Multi-Column Deck View** — View and filter recent uploads across multiple folders side-by-side without endless scrolling.
- **Playlist Customization & Indexing** — Customize playlist metadata, organize playlists into folders, and navigate large libraries smoothly.
- **Course & Study Mode** — Track progress across educational playlists with unlimited watched video tracking and custom status labels.
- **Auto-Tagging & Advanced Filters** — Automatically categorize channels and videos by rules, and filter by duration, Shorts, watch status, or custom tags.
- **Focus Mode** — Reduce YouTube distractions when you want to watch or study intentionally.
- **Insights & Analytics** — Understand your subscription activity and watch progress at a glance.
- **Cloud Sync & Backup** — Keep folders, tags, watch progress, and preferences (`language`, `focusMode`, `statusConfig`) synced via **Chrome Sync**, **Google Drive**, or JSON import/export.
- **Zero External Tracking** — All data stays locally in your browser or your own cloud storage.

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
   git clone https://github.com/aevren/tubenook.git
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
