/**
 * @fileoverview TubeNook YouTube Deck Mode (TweetDeck-style multi-column full-screen overlay).
 * Supports adding/editing/deleting/reordering columns (drag-and-drop + arrows), per-column independent
 * filters & sorting, real RSS video feeds, custom TubeNook playlists, Play All as Playlist, and Mark as Watched.
 */

import { BRAND_NAME } from '../shared/brand.js';
import {
  MESSAGE_ACTIONS,
  DECK_SOURCE_TYPES,
  SORT_OPTIONS,
  GROUP_KINDS,
} from '../shared/types.js';
import { renderIconHtml } from '../shared/icons.js';
import { t } from '../shared/i18n.js';
import { sendBg, showToast, isDarkTheme } from './yt-dom.js';

const WIDTH_PRESETS = Object.freeze([
  { id: 'compact', labelPt: 'Compacta (300px)', labelEn: 'Compact (300px)', px: 300 },
  { id: 'normal', labelPt: 'Normal (360px)', labelEn: 'Normal (360px)', px: 360 },
  { id: 'wide', labelPt: 'Larga (440px)', labelEn: 'Wide (440px)', px: 440 },
]);

/** @type {{ getState: () => any, onStateChange: (state: any) => void } | null} */
let deckHooks = null;
/** @type {HTMLElement | null} */
let overlayEl = null;
/** @type {HTMLElement | null} */
let columnModalEl = null;
let isOpen = false;
/** @type {string | null} */
let draggingColId = null;

/**
 * Per-column runtime state (loaded entries, loading flag, error, filter bar open).
 * @type {Map<string, { loading: boolean, error: string | null, entries: any[], filtersOpen: boolean }>}
 */
const columnRuntime = new Map();

/**
 * Escape HTML special characters for safe innerHTML interpolation.
 * @param {any} str
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Format timestamp into a compact relative time string.
 * @param {number} ts
 * @param {'pt-BR' | 'en'} lang
 * @returns {string}
 */
function formatRelativeTime(ts, lang) {
  if (!ts || !Number.isFinite(ts)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return lang === 'pt-BR' ? 'agora' : 'just now';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return lang === 'pt-BR' ? `${mins} min` : `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return lang === 'pt-BR' ? `${hrs} h` : `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return lang === 'pt-BR' ? `${days} d` : `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return lang === 'pt-BR' ? `${months} mês` : `${months}mo ago`;
  const years = Math.floor(months / 12);
  return lang === 'pt-BR' ? `${years} ano(s)` : `${years}y ago`;
}

/**
 * Format duration in seconds to MM:SS or H:MM:SS.
 * @param {number | undefined} sec
 * @returns {string}
 */
function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '';
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Format view count compactly.
 * @param {number | undefined} views
 * @param {'pt-BR' | 'en'} lang
 * @returns {string}
 */
function formatViews(views, lang) {
  if (!Number.isFinite(views) || views <= 0) return '';
  if (views >= 1_000_000) {
    return `${(views / 1_000_000).toFixed(1)}M ${lang === 'pt-BR' ? 'views' : 'views'}`;
  }
  if (views >= 1_000) {
    return `${(views / 1_000).toFixed(1)}K ${lang === 'pt-BR' ? 'views' : 'views'}`;
  }
  return `${views} views`;
}

function getState() {
  return deckHooks?.getState?.() || null;
}

function getLang(state) {
  return state?.settings?.language === 'en' ? 'en' : 'pt-BR';
}

function getRuntime(colId) {
  if (!columnRuntime.has(colId)) {
    columnRuntime.set(colId, {
      loading: false,
      error: null,
      entries: [],
      filtersOpen: false,
    });
  }
  return columnRuntime.get(colId);
}

/**
 * Initialize Deck module with state hooks.
 * @param {{ getState: () => any, onStateChange: (state: any) => void }} hooks
 */
export function initDeck({ getState: getStateFn, onStateChange }) {
  deckHooks = { getState: getStateFn, onStateChange };
}

/**
 * Open the full-screen YouTube Deck overlay.
 */
export function openDeckModal() {
  if (isOpen && overlayEl) {
    refreshDeck(getState());
    return;
  }

  isOpen = true;
  document.documentElement.style.overflow = 'hidden';

  overlayEl = document.createElement('div');
  overlayEl.className = 'tp-deck-overlay';
  overlayEl.id = 'tp-deck-overlay';
  applyThemeClass(overlayEl);

  document.body.appendChild(overlayEl);
  document.addEventListener('keydown', handleDeckKeydown);

  renderDeck();
  loadAllColumns(false);
}

/**
 * Close the full-screen YouTube Deck overlay.
 */
export function closeDeckModal() {
  closeColumnModal();
  if (!isOpen) return;
  isOpen = false;
  document.documentElement.style.overflow = '';
  document.removeEventListener('keydown', handleDeckKeydown);
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
}

/**
 * Refresh the Deck UI when AppState changes externally.
 * @param {any} state
 */
export function refreshDeck(state) {
  if (!isOpen || !overlayEl || !document.contains(overlayEl)) return;
  // Keep custom playlist column entries in sync with live state
  for (const col of state?.deckColumns || []) {
    if (col.sourceType === DECK_SOURCE_TYPES.PLAYLIST && col.sourceId) {
      const pl = state?.playlists?.[col.sourceId];
      if (pl && (pl.isCustom || Array.isArray(pl.videos))) {
        const rt = getRuntime(col.id);
        rt.entries = mapCustomPlaylistVideosToEntries(pl);
        rt.error = null;
        rt.loading = false;
      }
    }
  }
  applyThemeClass(overlayEl, state);
  renderDeck();
}

/**
 * Convert a custom PlayShelf playlist's videos[] array into Deck feed entries.
 * @param {import('../shared/types.js').PlaylistRecord} pl
 * @returns {any[]}
 */
function mapCustomPlaylistVideosToEntries(pl) {
  return (pl?.videos || [])
    .filter((v) => v && v.videoId)
    .map((v) => ({
      videoId: v.videoId,
      title: v.title || v.videoId,
      channelTitle: v.channelTitle || '',
      channelId: v.channelId || '',
      durationSec: Number.isFinite(v.durationSec) ? v.durationSec : 0,
      thumbnailUrl:
        v.thumbnailUrl ||
        `https://i.ytimg.com/vi/${encodeURIComponent(v.videoId)}/hqdefault.jpg`,
      publishedAt: v.addedAt || pl.updatedAt || 0,
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(v.videoId)}`,
      isShort: false,
    }));
}

function applyThemeClass(el, state = getState()) {
  if (!el) return;
  const theme = state?.settings?.theme || 'auto';
  const dark = theme === 'dark' ? true : theme === 'light' ? false : isDarkTheme();
  el.classList.toggle('tp-light', !dark);
}

function handleDeckKeydown(e) {
  if (e.key === 'Escape') {
    if (columnModalEl) {
      closeColumnModal();
    } else if (isOpen) {
      closeDeckModal();
    }
  }
}

/**
 * Fetch feed entries for a single Deck column via background service worker.
 * @param {import('../shared/types.js').DeckColumn} col
 * @param {boolean} [forceRefresh=false]
 */
async function loadColumnFeed(col, forceRefresh = false) {
  const state = getState();
  const rt = getRuntime(col.id);
  const lang = getLang(state);

  if (col.sourceType === DECK_SOURCE_TYPES.COMMUNITY) {
    rt.loading = false;
    rt.error = null;
    rt.entries = [];
    renderColumnBody(col);
    return;
  }

  rt.loading = true;
  rt.error = null;
  renderColumnBody(col);

  try {
    let res;
    if (col.sourceType === DECK_SOURCE_TYPES.GROUP) {
      res = await sendBg(MESSAGE_ACTIONS.FETCH_GROUP_FEED, {
        groupId: col.sourceId,
        forceRefresh,
        sortBy: col.sortBy || SORT_OPTIONS.DATE_DESC,
      });
    } else if (col.sourceType === DECK_SOURCE_TYPES.SUBSCRIPTIONS) {
      res = await sendBg(MESSAGE_ACTIONS.FETCH_GROUP_FEED, {
        groupId: null,
        forceRefresh,
        sortBy: col.sortBy || SORT_OPTIONS.DATE_DESC,
      });
    } else if (col.sourceType === DECK_SOURCE_TYPES.CHANNEL) {
      if (!col.sourceId) {
        rt.entries = [];
        rt.loading = false;
        renderColumnBody(col);
        return;
      }
      res = await sendBg(MESSAGE_ACTIONS.FETCH_CHANNEL_FEED, {
        channelId: col.sourceId,
        forceRefresh,
        sortBy: col.sortBy || SORT_OPTIONS.DATE_DESC,
      });
    } else if (col.sourceType === DECK_SOURCE_TYPES.PLAYLIST) {
      if (!col.sourceId) {
        rt.entries = [];
        rt.loading = false;
        renderColumnBody(col);
        return;
      }
      const pl = state?.playlists?.[col.sourceId];
      if (pl && (pl.isCustom || Array.isArray(pl.videos))) {
        rt.entries = mapCustomPlaylistVideosToEntries(pl);
        rt.error = null;
        rt.loading = false;
        renderColumnBody(col);
        return;
      }
      res = await sendBg(MESSAGE_ACTIONS.FETCH_CHANNEL_FEED, {
        playlistId: col.sourceId,
        forceRefresh,
        sortBy: col.sortBy || SORT_OPTIONS.DATE_DESC,
      });
    } else if (col.sourceType === DECK_SOURCE_TYPES.WATCH_LATER) {
      res = await sendBg(MESSAGE_ACTIONS.FETCH_CHANNEL_FEED, {
        playlistId: 'WL',
        forceRefresh,
        sortBy: col.sortBy || SORT_OPTIONS.DATE_DESC,
      });
    }

    if (res && res.ok) {
      rt.entries = Array.isArray(res.entries) ? res.entries : [];
      rt.error = null;
    } else {
      rt.error = res?.error || (lang === 'pt-BR' ? 'Falha ao carregar feed.' : 'Failed to load feed.');
    }
  } catch (err) {
    rt.error = err?.message || (lang === 'pt-BR' ? 'Erro de conexão.' : 'Connection error.');
  } finally {
    rt.loading = false;
    renderColumnBody(col);
  }
}

async function loadAllColumns(forceRefresh = false) {
  const state = getState();
  const cols = state?.deckColumns || [];
  await Promise.all(cols.map((col) => loadColumnFeed(col, forceRefresh)));
}

/**
 * Apply per-column filters and sorting to loaded entries.
 * @param {import('../shared/types.js').DeckColumn} col
 * @param {any[]} entries
 * @param {any} state
 * @returns {any[]}
 */
function getFilteredAndSortedEntries(col, entries, state) {
  const filters = col.filters || {};
  const watchedMap = state?.watched || {};
  const search = String(filters.search || '').trim().toLowerCase();
  const hideWatched = Boolean(filters.hideWatched || state?.settings?.hideWatchedGlobally);
  const hideShorts = Boolean(filters.hideShorts || state?.settings?.hideShortsGlobally);
  const minDur = Number.isFinite(filters.minDurationSec) ? filters.minDurationSec : null;
  const maxDur = Number.isFinite(filters.maxDurationSec) ? filters.maxDurationSec : null;

  let list = (entries || []).filter((entry) => {
    if (hideWatched && watchedMap[entry.videoId]) return false;
    if (hideShorts && entry.isShort) return false;
    if (search) {
      const hay = `${entry.title || ''} ${entry.channelTitle || ''}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (minDur !== null && Number.isFinite(entry.durationSec) && entry.durationSec < minDur) {
      return false;
    }
    if (maxDur !== null && Number.isFinite(entry.durationSec) && entry.durationSec > maxDur) {
      return false;
    }
    return true;
  });

  switch (col.sortBy) {
    case SORT_OPTIONS.DATE_ASC:
      list.sort((a, b) => (a.publishedAt || 0) - (b.publishedAt || 0));
      break;
    case SORT_OPTIONS.VIEWS_DESC:
      list.sort((a, b) => (b.views || 0) - (a.views || 0));
      break;
    case SORT_OPTIONS.DURATION_DESC:
      list.sort((a, b) => (b.durationSec || 0) - (a.durationSec || 0));
      break;
    case SORT_OPTIONS.DURATION_ASC:
      list.sort((a, b) => (a.durationSec || 0) - (b.durationSec || 0));
      break;
    case SORT_OPTIONS.TITLE_ASC:
      list.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
      break;
    case SORT_OPTIONS.DATE_DESC:
    default:
      list.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
      break;
  }

  return list;
}

/**
 * Render the entire Deck overlay shell and columns.
 */
function renderDeck() {
  if (!overlayEl) return;
  const state = getState();
  const lang = getLang(state);
  const columns = state?.deckColumns || [];

  overlayEl.innerHTML = `
    <header class="tp-deck-topbar">
      <div class="tp-deck-brand">
        <span class="tp-deck-logo" title="${escapeHtml(BRAND_NAME)}"><svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><defs><linearGradient id="tpDeckGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#ff4d6d"/><stop offset="55%" stop-color="#ef233c"/><stop offset="100%" stop-color="#6366f1"/></linearGradient></defs><rect x="1.5" y="1.5" width="29" height="29" rx="8" fill="url(#tpDeckGrad)"/><rect x="6" y="7" width="3" height="14" rx="1.5" fill="rgba(255,255,255,0.9)"/><path d="M13 8.8 L24 14.5 L13 20.2 Z" fill="#ffffff"/><rect x="6" y="23" width="20" height="2.4" rx="1.2" fill="rgba(255,255,255,0.85)"/></svg></span>
        <div>
          <h1 class="tp-deck-title">${escapeHtml(t('deck.title', lang))}</h1>
          <div class="tp-deck-subtitle">${columns.length} ${lang === 'pt-BR' ? 'colunas' : 'columns'}</div>
        </div>
      </div>
      <div class="tp-deck-topbar-actions">
        <button class="tp-btn tp-btn-primary tp-btn-sm" data-deck-action="add-column">
          ＋ ${escapeHtml(t('deck.addColumn', lang))}
        </button>
        <button class="tp-btn tp-btn-secondary tp-btn-sm" data-deck-action="refresh-all">
          ↻ ${escapeHtml(t('deck.refreshAll', lang))}
        </button>
        <button class="tp-btn tp-btn-ghost tp-btn-sm" data-deck-action="close" title="Esc">
          ✕ ${escapeHtml(t('common.close', lang))}
        </button>
      </div>
    </header>
    <main class="tp-deck-columns" id="tp-deck-columns"></main>
  `;

  overlayEl
    .querySelector('[data-deck-action="add-column"]')
    ?.addEventListener('click', () => openColumnModal(null));
  overlayEl
    .querySelector('[data-deck-action="refresh-all"]')
    ?.addEventListener('click', () => {
      loadAllColumns(true);
      showToast(lang === 'pt-BR' ? 'Atualizando todas as colunas...' : 'Refreshing all columns...', 'info');
    });
  overlayEl
    .querySelector('[data-deck-action="close"]')
    ?.addEventListener('click', () => closeDeckModal());

  const track = overlayEl.querySelector('#tp-deck-columns');
  if (!track) return;

  if (columns.length === 0) {
    track.innerHTML = `
      <div class="tp-deck-empty-board">
        <div style="font-size:36px;">📺</div>
        <div style="font-size:15px;font-weight:600;color:var(--tp-text);">
          ${lang === 'pt-BR' ? 'Seu Deck está vazio' : 'Your Deck is empty'}
        </div>
        <div>
          ${
            lang === 'pt-BR'
              ? 'Adicione colunas de grupos, canais, playlists ou inscrições para acompanhar tudo lado a lado.'
              : 'Add columns for groups, channels, playlists, or subscriptions to watch feeds side by side.'
          }
        </div>
        <button class="tp-btn tp-btn-primary" data-empty-add="1">
          ＋ ${escapeHtml(t('deck.addColumn', lang))}
        </button>
      </div>
    `;
    track.querySelector('[data-empty-add]')?.addEventListener('click', () => openColumnModal(null));
    return;
  }

  columns.forEach((col, index) => {
    const colEl = buildColumnElement(col, index, columns.length, state);
    track.appendChild(colEl);
    renderColumnBody(col);
  });
}

/**
 * Build DOM element for a single Deck column.
 */
function buildColumnElement(col, index, total, state) {
  const lang = getLang(state);
  const rt = getRuntime(col.id);
  const widthPx = Number.isFinite(col.width) ? col.width : 360;
  const group = col.sourceType === DECK_SOURCE_TYPES.GROUP && col.sourceId ? state?.groups?.[col.sourceId] : null;
  const iconHtml = group ? renderIconHtml(group.icon, 16) : getSourceDefaultIcon(col.sourceType);
  const sourceLabel = t(`deck.source.${col.sourceType}`, lang);

  const el = document.createElement('section');
  el.className = 'tp-deck-col';
  el.dataset.colId = col.id;
  el.style.width = `${widthPx}px`;
  el.draggable = true;

  const filters = col.filters || {};
  const minMin = Number.isFinite(filters.minDurationSec) ? Math.round(filters.minDurationSec / 60) : '';
  const maxMin = Number.isFinite(filters.maxDurationSec) ? Math.round(filters.maxDurationSec / 60) : '';

  el.innerHTML = `
    <div class="tp-deck-col-header">
      <div class="tp-deck-col-header-top">
        <div class="tp-deck-col-title-wrap" title="${escapeHtml(col.title)}">
          <span class="tp-deck-drag-handle" aria-hidden="true">⋮⋮</span>
          ${iconHtml}
          <div style="min-width:0;flex:1;">
            <h2 class="tp-deck-col-title">${escapeHtml(col.title)}</h2>
            <div class="tp-deck-col-source-tag">${escapeHtml(sourceLabel)}</div>
          </div>
        </div>
        <span class="tp-badge" data-col-count="${escapeHtml(col.id)}">0</span>
      </div>
      <div class="tp-deck-col-actions">
        <div class="tp-deck-col-actions-left">
          <button class="tp-btn-icon" data-col-act="play-all" title="${escapeHtml(t('deck.playAll', lang))}">▶</button>
          <button class="tp-btn-icon" data-col-act="refresh" title="${escapeHtml(t('common.refresh', lang))}">↻</button>
          <button class="tp-btn-icon ${rt.filtersOpen ? 'is-active' : ''}" data-col-act="toggle-filters" title="${escapeHtml(t('common.filter', lang))}">⚙</button>
        </div>
        <div class="tp-deck-col-actions-right">
          <button class="tp-btn-icon" data-col-act="move-left" ${index === 0 ? 'disabled' : ''} title="${lang === 'pt-BR' ? 'Mover para esquerda' : 'Move left'}">◀</button>
          <button class="tp-btn-icon" data-col-act="move-right" ${index === total - 1 ? 'disabled' : ''} title="${lang === 'pt-BR' ? 'Mover para direita' : 'Move right'}">▶</button>
          <button class="tp-btn-icon" data-col-act="edit" title="${escapeHtml(t('common.edit', lang))}">✎</button>
          <button class="tp-btn-icon" data-col-act="delete" title="${escapeHtml(t('common.delete', lang))}">🗑</button>
        </div>
      </div>
    </div>
    <div class="tp-deck-col-filters ${rt.filtersOpen ? '' : 'is-hidden'}" data-col-filters="${escapeHtml(col.id)}">
      <div class="tp-deck-filter-row">
        <input class="tp-input" type="text" data-filter="search" value="${escapeHtml(filters.search || '')}" placeholder="${escapeHtml(t('common.search', lang))}" />
      </div>
      <div class="tp-deck-filter-row">
        <select class="tp-select" data-filter="sortBy">
          <option value="${SORT_OPTIONS.DATE_DESC}" ${col.sortBy === SORT_OPTIONS.DATE_DESC ? 'selected' : ''}>${escapeHtml(t('sort.date_desc', lang))}</option>
          <option value="${SORT_OPTIONS.DATE_ASC}" ${col.sortBy === SORT_OPTIONS.DATE_ASC ? 'selected' : ''}>${escapeHtml(t('sort.date_asc', lang))}</option>
          <option value="${SORT_OPTIONS.VIEWS_DESC}" ${col.sortBy === SORT_OPTIONS.VIEWS_DESC ? 'selected' : ''}>${escapeHtml(t('sort.views_desc', lang))}</option>
          <option value="${SORT_OPTIONS.DURATION_DESC}" ${col.sortBy === SORT_OPTIONS.DURATION_DESC ? 'selected' : ''}>${escapeHtml(t('sort.duration_desc', lang))}</option>
          <option value="${SORT_OPTIONS.DURATION_ASC}" ${col.sortBy === SORT_OPTIONS.DURATION_ASC ? 'selected' : ''}>${escapeHtml(t('sort.duration_asc', lang))}</option>
          <option value="${SORT_OPTIONS.TITLE_ASC}" ${col.sortBy === SORT_OPTIONS.TITLE_ASC ? 'selected' : ''}>${escapeHtml(t('sort.title_asc', lang))}</option>
        </select>
      </div>
      <div class="tp-deck-filter-row">
        <input class="tp-input" type="number" min="0" data-filter="minMin" value="${escapeHtml(minMin)}" placeholder="${escapeHtml(t('filter.durationMin', lang))}" />
        <input class="tp-input" type="number" min="0" data-filter="maxMin" value="${escapeHtml(maxMin)}" placeholder="${escapeHtml(t('filter.durationMax', lang))}" />
      </div>
      <div class="tp-deck-checkbox-row">
        <label class="tp-deck-checkbox-label">
          <input type="checkbox" data-filter="hideWatched" ${filters.hideWatched ? 'checked' : ''} />
          ${escapeHtml(t('watched.hideWatched', lang))}
        </label>
        <label class="tp-deck-checkbox-label">
          <input type="checkbox" data-filter="hideShorts" ${filters.hideShorts ? 'checked' : ''} />
          ${escapeHtml(t('watched.hideShorts', lang))}
        </label>
      </div>
    </div>
    <div class="tp-deck-col-body" data-col-body="${escapeHtml(col.id)}"></div>
  `;

  // Wire header actions
  el.querySelector('[data-col-act="play-all"]')?.addEventListener('click', () => handlePlayAll(col));
  el.querySelector('[data-col-act="refresh"]')?.addEventListener('click', () => loadColumnFeed(col, true));
  el.querySelector('[data-col-act="toggle-filters"]')?.addEventListener('click', (e) => {
    rt.filtersOpen = !rt.filtersOpen;
    e.currentTarget.classList.toggle('is-active', rt.filtersOpen);
    el.querySelector(`[data-col-filters="${col.id}"]`)?.classList.toggle('is-hidden', !rt.filtersOpen);
  });
  el.querySelector('[data-col-act="move-left"]')?.addEventListener('click', () => moveColumnByOffset(col.id, -1));
  el.querySelector('[data-col-act="move-right"]')?.addEventListener('click', () => moveColumnByOffset(col.id, 1));
  el.querySelector('[data-col-act="edit"]')?.addEventListener('click', () => openColumnModal(col));
  el.querySelector('[data-col-act="delete"]')?.addEventListener('click', () => handleDeleteColumn(col));

  // Wire filter controls
  const updateColumnFilter = async (patch) => {
    const res = await sendBg(MESSAGE_ACTIONS.UPDATE_DECK_COLUMN, { id: col.id, patch });
    if (res?.ok && res.state) {
      deckHooks?.onStateChange?.(res.state);
      const updated = res.state.deckColumns.find((c) => c.id === col.id) || col;
      renderColumnBody(updated);
    }
  };

  let searchTimer = null;
  el.querySelector('[data-filter="search"]')?.addEventListener('input', (e) => {
    const val = e.target.value;
    col.filters = { ...(col.filters || {}), search: val };
    renderColumnBody(col);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => updateColumnFilter({ filters: { search: val } }), 300);
  });

  el.querySelector('[data-filter="sortBy"]')?.addEventListener('change', (e) => {
    col.sortBy = e.target.value;
    renderColumnBody(col);
    updateColumnFilter({ sortBy: e.target.value });
  });

  el.querySelector('[data-filter="hideWatched"]')?.addEventListener('change', (e) => {
    col.filters = { ...(col.filters || {}), hideWatched: e.target.checked };
    renderColumnBody(col);
    updateColumnFilter({ filters: { hideWatched: e.target.checked } });
  });

  el.querySelector('[data-filter="hideShorts"]')?.addEventListener('change', (e) => {
    col.filters = { ...(col.filters || {}), hideShorts: e.target.checked };
    renderColumnBody(col);
    updateColumnFilter({ filters: { hideShorts: e.target.checked } });
  });

  el.querySelector('[data-filter="minMin"]')?.addEventListener('change', (e) => {
    const val = e.target.value === '' ? null : Math.max(0, Number(e.target.value)) * 60;
    col.filters = { ...(col.filters || {}), minDurationSec: Number.isFinite(val) ? val : null };
    renderColumnBody(col);
    updateColumnFilter({ filters: { minDurationSec: col.filters.minDurationSec } });
  });

  el.querySelector('[data-filter="maxMin"]')?.addEventListener('change', (e) => {
    const val = e.target.value === '' ? null : Math.max(0, Number(e.target.value)) * 60;
    col.filters = { ...(col.filters || {}), maxDurationSec: Number.isFinite(val) ? val : null };
    renderColumnBody(col);
    updateColumnFilter({ filters: { maxDurationSec: col.filters.maxDurationSec } });
  });

  // HTML5 Drag & Drop Reorder
  el.addEventListener('dragstart', (e) => {
    draggingColId = col.id;
    el.classList.add('is-dragging');
    e.dataTransfer?.setData('text/plain', col.id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });

  el.addEventListener('dragend', () => {
    draggingColId = null;
    el.classList.remove('is-dragging');
    overlayEl?.querySelectorAll('.tp-deck-col.is-drag-over').forEach((n) => n.classList.remove('is-drag-over'));
  });

  el.addEventListener('dragover', (e) => {
    if (!draggingColId || draggingColId === col.id) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    el.classList.add('is-drag-over');
  });

  el.addEventListener('dragleave', () => {
    el.classList.remove('is-drag-over');
  });

  el.addEventListener('drop', async (e) => {
    e.preventDefault();
    el.classList.remove('is-drag-over');
    const sourceId = draggingColId || e.dataTransfer?.getData('text/plain');
    if (!sourceId || sourceId === col.id) return;
    await reorderColumnsByDrop(sourceId, col.id);
  });

  return el;
}

function getSourceDefaultIcon(sourceType) {
  switch (sourceType) {
    case DECK_SOURCE_TYPES.GROUP:
      return '<span class="tp-icon">📁</span>';
    case DECK_SOURCE_TYPES.CHANNEL:
      return '<span class="tp-icon">📺</span>';
    case DECK_SOURCE_TYPES.PLAYLIST:
      return '<span class="tp-icon">🎵</span>';
    case DECK_SOURCE_TYPES.WATCH_LATER:
      return '<span class="tp-icon">⏰</span>';
    case DECK_SOURCE_TYPES.COMMUNITY:
      return '<span class="tp-icon">💬</span>';
    case DECK_SOURCE_TYPES.SUBSCRIPTIONS:
    default:
      return '<span class="tp-icon">🔔</span>';
  }
}

/**
 * Render the video list (or loading/empty/error/community state) inside a column body.
 */
function renderColumnBody(col) {
  if (!overlayEl) return;
  const bodyEl = overlayEl.querySelector(`[data-col-body="${col.id}"]`);
  const countEl = overlayEl.querySelector(`[data-col-count="${col.id}"]`);
  if (!bodyEl) return;

  const state = getState();
  const lang = getLang(state);
  const rt = getRuntime(col.id);

  // Community column renders direct community links for channels in the group/all
  if (col.sourceType === DECK_SOURCE_TYPES.COMMUNITY) {
    const allChannels = Object.values(state?.channels || {});
    const targetChannels = col.sourceId
      ? allChannels.filter((c) => (c.groupIds || []).includes(col.sourceId))
      : allChannels;
    if (countEl) countEl.textContent = String(targetChannels.length);

    if (targetChannels.length === 0) {
      bodyEl.innerHTML = `
        <div class="tp-deck-state-box">
          <div style="font-size:28px;">💬</div>
          <div>${
            lang === 'pt-BR'
              ? 'Nenhum canal sincronizado ainda. Abra o Gerenciador e sincronize suas inscrições para acompanhar a aba Comunidade.'
              : 'No channels synced yet. Open the Manager and sync your subscriptions to follow Community posts.'
          }</div>
        </div>
      `;
      return;
    }

    bodyEl.innerHTML = targetChannels
      .slice(0, 50)
      .map((ch) => {
        const baseUrl = ch.url || `https://www.youtube.com/channel/${encodeURIComponent(ch.id)}`;
        const commUrl = `${baseUrl.replace(/\/$/, '')}/community`;
        const avatar = ch.avatarUrl
          ? `<img class="tp-deck-community-avatar" src="${escapeHtml(ch.avatarUrl)}" alt="" />`
          : `<div class="tp-deck-community-avatar"></div>`;
        return `
          <div class="tp-deck-community-card">
            <div class="tp-deck-community-info">
              ${avatar}
              <div style="min-width:0;">
                <div class="tp-deck-community-name">${escapeHtml(ch.title || ch.id)}</div>
                <div class="tp-deck-community-sub">${escapeHtml(ch.handle || '')}</div>
              </div>
            </div>
            <a class="tp-btn tp-btn-sm tp-btn-secondary" href="${escapeHtml(commUrl)}" target="_blank" rel="noopener">
              ${lang === 'pt-BR' ? 'Posts ↗' : 'Posts ↗'}
            </a>
          </div>
        `;
      })
      .join('');
    return;
  }

  if (rt.loading) {
    bodyEl.innerHTML = `
      <div class="tp-deck-state-box">
        <div class="tp-deck-spinner"></div>
        <div>${escapeHtml(t('common.loading', lang))}</div>
      </div>
    `;
    return;
  }

  if (rt.error) {
    bodyEl.innerHTML = `
      <div class="tp-deck-state-box">
        <div style="font-size:26px;">⚠️</div>
        <div>${escapeHtml(rt.error)}</div>
        <button class="tp-btn tp-btn-sm tp-btn-secondary" data-retry-col="${escapeHtml(col.id)}">
          ↻ ${escapeHtml(t('common.refresh', lang))}
        </button>
      </div>
    `;
    bodyEl.querySelector(`[data-retry-col="${col.id}"]`)?.addEventListener('click', () => loadColumnFeed(col, true));
    return;
  }

  const visible = getFilteredAndSortedEntries(col, rt.entries, state);
  if (countEl) countEl.textContent = String(visible.length);

  if (visible.length === 0) {
    let guidance = t('deck.emptyColumn', lang);
    let extraBtn = '';
    if (col.sourceType === DECK_SOURCE_TYPES.GROUP) {
      guidance =
        lang === 'pt-BR'
          ? 'Nenhum vídeo encontrado. Certifique-se de adicionar canais a este grupo no Gerenciador.'
          : 'No videos found. Make sure you have added channels to this group in the Manager.';
    } else if (col.sourceType === DECK_SOURCE_TYPES.SUBSCRIPTIONS) {
      guidance =
        lang === 'pt-BR'
          ? 'Nenhum canal sincronizado ainda. Sincronize suas inscrições no menu lateral ou Gerenciador.'
          : 'No subscriptions synced yet. Sync your subscriptions from the sidebar or Manager.';
    } else if (col.sourceType === DECK_SOURCE_TYPES.WATCH_LATER) {
      guidance =
        lang === 'pt-BR'
          ? 'A playlist Assistir Mais Tarde é privada no YouTube e não expõe RSS público.'
          : 'Watch Later is private on YouTube and does not expose a public RSS feed.';
      extraBtn = `<a class="tp-btn tp-btn-sm tp-btn-primary" href="https://www.youtube.com/playlist?list=WL" target="_blank" rel="noopener">${escapeHtml(t('deck.openInYoutube', lang))} ↗</a>`;
    }

    bodyEl.innerHTML = `
      <div class="tp-deck-state-box">
        <div style="font-size:28px;">📭</div>
        <div>${escapeHtml(guidance)}</div>
        ${extraBtn}
      </div>
    `;
    return;
  }

  const watchedMap = state?.watched || {};
  bodyEl.innerHTML = visible
    .map((entry) => {
      const watched = Boolean(watchedMap[entry.videoId]);
      const dur = formatDuration(entry.durationSec);
      const relTime = formatRelativeTime(entry.publishedAt, lang);
      const viewsStr = formatViews(entry.views, lang);
      const statsText = [relTime, viewsStr].filter(Boolean).join(' • ');
      const videoUrl = entry.url || `https://www.youtube.com/watch?v=${encodeURIComponent(entry.videoId)}`;
      const thumbUrl = entry.thumbnailUrl || `https://i.ytimg.com/vi/${encodeURIComponent(entry.videoId)}/hqdefault.jpg`;

      return `
        <article class="tp-deck-card ${watched ? 'is-watched' : ''}" data-video-id="${escapeHtml(entry.videoId)}">
          <a class="tp-deck-thumb-link" href="${escapeHtml(videoUrl)}" target="_blank" rel="noopener">
            <img class="tp-deck-thumb" src="${escapeHtml(thumbUrl)}" loading="lazy" alt="" />
            ${entry.isShort ? '<span class="tp-deck-shorts-badge">Shorts</span>' : ''}
            ${watched ? `<span class="tp-deck-watched-badge">${escapeHtml(t('watched.badge', lang))}</span>` : ''}
            ${dur ? `<span class="tp-deck-duration-badge">${escapeHtml(dur)}</span>` : ''}
          </a>
          <div class="tp-deck-card-info">
            <a class="tp-deck-card-title" href="${escapeHtml(videoUrl)}" target="_blank" rel="noopener" title="${escapeHtml(entry.title)}">
              ${escapeHtml(entry.title)}
            </a>
            <div class="tp-deck-card-meta">
              <span class="tp-deck-card-channel" title="${escapeHtml(entry.channelTitle)}">${escapeHtml(entry.channelTitle)}</span>
            </div>
            <div class="tp-deck-card-footer">
              <span class="tp-deck-card-stats">${escapeHtml(statsText)}</span>
              <button class="tp-deck-watch-btn ${watched ? 'is-watched' : ''}" data-toggle-watch="${escapeHtml(entry.videoId)}" title="${escapeHtml(watched ? t('watched.unmark', lang) : t('watched.mark', lang))}">
                ${watched ? '✓' : '○'} ${escapeHtml(watched ? t('watched.badge', lang) : t('watched.mark', lang))}
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join('');

  bodyEl.querySelectorAll('[data-toggle-watch]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const videoId = btn.dataset.toggleWatch;
      const entry = visible.find((v) => v.videoId === videoId);
      const res = await sendBg(MESSAGE_ACTIONS.TOGGLE_WATCHED, {
        videoId,
        meta: {
          title: entry?.title,
          channelId: entry?.channelId,
          durationSec: entry?.durationSec,
        },
      });
      if (res?.ok && res.state) {
        deckHooks?.onStateChange?.(res.state);
        renderColumnBody(col);
      }
    });
  });
}

/**
 * Play all visible videos in a column as a temporary YouTube playlist.
 */
function handlePlayAll(col) {
  const state = getState();
  const lang = getLang(state);
  const rt = getRuntime(col.id);
  const visible = getFilteredAndSortedEntries(col, rt.entries, state);
  const ids = visible.map((v) => v.videoId).filter(Boolean).slice(0, 50);

  if (ids.length === 0) {
    showToast(lang === 'pt-BR' ? 'Nenhum vídeo nesta coluna para reproduzir.' : 'No videos in this column to play.', 'info');
    return;
  }

  const url = `https://www.youtube.com/watch_videos?video_ids=${encodeURIComponent(ids.join(','))}`;
  window.open(url, '_blank', 'noopener');
}

async function moveColumnByOffset(colId, offset) {
  const state = getState();
  const cols = [...(state?.deckColumns || [])];
  const idx = cols.findIndex((c) => c.id === colId);
  if (idx === -1) return;
  const targetIdx = idx + offset;
  if (targetIdx < 0 || targetIdx >= cols.length) return;

  const [moved] = cols.splice(idx, 1);
  cols.splice(targetIdx, 0, moved);

  const res = await sendBg(MESSAGE_ACTIONS.SAVE_DECK_COLUMNS, { columns: cols });
  if (res?.ok && res.state) {
    deckHooks?.onStateChange?.(res.state);
    renderDeck();
  }
}

async function reorderColumnsByDrop(sourceId, targetId) {
  const state = getState();
  const cols = [...(state?.deckColumns || [])];
  const fromIdx = cols.findIndex((c) => c.id === sourceId);
  const toIdx = cols.findIndex((c) => c.id === targetId);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;

  const [moved] = cols.splice(fromIdx, 1);
  cols.splice(toIdx, 0, moved);

  const res = await sendBg(MESSAGE_ACTIONS.SAVE_DECK_COLUMNS, { columns: cols });
  if (res?.ok && res.state) {
    deckHooks?.onStateChange?.(res.state);
    renderDeck();
  }
}

async function handleDeleteColumn(col) {
  const state = getState();
  const lang = getLang(state);
  const res = await sendBg(MESSAGE_ACTIONS.DELETE_DECK_COLUMN, { id: col.id });
  if (res?.ok && res.state) {
    columnRuntime.delete(col.id);
    deckHooks?.onStateChange?.(res.state);
    renderDeck();
    showToast(lang === 'pt-BR' ? 'Coluna removida.' : 'Column removed.', 'info');
  }
}

/**
 * Open the Add / Edit Column modal.
 * @param {import('../shared/types.js').DeckColumn | null} editingCol
 */
function openColumnModal(editingCol) {
  closeColumnModal();
  const state = getState();
  const lang = getLang(state);
  const isEdit = Boolean(editingCol);

  const subGroups = Object.values(state?.groups || {}).filter((g) => g.kind === GROUP_KINDS.SUBSCRIPTION);
  const channels = Object.values(state?.channels || {}).sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  const playlists = Object.values(state?.playlists || {}).sort((a, b) => (a.title || '').localeCompare(b.title || ''));

  let selectedSourceType = editingCol?.sourceType || DECK_SOURCE_TYPES.GROUP;
  let selectedSourceId = editingCol?.sourceId || '';
  let selectedWidth = editingCol?.width || 360;

  columnModalEl = document.createElement('div');
  columnModalEl.className = 'tp-modal-backdrop';
  applyThemeClass(columnModalEl, state);

  columnModalEl.innerHTML = `
    <div class="tp-modal" role="dialog" aria-modal="true">
      <div class="tp-modal-header">
        <h3 class="tp-modal-title">
          ${escapeHtml(isEdit ? t('common.edit', lang) : t('deck.addColumn', lang))}
        </h3>
        <button class="tp-btn-icon" data-cm-close="1">✕</button>
      </div>
      <div class="tp-modal-body">
        <div class="tp-form-group">
          <label class="tp-form-label">${escapeHtml(t('deck.sourceType', lang))}</label>
          <select class="tp-select" id="tp-cm-source-type">
            <option value="${DECK_SOURCE_TYPES.GROUP}" ${selectedSourceType === DECK_SOURCE_TYPES.GROUP ? 'selected' : ''}>${escapeHtml(t('deck.source.group', lang))}</option>
            <option value="${DECK_SOURCE_TYPES.CHANNEL}" ${selectedSourceType === DECK_SOURCE_TYPES.CHANNEL ? 'selected' : ''}>${escapeHtml(t('deck.source.channel', lang))}</option>
            <option value="${DECK_SOURCE_TYPES.PLAYLIST}" ${selectedSourceType === DECK_SOURCE_TYPES.PLAYLIST ? 'selected' : ''}>${escapeHtml(t('deck.source.playlist', lang))}</option>
            <option value="${DECK_SOURCE_TYPES.SUBSCRIPTIONS}" ${selectedSourceType === DECK_SOURCE_TYPES.SUBSCRIPTIONS ? 'selected' : ''}>${escapeHtml(t('deck.source.subscriptions', lang))}</option>
            <option value="${DECK_SOURCE_TYPES.WATCH_LATER}" ${selectedSourceType === DECK_SOURCE_TYPES.WATCH_LATER ? 'selected' : ''}>${escapeHtml(t('deck.source.watch-later', lang))}</option>
            <option value="${DECK_SOURCE_TYPES.COMMUNITY}" ${selectedSourceType === DECK_SOURCE_TYPES.COMMUNITY ? 'selected' : ''}>${escapeHtml(t('deck.source.community', lang))}</option>
          </select>
        </div>

        <div class="tp-form-group" id="tp-cm-target-wrap"></div>

        <div class="tp-form-group">
          <label class="tp-form-label">${escapeHtml(t('deck.columnTitle', lang))}</label>
          <input class="tp-input" type="text" id="tp-cm-title" value="${escapeHtml(editingCol?.title || '')}" placeholder="${lang === 'pt-BR' ? 'Ex: Tech & IA' : 'e.g. Tech & AI'}" />
        </div>

        <div class="tp-form-group">
          <label class="tp-form-label">${lang === 'pt-BR' ? 'Largura da coluna' : 'Column width'}</label>
          <div class="tp-deck-width-options" id="tp-cm-widths">
            ${WIDTH_PRESETS.map(
              (w) => `
              <button type="button" class="tp-deck-width-btn ${selectedWidth === w.px ? 'is-selected' : ''}" data-width-px="${w.px}">
                ${escapeHtml(lang === 'pt-BR' ? w.labelPt : w.labelEn)}
              </button>
            `
            ).join('')}
          </div>
        </div>
      </div>
      <div class="tp-modal-footer">
        <button type="button" class="tp-btn tp-btn-secondary" data-cm-close="1">${escapeHtml(t('common.cancel', lang))}</button>
        <button type="button" class="tp-btn tp-btn-primary" id="tp-cm-save">${escapeHtml(t('common.save', lang))}</button>
      </div>
    </div>
  `;

  document.body.appendChild(columnModalEl);

  const sourceTypeSelect = columnModalEl.querySelector('#tp-cm-source-type');
  const targetWrap = columnModalEl.querySelector('#tp-cm-target-wrap');
  const titleInput = columnModalEl.querySelector('#tp-cm-title');

  const renderTargetPicker = () => {
    if (!targetWrap) return;
    if (selectedSourceType === DECK_SOURCE_TYPES.GROUP || selectedSourceType === DECK_SOURCE_TYPES.COMMUNITY) {
      targetWrap.style.display = '';
      targetWrap.innerHTML = `
        <label class="tp-form-label">${lang === 'pt-BR' ? 'Grupo' : 'Group'}</label>
        <select class="tp-select" id="tp-cm-source-id">
          ${selectedSourceType === DECK_SOURCE_TYPES.COMMUNITY ? `<option value="">${escapeHtml(t('common.all', lang))}</option>` : ''}
          ${
            subGroups.length === 0
              ? `<option value="">${lang === 'pt-BR' ? 'Nenhum grupo criado' : 'No groups created'}</option>`
              : subGroups
                  .map(
                    (g) =>
                      `<option value="${escapeHtml(g.id)}" ${selectedSourceId === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`
                  )
                  .join('')
          }
        </select>
      `;
    } else if (selectedSourceType === DECK_SOURCE_TYPES.CHANNEL) {
      targetWrap.style.display = '';
      targetWrap.innerHTML = `
        <label class="tp-form-label">${lang === 'pt-BR' ? 'Canal' : 'Channel'}</label>
        <select class="tp-select" id="tp-cm-source-id">
          ${
            channels.length === 0
              ? `<option value="">${lang === 'pt-BR' ? 'Nenhum canal sincronizado' : 'No channels synced'}</option>`
              : channels
                  .map(
                    (c) =>
                      `<option value="${escapeHtml(c.id)}" ${selectedSourceId === c.id ? 'selected' : ''}>${escapeHtml(c.title || c.id)}</option>`
                  )
                  .join('')
          }
        </select>
      `;
    } else if (selectedSourceType === DECK_SOURCE_TYPES.PLAYLIST) {
      targetWrap.style.display = '';
      targetWrap.innerHTML = `
        <label class="tp-form-label">${lang === 'pt-BR' ? 'Playlist' : 'Playlist'}</label>
        <select class="tp-select" id="tp-cm-source-id">
          ${
            playlists.length === 0
              ? `<option value="">${lang === 'pt-BR' ? 'Nenhuma playlist sincronizada' : 'No playlists synced'}</option>`
              : playlists
                  .map(
                    (p) =>
                      `<option value="${escapeHtml(p.id)}" ${selectedSourceId === p.id ? 'selected' : ''}>${escapeHtml(p.title || p.id)}${p.isCustom ? ` (${escapeHtml(BRAND_NAME)})` : ''}</option>`
                  )
                  .join('')
          }
        </select>
      `;
    } else {
      targetWrap.style.display = 'none';
      targetWrap.innerHTML = '';
    }
  };

  renderTargetPicker();

  sourceTypeSelect?.addEventListener('change', (e) => {
    selectedSourceType = e.target.value;
    selectedSourceId = '';
    renderTargetPicker();
  });

  columnModalEl.querySelectorAll('[data-width-px]').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedWidth = Number(btn.dataset.widthPx) || 360;
      columnModalEl
        ?.querySelectorAll('[data-width-px]')
        .forEach((b) => b.classList.toggle('is-selected', b === btn));
    });
  });

  columnModalEl.querySelectorAll('[data-cm-close]').forEach((btn) => {
    btn.addEventListener('click', () => closeColumnModal());
  });

  columnModalEl.addEventListener('click', (e) => {
    if (e.target === columnModalEl) closeColumnModal();
  });

  columnModalEl.querySelector('#tp-cm-save')?.addEventListener('click', async () => {
    const sourceIdEl = columnModalEl?.querySelector('#tp-cm-source-id');
    const sourceId = sourceIdEl ? sourceIdEl.value || null : null;
    let title = String(titleInput?.value || '').trim();

    if (!title) {
      if (selectedSourceType === DECK_SOURCE_TYPES.GROUP && sourceId && state?.groups?.[sourceId]) {
        title = state.groups[sourceId].name;
      } else if (selectedSourceType === DECK_SOURCE_TYPES.CHANNEL && sourceId && state?.channels?.[sourceId]) {
        title = state.channels[sourceId].title;
      } else if (selectedSourceType === DECK_SOURCE_TYPES.PLAYLIST && sourceId && state?.playlists?.[sourceId]) {
        title = state.playlists[sourceId].title;
      } else {
        title = t(`deck.source.${selectedSourceType}`, lang);
      }
    }

    if (isEdit && editingCol) {
      const res = await sendBg(MESSAGE_ACTIONS.UPDATE_DECK_COLUMN, {
        id: editingCol.id,
        patch: {
          title,
          sourceType: selectedSourceType,
          sourceId,
          width: selectedWidth,
        },
      });
      if (res?.ok && res.state) {
        deckHooks?.onStateChange?.(res.state);
        closeColumnModal();
        renderDeck();
        const updatedCol = res.state.deckColumns.find((c) => c.id === editingCol.id);
        if (updatedCol) loadColumnFeed(updatedCol, true);
      }
    } else {
      const res = await sendBg(MESSAGE_ACTIONS.CREATE_DECK_COLUMN, {
        column: {
          title,
          sourceType: selectedSourceType,
          sourceId,
          width: selectedWidth,
          sortBy: SORT_OPTIONS.DATE_DESC,
          filters: { hideWatched: false, hideShorts: false },
        },
      });
      if (res?.ok && res.state) {
        deckHooks?.onStateChange?.(res.state);
        closeColumnModal();
        renderDeck();
        if (res.column) loadColumnFeed(res.column, false);
      }
    }
  });
}

function closeColumnModal() {
  if (columnModalEl) {
    columnModalEl.remove();
    columnModalEl = null;
  }
}
