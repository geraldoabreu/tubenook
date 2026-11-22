/**
 * @fileoverview Full storage adapter and state management for TubeNook.
 * Supports chrome.storage.local (with unlimitedStorage) and pluggable in-memory backends for unit testing.
 */

import {
  SCHEMA_VERSION,
  STORAGE_KEYS,
  GROUP_KINDS,
  DEFAULT_SETTINGS,
  DEFAULT_STATUS_CONFIG,
  DEFAULT_SYNC_CONFIG,
  DECK_SOURCE_TYPES,
  SORT_OPTIONS,
  createDefaultState,
  createId,
} from './types.js';
import { BRAND_NAME } from './brand.js';
import { computeAutoTags, computeChannelStatus } from './auto-tagger.js';
import { suggestCourseSequence } from './courses.js';

/**
 * @typedef {Object} StorageBackend
 * @property {(key: string) => Promise<any>} get
 * @property {(key: string, value: any) => Promise<void>} set
 * @property {(key: string) => Promise<void>} remove
 */

/**
 * Create an in-memory storage backend (for Node tests or fallback).
 * @param {Record<string, any>} [initial={}]
 * @returns {StorageBackend}
 */
export function createMemoryBackend(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    async get(key) {
      const val = store.get(key);
      return val === undefined ? undefined : structuredClone(val);
    },
    async set(key, value) {
      store.set(key, structuredClone(value));
    },
    async remove(key) {
      store.delete(key);
    },
  };
}

/**
 * Create a chrome.storage.local backend.
 * @returns {StorageBackend}
 */
export function createChromeStorageBackend() {
  return {
    async get(key) {
      const result = await chrome.storage.local.get(key);
      return result ? result[key] : undefined;
    },
    async set(key, value) {
      await chrome.storage.local.set({ [key]: value });
    },
    async remove(key) {
      await chrome.storage.local.remove(key);
    },
  };
}

/** @type {StorageBackend} */
let activeBackend =
  typeof chrome !== 'undefined' && chrome?.storage?.local
    ? createChromeStorageBackend()
    : createMemoryBackend();

/**
 * Replace the active storage backend (primarily for tests).
 * @param {StorageBackend} backend
 */
export function setStorageBackend(backend) {
  activeBackend = backend;
}

/**
 * Get the currently active storage backend.
 * @returns {StorageBackend}
 */
export function getStorageBackend() {
  return activeBackend;
}

/**
 * Normalize and hydrate raw persisted state against the current schema.
 * @param {any} raw
 * @returns {import('./types.js').AppState}
 */
export function hydrateState(raw) {
  const base = createDefaultState();
  if (!raw || typeof raw !== 'object') return base;

  const settings = {
    ...DEFAULT_SETTINGS,
    ...(raw.settings && typeof raw.settings === 'object' ? raw.settings : {}),
    statusConfig: {
      ...DEFAULT_STATUS_CONFIG,
      ...(raw.settings?.statusConfig && typeof raw.settings.statusConfig === 'object'
        ? raw.settings.statusConfig
        : {}),
    },
    sync: {
      ...DEFAULT_SYNC_CONFIG,
      ...(raw.settings?.sync && typeof raw.settings.sync === 'object'
        ? raw.settings.sync
        : {}),
    },
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    groups: raw.groups && typeof raw.groups === 'object' ? { ...raw.groups } : {},
    channels: raw.channels && typeof raw.channels === 'object' ? { ...raw.channels } : {},
    playlists: raw.playlists && typeof raw.playlists === 'object' ? { ...raw.playlists } : {},
    watched: raw.watched && typeof raw.watched === 'object' ? { ...raw.watched } : {},
    videoNotes: raw.videoNotes && typeof raw.videoNotes === 'object' ? { ...raw.videoNotes } : {},
    smartRules: Array.isArray(raw.smartRules) ? [...raw.smartRules] : [],
    courses: raw.courses && typeof raw.courses === 'object' ? { ...raw.courses } : {},
    deckColumns: Array.isArray(raw.deckColumns) ? raw.deckColumns : base.deckColumns,
    settings,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  };
}

/**
 * Load full AppState from storage.
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function loadState() {
  const raw = await activeBackend.get(STORAGE_KEYS.STATE);
  return hydrateState(raw);
}

/**
 * Persist full AppState to storage.
 * @param {import('./types.js').AppState} state
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function saveState(state) {
  const next = {
    ...state,
    schemaVersion: SCHEMA_VERSION,
    updatedAt: Date.now(),
  };
  await activeBackend.set(STORAGE_KEYS.STATE, next);
  return next;
}

/**
 * Reset state back to defaults.
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function resetState() {
  const fresh = createDefaultState();
  await activeBackend.set(STORAGE_KEYS.STATE, fresh);
  return fresh;
}

/**
 * Get current AppSettings.
 * @returns {Promise<import('./types.js').AppSettings>}
 */
export async function getSettings() {
  const state = await loadState();
  return state.settings;
}

/**
 * Partially update AppSettings.
 * @param {Partial<import('./types.js').AppSettings>} partial
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function updateSettings(partial) {
  const state = await loadState();
  state.settings = {
    ...state.settings,
    ...partial,
    statusConfig: {
      ...state.settings.statusConfig,
      ...(partial?.statusConfig || {}),
    },
    sync: {
      ...DEFAULT_SYNC_CONFIG,
      ...(state.settings.sync || {}),
      ...(partial?.sync || {}),
    },
  };
  // Recompute channel statuses if statusConfig changed
  if (partial?.statusConfig) {
    for (const id of Object.keys(state.channels)) {
      const ch = state.channels[id];
      ch.status = computeChannelStatus(ch.lastVideoAt, state.settings.statusConfig);
    }
  }
  return saveState(state);
}

/* ============================================================================
 * PURE GROUP TREE HELPERS
 * ========================================================================== */

/**
 * Return all descendant group IDs of `groupId` (excluding `groupId` itself).
 * @param {Record<string, import('./types.js').Group>} groups
 * @param {string} groupId
 * @returns {string[]}
 */
export function getDescendants(groups, groupId) {
  const result = [];
  const visited = new Set([groupId]);
  const queue = [groupId];

  while (queue.length > 0) {
    const current = queue.shift();
    for (const g of Object.values(groups || {})) {
      if (g.parentId === current && !visited.has(g.id)) {
        visited.add(g.id);
        result.push(g.id);
        queue.push(g.id);
      }
    }
  }
  return result;
}

/**
 * Return ancestor group IDs from immediate parent up to root.
 * @param {Record<string, import('./types.js').Group>} groups
 * @param {string} groupId
 * @returns {string[]}
 */
export function getAncestors(groups, groupId) {
  const result = [];
  const visited = new Set([groupId]);
  let curr = groups?.[groupId]?.parentId || null;

  while (curr && groups[curr] && !visited.has(curr)) {
    visited.add(curr);
    result.push(curr);
    curr = groups[curr].parentId || null;
  }
  return result;
}

/**
 * Return 0-based nesting depth of a group.
 * @param {Record<string, import('./types.js').Group>} groups
 * @param {string} groupId
 * @returns {number}
 */
export function getGroupDepth(groups, groupId) {
  return getAncestors(groups, groupId).length;
}

/**
 * Check whether moving `groupId` under `newParentId` would create a cycle.
 * @param {Record<string, import('./types.js').Group>} groups
 * @param {string} groupId
 * @param {string | null} newParentId
 * @returns {boolean}
 */
export function wouldCreateCycle(groups, groupId, newParentId) {
  if (!newParentId) return false;
  if (newParentId === groupId) return true;
  const descendants = new Set(getDescendants(groups, groupId));
  return descendants.has(newParentId);
}

/**
 * Build a sorted nested tree of groups for a given kind ('subscription' | 'playlist').
 * @param {Record<string, import('./types.js').Group>} groups
 * @param {'subscription' | 'playlist'} [kind]
 * @returns {import('./types.js').GroupTreeNode[]}
 */
export function getGroupTree(groups, kind) {
  const filtered = Object.values(groups || {}).filter((g) => !kind || g.kind === kind);
  /** @type {Map<string, import('./types.js').GroupTreeNode>} */
  const nodeMap = new Map();
  for (const g of filtered) {
    nodeMap.set(g.id, { ...g, children: [] });
  }

  /** @type {import('./types.js').GroupTreeNode[]} */
  const roots = [];
  for (const node of nodeMap.values()) {
    if (node.parentId && nodeMap.has(node.parentId)) {
      nodeMap.get(node.parentId).children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortRecursive = (list) => {
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
    for (const item of list) {
      if (item.children.length > 0) sortRecursive(item.children);
    }
  };
  sortRecursive(roots);
  return roots;
}

/* ============================================================================
 * GROUP CRUD OPERATIONS
 * ========================================================================== */

/**
 * Create a new subscription or playlist group (supports nested parentId).
 * @param {{ name: string, parentId?: string | null, kind?: 'subscription' | 'playlist', icon?: import('./types.js').GroupIcon, color?: string }} input
 * @returns {Promise<{ state: import('./types.js').AppState, group: import('./types.js').Group }>}
 */
export async function createGroup(input) {
  const state = await loadState();
  const kind = input.kind === GROUP_KINDS.PLAYLIST ? GROUP_KINDS.PLAYLIST : GROUP_KINDS.SUBSCRIPTION;
  const parentId =
    input.parentId && state.groups[input.parentId] && state.groups[input.parentId].kind === kind
      ? input.parentId
      : null;

  const siblings = Object.values(state.groups).filter(
    (g) => g.kind === kind && (g.parentId || null) === parentId
  );
  const maxOrder = siblings.reduce((max, g) => Math.max(max, g.order ?? 0), -1);

  /** @type {import('./types.js').Group} */
  const group = {
    id: createId('grp'),
    name: String(input.name || 'New Group').trim() || 'New Group',
    parentId,
    kind,
    icon: input.icon || { type: 'emoji', value: kind === GROUP_KINDS.PLAYLIST ? '🎵' : '📁' },
    color: input.color || '#ef233c',
    order: maxOrder + 1,
    collapsed: false,
    createdAt: Date.now(),
  };

  state.groups[group.id] = group;
  const saved = await saveState(state);
  return { state: saved, group };
}

/**
 * Update an existing group's metadata (name, icon, color, collapsed, order, parentId).
 * @param {string} id
 * @param {Partial<import('./types.js').Group>} patch
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function updateGroup(id, patch) {
  const state = await loadState();
  const existing = state.groups[id];
  if (!existing) throw new Error(`Group not found: ${id}`);

  let nextParentId = existing.parentId;
  if (patch.parentId !== undefined) {
    const candidate = patch.parentId || null;
    if (wouldCreateCycle(state.groups, id, candidate)) {
      throw new Error('Cannot move a group into itself or one of its descendants.');
    }
    if (candidate && (!state.groups[candidate] || state.groups[candidate].kind !== existing.kind)) {
      throw new Error('Invalid parent group.');
    }
    nextParentId = candidate;
  }

  state.groups[id] = {
    ...existing,
    ...patch,
    id: existing.id,
    kind: existing.kind,
    parentId: nextParentId,
    name: patch.name !== undefined ? String(patch.name).trim() || existing.name : existing.name,
  };

  return saveState(state);
}

/**
 * Move a group to a new parent and/or order position, preventing cycles.
 * @param {string} id
 * @param {string | null} newParentId
 * @param {number} [newOrder]
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function moveGroup(id, newParentId, newOrder) {
  const state = await loadState();
  const target = state.groups[id];
  if (!target) throw new Error(`Group not found: ${id}`);

  const candidate = newParentId || null;
  if (wouldCreateCycle(state.groups, id, candidate)) {
    throw new Error('Cannot move a group into itself or one of its descendants.');
  }
  if (candidate && (!state.groups[candidate] || state.groups[candidate].kind !== target.kind)) {
    throw new Error('Parent group must exist and have the same kind.');
  }

  target.parentId = candidate;

  // Reindex siblings under the new parent
  const siblings = Object.values(state.groups)
    .filter((g) => g.kind === target.kind && (g.parentId || null) === candidate && g.id !== id)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const insertIndex =
    typeof newOrder === 'number' && Number.isFinite(newOrder)
      ? Math.max(0, Math.min(siblings.length, Math.floor(newOrder)))
      : siblings.length;

  siblings.splice(insertIndex, 0, target);
  siblings.forEach((g, idx) => {
    g.order = idx;
  });

  return saveState(state);
}

/**
 * Delete a group, either reparenting its children to its parent ('reparent') or deleting all descendants ('cascade').
 * Also cleans up references in channels, playlists, and deck columns.
 * @param {string} id
 * @param {{ mode?: 'reparent' | 'cascade' }} [options]
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function deleteGroup(id, options = {}) {
  const state = await loadState();
  const target = state.groups[id];
  if (!target) return state;

  const mode = options.mode === 'cascade' ? 'cascade' : 'reparent';
  const removedIds = new Set([id]);

  if (mode === 'cascade') {
    for (const descId of getDescendants(state.groups, id)) {
      removedIds.add(descId);
    }
  } else {
    // Reparent direct children to target.parentId
    for (const g of Object.values(state.groups)) {
      if (g.parentId === id) {
        g.parentId = target.parentId || null;
      }
    }
  }

  for (const rid of removedIds) {
    delete state.groups[rid];
  }

  // Clean up channel groupIds
  for (const ch of Object.values(state.channels)) {
    if (Array.isArray(ch.groupIds)) {
      ch.groupIds = ch.groupIds.filter((gid) => !removedIds.has(gid));
    }
  }

  // Clean up playlist groupIds
  for (const pl of Object.values(state.playlists)) {
    if (Array.isArray(pl.groupIds)) {
      pl.groupIds = pl.groupIds.filter((gid) => !removedIds.has(gid));
    }
  }

  // Clean up deck columns referencing deleted groups
  state.deckColumns = state.deckColumns.filter(
    (col) => !(col.sourceType === DECK_SOURCE_TYPES.GROUP && col.sourceId && removedIds.has(col.sourceId))
  );

  return saveState(state);
}

/* ============================================================================
 * CHANNEL OPERATIONS
 * ========================================================================== */

/**
 * Normalize a YouTube handle for case-insensitive comparison.
 * @param {string} [val]
 * @returns {string}
 */
function normalizeHandleKey(val) {
  if (!val || typeof val !== 'string') return '';
  const trimmed = val.trim().toLowerCase();
  if (!trimmed) return '';
  return trimmed.startsWith('@') ? trimmed : '';
}

/**
 * Find an existing channel key matching an incoming channel by id, ucId, or case-insensitive handle.
 * @param {Record<string, import('./types.js').Channel>} channels
 * @param {Partial<import('./types.js').Channel> & { id: string }} item
 * @returns {string | null}
 */
function findExistingChannelKey(channels, item) {
  if (channels[item.id]) return item.id;

  const incomingUcId = item.ucId?.startsWith('UC')
    ? item.ucId
    : item.id?.startsWith('UC')
      ? item.id
      : '';
  const incomingHandle =
    normalizeHandleKey(item.handle) || normalizeHandleKey(item.id);

  for (const [key, existing] of Object.entries(channels)) {
    if (!existing) continue;
    if (incomingUcId) {
      if (existing.ucId === incomingUcId || existing.id === incomingUcId || key === incomingUcId) {
        return key;
      }
    }
    if (incomingHandle) {
      const existingHandle =
        normalizeHandleKey(existing.handle) || normalizeHandleKey(existing.id) || normalizeHandleKey(key);
      if (existingHandle && existingHandle === incomingHandle) {
        return key;
      }
    }
  }
  return null;
}

/**
 * Upsert one or more channels, deduplicating by ucId/handle/id, preserving existing groupIds & manual tags,
 * and optionally computing autoTags/status.
 * @param {Array<Partial<import('./types.js').Channel> & { id: string }>} incomingList
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function upsertChannels(incomingList) {
  const state = await loadState();
  const autoTag = state.settings.autoTaggingEnabled !== false;

  for (const item of incomingList || []) {
    if (!item?.id) continue;

    const matchedKey = findExistingChannelKey(state.channels, item);
    const prev = matchedKey ? state.channels[matchedKey] : undefined;

    // Prefer UC... as canonical ID when deduplicating a @handle vs UC... pair
    let canonicalId = item.id;
    if (matchedKey && matchedKey !== item.id) {
      if (matchedKey.startsWith('UC') && !item.id.startsWith('UC')) {
        canonicalId = matchedKey;
      } else {
        canonicalId = item.id;
        delete state.channels[matchedKey];
      }
    }

    const ucId =
      (item.ucId?.startsWith('UC') ? item.ucId : undefined) ||
      (prev?.ucId?.startsWith('UC') ? prev.ucId : undefined) ||
      (canonicalId.startsWith('UC') ? canonicalId : undefined) ||
      (item.id.startsWith('UC') ? item.id : undefined);

    const handle =
      item.handle ||
      prev?.handle ||
      (item.id.startsWith('@') ? item.id : '') ||
      (canonicalId.startsWith('@') ? canonicalId : '');

    const isDedupMerge = Boolean(matchedKey && matchedKey !== item.id);
    const groupIds = isDedupMerge
      ? [...new Set([...(prev?.groupIds || []), ...(Array.isArray(item.groupIds) ? item.groupIds : [])])]
      : Array.isArray(item.groupIds)
        ? [...new Set([...(prev?.groupIds || []), ...item.groupIds])]
        : prev?.groupIds || [];

    const tags = isDedupMerge
      ? [...new Set([...(prev?.tags || []), ...(Array.isArray(item.tags) ? item.tags : [])])]
      : Array.isArray(item.tags)
        ? [...new Set(item.tags)]
        : prev?.tags || [];

    const autoTags = isDedupMerge
      ? [...new Set([...(prev?.autoTags || []), ...(Array.isArray(item.autoTags) ? item.autoTags : [])])]
      : Array.isArray(item.autoTags)
        ? [...new Set(item.autoTags)]
        : prev?.autoTags || [];

    const defaultUrl = canonicalId.startsWith('UC')
      ? `https://www.youtube.com/channel/${canonicalId}`
      : `https://www.youtube.com/${handle || canonicalId}`;

    const merged = {
      id: canonicalId,
      ...(ucId ? { ucId } : {}),
      handle,
      title: item.title || prev?.title || canonicalId,
      avatarUrl: item.avatarUrl || prev?.avatarUrl || '',
      url: item.url || prev?.url || defaultUrl,
      groupIds,
      tags,
      autoTags,
      lastVideoAt:
        item.lastVideoAt !== undefined
          ? item.lastVideoAt
          : prev?.lastVideoAt ?? null,
      status: item.status ?? prev?.status ?? 'inactive',
      subscriberCount: item.subscriberCount ?? prev?.subscriberCount,
      videoCount: item.videoCount ?? prev?.videoCount,
    };

    if (autoTag && merged.autoTags.length === 0) {
      merged.autoTags = computeAutoTags(merged);
    }
    merged.status = computeChannelStatus(merged.lastVideoAt, state.settings.statusConfig);
    state.channels[canonicalId] = merged;
  }

  return saveState(state);
}

/**
 * Upsert a single channel.
 * @param {Partial<import('./types.js').Channel> & { id: string }} channel
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function upsertChannel(channel) {
  return upsertChannels([channel]);
}

/**
 * Remove a channel by ID.
 * @param {string} channelId
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function removeChannel(channelId) {
  const state = await loadState();
  delete state.channels[channelId];
  return saveState(state);
}

/**
 * Set the exact list of group IDs for a channel (supports multi-group membership).
 * @param {string} channelId
 * @param {string[]} groupIds
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function assignChannelToGroups(channelId, groupIds) {
  const state = await loadState();
  const ch = state.channels[channelId];
  if (!ch) throw new Error(`Channel not found: ${channelId}`);

  const valid = [...new Set(groupIds || [])].filter(
    (gid) => state.groups[gid] && state.groups[gid].kind === GROUP_KINDS.SUBSCRIPTION
  );
  ch.groupIds = valid;
  return saveState(state);
}

/**
 * Add a channel to a single group without removing existing group memberships.
 * @param {string} channelId
 * @param {string} groupId
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function addChannelToGroup(channelId, groupId) {
  const state = await loadState();
  const ch = state.channels[channelId];
  if (!ch) throw new Error(`Channel not found: ${channelId}`);
  if (!state.groups[groupId]) throw new Error(`Group not found: ${groupId}`);

  if (!ch.groupIds.includes(groupId)) {
    ch.groupIds = [...ch.groupIds, groupId];
  }
  return saveState(state);
}

/**
 * Remove a channel from a single group.
 * @param {string} channelId
 * @param {string} groupId
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function removeChannelFromGroup(channelId, groupId) {
  const state = await loadState();
  const ch = state.channels[channelId];
  if (!ch) return state;
  ch.groupIds = ch.groupIds.filter((gid) => gid !== groupId);
  return saveState(state);
}

/**
 * Bulk assign multiple channels to a group (add or remove).
 * @param {string[]} channelIds
 * @param {string} groupId
 * @param {'add' | 'remove'} [action='add']
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function bulkAssignChannelsToGroup(channelIds, groupId, action = 'add') {
  const state = await loadState();
  if (!state.groups[groupId]) throw new Error(`Group not found: ${groupId}`);

  for (const cid of channelIds || []) {
    const ch = state.channels[cid];
    if (!ch) continue;
    if (action === 'remove') {
      ch.groupIds = ch.groupIds.filter((gid) => gid !== groupId);
    } else if (!ch.groupIds.includes(groupId)) {
      ch.groupIds = [...ch.groupIds, groupId];
    }
  }
  return saveState(state);
}

/**
 * Set manual tags for a channel.
 * @param {string} channelId
 * @param {string[]} tags
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function setChannelTags(channelId, tags) {
  const state = await loadState();
  const ch = state.channels[channelId];
  if (!ch) throw new Error(`Channel not found: ${channelId}`);
  ch.tags = [...new Set((tags || []).map((t) => String(t).trim()).filter(Boolean))];
  return saveState(state);
}

/**
 * Get all channels belonging to a group (optionally including nested descendant groups).
 * @param {import('./types.js').AppState} state
 * @param {string} groupId
 * @param {{ includeDescendants?: boolean }} [options]
 * @returns {import('./types.js').Channel[]}
 */
export function getChannelsByGroup(state, groupId, options = {}) {
  const targetIds = new Set([groupId]);
  if (options.includeDescendants !== false) {
    for (const d of getDescendants(state.groups, groupId)) {
      targetIds.add(d);
    }
  }
  return Object.values(state.channels || {}).filter((ch) =>
    (ch.groupIds || []).some((gid) => targetIds.has(gid))
  );
}

/**
 * Export channels to RFC 4180 CSV format.
 * @param {Record<string, import('./types.js').Channel> | import('./types.js').Channel[]} channels
 * @param {Record<string, import('./types.js').Group>} [groups={}]
 * @returns {string}
 */
export function exportChannelsCsv(channels, groups = {}) {
  const list = Array.isArray(channels) ? channels : Object.values(channels || {});
  const esc = (val) => {
    const str = val === null || val === undefined ? '' : String(val);
    return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };

  const headers = [
    'Channel ID',
    'Title',
    'Handle',
    'URL',
    'Groups',
    'Tags',
    'Auto Tags',
    'Status',
    'Last Video At',
  ];

  const rows = [headers.join(',')];
  for (const ch of list) {
    const groupNames = (ch.groupIds || [])
      .map((gid) => groups[gid]?.name || gid)
      .join('; ');
    rows.push(
      [
        ch.id,
        ch.title,
        ch.handle,
        ch.url,
        groupNames,
        (ch.tags || []).join('; '),
        (ch.autoTags || []).join('; '),
        ch.status || '',
        ch.lastVideoAt ? new Date(ch.lastVideoAt).toISOString() : '',
      ]
        .map(esc)
        .join(',')
    );
  }
  return rows.join('\n');
}

/* ============================================================================
 * PLAYLIST OPERATIONS
 * ========================================================================== */

/**
 * Sanitize a single playlist video item.
 * @param {any} v
 * @returns {import('./types.js').PlaylistVideoItem | null}
 */
function sanitizePlaylistVideo(v) {
  const videoId = typeof v?.videoId === 'string' ? v.videoId.trim() : '';
  if (!videoId) return null;
  return {
    videoId,
    title: String(v.title || videoId),
    channelTitle: String(v.channelTitle || ''),
    channelId: String(v.channelId || ''),
    durationSec: Number.isFinite(v.durationSec) ? Math.max(0, Math.floor(v.durationSec)) : 0,
    thumbnailUrl: String(v.thumbnailUrl || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`),
    addedAt: Number.isFinite(v.addedAt) ? v.addedAt : Date.now(),
  };
}

/**
 * Sanitize and deduplicate an array of playlist video items.
 * @param {any[]} videos
 * @returns {import('./types.js').PlaylistVideoItem[]}
 */
function sanitizePlaylistVideos(videos) {
  const seen = new Set();
  const out = [];
  for (const raw of videos || []) {
    const clean = sanitizePlaylistVideo(raw);
    if (!clean || seen.has(clean.videoId)) continue;
    seen.add(clean.videoId);
    out.push(clean);
  }
  return out;
}

/**
 * Build a YouTube watch_videos URL for a custom playlist's videos.
 * @param {import('./types.js').PlaylistVideoItem[]} videos
 * @returns {string}
 */
function buildCustomPlaylistUrl(videos) {
  if (!Array.isArray(videos) || videos.length === 0) return '';
  return `https://www.youtube.com/watch_videos?video_ids=${videos.map((v) => v.videoId).join(',')}`;
}

/**
 * Upsert one or more playlists, preserving existing group memberships and custom playlist fields.
 * @param {Array<Partial<import('./types.js').PlaylistRecord> & { id: string }>} list
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function upsertPlaylists(list) {
  const state = await loadState();
  for (const item of list || []) {
    if (!item?.id) continue;
    const prev = state.playlists[item.id];
    const isCustom = item.isCustom !== undefined ? Boolean(item.isCustom) : Boolean(prev?.isCustom);
    const hasVideos = Array.isArray(item.videos) || Array.isArray(prev?.videos) || isCustom;
    const videos = Array.isArray(item.videos)
      ? sanitizePlaylistVideos(item.videos)
      : Array.isArray(prev?.videos)
        ? prev.videos
        : isCustom
          ? []
          : undefined;

    const customThumbnailUrl =
      item.customThumbnailUrl !== undefined
        ? String(item.customThumbnailUrl || '')
        : prev?.customThumbnailUrl ?? '';

    const icon =
      item.icon !== undefined
        ? item.icon && typeof item.icon === 'object' && item.icon.value
          ? { type: item.icon.type || 'emoji', value: String(item.icon.value) }
          : undefined
        : prev?.icon;

    const color =
      item.color !== undefined
        ? String(item.color || '').trim()
        : prev?.color ?? '';

    const description =
      item.description !== undefined ? String(item.description || '') : prev?.description ?? '';

    let url = item.url ?? prev?.url ?? `https://www.youtube.com/playlist?list=${item.id}`;
    let videoCount = Number.isFinite(item.videoCount) ? item.videoCount : prev?.videoCount ?? 0;

    if (isCustom && Array.isArray(videos)) {
      videoCount = videos.length;
      if (videos.length > 0) {
        url = buildCustomPlaylistUrl(videos);
      } else if (item.url === undefined && !prev?.url) {
        url = '';
      }
    }

    const fallbackThumb =
      customThumbnailUrl ||
      item.thumbnailUrl ||
      prev?.thumbnailUrl ||
      (Array.isArray(videos) && videos.length > 0 ? videos[0].thumbnailUrl : '');

    state.playlists[item.id] = {
      id: item.id,
      title: item.title ?? prev?.title ?? item.id,
      url,
      thumbnailUrl: fallbackThumb,
      videoCount,
      watchedCount: Number.isFinite(item.watchedCount) ? item.watchedCount : prev?.watchedCount ?? 0,
      groupIds: Array.isArray(item.groupIds)
        ? [...new Set(item.groupIds)]
        : prev?.groupIds || [],
      author: item.author ?? prev?.author,
      ...(isCustom ? { isCustom: true } : {}),
      ...(description ? { description } : {}),
      ...(customThumbnailUrl ? { customThumbnailUrl } : {}),
      ...(icon ? { icon } : {}),
      ...(color ? { color } : {}),
      ...(hasVideos && videos ? { videos } : {}),
      updatedAt: Date.now(),
    };
  }
  return saveState(state);
}

/**
 * Sync derived custom playlist fields (videoCount, url, thumbnailUrl, updatedAt).
 * @param {import('./types.js').PlaylistRecord} pl
 */
function syncCustomPlaylistDerived(pl) {
  if (!Array.isArray(pl.videos)) pl.videos = [];
  pl.videoCount = pl.videos.length;
  if (pl.isCustom) {
    pl.url = pl.videos.length > 0 ? buildCustomPlaylistUrl(pl.videos) : '';
  }
  if (!pl.customThumbnailUrl && !pl.thumbnailUrl && pl.videos.length > 0) {
    pl.thumbnailUrl = pl.videos[0].thumbnailUrl;
  }
  pl.updatedAt = Date.now();
}

/**
 * Add (or update) a video in a playlist, deduplicating by videoId.
 * @param {string} playlistId
 * @param {Partial<import('./types.js').PlaylistVideoItem> & { videoId: string }} video
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function addVideoToPlaylist(playlistId, video) {
  const state = await loadState();
  const pl = state.playlists[playlistId];
  if (!pl) throw new Error(`Playlist not found: ${playlistId}`);
  const clean = sanitizePlaylistVideo(video);
  if (!clean) throw new Error('Invalid video: videoId is required.');

  if (!Array.isArray(pl.videos)) pl.videos = [];
  const idx = pl.videos.findIndex((v) => v.videoId === clean.videoId);
  if (idx >= 0) {
    pl.videos[idx] = {
      ...pl.videos[idx],
      ...clean,
      addedAt: Number.isFinite(video.addedAt) ? video.addedAt : pl.videos[idx].addedAt,
    };
  } else {
    pl.videos.push(clean);
  }
  syncCustomPlaylistDerived(pl);
  return saveState(state);
}

/**
 * Remove a video from a playlist by videoId.
 * @param {string} playlistId
 * @param {string} videoId
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function removeVideoFromPlaylist(playlistId, videoId) {
  const state = await loadState();
  const pl = state.playlists[playlistId];
  if (!pl) throw new Error(`Playlist not found: ${playlistId}`);
  if (!Array.isArray(pl.videos)) pl.videos = [];
  pl.videos = pl.videos.filter((v) => v.videoId !== videoId);
  syncCustomPlaylistDerived(pl);
  return saveState(state);
}

/**
 * Reorder videos in a playlist according to an ordered list of videoIds.
 * @param {string} playlistId
 * @param {string[]} orderedVideoIds
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function reorderPlaylistVideos(playlistId, orderedVideoIds) {
  const state = await loadState();
  const pl = state.playlists[playlistId];
  if (!pl) throw new Error(`Playlist not found: ${playlistId}`);
  if (!Array.isArray(pl.videos)) pl.videos = [];

  const byId = new Map(pl.videos.map((v) => [v.videoId, v]));
  const reordered = [];
  for (const vid of orderedVideoIds || []) {
    if (byId.has(vid)) {
      reordered.push(byId.get(vid));
      byId.delete(vid);
    }
  }
  for (const rest of byId.values()) {
    reordered.push(rest);
  }
  pl.videos = reordered;
  syncCustomPlaylistDerived(pl);
  return saveState(state);
}

/**
 * Move a video to the top (index 0) of a playlist.
 * @param {string} playlistId
 * @param {string} videoId
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function moveVideoToTop(playlistId, videoId) {
  const state = await loadState();
  const pl = state.playlists[playlistId];
  if (!pl) throw new Error(`Playlist not found: ${playlistId}`);
  if (!Array.isArray(pl.videos)) pl.videos = [];

  const idx = pl.videos.findIndex((v) => v.videoId === videoId);
  if (idx > 0) {
    const [item] = pl.videos.splice(idx, 1);
    pl.videos.unshift(item);
    syncCustomPlaylistDerived(pl);
    return saveState(state);
  }
  return state;
}

/**
 * Move a video to the bottom (last index) of a playlist.
 * @param {string} playlistId
 * @param {string} videoId
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function moveVideoToBottom(playlistId, videoId) {
  const state = await loadState();
  const pl = state.playlists[playlistId];
  if (!pl) throw new Error(`Playlist not found: ${playlistId}`);
  if (!Array.isArray(pl.videos)) pl.videos = [];

  const idx = pl.videos.findIndex((v) => v.videoId === videoId);
  if (idx >= 0 && idx < pl.videos.length - 1) {
    const [item] = pl.videos.splice(idx, 1);
    pl.videos.push(item);
    syncCustomPlaylistDerived(pl);
    return saveState(state);
  }
  return state;
}

/**
 * Set a custom thumbnail URL for a playlist.
 * @param {string} playlistId
 * @param {string} thumbnailUrl
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function setPlaylistThumbnail(playlistId, thumbnailUrl) {
  const state = await loadState();
  const pl = state.playlists[playlistId];
  if (!pl) throw new Error(`Playlist not found: ${playlistId}`);
  const cleanUrl = String(thumbnailUrl || '').trim();
  pl.customThumbnailUrl = cleanUrl;
  if (cleanUrl) {
    pl.thumbnailUrl = cleanUrl;
  }
  pl.updatedAt = Date.now();
  return saveState(state);
}

/**
 * Customize visual layout and metadata of a playlist (icon, color, customThumbnailUrl, title).
 * @param {string} playlistId
 * @param {{ icon?: import('./types.js').GroupIcon | null, color?: string | null, customThumbnailUrl?: string | null, title?: string }} [options={}]
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function customizePlaylist(
  playlistId,
  { icon, color, customThumbnailUrl, title } = {}
) {
  const state = await loadState();
  const pl = state.playlists[playlistId];
  if (!pl) throw new Error(`Playlist not found: ${playlistId}`);

  if (title !== undefined) {
    const cleanTitle = String(title || '').trim();
    if (cleanTitle) pl.title = cleanTitle;
  }

  if (icon !== undefined) {
    if (icon && typeof icon === 'object' && icon.value) {
      pl.icon = {
        type: icon.type || 'emoji',
        value: String(icon.value),
      };
    } else {
      delete pl.icon;
    }
  }

  if (color !== undefined) {
    const cleanColor = String(color || '').trim();
    if (cleanColor) {
      pl.color = cleanColor;
    } else {
      delete pl.color;
    }
  }

  if (customThumbnailUrl !== undefined) {
    const cleanUrl = String(customThumbnailUrl || '').trim();
    if (cleanUrl) {
      pl.customThumbnailUrl = cleanUrl;
      pl.thumbnailUrl = cleanUrl;
    } else {
      delete pl.customThumbnailUrl;
      if (Array.isArray(pl.videos) && pl.videos.length > 0) {
        pl.thumbnailUrl = pl.videos[0].thumbnailUrl;
      }
    }
  }

  pl.updatedAt = Date.now();
  return saveState(state);
}

/**
 * Upsert a single playlist.
 * @param {Partial<import('./types.js').PlaylistRecord> & { id: string }} playlist
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function upsertPlaylist(playlist) {
  return upsertPlaylists([playlist]);
}

/**
 * Remove a playlist by ID.
 * @param {string} playlistId
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function removePlaylist(playlistId) {
  const state = await loadState();
  delete state.playlists[playlistId];
  return saveState(state);
}

/**
 * Assign a playlist to one or more playlist groups.
 * @param {string} playlistId
 * @param {string[]} groupIds
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function assignPlaylistToGroups(playlistId, groupIds) {
  const state = await loadState();
  const pl = state.playlists[playlistId];
  if (!pl) throw new Error(`Playlist not found: ${playlistId}`);
  pl.groupIds = [...new Set(groupIds || [])].filter(
    (gid) => state.groups[gid] && state.groups[gid].kind === GROUP_KINDS.PLAYLIST
  );
  pl.updatedAt = Date.now();
  return saveState(state);
}

/**
 * Update watched & total video counts for a playlist.
 * @param {string} playlistId
 * @param {number} watchedCount
 * @param {number} [videoCount]
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function updatePlaylistProgress(playlistId, watchedCount, videoCount) {
  const state = await loadState();
  const pl = state.playlists[playlistId];
  if (!pl) throw new Error(`Playlist not found: ${playlistId}`);
  if (Number.isFinite(videoCount)) pl.videoCount = Math.max(0, videoCount);
  pl.watchedCount = Math.max(0, Math.min(pl.videoCount || watchedCount, watchedCount));
  pl.updatedAt = Date.now();
  return saveState(state);
}

/**
 * Calculate percentage (0..100) watched progress for a playlist.
 * @param {{ videoCount?: number, watchedCount?: number }} playlist
 * @returns {number}
 */
export function getPlaylistProgressPercent(playlist) {
  const total = playlist?.videoCount || 0;
  if (total <= 0) return 0;
  const watched = Math.max(0, Math.min(total, playlist?.watchedCount || 0));
  return Math.round((watched / total) * 100);
}

/**
 * Get all playlists in a playlist group (optionally including descendants).
 * @param {import('./types.js').AppState} state
 * @param {string} groupId
 * @param {{ includeDescendants?: boolean }} [options]
 * @returns {import('./types.js').PlaylistRecord[]}
 */
export function getPlaylistsByGroup(state, groupId, options = {}) {
  const targetIds = new Set([groupId]);
  if (options.includeDescendants !== false) {
    for (const d of getDescendants(state.groups, groupId)) {
      targetIds.add(d);
    }
  }
  return Object.values(state.playlists || {}).filter((pl) =>
    (pl.groupIds || []).some((gid) => targetIds.has(gid))
  );
}

/* ============================================================================
 * UNLIMITED MARK-AS-WATCHED OPERATIONS
 * ========================================================================== */

/**
 * Mark a single video as watched.
 * @param {string} videoId
 * @param {{ title?: string, channelId?: string, durationSec?: number }} [meta={}]
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function markVideoWatched(videoId, meta = {}) {
  const state = await loadState();
  state.watched[videoId] = {
    videoId,
    title: meta.title,
    channelId: meta.channelId,
    durationSec: meta.durationSec,
    watchedAt: Date.now(),
  };
  return saveState(state);
}

/**
 * Unmark a single video as watched.
 * @param {string} videoId
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function unmarkVideoWatched(videoId) {
  const state = await loadState();
  delete state.watched[videoId];
  return saveState(state);
}

/**
 * Toggle watched status for a video.
 * @param {string} videoId
 * @param {{ title?: string, channelId?: string, durationSec?: number }} [meta={}]
 * @returns {Promise<{ state: import('./types.js').AppState, watched: boolean }>}
 */
export async function toggleVideoWatched(videoId, meta = {}) {
  const state = await loadState();
  let watched;
  if (state.watched[videoId]) {
    delete state.watched[videoId];
    watched = false;
  } else {
    state.watched[videoId] = {
      videoId,
      title: meta.title,
      channelId: meta.channelId,
      durationSec: meta.durationSec,
      watchedAt: Date.now(),
    };
    watched = true;
  }
  const saved = await saveState(state);
  return { state: saved, watched };
}

/**
 * Bulk mark or unmark videos as watched.
 * @param {Array<{ videoId: string, title?: string, channelId?: string, durationSec?: number }>} records
 * @param {boolean} [watched=true]
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function bulkMarkWatched(records, watched = true) {
  const state = await loadState();
  const now = Date.now();
  for (const rec of records || []) {
    if (!rec?.videoId) continue;
    if (watched) {
      state.watched[rec.videoId] = {
        videoId: rec.videoId,
        title: rec.title,
        channelId: rec.channelId,
        durationSec: rec.durationSec,
        watchedAt: now,
      };
    } else {
      delete state.watched[rec.videoId];
    }
  }
  return saveState(state);
}

/**
 * Check if a video ID is marked watched in state.
 * @param {import('./types.js').AppState} state
 * @param {string} videoId
 * @returns {boolean}
 */
export function isVideoWatched(state, videoId) {
  return Boolean(state?.watched && state.watched[videoId]);
}

/**
 * Clear all watched records.
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function clearWatchedHistory() {
  const state = await loadState();
  state.watched = {};
  return saveState(state);
}

/* ============================================================================
 * DECK COLUMN OPERATIONS
 * ========================================================================== */

/**
 * Create a new Deck column.
 * @param {Partial<import('./types.js').DeckColumn>} input
 * @returns {Promise<{ state: import('./types.js').AppState, column: import('./types.js').DeckColumn }>}
 */
export async function createDeckColumn(input) {
  const state = await loadState();
  /** @type {import('./types.js').DeckColumn} */
  const column = {
    id: input.id || createId('col'),
    title: String(input.title || 'New Column').trim() || 'New Column',
    sourceType: input.sourceType || DECK_SOURCE_TYPES.GROUP,
    sourceId: input.sourceId ?? null,
    sortBy: input.sortBy || SORT_OPTIONS.DATE_DESC,
    filters: { hideWatched: false, hideShorts: false, ...(input.filters || {}) },
    width: Number.isFinite(input.width) ? Math.max(260, Math.min(720, input.width)) : 360,
  };
  state.deckColumns.push(column);
  const saved = await saveState(state);
  return { state: saved, column };
}

/**
 * Update a Deck column by ID.
 * @param {string} id
 * @param {Partial<import('./types.js').DeckColumn>} patch
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function updateDeckColumn(id, patch) {
  const state = await loadState();
  const idx = state.deckColumns.findIndex((c) => c.id === id);
  if (idx === -1) throw new Error(`Deck column not found: ${id}`);
  const prev = state.deckColumns[idx];
  state.deckColumns[idx] = {
    ...prev,
    ...patch,
    id: prev.id,
    filters: { ...prev.filters, ...(patch.filters || {}) },
  };
  return saveState(state);
}

/**
 * Delete a Deck column by ID.
 * @param {string} id
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function deleteDeckColumn(id) {
  const state = await loadState();
  state.deckColumns = state.deckColumns.filter((c) => c.id !== id);
  return saveState(state);
}

/**
 * Replace or reorder all Deck columns.
 * @param {import('./types.js').DeckColumn[]} columns
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function saveDeckColumns(columns) {
  const state = await loadState();
  state.deckColumns = Array.isArray(columns) ? columns : [];
  return saveState(state);
}

/**
 * Reorder Deck columns by an ordered array of column IDs.
 * @param {string[]} orderedIds
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function reorderDeckColumns(orderedIds) {
  const state = await loadState();
  const byId = new Map(state.deckColumns.map((c) => [c.id, c]));
  const reordered = [];
  for (const id of orderedIds || []) {
    if (byId.has(id)) {
      reordered.push(byId.get(id));
      byId.delete(id);
    }
  }
  // Append any columns not explicitly listed
  for (const rest of byId.values()) {
    reordered.push(rest);
  }
  state.deckColumns = reordered;
  return saveState(state);
}

/* ============================================================================
 * VIDEO NOTES & SMART RULES OPERATIONS
 * ========================================================================== */

/**
 * Add or update a timestamped note for a video.
 * @param {string} videoId
 * @param {Partial<import('./types.js').VideoNote>} note
 * @returns {Promise<import('./types.js').VideoNote[]>} Updated notes array for `videoId`
 */
export async function upsertVideoNote(videoId, note) {
  if (!videoId) throw new Error('videoId is required.');
  const state = await loadState();
  if (!state.videoNotes || typeof state.videoNotes !== 'object') {
    state.videoNotes = {};
  }
  const existing = Array.isArray(state.videoNotes[videoId]) ? [...state.videoNotes[videoId]] : [];
  const noteId = note?.id || createId('note');
  const record = {
    id: noteId,
    videoId,
    timestampSec: Number.isFinite(note?.timestampSec) ? Math.max(0, Math.floor(note.timestampSec)) : 0,
    text: String(note?.text || '').trim(),
    createdAt: Number.isFinite(note?.createdAt) ? note.createdAt : Date.now(),
  };

  const idx = existing.findIndex((n) => n.id === noteId);
  if (idx >= 0) {
    existing[idx] = { ...existing[idx], ...record };
  } else {
    existing.push(record);
  }
  existing.sort((a, b) => a.timestampSec - b.timestampSec || a.createdAt - b.createdAt);
  state.videoNotes[videoId] = existing;
  const saved = await saveState(state);
  return saved.videoNotes[videoId];
}

/**
 * Delete a single note for a video.
 * @param {string} videoId
 * @param {string} noteId
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function deleteVideoNote(videoId, noteId) {
  const state = await loadState();
  if (!state.videoNotes || !Array.isArray(state.videoNotes[videoId])) {
    return state;
  }
  const next = state.videoNotes[videoId].filter((n) => n.id !== noteId);
  if (next.length === 0) {
    delete state.videoNotes[videoId];
  } else {
    state.videoNotes[videoId] = next;
  }
  return saveState(state);
}

/**
 * Save smart automation rules.
 * @param {Array<Partial<import('./types.js').SmartRule>>} rules
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function saveSmartRules(rules) {
  const state = await loadState();
  state.smartRules = (Array.isArray(rules) ? rules : []).map((r) => ({
    id: r?.id || createId('rule'),
    name: String(r?.name || 'Rule').trim() || 'Rule',
    enabled: r?.enabled !== false,
    matchType: r?.matchType === 'tag' ? 'tag' : 'keyword',
    pattern: String(r?.pattern || '').trim(),
    actionType: r?.actionType === 'hide_video' ? 'hide_video' : 'assign_group',
    targetGroupId: r?.targetGroupId ?? null,
  }));
  return saveState(state);
}

/**
 * Evaluate enabled `assign_group` smart rules on all channels in `state` (mutates and returns `state`).
 * @param {import('./types.js').AppState} state
 * @returns {import('./types.js').AppState}
 */
export function applySmartRulesToChannels(state) {
  if (!state || typeof state !== 'object') return state;
  const rules = (state.smartRules || []).filter(
    (r) =>
      r &&
      r.enabled !== false &&
      r.actionType === 'assign_group' &&
      r.targetGroupId &&
      state.groups?.[r.targetGroupId] &&
      String(r.pattern || '').trim().length > 0
  );
  if (rules.length === 0) return state;

  for (const ch of Object.values(state.channels || {})) {
    if (!ch) continue;
    const allTags = [...(ch.tags || []), ...(ch.autoTags || [])].map((t) => String(t).toLowerCase());
    const haystack = `${ch.title || ''} ${ch.handle || ''}`.toLowerCase();

    for (const rule of rules) {
      const needle = String(rule.pattern).trim().toLowerCase();
      let matched = false;
      if (rule.matchType === 'tag') {
        matched = allTags.some((tag) => tag === needle || tag.includes(needle));
      } else {
        matched = haystack.includes(needle);
      }

      if (matched) {
        if (!Array.isArray(ch.groupIds)) ch.groupIds = [];
        if (!ch.groupIds.includes(rule.targetGroupId)) {
          ch.groupIds = [...ch.groupIds, rule.targetGroupId];
        }
      }
    }
  }
  return state;
}

/* ============================================================================
 * COURSES CRUD & SEQUENCING OPERATIONS
 * ========================================================================== */

/**
 * Sanitize a single course lesson object.
 * @param {any} raw
 * @param {number} [defaultOrder=0]
 * @returns {import('./types.js').CourseLesson | null}
 */
function sanitizeCourseLesson(raw, defaultOrder = 0) {
  const videoId = typeof raw?.videoId === 'string' ? raw.videoId.trim() : '';
  if (!videoId) return null;
  return {
    id: raw.id || createId('les'),
    videoId,
    title: String(raw.title || videoId),
    channelTitle: String(raw.channelTitle || ''),
    channelId: String(raw.channelId || ''),
    durationSec: Number.isFinite(raw.durationSec) ? Math.max(0, Math.floor(raw.durationSec)) : 0,
    thumbnailUrl: String(raw.thumbnailUrl || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`),
    moduleId: raw.moduleId ?? null,
    order: Number.isFinite(raw.order) ? raw.order : defaultOrder,
    completed: Boolean(raw.completed),
    completedAt: raw.completed ? (Number.isFinite(raw.completedAt) ? raw.completedAt : Date.now()) : null,
    addedAt: Number.isFinite(raw.addedAt) ? raw.addedAt : Date.now(),
  };
}

/**
 * Create a new course.
 * @param {{ id?: string, title: string, description?: string, thumbnailUrl?: string, modules?: import('./types.js').CourseModule[], lessons?: Array<Partial<import('./types.js').CourseLesson>> }} input
 * @returns {Promise<{ state: import('./types.js').AppState, course: import('./types.js').Course }>}
 */
export async function createCourse(input) {
  const state = await loadState();
  if (!state.courses || typeof state.courses !== 'object') state.courses = {};

  const now = Date.now();
  const lessons = [];
  const seen = new Set();
  for (const raw of Array.isArray(input?.lessons) ? input.lessons : []) {
    const clean = sanitizeCourseLesson(raw, lessons.length);
    if (!clean || seen.has(clean.videoId)) continue;
    seen.add(clean.videoId);
    lessons.push(clean);
  }

  const modules = Array.isArray(input?.modules)
    ? input.modules.map((m, idx) => ({
        id: m?.id || createId('mod'),
        title: String(m?.title || `Module ${idx + 1}`).trim() || `Module ${idx + 1}`,
        order: Number.isFinite(m?.order) ? m.order : idx,
      }))
    : [];

  /** @type {import('./types.js').Course} */
  const course = {
    id: input?.id || createId('crs'),
    title: String(input?.title || 'New Course').trim() || 'New Course',
    description: String(input?.description || ''),
    thumbnailUrl: String(input?.thumbnailUrl || lessons[0]?.thumbnailUrl || ''),
    modules,
    lessons,
    createdAt: now,
    updatedAt: now,
  };

  state.courses[course.id] = course;
  const saved = await saveState(state);
  return { state: saved, course };
}

/**
 * Update an existing course's metadata, modules, or lessons.
 * @param {string} courseId
 * @param {Partial<import('./types.js').Course>} patch
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function updateCourse(courseId, patch) {
  const state = await loadState();
  const existing = state.courses?.[courseId];
  if (!existing) throw new Error(`Course not found: ${courseId}`);

  state.courses[courseId] = {
    ...existing,
    ...patch,
    id: existing.id,
    title: patch?.title !== undefined ? String(patch.title).trim() || existing.title : existing.title,
    description: patch?.description !== undefined ? String(patch.description || '') : existing.description,
    updatedAt: Date.now(),
  };
  return saveState(state);
}

/**
 * Delete a course by ID.
 * @param {string} courseId
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function deleteCourse(courseId) {
  const state = await loadState();
  if (state.courses) {
    delete state.courses[courseId];
  }
  return saveState(state);
}

/**
 * Add (or update) a lesson video inside a course, deduplicating by videoId.
 * @param {string} courseId
 * @param {Partial<import('./types.js').CourseLesson> & { videoId: string }} lesson
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function addLessonToCourse(courseId, lesson) {
  const state = await loadState();
  const course = state.courses?.[courseId];
  if (!course) throw new Error(`Course not found: ${courseId}`);
  if (!Array.isArray(course.lessons)) course.lessons = [];

  const clean = sanitizeCourseLesson(lesson, course.lessons.length);
  if (!clean) throw new Error('Invalid lesson: videoId is required.');

  const idx = course.lessons.findIndex((l) => l.videoId === clean.videoId);
  if (idx >= 0) {
    course.lessons[idx] = {
      ...course.lessons[idx],
      ...clean,
      id: course.lessons[idx].id,
      completed: lesson.completed !== undefined ? Boolean(lesson.completed) : course.lessons[idx].completed,
      completedAt:
        lesson.completed !== undefined
          ? lesson.completed
            ? Date.now()
            : null
          : course.lessons[idx].completedAt,
      addedAt: course.lessons[idx].addedAt,
    };
  } else {
    course.lessons.push(clean);
  }

  if (!course.thumbnailUrl && clean.thumbnailUrl) {
    course.thumbnailUrl = clean.thumbnailUrl;
  }
  course.updatedAt = Date.now();
  return saveState(state);
}

/**
 * Remove a lesson from a course by lesson ID or videoId.
 * @param {string} courseId
 * @param {string} lessonIdOrVideoId
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function removeLessonFromCourse(courseId, lessonIdOrVideoId) {
  const state = await loadState();
  const course = state.courses?.[courseId];
  if (!course) throw new Error(`Course not found: ${courseId}`);
  if (!Array.isArray(course.lessons)) course.lessons = [];

  course.lessons = course.lessons.filter(
    (l) => l.id !== lessonIdOrVideoId && l.videoId !== lessonIdOrVideoId
  );
  course.updatedAt = Date.now();
  return saveState(state);
}

/**
 * Toggle (or explicitly set) completion status for a lesson in a course.
 * @param {string} courseId
 * @param {string} lessonIdOrVideoId
 * @param {boolean} [forceCompleted]
 * @returns {Promise<{ state: import('./types.js').AppState, completed: boolean }>}
 */
export async function toggleLessonComplete(courseId, lessonIdOrVideoId, forceCompleted = undefined) {
  const state = await loadState();
  const course = state.courses?.[courseId];
  if (!course) throw new Error(`Course not found: ${courseId}`);
  if (!Array.isArray(course.lessons)) course.lessons = [];

  const lesson = course.lessons.find(
    (l) => l.id === lessonIdOrVideoId || l.videoId === lessonIdOrVideoId
  );
  if (!lesson) throw new Error(`Lesson not found: ${lessonIdOrVideoId}`);

  const nextCompleted =
    typeof forceCompleted === 'boolean' ? forceCompleted : !lesson.completed;
  lesson.completed = nextCompleted;
  lesson.completedAt = nextCompleted ? Date.now() : null;
  course.updatedAt = Date.now();

  const saved = await saveState(state);
  return { state: saved, completed: nextCompleted };
}

/**
 * Apply an auto-suggested or custom module/lesson sequence to a course.
 * @param {string} courseId
 * @param {{ modules?: import('./types.js').CourseModule[], lessons?: import('./types.js').CourseLesson[], summary?: string }} [sequence]
 * @returns {Promise<{ state: import('./types.js').AppState, course: import('./types.js').Course, summary: string }>}
 */
export async function applyCourseSequence(courseId, sequence = undefined) {
  const state = await loadState();
  const course = state.courses?.[courseId];
  if (!course) throw new Error(`Course not found: ${courseId}`);

  const computed =
    sequence && Array.isArray(sequence.modules) && Array.isArray(sequence.lessons)
      ? sequence
      : suggestCourseSequence(course.lessons || []);

  course.modules = computed.modules;
  course.lessons = computed.lessons;
  course.updatedAt = Date.now();

  const saved = await saveState(state);
  return {
    state: saved,
    course: saved.courses[courseId],
    summary: computed.summary || '',
  };
}

/* ============================================================================
 * JSON EXPORT / IMPORT WITH VALIDATION
 * ========================================================================== */

/**
 * Serialize AppState into a formatted JSON backup string.
 * @param {import('./types.js').AppState} state
 * @returns {string}
 */
export function exportStateJson(state) {
  return JSON.stringify(
    {
      app: BRAND_NAME,
      exportedAt: new Date().toISOString(),
      schemaVersion: SCHEMA_VERSION,
      data: hydrateState(state),
    },
    null,
    2
  );
}

/**
 * Validate parsed JSON import payload.
 * @param {any} raw
 * @returns {{ valid: boolean, error?: string, state?: import('./types.js').AppState }}
 */
export function validateImportData(raw) {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: 'Invalid JSON root object.' };
  }
  const payload = raw.data && typeof raw.data === 'object' ? raw.data : raw;
  if (
    typeof payload.groups !== 'object' &&
    typeof payload.channels !== 'object' &&
    typeof payload.playlists !== 'object' &&
    typeof payload.watched !== 'object'
  ) {
    return { valid: false, error: 'Backup JSON is missing TubeNook data sections.' };
  }
  return { valid: true, state: hydrateState(payload) };
}

/**
 * Import state from a JSON string (replace or merge mode).
 * @param {string} jsonString
 * @param {{ merge?: boolean }} [options]
 * @returns {Promise<import('./types.js').AppState>}
 */
export async function importStateJson(jsonString, options = {}) {
  let parsed;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err) {
    throw new Error(`Malformed JSON: ${err.message}`);
  }

  const validation = validateImportData(parsed);
  if (!validation.valid || !validation.state) {
    throw new Error(validation.error || 'Invalid backup file.');
  }

  if (!options.merge) {
    return saveState(validation.state);
  }

  const current = await loadState();
  const incoming = validation.state;
  const merged = {
    ...current,
    groups: { ...current.groups, ...incoming.groups },
    channels: { ...current.channels, ...incoming.channels },
    playlists: { ...current.playlists, ...incoming.playlists },
    watched: { ...current.watched, ...incoming.watched },
    videoNotes: { ...(current.videoNotes || {}), ...(incoming.videoNotes || {}) },
    smartRules:
      Array.isArray(incoming.smartRules) && incoming.smartRules.length > 0
        ? incoming.smartRules
        : current.smartRules || [],
    courses: { ...(current.courses || {}), ...(incoming.courses || {}) },
    deckColumns:
      incoming.deckColumns.length > 0 ? incoming.deckColumns : current.deckColumns,
    settings: {
      ...current.settings,
      ...incoming.settings,
      statusConfig: {
        ...current.settings.statusConfig,
        ...incoming.settings.statusConfig,
      },
      sync: {
        ...DEFAULT_SYNC_CONFIG,
        ...(current.settings.sync || {}),
        ...(incoming.settings.sync || {}),
        gdriveClientId:
          incoming.settings.sync?.gdriveClientId ||
          current.settings.sync?.gdriveClientId ||
          '',
      },
    },
  };
  return saveState(merged);
}
