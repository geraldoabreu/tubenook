/**
 * @fileoverview Core data models, constants, and factory helpers for TubeNook.
 */

export const SCHEMA_VERSION = 1;

export const STORAGE_KEYS = Object.freeze({
  STATE: 'tubepocket_state_v1',
  BACKUP_META: 'tubepocket_backup_meta_v1',
});

export const GROUP_KINDS = Object.freeze({
  SUBSCRIPTION: 'subscription',
  PLAYLIST: 'playlist',
});

export const CHANNEL_STATUSES = Object.freeze({
  ACTIVE: 'active',
  SLOW: 'slow',
  INACTIVE: 'inactive',
  DEAD: 'dead',
});

export const SORT_OPTIONS = Object.freeze({
  DATE_DESC: 'date_desc',
  DATE_ASC: 'date_asc',
  VIEWS_DESC: 'views_desc',
  VIEWS_ASC: 'views_asc',
  DURATION_DESC: 'duration_desc',
  DURATION_ASC: 'duration_asc',
  TITLE_ASC: 'title_asc',
  TITLE_DESC: 'title_desc',
  RANDOM: 'random',
});

export const DECK_SOURCE_TYPES = Object.freeze({
  GROUP: 'group',
  CHANNEL: 'channel',
  PLAYLIST: 'playlist',
  COMMUNITY: 'community',
  WATCH_LATER: 'watch-later',
  SUBSCRIPTIONS: 'subscriptions',
});

export const MESSAGE_ACTIONS = Object.freeze({
  // State & Settings
  GET_STATE: 'GET_STATE',
  STATE_UPDATED: 'STATE_UPDATED',
  UPDATE_SETTINGS: 'UPDATE_SETTINGS',
  RESET_STATE: 'RESET_STATE',

  // Groups
  CREATE_GROUP: 'CREATE_GROUP',
  UPDATE_GROUP: 'UPDATE_GROUP',
  DELETE_GROUP: 'DELETE_GROUP',
  MOVE_GROUP: 'MOVE_GROUP',

  // Channels
  UPSERT_CHANNELS: 'UPSERT_CHANNELS',
  REMOVE_CHANNEL: 'REMOVE_CHANNEL',
  ASSIGN_CHANNEL_GROUPS: 'ASSIGN_CHANNEL_GROUPS',
  BULK_ASSIGN_CHANNELS: 'BULK_ASSIGN_CHANNELS',
  SET_CHANNEL_TAGS: 'SET_CHANNEL_TAGS',
  AUTO_TAG_CHANNELS: 'AUTO_TAG_CHANNELS',

  // Playlists
  UPSERT_PLAYLISTS: 'UPSERT_PLAYLISTS',
  REMOVE_PLAYLIST: 'REMOVE_PLAYLIST',
  ASSIGN_PLAYLIST_GROUPS: 'ASSIGN_PLAYLIST_GROUPS',
  UPDATE_PLAYLIST_PROGRESS: 'UPDATE_PLAYLIST_PROGRESS',
  ADD_VIDEO_TO_PLAYLIST: 'ADD_VIDEO_TO_PLAYLIST',
  REMOVE_VIDEO_FROM_PLAYLIST: 'REMOVE_VIDEO_FROM_PLAYLIST',
  REORDER_PLAYLIST_VIDEOS: 'REORDER_PLAYLIST_VIDEOS',
  MOVE_VIDEO_TO_TOP: 'MOVE_VIDEO_TO_TOP',
  MOVE_VIDEO_TO_BOTTOM: 'MOVE_VIDEO_TO_BOTTOM',
  SET_PLAYLIST_THUMBNAIL: 'SET_PLAYLIST_THUMBNAIL',
  CUSTOMIZE_PLAYLIST: 'CUSTOMIZE_PLAYLIST',

  // Video Notes & Smart Rules
  UPSERT_VIDEO_NOTE: 'UPSERT_VIDEO_NOTE',
  DELETE_VIDEO_NOTE: 'DELETE_VIDEO_NOTE',
  SAVE_SMART_RULES: 'SAVE_SMART_RULES',
  APPLY_SMART_RULES: 'APPLY_SMART_RULES',

  // Multi-Device Sync
  SYNC_CHROME_PUSH: 'SYNC_CHROME_PUSH',
  SYNC_CHROME_PULL: 'SYNC_CHROME_PULL',
  SYNC_GDRIVE_PUSH: 'SYNC_GDRIVE_PUSH',
  SYNC_GDRIVE_PULL: 'SYNC_GDRIVE_PULL',
  SYNC_GDRIVE_DISCONNECT: 'SYNC_GDRIVE_DISCONNECT',

  // Courses
  CREATE_COURSE: 'CREATE_COURSE',
  UPDATE_COURSE: 'UPDATE_COURSE',
  DELETE_COURSE: 'DELETE_COURSE',
  ADD_LESSON_TO_COURSE: 'ADD_LESSON_TO_COURSE',
  REMOVE_LESSON_FROM_COURSE: 'REMOVE_LESSON_FROM_COURSE',
  TOGGLE_LESSON_COMPLETE: 'TOGGLE_LESSON_COMPLETE',
  APPLY_COURSE_SEQUENCE: 'APPLY_COURSE_SEQUENCE',

  // Watched tracking
  TOGGLE_WATCHED: 'TOGGLE_WATCHED',
  BULK_MARK_WATCHED: 'BULK_MARK_WATCHED',
  CLEAR_WATCHED: 'CLEAR_WATCHED',

  // Deck
  SAVE_DECK_COLUMNS: 'SAVE_DECK_COLUMNS',
  CREATE_DECK_COLUMN: 'CREATE_DECK_COLUMN',
  UPDATE_DECK_COLUMN: 'UPDATE_DECK_COLUMN',
  DELETE_DECK_COLUMN: 'DELETE_DECK_COLUMN',

  // Feeds & Statuses
  FETCH_CHANNEL_FEED: 'FETCH_CHANNEL_FEED',
  FETCH_GROUP_FEED: 'FETCH_GROUP_FEED',
  REFRESH_CHANNEL_STATUSES: 'REFRESH_CHANNEL_STATUSES',

  // Import / Export
  EXPORT_DATA: 'EXPORT_DATA',
  IMPORT_DATA: 'IMPORT_DATA',
  EXPORT_CSV: 'EXPORT_CSV',

  // UI Navigation / Actions
  OPEN_OPTIONS: 'OPEN_OPTIONS',
  OPEN_DECK: 'OPEN_DECK',
  OPEN_GROUP_IN_YOUTUBE: 'OPEN_GROUP_IN_YOUTUBE',
  CONTEXT_ADD_CHANNEL: 'CONTEXT_ADD_CHANNEL',
  CONTEXT_TOGGLE_WATCHED: 'CONTEXT_TOGGLE_WATCHED',
});

/**
 * @typedef {'emoji' | 'svg' | 'custom'} GroupIconType
 */

/**
 * @typedef {Object} GroupIcon
 * @property {GroupIconType} type
 * @property {string} value
 */

/**
 * @typedef {Object} Group
 * @property {string} id
 * @property {string} name
 * @property {string | null} parentId
 * @property {'subscription' | 'playlist'} kind
 * @property {GroupIcon} icon
 * @property {string} color
 * @property {number} order
 * @property {boolean} collapsed
 * @property {number} createdAt
 */

/**
 * @typedef {Group & { children: GroupTreeNode[] }} GroupTreeNode
 */

/**
 * @typedef {'active' | 'slow' | 'inactive' | 'dead'} ChannelStatus
 */

/**
 * @typedef {Object} Channel
 * @property {string} id
 * @property {string} [ucId]
 * @property {string} handle
 * @property {string} title
 * @property {string} avatarUrl
 * @property {string} url
 * @property {string[]} groupIds
 * @property {string[]} tags
 * @property {string[]} autoTags
 * @property {number | null} lastVideoAt
 * @property {ChannelStatus} status
 * @property {string} [subscriberCount]
 * @property {number} [videoCount]
 */

/**
 * @typedef {Object} PlaylistVideoItem
 * @property {string} videoId
 * @property {string} title
 * @property {string} channelTitle
 * @property {string} channelId
 * @property {number} durationSec
 * @property {string} thumbnailUrl
 * @property {number} addedAt
 */

/**
 * @typedef {Object} PlaylistRecord
 * @property {string} id
 * @property {string} title
 * @property {string} url
 * @property {string} thumbnailUrl
 * @property {number} videoCount
 * @property {number} watchedCount
 * @property {string[]} groupIds
 * @property {string} [author]
 * @property {boolean} [isCustom]
 * @property {string} [description]
 * @property {string} [customThumbnailUrl]
 * @property {GroupIcon} [icon]
 * @property {string} [color]
 * @property {PlaylistVideoItem[]} [videos]
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} VideoNote
 * @property {string} id
 * @property {string} videoId
 * @property {number} timestampSec
 * @property {string} text
 * @property {number} createdAt
 */

/**
 * @typedef {Object} SmartRule
 * @property {string} id
 * @property {string} name
 * @property {boolean} enabled
 * @property {'tag' | 'keyword'} matchType
 * @property {string} pattern
 * @property {'assign_group' | 'hide_video'} actionType
 * @property {string | null} [targetGroupId]
 */

/**
 * @typedef {Object} SyncConfig
 * @property {'none' | 'chrome' | 'gdrive'} provider
 * @property {boolean} autoSync
 * @property {string} gdriveClientId
 * @property {number | null} lastSyncedAt
 * @property {string} lastSyncStatus
 */

/**
 * @typedef {Object} WatchedRecord
 * @property {string} videoId
 * @property {string} [title]
 * @property {string} [channelId]
 * @property {number} [durationSec]
 * @property {number} watchedAt
 */

/**
 * @typedef {Object} DeckColumnFilters
 * @property {boolean} [hideWatched]
 * @property {boolean} [hideShorts]
 * @property {boolean} [onlyLive]
 * @property {string} [search]
 * @property {number | null} [minDurationSec]
 * @property {number | null} [maxDurationSec]
 * @property {number | null} [daysBack]
 */

/**
 * @typedef {Object} DeckColumn
 * @property {string} id
 * @property {string} title
 * @property {'group' | 'channel' | 'playlist' | 'community' | 'watch-later' | 'subscriptions'} sourceType
 * @property {string | null} sourceId
 * @property {string} sortBy
 * @property {DeckColumnFilters} filters
 * @property {number} width
 */

/**
 * @typedef {Object} ChannelStatusConfig
 * @property {number} activeDays
 * @property {number} slowDays
 * @property {number} inactiveDays
 */

/**
 * @typedef {Object} AppSettings
 * @property {'pt-BR' | 'pt-PT' | 'en' | 'es'} language
 * @property {'auto' | 'dark' | 'light'} theme
 * @property {ChannelStatusConfig} statusConfig
 * @property {boolean} keyboardShortcuts
 * @property {boolean} hideWatchedGlobally
 * @property {boolean} hideShortsGlobally
 * @property {boolean} showWatchedBadge
 * @property {boolean} showProgressOnPlaylists
 * @property {boolean} autoTaggingEnabled
 * @property {boolean} focusMode
 * @property {SyncConfig} sync
 */

/**
 * @typedef {Object} CourseModule
 * @property {string} id
 * @property {string} title
 * @property {number} order
 */

/**
 * @typedef {Object} CourseLesson
 * @property {string} id
 * @property {string} videoId
 * @property {string} title
 * @property {string} channelTitle
 * @property {string} channelId
 * @property {number} durationSec
 * @property {string} thumbnailUrl
 * @property {string | null} moduleId
 * @property {number} order
 * @property {boolean} completed
 * @property {number | null} completedAt
 * @property {number} addedAt
 */

/**
 * @typedef {Object} Course
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {string} thumbnailUrl
 * @property {CourseModule[]} modules
 * @property {CourseLesson[]} lessons
 * @property {number} createdAt
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} AppState
 * @property {number} schemaVersion
 * @property {Record<string, Group>} groups
 * @property {Record<string, Channel>} channels
 * @property {Record<string, PlaylistRecord>} playlists
 * @property {Record<string, WatchedRecord>} watched
 * @property {Record<string, VideoNote[]>} videoNotes
 * @property {SmartRule[]} smartRules
 * @property {Record<string, Course>} courses
 * @property {DeckColumn[]} deckColumns
 * @property {AppSettings} settings
 * @property {number} updatedAt
 */

/** @type {ChannelStatusConfig} */
export const DEFAULT_STATUS_CONFIG = Object.freeze({
  activeDays: 14,
  slowDays: 60,
  inactiveDays: 180,
});

/** @type {SyncConfig} */
export const DEFAULT_SYNC_CONFIG = Object.freeze({
  provider: 'none',
  autoSync: false,
  gdriveClientId: '',
  lastSyncedAt: null,
  lastSyncStatus: '',
});

/** @type {AppSettings} */
export const DEFAULT_SETTINGS = Object.freeze({
  language: 'pt-BR',
  theme: 'auto',
  statusConfig: { ...DEFAULT_STATUS_CONFIG },
  keyboardShortcuts: true,
  hideWatchedGlobally: false,
  hideShortsGlobally: false,
  showWatchedBadge: true,
  showProgressOnPlaylists: true,
  autoTaggingEnabled: true,
  focusMode: false,
  sync: { ...DEFAULT_SYNC_CONFIG },
});

/**
 * Generate a collision-resistant short ID with an optional prefix.
 * @param {string} [prefix='id']
 * @returns {string}
 */
export function createId(prefix = 'id') {
  const rand = Math.random().toString(36).slice(2, 8);
  const time = Date.now().toString(36);
  return `${prefix}_${time}_${rand}`;
}

/**
 * Create a clean default AppState.
 * @returns {AppState}
 */
export function createDefaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    groups: {},
    channels: {},
    playlists: {},
    watched: {},
    videoNotes: {},
    smartRules: [],
    courses: {},
    deckColumns: [
      {
        id: 'col_subs_default',
        title: 'Subscriptions',
        sourceType: DECK_SOURCE_TYPES.SUBSCRIPTIONS,
        sourceId: null,
        sortBy: SORT_OPTIONS.DATE_DESC,
        filters: { hideWatched: false, hideShorts: false },
        width: 360,
      },
      {
        id: 'col_wl_default',
        title: 'Watch Later',
        sourceType: DECK_SOURCE_TYPES.WATCH_LATER,
        sourceId: null,
        sortBy: SORT_OPTIONS.DATE_DESC,
        filters: { hideWatched: false, hideShorts: false },
        width: 360,
      },
    ],
    settings: {
      ...DEFAULT_SETTINGS,
      statusConfig: { ...DEFAULT_STATUS_CONFIG },
      sync: { ...DEFAULT_SYNC_CONFIG },
    },
    updatedAt: Date.now(),
  };
}
