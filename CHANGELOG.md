# Changelog

All notable changes to **TubeNook** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-11-24

### Added
- **Unified Playlist & Subscription Editor**: Creating and customizing playlists now uses the exact same Manager modal workflow (Name, Color swatches, 110+ searchable icons, Custom image upload) as Subscriptions.
- **Automated i18n Key Audit Test**: Static regression test verifying 0 missing translation keys across `src/**/*.{js,html}` in all 4 locales (`pt-BR`, `pt-PT`, `en`, `es`).

### Changed
- **MV3 Single-Bundle Content Script & Native CSS**: Bundled content script into `dist/src/content/content.bundle.js` and declared all 5 stylesheets natively in `manifest.json` to eliminate cross-origin `chrome-extension://` errors in Chrome and Opera.
- **Sidebar & Deck Polish**: Elevated `TubeNook` brand header with official inline SVG icon, unified `Deck`, `Inscrições`, `Listas de reprodução`, and `Cursos` sidebar items, fixed Deck flex card sizing, and repositioned the Shorts quick bar to top-right so it never overlaps the timeline scrubber.

## [1.0.0] - 2026-11-22

### Added
- **TubeNook Rebrand & Visual Identity**: Complete TubeNook branding, custom SVG logo, Chrome Web Store promotional assets, privacy policy, and landing page.
- **Nested Folders for Subscriptions & Playlists**: Organize channels and playlists into customizable folders directly in the YouTube sidebar.
- **Playlist Customization & Performance Indexing**: Customize playlist appearance/metadata and enjoy faster playlist and sidebar rendering.
- **Multi-Column Deck View**: Track recent uploads across multiple folders simultaneously.
- **Course & Study Mode**: Unlimited watched video tracking, progress indicators, and custom status badges.
- **Auto-Tagger & Advanced Filters**: Automatic categorization rules, Shorts filtering, duration filters, and Focus Mode.
- **4-Language Internationalization**: Full UI localization in `pt-BR`, `pt-PT`, `en`, and `es` with parity validation.
- **Cloud Sync & Backup**: Full settings and state sync (`language`, `focusMode`, `statusConfig`, folders, playlists, watched history) across Google Drive (`appDataFolder`), Chrome Sync, and JSON import/export.
- **Release Packaging & CI**: Automated release packaging (`npm run package`) and GitHub Actions CI workflow running tests and builds on Node 22 & 24.
