# TubeNook — Chrome Web Store Permissions Justification

This document provides the exact justification for every permission declared in `manifest.json` for Chrome Web Store review.

---

## Single Purpose Statement
**TubeNook** has a single, focused purpose: helping users organize their YouTube subscriptions, custom playlists, multi-column Deck feeds, courses, timestamped study notes, and Focus Mode preferences directly inside YouTube.

---

## Remote Code Declaration
**No remote code is used.** All JavaScript, CSS, HTML, and SVG/PNG assets are packaged statically inside the extension bundle. No external scripts are loaded or evaluated.

---

## Permission-by-Permission Justification

| Permission | Justification |
| :--- | :--- |
| **`storage`** | Required to persist user-created subscription groups, nested folders, custom playlists, Courses Mode progress, video notes with timestamps, Focus Mode toggles, and language/UI settings locally (`chrome.storage.local`) and optionally via `chrome.storage.sync`. |
| **`unlimitedStorage`** | Required because users with hundreds of subscribed channels, extensive study notes, and unlimited watched-video history can exceed the default 10 MB `chrome.storage.local` quota. Ensures local-first data is never silently truncated. |
| **`tabs`** | Required to detect open `youtube.com` tabs when the user triggers actions from the extension popup, options page, or context menu (e.g., jumping to a video/course, opening the Deck view, or refreshing active YouTube tabs when settings or synced data change). |
| **`activeTab`** | Required to interact with the currently active YouTube tab on explicit user action (such as adding the current channel/video to a TubeNook folder or capturing the current playback timestamp for a note). |
| **`contextMenus`** | Required to register convenient right-click context menu items on YouTube links and pages (e.g., "Add channel to TubeNook group", "Add video to TubeNook playlist/course"). |
| **`identity`** | Required exclusively for the **optional**, user-initiated Google Drive backup feature (`chrome.identity.getAuthToken`), requesting only the restricted `drive.appdata` scope so users can back up and restore their TubeNook JSON data in their own hidden Drive `appDataFolder`. Never invoked unless the user clicks "Connect Google Drive". |
| **`*://*.youtube.com/*` (Host Permission)** | Required so TubeNook's content scripts and styles can inject the subscription folders sidebar, YouTube Deck, Courses Mode organizer, timestamped notes panel, and Focus Mode filters directly into YouTube pages. TubeNook does not run on any other domain. |
