/**
 * @fileoverview Manifest V3 Service Worker for TubeNook.
 * Handles runtime messages, YouTube RSS/Atom feed fetching, handle-to-UCID resolution,
 * courses management, multi-device sync, context menus, badge updates, and tab broadcasting.
 */

import { MESSAGE_ACTIONS, SORT_OPTIONS } from '../shared/types.js';
import {
  hydrateState,
  loadState,
  saveState,
  resetState,
  updateSettings,
  createGroup,
  updateGroup,
  deleteGroup,
  moveGroup,
  upsertChannels,
  removeChannel,
  assignChannelToGroups,
  bulkAssignChannelsToGroup,
  setChannelTags,
  getChannelsByGroup,
  exportChannelsCsv,
  upsertPlaylists,
  removePlaylist,
  assignPlaylistToGroups,
  updatePlaylistProgress,
  addVideoToPlaylist,
  removeVideoFromPlaylist,
  reorderPlaylistVideos,
  moveVideoToTop,
  moveVideoToBottom,
  setPlaylistThumbnail,
  customizePlaylist,
  toggleVideoWatched,
  bulkMarkWatched,
  clearWatchedHistory,
  createDeckColumn,
  updateDeckColumn,
  deleteDeckColumn,
  saveDeckColumns,
  upsertVideoNote,
  deleteVideoNote,
  saveSmartRules,
  applySmartRulesToChannels,
  createCourse,
  updateCourse,
  deleteCourse,
  addLessonToCourse,
  removeLessonFromCourse,
  toggleLessonComplete,
  applyCourseSequence,
  exportStateJson,
  importStateJson,
} from '../shared/storage.js';
import {
  pushToChromeSync,
  pullFromChromeSync,
  getGoogleDriveToken,
  pushToGoogleDrive,
  pullFromGoogleDrive,
  disconnectGoogleDrive,
} from '../shared/sync.js';
import { tagAllChannels, computeChannelStatus } from '../shared/auto-tagger.js';
import { t } from '../shared/i18n.js';

const FEED_CACHE_TTL_MS = 5 * 60 * 1000;
const AUTO_SYNC_DEBOUNCE_MS = 3000;
/** @type {Map<string, { fetchedAt: number, entries: any[] }>} */
const feedCache = new Map();
/** @type {Map<string, string>} */
const ucIdCache = new Map();
/** @type {ReturnType<typeof setTimeout> | null} */
let autoSyncTimer = null;
let autoSyncInFlight = false;

/**
 * Decode common XML entities.
 * @param {string} str
 * @returns {string}
 */
function decodeXml(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

/**
 * Extract the text content of the first matching XML tag.
 * @param {string} xml
 * @param {string} tag
 * @returns {string}
 */
function extractTag(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(re);
  return m ? decodeXml(m[1].trim()) : '';
}

/**
 * Parse a YouTube Atom RSS feed XML string into structured video entries.
 * Works without DOMParser (service-worker & Node safe).
 * @param {string} xmlText
 * @returns {Array<{ videoId: string, title: string, channelId: string, channelTitle: string, publishedAt: number, thumbnailUrl: string, url: string, views: number, isShort: boolean }>}
 */
export function parseYouTubeAtomFeed(xmlText) {
  if (!xmlText || typeof xmlText !== 'string') return [];

  const feedChannelId = extractTag(xmlText, 'yt:channelId');
  const feedTitle = extractTag(xmlText, 'title');
  const entries = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;

  let match;
  while ((match = entryRegex.exec(xmlText)) !== null) {
    const block = match[1];
    const videoId = extractTag(block, 'yt:videoId');
    if (!videoId) continue;

    const title = extractTag(block, 'title');
    const channelId = extractTag(block, 'yt:channelId') || feedChannelId;
    const authorBlock = extractTag(block, 'author');
    const channelTitle = extractTag(authorBlock, 'name') || feedTitle;
    const publishedStr = extractTag(block, 'published') || extractTag(block, 'updated');
    const publishedAt = publishedStr ? Date.parse(publishedStr) || 0 : 0;

    const linkMatch = block.match(/<link[^>]+href="([^"]+)"/i);
    const url = linkMatch ? decodeXml(linkMatch[1]) : `https://www.youtube.com/watch?v=${videoId}`;

    const thumbMatch = block.match(/<media:thumbnail[^>]+url="([^"]+)"/i);
    const thumbnailUrl = thumbMatch
      ? decodeXml(thumbMatch[1])
      : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    const viewsMatch = block.match(/<media:statistics[^>]+views="(\d+)"/i);
    const views = viewsMatch ? parseInt(viewsMatch[1], 10) : 0;

    const isShort =
      url.includes('/shorts/') || /#shorts\b/i.test(title) || /#short\b/i.test(title);

    entries.push({
      videoId,
      title,
      channelId,
      channelTitle,
      publishedAt,
      thumbnailUrl,
      url,
      views,
      isShort,
    });
  }

  return entries;
}

/**
 * Resolve a channel's canonical UC... channel ID from its existing `ucId`/`id`,
 * or by fetching its YouTube handle page and extracting `externalId`/`channelId`/`channel_id`.
 * Persists newly discovered `ucId` back into `state.channels`.
 * @param {Partial<import('../shared/types.js').Channel>} ch
 * @param {import('../shared/types.js').AppState} [existingState]
 * @returns {Promise<string | null>}
 */
export async function resolveChannelUcId(ch, existingState = undefined) {
  if (!ch) return null;
  if (typeof ch.ucId === 'string' && ch.ucId.startsWith('UC')) return ch.ucId;
  if (typeof ch.id === 'string' && ch.id.startsWith('UC')) return ch.id;

  const rawHandle =
    (typeof ch.handle === 'string' && ch.handle.trim()) ||
    (typeof ch.id === 'string' && ch.id.trim().startsWith('@') ? ch.id.trim() : '');
  if (!rawHandle) return null;

  const normalizedHandle = rawHandle.startsWith('@') ? rawHandle : `@${rawHandle}`;
  const cacheKey = normalizedHandle.toLowerCase();

  let resolved = ucIdCache.get(cacheKey) || null;
  if (!resolved) {
    try {
      const res = await fetch(`https://www.youtube.com/${encodeURIComponent(normalizedHandle).replace('%40', '@')}`, {
        credentials: 'omit',
      });
      if (!res.ok) return null;
      const html = await res.text();
      const match =
        html.match(/"(?:externalId|channelId)":"(UC[\w-]{20,})"/) ||
        html.match(/channel_id=(UC[\w-]{20,})/);
      if (match && match[1]) {
        resolved = match[1];
        ucIdCache.set(cacheKey, resolved);
      }
    } catch {
      return null;
    }
  }

  if (resolved && ch.id) {
    if (existingState?.channels?.[ch.id]) {
      existingState.channels[ch.id].ucId = resolved;
    } else if (!existingState) {
      try {
        const state = await loadState();
        if (state.channels[ch.id] && state.channels[ch.id].ucId !== resolved) {
          state.channels[ch.id].ucId = resolved;
          await saveState(state);
        }
      } catch {
        // Ignore persistence errors during standalone resolution
      }
    }
  }

  return resolved;
}

/**
 * Fetch and parse a YouTube RSS feed for a channel ID or playlist ID (with 5-minute cache).
 * @param {{ channelId?: string, playlistId?: string, forceRefresh?: boolean }} params
 */
export async function fetchYouTubeFeed({ channelId, playlistId, forceRefresh = false }) {
  const key = channelId ? `ch:${channelId}` : playlistId ? `pl:${playlistId}` : '';
  if (!key) return [];

  const cached = feedCache.get(key);
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < FEED_CACHE_TTL_MS) {
    return cached.entries;
  }

  const feedUrl = channelId
    ? `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`
    : `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`;

  try {
    const res = await fetch(feedUrl, { credentials: 'omit' });
    if (!res.ok) return cached?.entries || [];
    const xml = await res.text();
    const entries = parseYouTubeAtomFeed(xml);
    feedCache.set(key, { fetchedAt: Date.now(), entries });
    return entries;
  } catch {
    return cached?.entries || [];
  }
}

/**
 * Run an async mapper over items with bounded concurrency.
 * @template T, R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < items.length) {
      const i = nextIdx++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Sort feed entries according to SORT_OPTIONS.
 * @param {any[]} entries
 * @param {string} sortBy
 */
function sortFeedEntries(entries, sortBy) {
  const list = [...entries];
  switch (sortBy) {
    case SORT_OPTIONS.DATE_ASC:
      return list.sort((a, b) => (a.publishedAt || 0) - (b.publishedAt || 0));
    case SORT_OPTIONS.VIEWS_DESC:
      return list.sort((a, b) => (b.views || 0) - (a.views || 0));
    case SORT_OPTIONS.VIEWS_ASC:
      return list.sort((a, b) => (a.views || 0) - (b.views || 0));
    case SORT_OPTIONS.TITLE_ASC:
      return list.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    case SORT_OPTIONS.TITLE_DESC:
      return list.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
    case SORT_OPTIONS.RANDOM:
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      return list;
    case SORT_OPTIONS.DATE_DESC:
    default:
      return list.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
  }
}

/**
 * Broadcast STATE_UPDATED to all open YouTube tabs.
 * @param {import('../shared/types.js').AppState} state
 */
async function broadcastStateUpdated(state) {
  if (typeof chrome === 'undefined' || !chrome.tabs) return;
  try {
    const tabs = await chrome.tabs.query({ url: '*://*.youtube.com/*' });
    for (const tab of tabs) {
      if (tab.id !== undefined) {
        chrome.tabs
          .sendMessage(tab.id, { action: MESSAGE_ACTIONS.STATE_UPDATED, state })
          .catch(() => {});
      }
    }
  } catch {
    // Ignore tab broadcast errors
  }
}

/**
 * Update the extension toolbar badge with the number of user groups.
 * @param {import('../shared/types.js').AppState} state
 */
async function updateBadge(state) {
  if (typeof chrome === 'undefined' || !chrome.action) return;
  try {
    const count = Object.keys(state.groups || {}).length;
    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#ef233c' });
  } catch {
    // Ignore badge errors
  }
}

/**
 * Schedule a debounced, non-blocking cloud push when auto-sync is enabled.
 * @param {import('../shared/types.js').AppState} state
 */
function scheduleAutoSync(state) {
  const sync = state?.settings?.sync;
  if (!sync?.autoSync) return;
  if (sync.provider !== 'chrome' && sync.provider !== 'gdrive') return;
  if (typeof chrome === 'undefined') return;

  if (autoSyncTimer !== null) {
    clearTimeout(autoSyncTimer);
  }

  autoSyncTimer = setTimeout(() => {
    autoSyncTimer = null;
    if (autoSyncInFlight) return;
    autoSyncInFlight = true;

    (async () => {
      try {
        const latest = await loadState();
        const cfg = latest.settings?.sync;
        if (!cfg?.autoSync) return;

        if (cfg.provider === 'chrome') {
          if (!chrome.storage?.sync) return;
          const result = await pushToChromeSync(latest);
          const updated = await updateSettings({
            sync: {
              ...latest.settings.sync,
              lastSyncedAt: result.syncedAt,
              lastSyncStatus: 'ok',
            },
          });
          await notifyMutation(updated, { skipAutoSync: true });
        } else if (cfg.provider === 'gdrive') {
          if (!chrome.identity) return;
          const lang = latest.settings?.language || 'pt-BR';
          const token = await getGoogleDriveToken(cfg.gdriveClientId || '', false, lang);
          const result = await pushToGoogleDrive(latest, token);
          const updated = await updateSettings({
            sync: {
              ...latest.settings.sync,
              lastSyncedAt: result.syncedAt,
              lastSyncStatus: 'ok',
            },
          });
          await notifyMutation(updated, { skipAutoSync: true });
        }
      } catch (err) {
        // Non-blocking: auto-sync failures must never break user mutations
        console.warn('[TubeNook AutoSync]', err?.message || err);
      } finally {
        autoSyncInFlight = false;
      }
    })();
  }, AUTO_SYNC_DEBOUNCE_MS);

  if (typeof autoSyncTimer?.unref === 'function') {
    autoSyncTimer.unref();
  }
}

/**
 * Persist notification helper after any state-mutating action.
 * @param {import('../shared/types.js').AppState} state
 * @param {{ skipAutoSync?: boolean }} [options]
 */
async function notifyMutation(state, options = {}) {
  await Promise.all([broadcastStateUpdated(state), updateBadge(state)]);
  if (!options.skipAutoSync) {
    scheduleAutoSync(state);
  }
  return state;
}

/**
 * Register YouTube context menus.
 */
async function setupContextMenus() {
  if (typeof chrome === 'undefined' || !chrome.contextMenus) return;
  try {
    const state = await loadState();
    const lang = state.settings?.language || 'pt-BR';
    await chrome.contextMenus.removeAll();

    chrome.contextMenus.create({
      id: 'tp-add-channel',
      title: t('context.addChannel', lang),
      contexts: ['page', 'link'],
      documentUrlPatterns: ['*://*.youtube.com/*'],
    });

    chrome.contextMenus.create({
      id: 'tp-toggle-watched',
      title: t('context.toggleWatched', lang),
      contexts: ['page', 'link'],
      documentUrlPatterns: ['*://*.youtube.com/*'],
    });

    chrome.contextMenus.create({
      id: 'tp-open-deck',
      title: t('context.openDeck', lang),
      contexts: ['page', 'action'],
      documentUrlPatterns: ['*://*.youtube.com/*'],
    });
  } catch {
    // Ignore context menu setup errors
  }
}

/**
 * Main message dispatcher for runtime messages.
 * @param {any} msg
 */
export async function handleMessage(rawMsg) {
  if (!rawMsg || !rawMsg.action) {
    return { ok: false, error: 'Missing message action.' };
  }
  // Support both `{ action, ...fields }` and `{ action, payload: { ...fields } }`
  const msg =
    rawMsg.payload && typeof rawMsg.payload === 'object'
      ? { ...rawMsg.payload, ...rawMsg }
      : rawMsg;

  try {
    switch (msg.action) {
      case MESSAGE_ACTIONS.GET_STATE: {
        const state = await loadState();
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.UPDATE_SETTINGS: {
        const state = await notifyMutation(await updateSettings(msg.settings || {}));
        await setupContextMenus();
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.RESET_STATE: {
        const state = await notifyMutation(await resetState());
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.CREATE_GROUP: {
        const { state, group } = await createGroup(msg.group || {});
        await notifyMutation(state);
        return { ok: true, state, group };
      }

      case MESSAGE_ACTIONS.UPDATE_GROUP: {
        const state = await notifyMutation(await updateGroup(msg.id, msg.patch || {}));
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.DELETE_GROUP: {
        const state = await notifyMutation(await deleteGroup(msg.id, msg.options || {}));
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.MOVE_GROUP: {
        const state = await notifyMutation(await moveGroup(msg.id, msg.newParentId ?? null, msg.newOrder));
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.UPSERT_CHANNELS: {
        const state = await notifyMutation(await upsertChannels(msg.channels || []));
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.REMOVE_CHANNEL: {
        const state = await notifyMutation(await removeChannel(msg.channelId));
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.ASSIGN_CHANNEL_GROUPS: {
        const state = await notifyMutation(
          await assignChannelToGroups(msg.channelId, msg.groupIds || [])
        );
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.BULK_ASSIGN_CHANNELS: {
        const state = await notifyMutation(
          await bulkAssignChannelsToGroup(msg.channelIds || [], msg.groupId, msg.mode || 'add')
        );
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.SET_CHANNEL_TAGS: {
        const state = await notifyMutation(await setChannelTags(msg.channelId, msg.tags || []));
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.AUTO_TAG_CHANNELS: {
        const state = await loadState();
        state.channels = tagAllChannels(state.channels);
        const saved = await notifyMutation(await saveState(state));
        return { ok: true, state: saved };
      }

      case MESSAGE_ACTIONS.UPSERT_PLAYLISTS: {
        const state = await notifyMutation(await upsertPlaylists(msg.playlists || []));
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.REMOVE_PLAYLIST: {
        const state = await notifyMutation(await removePlaylist(msg.playlistId));
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.ASSIGN_PLAYLIST_GROUPS: {
        const state = await notifyMutation(
          await assignPlaylistToGroups(msg.playlistId, msg.groupIds || [])
        );
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.UPDATE_PLAYLIST_PROGRESS: {
        const state = await notifyMutation(
          await updatePlaylistProgress(msg.playlistId, msg.watchedCount, msg.videoCount)
        );
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.ADD_VIDEO_TO_PLAYLIST: {
        const state = await notifyMutation(
          await addVideoToPlaylist(msg.playlistId, msg.video)
        );
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.REMOVE_VIDEO_FROM_PLAYLIST: {
        const state = await notifyMutation(
          await removeVideoFromPlaylist(msg.playlistId, msg.videoId)
        );
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.REORDER_PLAYLIST_VIDEOS: {
        const state = await notifyMutation(
          await reorderPlaylistVideos(msg.playlistId, msg.orderedVideoIds || [])
        );
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.MOVE_VIDEO_TO_TOP: {
        const state = await notifyMutation(
          await moveVideoToTop(msg.playlistId, msg.videoId)
        );
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.MOVE_VIDEO_TO_BOTTOM: {
        const state = await notifyMutation(
          await moveVideoToBottom(msg.playlistId, msg.videoId)
        );
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.SET_PLAYLIST_THUMBNAIL: {
        const state = await notifyMutation(
          await setPlaylistThumbnail(msg.playlistId, msg.thumbnailUrl)
        );
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.CUSTOMIZE_PLAYLIST: {
        const patch = msg.patch && typeof msg.patch === 'object' ? msg.patch : msg;
        const state = await notifyMutation(
          await customizePlaylist(msg.playlistId, {
            icon: patch.icon,
            color: patch.color,
            customThumbnailUrl: patch.customThumbnailUrl,
            title: patch.title,
          })
        );
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.UPSERT_VIDEO_NOTE: {
        const notes = await upsertVideoNote(msg.videoId, msg.note || {});
        const state = await notifyMutation(await loadState());
        return { ok: true, state, notes };
      }

      case MESSAGE_ACTIONS.DELETE_VIDEO_NOTE: {
        const state = await notifyMutation(
          await deleteVideoNote(msg.videoId, msg.noteId)
        );
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.SAVE_SMART_RULES: {
        const state = await notifyMutation(await saveSmartRules(msg.rules || []));
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.APPLY_SMART_RULES: {
        const state = await loadState();
        applySmartRulesToChannels(state);
        const saved = await notifyMutation(await saveState(state));
        return { ok: true, state: saved };
      }

      case MESSAGE_ACTIONS.SYNC_CHROME_PUSH: {
        const state = await loadState();
        const pushSnapshot = {
          ...state,
          settings: {
            ...state.settings,
            sync: {
              ...state.settings.sync,
              provider: 'chrome',
            },
          },
        };
        const result = await pushToChromeSync(pushSnapshot);
        const updated = await notifyMutation(
          await updateSettings({
            sync: {
              ...state.settings.sync,
              provider: 'chrome',
              lastSyncedAt: result.syncedAt,
              lastSyncStatus: 'ok',
            },
          }),
          { skipAutoSync: true }
        );
        return { ok: true, state: updated, ...result };
      }

      case MESSAGE_ACTIONS.SYNC_CHROME_PULL: {
        const localState = await loadState();
        const localClientId = localState.settings?.sync?.gdriveClientId || '';
        const remote = await pullFromChromeSync();
        if (!remote) {
          return { ok: false, error: 'No synced data found in Chrome Sync.' };
        }
        const saved = msg.merge
          ? await importStateJson(JSON.stringify(remote), { merge: true })
          : await saveState(hydrateState(remote));
        const mergedClientId = saved.settings?.sync?.gdriveClientId || localClientId;
        const updated = await notifyMutation(
          await updateSettings({
            sync: {
              ...saved.settings.sync,
              provider: 'chrome',
              gdriveClientId: mergedClientId,
              lastSyncedAt: Date.now(),
              lastSyncStatus: 'ok',
            },
          }),
          { skipAutoSync: true }
        );
        await setupContextMenus();
        return { ok: true, state: updated };
      }

      case MESSAGE_ACTIONS.SYNC_GDRIVE_PUSH: {
        const state = await loadState();
        const lang = state.settings?.language || 'pt-BR';
        const clientId = msg.clientId ?? state.settings?.sync?.gdriveClientId ?? '';
        const token =
          msg.token || (await getGoogleDriveToken(clientId, msg.interactive !== false, lang));
        const pushSnapshot = {
          ...state,
          settings: {
            ...state.settings,
            sync: {
              ...state.settings.sync,
              provider: 'gdrive',
              gdriveClientId: clientId,
            },
          },
        };
        const result = await pushToGoogleDrive(pushSnapshot, token);
        const updated = await notifyMutation(
          await updateSettings({
            sync: {
              ...state.settings.sync,
              provider: 'gdrive',
              gdriveClientId: clientId,
              lastSyncedAt: result.syncedAt,
              lastSyncStatus: 'ok',
            },
          }),
          { skipAutoSync: true }
        );
        return { ok: true, state: updated, ...result };
      }

      case MESSAGE_ACTIONS.SYNC_GDRIVE_PULL: {
        const state = await loadState();
        const lang = state.settings?.language || 'pt-BR';
        const localClientId = msg.clientId || state.settings?.sync?.gdriveClientId || '';
        const token =
          msg.token || (await getGoogleDriveToken(localClientId, msg.interactive !== false, lang));
        const remote = await pullFromGoogleDrive(token);
        if (!remote) {
          return { ok: false, error: 'No synced backup found in Google Drive.' };
        }
        const saved = msg.merge
          ? await importStateJson(JSON.stringify(remote), { merge: true })
          : await saveState(hydrateState(remote));
        const mergedClientId = saved.settings?.sync?.gdriveClientId || localClientId;
        const updated = await notifyMutation(
          await updateSettings({
            sync: {
              ...saved.settings.sync,
              provider: 'gdrive',
              gdriveClientId: mergedClientId,
              lastSyncedAt: Date.now(),
              lastSyncStatus: 'ok',
            },
          }),
          { skipAutoSync: true }
        );
        await setupContextMenus();
        return { ok: true, state: updated };
      }

      case MESSAGE_ACTIONS.SYNC_GDRIVE_DISCONNECT: {
        const state = await loadState();
        const lang = state.settings?.language || 'pt-BR';
        let token = msg.token || '';
        if (!token) {
          try {
            token = await getGoogleDriveToken(state.settings?.sync?.gdriveClientId || '', false, lang);
          } catch {
            // No cached token to revoke
          }
        }
        await disconnectGoogleDrive(token);
        const updated = await notifyMutation(
          await updateSettings({
            sync: {
              ...state.settings.sync,
              provider: 'none',
              lastSyncStatus: 'disconnected',
            },
          }),
          { skipAutoSync: true }
        );
        return { ok: true, state: updated };
      }

      case MESSAGE_ACTIONS.CREATE_COURSE: {
        const { state, course } = await createCourse(msg.course || msg);
        await notifyMutation(state);
        return { ok: true, state, course };
      }

      case MESSAGE_ACTIONS.UPDATE_COURSE: {
        const state = await notifyMutation(
          await updateCourse(msg.courseId || msg.id, msg.patch || {})
        );
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.DELETE_COURSE: {
        const state = await notifyMutation(await deleteCourse(msg.courseId || msg.id));
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.ADD_LESSON_TO_COURSE: {
        const state = await notifyMutation(
          await addLessonToCourse(msg.courseId, msg.lesson || msg.video)
        );
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.REMOVE_LESSON_FROM_COURSE: {
        const state = await notifyMutation(
          await removeLessonFromCourse(msg.courseId, msg.lessonId || msg.videoId)
        );
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.TOGGLE_LESSON_COMPLETE: {
        const { state, completed } = await toggleLessonComplete(
          msg.courseId,
          msg.lessonId || msg.videoId,
          msg.completed
        );
        await notifyMutation(state);
        return { ok: true, state, completed };
      }

      case MESSAGE_ACTIONS.APPLY_COURSE_SEQUENCE: {
        const { state, course, summary } = await applyCourseSequence(
          msg.courseId || msg.id,
          msg.sequence
        );
        await notifyMutation(state);
        return { ok: true, state, course, summary };
      }

      case MESSAGE_ACTIONS.TOGGLE_WATCHED: {
        const { state, watched } = await toggleVideoWatched(msg.videoId, msg.meta || {});
        await notifyMutation(state);
        return { ok: true, state, watched };
      }

      case MESSAGE_ACTIONS.BULK_MARK_WATCHED: {
        const state = await notifyMutation(
          await bulkMarkWatched(msg.records || [], msg.watched !== false)
        );
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.CLEAR_WATCHED: {
        const state = await notifyMutation(await clearWatchedHistory());
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.CREATE_DECK_COLUMN: {
        const { state, column } = await createDeckColumn(msg.column || {});
        await notifyMutation(state);
        return { ok: true, state, column };
      }

      case MESSAGE_ACTIONS.UPDATE_DECK_COLUMN: {
        const state = await notifyMutation(await updateDeckColumn(msg.id, msg.patch || {}));
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.DELETE_DECK_COLUMN: {
        const state = await notifyMutation(await deleteDeckColumn(msg.id));
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.SAVE_DECK_COLUMNS: {
        const state = await notifyMutation(await saveDeckColumns(msg.columns || []));
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.FETCH_CHANNEL_FEED: {
        let resolvedChannelId = msg.channelId;
        if (resolvedChannelId && !resolvedChannelId.startsWith('UC')) {
          const state = await loadState();
          const ch = state.channels[resolvedChannelId] || { id: resolvedChannelId, handle: resolvedChannelId };
          resolvedChannelId = await resolveChannelUcId(ch);
        }
        const entries = await fetchYouTubeFeed({
          channelId: resolvedChannelId,
          playlistId: msg.playlistId,
          forceRefresh: Boolean(msg.forceRefresh),
        });
        // Update channel lastVideoAt if channel exists in state
        if (msg.channelId && entries.length > 0) {
          const state = await loadState();
          const ch = state.channels[msg.channelId] || (resolvedChannelId ? state.channels[resolvedChannelId] : null);
          if (ch) {
            const latest = Math.max(...entries.map((e) => e.publishedAt || 0));
            if (latest > (ch.lastVideoAt || 0)) {
              ch.lastVideoAt = latest;
              ch.status = computeChannelStatus(latest, state.settings.statusConfig);
              await notifyMutation(await saveState(state));
            }
          }
        }
        return { ok: true, entries: sortFeedEntries(entries, msg.sortBy || SORT_OPTIONS.DATE_DESC) };
      }

      case MESSAGE_ACTIONS.FETCH_GROUP_FEED: {
        const state = await loadState();
        const channels = msg.groupId
          ? getChannelsByGroup(state, msg.groupId, { includeDescendants: true })
          : Object.values(state.channels);

        const targetChannels = channels.slice(0, 40);
        let mutated = false;

        // Resolve @handle channels to UC... IDs with concurrency 5
        const resolvedList = await mapWithConcurrency(targetChannels, 5, async (ch) => {
          const prevUcId = ch.ucId;
          const ucId = await resolveChannelUcId(ch, state);
          if (ucId && ucId !== prevUcId && state.channels[ch.id]) {
            state.channels[ch.id].ucId = ucId;
            mutated = true;
          }
          return { ch, ucId };
        });

        const validPairs = resolvedList.filter((item) => item.ucId && item.ucId.startsWith('UC'));
        const perChannel = await mapWithConcurrency(validPairs, 6, ({ ucId }) =>
          fetchYouTubeFeed({ channelId: ucId, forceRefresh: Boolean(msg.forceRefresh) })
        );

        const allEntries = [];
        const seenVideos = new Set();

        perChannel.forEach((entries, idx) => {
          const { ch } = validPairs[idx];
          if (entries.length > 0 && state.channels[ch.id]) {
            const latest = Math.max(...entries.map((e) => e.publishedAt || 0));
            if (latest > (state.channels[ch.id].lastVideoAt || 0)) {
              state.channels[ch.id].lastVideoAt = latest;
              state.channels[ch.id].status = computeChannelStatus(
                latest,
                state.settings.statusConfig
              );
              mutated = true;
            }
          }
          for (const entry of entries) {
            if (!seenVideos.has(entry.videoId)) {
              seenVideos.add(entry.videoId);
              allEntries.push(entry);
            }
          }
        });

        if (mutated) {
          await notifyMutation(await saveState(state));
        }

        const sorted = sortFeedEntries(allEntries, msg.sortBy || SORT_OPTIONS.DATE_DESC);
        return { ok: true, entries: sorted.slice(0, msg.limit || 120) };
      }

      case MESSAGE_ACTIONS.REFRESH_CHANNEL_STATUSES: {
        const state = await loadState();
        const channelList = Object.values(state.channels);
        const targets = msg.channelIds
          ? channelList.filter((c) => msg.channelIds.includes(c.id))
          : channelList;

        let refreshedCount = 0;
        await mapWithConcurrency(targets, 5, async (ch) => {
          const ucId = await resolveChannelUcId(ch, state);
          if (!ucId) return;
          if (state.channels[ch.id]) {
            state.channels[ch.id].ucId = ucId;
          }
          const entries = await fetchYouTubeFeed({
            channelId: ucId,
            forceRefresh: Boolean(msg.forceRefresh),
          });
          refreshedCount++;
          if (entries.length > 0) {
            const latest = Math.max(...entries.map((e) => e.publishedAt || 0));
            if (latest > 0) {
              state.channels[ch.id].lastVideoAt = latest;
            }
          }
          state.channels[ch.id].status = computeChannelStatus(
            state.channels[ch.id].lastVideoAt,
            state.settings.statusConfig
          );
        });

        const saved = await notifyMutation(await saveState(state));
        return { ok: true, state: saved, refreshedCount };
      }

      case MESSAGE_ACTIONS.EXPORT_DATA: {
        const state = await loadState();
        return { ok: true, json: exportStateJson(state) };
      }

      case MESSAGE_ACTIONS.IMPORT_DATA: {
        const state = await notifyMutation(
          await importStateJson(msg.json, { merge: Boolean(msg.merge) })
        );
        return { ok: true, state };
      }

      case MESSAGE_ACTIONS.EXPORT_CSV: {
        const state = await loadState();
        return { ok: true, csv: exportChannelsCsv(state.channels, state.groups) };
      }

      case MESSAGE_ACTIONS.OPEN_OPTIONS: {
        if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
          await chrome.runtime.openOptionsPage();
        }
        return { ok: true };
      }

      case MESSAGE_ACTIONS.OPEN_DECK: {
        if (typeof chrome !== 'undefined' && chrome.tabs) {
          const tabs = await chrome.tabs.query({ url: '*://*.youtube.com/*' });
          if (tabs.length > 0 && tabs[0].id !== undefined) {
            await chrome.tabs.update(tabs[0].id, { active: true });
            chrome.tabs
              .sendMessage(tabs[0].id, { action: MESSAGE_ACTIONS.OPEN_DECK })
              .catch(() => {});
          } else {
            await chrome.tabs.create({ url: 'https://www.youtube.com/#tubepocket-deck' });
          }
        }
        return { ok: true };
      }

      default:
        return { ok: false, error: `Unknown action: ${msg.action}` };
    }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

// Register Chrome Extension listeners when running in the MV3 Service Worker
if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onInstalled.addListener(async () => {
    const state = await loadState();
    await saveState(state);
    await updateBadge(state);
    await setupContextMenus();
  });

  chrome.runtime.onStartup?.addListener(async () => {
    const state = await loadState();
    await updateBadge(state);
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    handleMessage(msg).then(sendResponse);
    return true; // keep async message channel open
  });

  chrome.contextMenus?.onClicked.addListener((info, tab) => {
    if (!tab?.id) return;
    if (info.menuItemId === 'tp-add-channel') {
      chrome.tabs
        .sendMessage(tab.id, {
          action: MESSAGE_ACTIONS.CONTEXT_ADD_CHANNEL,
          linkUrl: info.linkUrl || info.pageUrl,
        })
        .catch(() => {});
    } else if (info.menuItemId === 'tp-toggle-watched') {
      chrome.tabs
        .sendMessage(tab.id, {
          action: MESSAGE_ACTIONS.CONTEXT_TOGGLE_WATCHED,
          linkUrl: info.linkUrl || info.pageUrl,
        })
        .catch(() => {});
    } else if (info.menuItemId === 'tp-open-deck') {
      chrome.tabs
        .sendMessage(tab.id, { action: MESSAGE_ACTIONS.OPEN_DECK })
        .catch(() => {});
    }
  });
}
