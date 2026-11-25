/**
 * @fileoverview TubeNook Subscription Manager UI & Features (Pro-complete):
 * - Feed Filter & Sort Toolbar (/feed/subscriptions & Group Feed) + Play Group as Playlist
 * - Unlimited "Mark as Watched" badges on every YouTube video card
 * - Channel Page Group & Tag Button near Subscribe
 * - Smart Rules (`hide_video`) & 1-click Focus Mode toggle
 * - Full Manager Modal: Groups (nested CRUD + searchable Icon Picker + custom upload),
 *   Channels (Sync, Auto-Tags, Manual Tags, Unlimited AND/OR/NOT Tag Filtering,
 *   Channel Status badges + inline threshold editor, Bulk Assign, Bulk Unsubscribe helper, Export CSV),
 *   Community Posts viewer.
 */

import { BRAND_NAME } from '../shared/brand.js';
import {
  GROUP_KINDS,
  CHANNEL_STATUSES,
  SORT_OPTIONS,
  MESSAGE_ACTIONS,
  DEFAULT_STATUS_CONFIG,
  createId,
} from '../shared/types.js';
import {
  getGroupTree,
  getDescendants,
  getChannelsByGroup,
  getPlaylistsByGroup,
  exportChannelsCsv,
} from '../shared/storage.js';
import {
  tagAllChannels,
  filterChannelsByTags,
  getAllUniqueTags,
} from '../shared/auto-tagger.js';
import {
  DEFAULT_GROUP_COLORS,
  ICON_CATEGORIES,
  searchIcons,
  renderIconHtml,
  resizeImageToDataUrl,
} from '../shared/icons.js';
import { t } from '../shared/i18n.js';
import {
  escapeHtml,
  sendBg,
  getPageContext,
  detectChannelIdFromDom,
  isDarkTheme,
  scrapeVideoCards,
  scrapeSidebarSubscriptions,
  showToast,
  toggleFocusModeCss,
  debounce,
  scheduleIdle,
} from './yt-dom.js';

const SUB_TOOLBAR_ID = 'tp-sub-feed-toolbar';
const GROUP_FEED_OVERLAY_ID = 'tp-group-feed-overlay';
const MANAGER_MODAL_ID = 'tp-manager-modal-backdrop';
const CHANNEL_BTN_ID = 'tp-channel-page-btn-wrap';
const CHANNEL_POPOVER_ID = 'tp-channel-popover';
const WATCH_CHANNEL_BTN_ID = 'tp-watch-channel-btn-wrap';
const WATCH_CHANNEL_POPOVER_ID = 'tp-watch-channel-popover';

/** @type {{ getState?: () => import('../shared/types.js').AppState, onStateChange?: (state: any) => void, onOpenDeck?: () => void }} */
let hooks = {};
/** @type {import('../shared/types.js').AppState | null} */
let localState = null;
/** @type {MutationObserver | null} */
let cardObserver = null;
/** @type {Element | null} */
let observedPageManager = null;
let pageManagerAttachTimer = null;
let pageManagerAttachAttempts = 0;

/** Track already-enhanced video cards so MutationObserver never re-processes them. */
const processedCards = new WeakSet();
/** Store lightweight scraped metadata per card element for delegated click handling. */
const cardMetaMap = new WeakMap();
let delegatedWatchedBound = false;
let lastSubToolbarSig = '';
let lastCardStateSig = '';

/** Feed toolbar filter/sort state (shared for /feed/subscriptions) */
const subFeedFilters = {
  groupId: 'all',
  sortBy: SORT_OPTIONS.DATE_DESC,
  search: '',
  minDurationMin: '',
  maxDurationMin: '',
  hideWatched: false,
  hideShorts: false,
  hideLive: false,
};

/** Group Feed overlay state */
const groupFeedState = {
  open: false,
  groupId: null,
  viewTab: 'videos', // 'videos' | 'channels'
  selectedChannelId: null,
  loading: false,
  entries: [],
  sortBy: SORT_OPTIONS.DATE_DESC,
  search: '',
  minDurationMin: '',
  maxDurationMin: '',
  hideWatched: false,
  hideShorts: false,
  hideLive: false,
};

/** Manager Modal UI state */
const modalState = {
  open: false,
  tab: 'groups', // 'groups' | 'playlists' | 'channels' | 'community'
  // Groups & Playlists shared editor form
  editingGroupId: null,
  editingPlaylistId: null,
  groupFormKind: GROUP_KINDS.SUBSCRIPTION,
  groupFormName: '',
  groupFormParentId: '',
  groupFormColor: DEFAULT_GROUP_COLORS[0],
  groupFormIcon: { type: 'emoji', value: '📁' },
  iconSearch: '',
  iconCategory: 'all',
  showGroupForm: false,
  showPlaylistForm: false,
  // Channels tab
  channelSearch: '',
  channelStatusFilter: 'all',
  channelGroupFilter: 'all',
  tagFilterMode: 'includeAll', // 'includeAll' | 'includeAny' | 'exclude'
  tagIncludeAll: [],
  tagIncludeAny: [],
  tagExclude: [],
  selectedChannelIds: new Set(),
  showThresholdEditor: false,
  showUnsubHelper: false,
  editingChannelTagsId: null,
  // Community tab
  communityGroupId: 'all',
  communityLoading: false,
  communityPosts: [],
  communityError: '',
};

/** Cache for community posts: key -> { fetchedAt, posts } */
const communityCache = new Map();
const COMMUNITY_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Get current AppState from hook or local cache.
 * @returns {import('../shared/types.js').AppState | null}
 */
function stateNow() {
  return hooks.getState?.() || localState;
}

/**
 * Notify host and update local cache when state changes.
 * @param {import('../shared/types.js').AppState | undefined} nextState
 */
function applyNewState(nextState) {
  if (!nextState) return;
  localState = nextState;
  hooks.onStateChange?.(nextState);
}

/**
 * Resolve theme class for modals & overlays.
 * @param {import('../shared/types.js').AppState | null} [state]
 * @returns {'tp-theme-dark' | 'tp-theme-light'}
 */
function getThemeClass(state = stateNow()) {
  const pref = state?.settings?.theme || 'auto';
  if (pref === 'dark') return 'tp-theme-dark';
  if (pref === 'light') return 'tp-theme-light';
  return isDarkTheme() ? 'tp-theme-dark' : 'tp-theme-light';
}

/**
 * Format duration seconds into MM:SS or H:MM:SS.
 * @param {number} sec
 * @returns {string}
 */
function formatDuration(sec) {
  if (!sec || sec <= 0) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Format view count compactly.
 * @param {number} views
 * @returns {string}
 */
function formatViews(views) {
  if (!views || views <= 0) return '';
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (views >= 1_000) return `${(views / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(views);
}

/**
 * Format timestamp as relative date string.
 * @param {number | null | undefined} ts
 * @param {string} [lang='pt-BR']
 * @returns {string}
 */
function formatRelativeDate(ts, lang = 'pt-BR') {
  if (!ts) return t('channel.noVideoDate', lang);
  const diffMs = Math.max(0, Date.now() - ts);
  const days = Math.floor(diffMs / 86400000);
  const hours = Math.floor(diffMs / 3600000);
  if (lang === 'pt-BR') {
    if (hours < 1) return 'agora';
    if (hours < 24) return `há ${hours}h`;
    if (days === 1) return 'há 1 dia';
    if (days < 30) return `há ${days} dias`;
    const months = Math.floor(days / 30);
    if (months < 12) return months === 1 ? 'há 1 mês' : `há ${months} meses`;
    const years = Math.floor(months / 12);
    return years === 1 ? 'há 1 ano' : `há ${years} anos`;
  }
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? '1 month ago' : `${months} months ago`;
  const years = Math.floor(months / 12);
  return years === 1 ? '1 year ago' : `${years} years ago`;
}

/**
 * Open a YouTube watch_videos temporary playlist for up to 50 video IDs.
 * @param {string[]} videoIds
 * @param {string} lang
 */
function playVideosAsPlaylist(videoIds, lang) {
  const unique = [...new Set(videoIds.filter(Boolean))].slice(0, 50);
  if (unique.length === 0) {
    showToast(
      lang === 'pt-BR' ? 'Nenhum vídeo visível para reproduzir.' : 'No visible videos to play.',
      'warning'
    );
    return;
  }
  const url = `https://www.youtube.com/watch_videos?video_ids=${encodeURIComponent(unique.join(','))}`;
  window.open(url, '_blank', 'noopener');
}

/**
 * Check if a video matches any enabled SmartRule of type `hide_video`.
 * @param {{ title?: string, channelTitle?: string }} video
 * @param {import('../shared/types.js').AppState | null} state
 * @returns {boolean}
 */
function matchesHideVideoSmartRules(video, state) {
  const rules = state?.smartRules;
  if (!Array.isArray(rules) || rules.length === 0) return false;
  const hay = `${video?.title || ''} ${video?.channelTitle || ''}`.toLowerCase();
  if (!hay.trim()) return false;

  for (const rule of rules) {
    if (!rule?.enabled || rule.actionType !== 'hide_video') continue;
    const rawPattern = String(rule.pattern || '').trim();
    if (!rawPattern) continue;
    const terms = rawPattern
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (terms.some((term) => hay.includes(term))) {
      return true;
    }
  }
  return false;
}

/**
 * Toggle PlayShelf Focus Mode (persists setting and toggles CSS class).
 */
async function toggleFocusMode() {
  const st = stateNow();
  if (!st) return;
  const nextEnabled = !Boolean(st.settings?.focusMode);
  toggleFocusModeCss(nextEnabled);
  const res = await sendBg(MESSAGE_ACTIONS.UPDATE_SETTINGS, {
    settings: { focusMode: nextEnabled },
  });
  if (res?.ok && res.state) {
    applyNewState(res.state);
    refreshSubscriptionsUI(res.state);
    const lang = res.state.settings?.language || 'pt-BR';
    showToast(
      `${t('focus.focusMode', lang)}: ${
        nextEnabled ? (lang === 'pt-BR' ? 'Ativado' : 'On') : lang === 'pt-BR' ? 'Desativado' : 'Off'
      }`,
      'info'
    );
  }
}

/* ============================================================================
 * 1. UNLIMITED "MARK AS WATCHED" BADGES ON VIDEO CARDS
 * ========================================================================== */

/**
 * Compute a lightweight signature for state fields that affect video card rendering.
 * @param {import('../shared/types.js').AppState | null} state
 * @returns {string}
 */
function computeCardStateSig(state) {
  if (!state) return '';
  const watchedKeys = Object.keys(state.watched || {});
  const s = state.settings || {};
  const rulesSig = (state.smartRules || [])
    .filter((r) => r?.enabled && r.actionType === 'hide_video')
    .map((r) => r.pattern || '')
    .join(',');
  return `${watchedKeys.length}:${watchedKeys.slice(-5).join(',')}|${s.showWatchedBadge !== false ? 1 : 0}|${s.hideWatchedGlobally ? 1 : 0}|${s.hideShortsGlobally ? 1 : 0}|${s.language || 'pt-BR'}|${rulesSig}`;
}

/**
 * Bind a single delegated click listener for all `.tp-watched-toggle-btn` badges
 * instead of attaching a listener to every video card.
 */
function bindWatchedToggleDelegation() {
  if (delegatedWatchedBound || typeof document === 'undefined') return;
  delegatedWatchedBound = true;

  document.addEventListener(
    'click',
    async (ev) => {
      const btn = /** @type {HTMLButtonElement | null} */ (
        ev.target instanceof Element ? ev.target.closest('.tp-watched-toggle-btn') : null
      );
      if (!btn) return;
      ev.preventDefault();
      ev.stopPropagation();

      const vid = btn.dataset.videoId;
      if (!vid) return;

      const cardEl = btn.closest('[data-tp-video-id]');
      const meta = (cardEl && cardMetaMap.get(cardEl)) || {};

      const res = await sendBg(MESSAGE_ACTIONS.TOGGLE_WATCHED, {
        videoId: vid,
        meta: {
          title: meta.title || '',
          channelId: meta.channelId || '',
          durationSec: meta.durationSec || 0,
        },
      });
      if (res?.ok && res.state) {
        applyNewState(res.state);
        enhanceVideoCards(res.state, { onlyNew: false });
        if (getPageContext().type === 'subscriptions') {
          applySubFeedFiltersAndSort(res.state);
        }
      }
    },
    true
  );
}

/**
 * Decorate scraped video cards on the page with a Mark-as-Watched toggle button
 * and apply watched dimming/hiding. Uses `processedCards` WeakSet + event delegation
 * so already-enhanced cards are never re-processed on incremental DOM scans.
 * @param {import('../shared/types.js').AppState | null} [state]
 * @param {{ onlyNew?: boolean }} [opts]
 */
function enhanceVideoCards(state = stateNow(), opts = {}) {
  if (typeof document === 'undefined' || !state) return;
  bindWatchedToggleDelegation();

  const onlyNew = Boolean(opts.onlyNew);
  const watchedMap = state.watched || {};
  const showBadge = state.settings?.showWatchedBadge !== false;
  const hideWatchedGlobally = Boolean(state.settings?.hideWatchedGlobally);
  const hideShortsGlobally = Boolean(state.settings?.hideShortsGlobally);
  const lang = state.settings?.language || 'pt-BR';
  const ctx = getPageContext();
  const isSubsPage = ctx.type === 'subscriptions';

  const scanRoot =
    document.querySelector('ytd-page-manager') ||
    document.getElementById('page-manager') ||
    document;

  const cards = scrapeVideoCards(scanRoot);
  for (const card of cards) {
    const el = /** @type {HTMLElement} */ (card.el);

    // Skip already-processed cards on incremental scans (unless YouTube recycled the DOM node for a new videoId)
    if (onlyNew && processedCards.has(el) && el.dataset.tpVideoId === card.videoId) {
      continue;
    }

    const isWatched = Boolean(watchedMap[card.videoId]);
    el.dataset.tpVideoId = card.videoId;
    cardMetaMap.set(el, {
      videoId: card.videoId,
      title: card.title,
      channelId: card.channelId,
      durationSec: card.durationSec,
      isShort: card.isShort,
    });
    processedCards.add(el);

    if (el.classList.contains('tp-card-watched') !== isWatched) {
      el.classList.toggle('tp-card-watched', isWatched);
    }

    // Apply global hide rules + SmartRules (`hide_video`) when not on /feed/subscriptions
    if (!isSubsPage) {
      const shouldHide =
        (hideWatchedGlobally && isWatched) ||
        (hideShortsGlobally && card.isShort) ||
        matchesHideVideoSmartRules(card, state);
      if (el.classList.contains('tp-card-hidden') !== shouldHide) {
        el.classList.toggle('tp-card-hidden', shouldHide);
      }
    }

    // Inject Mark-as-Watched button onto thumbnail container
    const thumbHost =
      el.querySelector('ytd-thumbnail #thumbnail') ||
      el.querySelector('ytd-thumbnail') ||
      el.querySelector('yt-thumbnail-view-model') ||
      el.querySelector('a#thumbnail');

    if (!thumbHost) continue;

    let btn = /** @type {HTMLButtonElement | null} */ (
      thumbHost.querySelector(':scope > .tp-watched-toggle-btn')
    );

    if (!showBadge) {
      if (btn) btn.remove();
      continue;
    }

    if (!btn) {
      if (getComputedStyle(thumbHost).position === 'static') {
        /** @type {HTMLElement} */ (thumbHost).style.position = 'relative';
      }
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tp-watched-toggle-btn';
      thumbHost.appendChild(btn);
    }

    if (btn.dataset.videoId !== card.videoId) {
      btn.dataset.videoId = card.videoId;
    }
    if (btn.classList.contains('tp-is-watched') !== isWatched) {
      btn.classList.toggle('tp-is-watched', isWatched);
    }
    const nextTitle = isWatched ? t('watched.unmark', lang) : t('watched.mark', lang);
    if (btn.title !== nextTitle) {
      btn.title = nextTitle;
      btn.setAttribute('aria-label', nextTitle);
    }
    const nextGlyph = isWatched ? '✓' : '○';
    if (btn.textContent !== nextGlyph) {
      btn.textContent = nextGlyph;
    }
  }
}

/**
 * Debounced (350ms) idle-scheduled scan for newly loaded YouTube video cards (infinite scroll).
 */
const scheduleCardScan = debounce(() => {
  scheduleIdle(() => {
    const st = stateNow();
    if (!st) return;
    enhanceVideoCards(st, { onlyNew: true });
    const ctx = getPageContext();
    if (ctx.type === 'subscriptions') {
      ensureSubFeedToolbar(st);
      applySubFeedFiltersAndSort(st);
    } else if (ctx.type === 'watch') {
      ensureWatchChannelGroupButton(st);
    }
  });
}, 350);

/* ============================================================================
 * 2. /feed/subscriptions FILTER & SORT TOOLBAR
 * ========================================================================== */

/**
 * Render and mount the Feed Filter & Sort Toolbar on `/feed/subscriptions`.
 * @param {import('../shared/types.js').AppState | null} state
 */
function ensureSubFeedToolbar(state) {
  if (typeof document === 'undefined' || !state) return;
  const ctx = getPageContext();
  const existing = document.getElementById(SUB_TOOLBAR_ID);

  if (ctx.type !== 'subscriptions') {
    if (existing) existing.remove();
    return;
  }

  const host =
    document.querySelector('ytd-browse[page-subtype="subscriptions"] #primary #contents') ||
    document.querySelector('ytd-browse[page-subtype="subscriptions"] ytd-rich-grid-renderer') ||
    document.querySelector('ytd-browse[page-subtype="subscriptions"] #primary');
  if (!host) return;

  const lang = state.settings?.language || 'pt-BR';
  const themeClass = getThemeClass(state);
  const subGroups = Object.values(state.groups || {})
    .filter((g) => g.kind === GROUP_KINDS.SUBSCRIPTION)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));

  const focusOn = Boolean(state.settings?.focusMode);
  const toolbarSig = `${themeClass}|${lang}|${focusOn ? 1 : 0}|${subFeedFilters.groupId}|${subGroups.map((g) => `${g.id}:${g.name}:${g.color || ''}`).join(',')}`;

  let toolbar = existing;
  if (!toolbar) {
    toolbar = document.createElement('div');
    toolbar.id = SUB_TOOLBAR_ID;
    host.parentElement?.insertBefore(toolbar, host);
    lastSubToolbarSig = '';
  }

  if (toolbar.dataset.tpBound === '1' && lastSubToolbarSig === toolbarSig) {
    return;
  }
  lastSubToolbarSig = toolbarSig;

  toolbar.className = `tp-feed-toolbar ${themeClass}`;

  const groupPillsHtml = [
    `<button type="button" class="tp-pill ${subFeedFilters.groupId === 'all' ? 'tp-pill-active' : ''}" data-tp-sub-group="all">${escapeHtml(t('common.all', lang))}</button>`,
    ...subGroups.map(
      (g) => `
      <button type="button" class="tp-pill ${subFeedFilters.groupId === g.id ? 'tp-pill-active' : ''}" data-tp-sub-group="${escapeHtml(g.id)}" style="--tp-pill-accent:${escapeHtml(g.color || '#ef233c')}">
        <span class="tp-pill-ico">${renderIconHtml(g.icon, 14)}</span>
        <span>${escapeHtml(g.name)}</span>
      </button>`
    ),
  ].join('');

  toolbar.innerHTML = `
    <div class="tp-toolbar-top">
      <div class="tp-toolbar-brand">
        <span class="tp-brand-dot"></span>
        <strong>${escapeHtml(BRAND_NAME)}</strong>
      </div>
      <div class="tp-toolbar-pills">${groupPillsHtml}</div>
      <div class="tp-toolbar-right">
        <button type="button" class="tp-btn tp-btn-sm tp-focus-toggle-btn ${focusOn ? 'tp-focus-active' : ''}" data-tp-sub-action="toggle-focus" title="${escapeHtml(t('focus.focusModeDesc', lang))}">
          🎯 ${escapeHtml(t('focus.focusMode', lang))}
        </button>
        <button type="button" class="tp-btn tp-btn-primary tp-btn-sm" data-tp-sub-action="play-playlist" title="${escapeHtml(lang === 'pt-BR' ? 'Reproduzir vídeos filtrados como playlist' : 'Play filtered videos as playlist')}">
          ▶ ${escapeHtml(lang === 'pt-BR' ? 'Reproduzir como Playlist' : 'Play as Playlist')}
        </button>
        <button type="button" class="tp-btn tp-btn-sm" data-tp-sub-action="open-manager">
          ⚙ ${escapeHtml(lang === 'pt-BR' ? 'Gerenciar' : 'Manage')}
        </button>
        <button type="button" class="tp-btn tp-btn-sm" data-tp-sub-action="open-deck">
          📺 Deck
        </button>
      </div>
    </div>
    <div class="tp-toolbar-controls">
      <input type="search" class="tp-input tp-input-sm" data-tp-sub-filter="search" value="${escapeHtml(subFeedFilters.search)}" placeholder="${escapeHtml(t('common.search', lang))}" />

      <select class="tp-select tp-select-sm" data-tp-sub-filter="sortBy" aria-label="Sort">
        <option value="${SORT_OPTIONS.DATE_DESC}" ${subFeedFilters.sortBy === SORT_OPTIONS.DATE_DESC ? 'selected' : ''}>${escapeHtml(t('sort.date_desc', lang))}</option>
        <option value="${SORT_OPTIONS.DATE_ASC}" ${subFeedFilters.sortBy === SORT_OPTIONS.DATE_ASC ? 'selected' : ''}>${escapeHtml(t('sort.date_asc', lang))}</option>
        <option value="${SORT_OPTIONS.DURATION_ASC}" ${subFeedFilters.sortBy === SORT_OPTIONS.DURATION_ASC ? 'selected' : ''}>${escapeHtml(t('sort.duration_asc', lang))}</option>
        <option value="${SORT_OPTIONS.DURATION_DESC}" ${subFeedFilters.sortBy === SORT_OPTIONS.DURATION_DESC ? 'selected' : ''}>${escapeHtml(t('sort.duration_desc', lang))}</option>
        <option value="${SORT_OPTIONS.VIEWS_DESC}" ${subFeedFilters.sortBy === SORT_OPTIONS.VIEWS_DESC ? 'selected' : ''}>${escapeHtml(t('sort.views_desc', lang))}</option>
        <option value="${SORT_OPTIONS.TITLE_ASC}" ${subFeedFilters.sortBy === SORT_OPTIONS.TITLE_ASC ? 'selected' : ''}>${escapeHtml(t('sort.title_asc', lang))}</option>
      </select>

      <label class="tp-inline-field">
        <span>${escapeHtml(lang === 'pt-BR' ? 'Min (m)' : 'Min (m)')}</span>
        <input type="number" min="0" class="tp-input tp-input-xs" data-tp-sub-filter="minDurationMin" value="${escapeHtml(subFeedFilters.minDurationMin)}" placeholder="0" />
      </label>

      <label class="tp-inline-field">
        <span>${escapeHtml(lang === 'pt-BR' ? 'Máx (m)' : 'Max (m)')}</span>
        <input type="number" min="0" class="tp-input tp-input-xs" data-tp-sub-filter="maxDurationMin" value="${escapeHtml(subFeedFilters.maxDurationMin)}" placeholder="∞" />
      </label>

      <label class="tp-check-pill">
        <input type="checkbox" data-tp-sub-filter="hideWatched" ${subFeedFilters.hideWatched ? 'checked' : ''} />
        <span>${escapeHtml(t('watched.hideWatched', lang))}</span>
      </label>

      <label class="tp-check-pill">
        <input type="checkbox" data-tp-sub-filter="hideShorts" ${subFeedFilters.hideShorts ? 'checked' : ''} />
        <span>${escapeHtml(t('watched.hideShorts', lang))}</span>
      </label>

      <label class="tp-check-pill">
        <input type="checkbox" data-tp-sub-filter="hideLive" ${subFeedFilters.hideLive ? 'checked' : ''} />
        <span>${escapeHtml(lang === 'pt-BR' ? 'Ocultar Ao Vivo' : 'Hide Live')}</span>
      </label>

      <span class="tp-toolbar-count" id="tp-sub-visible-count"></span>
    </div>
  `;

  if (toolbar.dataset.tpBound !== '1') {
    toolbar.dataset.tpBound = '1';
    toolbar.addEventListener('click', (e) => {
      const target = /** @type {HTMLElement | null} */ (e.target instanceof Element ? e.target : null);
      if (!target) return;

      const groupBtn = target.closest('[data-tp-sub-group]');
      if (groupBtn) {
        subFeedFilters.groupId = groupBtn.getAttribute('data-tp-sub-group') || 'all';
        ensureSubFeedToolbar(stateNow());
        applySubFeedFiltersAndSort(stateNow());
        return;
      }

      const actionBtn = target.closest('[data-tp-sub-action]');
      if (actionBtn) {
        const act = actionBtn.getAttribute('data-tp-sub-action');
        const st = stateNow();
        const curLang = st?.settings?.language || 'pt-BR';
        if (act === 'play-playlist') {
          const visibleIds = getVisibleSubFeedVideoIds();
          playVideosAsPlaylist(visibleIds, curLang);
        } else if (act === 'toggle-focus') {
          toggleFocusMode();
        } else if (act === 'open-manager') {
          openManagerModal('groups');
        } else if (act === 'open-deck') {
          hooks.onOpenDeck?.();
        }
      }
    });

    const onInput = (e) => {
      const target = /** @type {HTMLInputElement | HTMLSelectElement} */ (e.target);
      const key = target?.getAttribute?.('data-tp-sub-filter');
      if (!key) return;
      if (target.type === 'checkbox') {
        subFeedFilters[key] = target.checked;
      } else {
        subFeedFilters[key] = target.value;
      }
      applySubFeedFiltersAndSort(stateNow());
    };
    toolbar.addEventListener('input', onInput);
    toolbar.addEventListener('change', onInput);
  }
}

/**
 * Collect video IDs of currently visible cards in `/feed/subscriptions`.
 * @returns {string[]}
 */
function getVisibleSubFeedVideoIds() {
  const root =
    document.querySelector('ytd-browse[page-subtype="subscriptions"]') || document;
  return scrapeVideoCards(root)
    .filter((c) => !c.el.classList.contains('tp-card-hidden'))
    .map((c) => c.videoId);
}

/**
 * Filter & sort native video cards inside `/feed/subscriptions`.
 * @param {import('../shared/types.js').AppState | null} state
 */
function applySubFeedFiltersAndSort(state) {
  if (typeof document === 'undefined' || !state) return;
  const browse = document.querySelector('ytd-browse[page-subtype="subscriptions"]');
  if (!browse) return;

  const cards = scrapeVideoCards(browse);
  const watchedMap = state.watched || {};
  const hideWatched = subFeedFilters.hideWatched || Boolean(state.settings?.hideWatchedGlobally);
  const hideShorts = subFeedFilters.hideShorts || Boolean(state.settings?.hideShortsGlobally);
  const hideLive = subFeedFilters.hideLive;
  const searchQ = subFeedFilters.search.trim().toLowerCase();
  const minSec =
    subFeedFilters.minDurationMin !== '' && !Number.isNaN(Number(subFeedFilters.minDurationMin))
      ? Number(subFeedFilters.minDurationMin) * 60
      : null;
  const maxSec =
    subFeedFilters.maxDurationMin !== '' && !Number.isNaN(Number(subFeedFilters.maxDurationMin))
      ? Number(subFeedFilters.maxDurationMin) * 60
      : null;

  // Build allowed channel identifiers for selected group
  let allowedChannelKeys = null;
  if (subFeedFilters.groupId && subFeedFilters.groupId !== 'all') {
    const chs = getChannelsByGroup(state, subFeedFilters.groupId, { includeDescendants: true });
    allowedChannelKeys = new Set();
    for (const ch of chs) {
      if (ch.id) allowedChannelKeys.add(ch.id.toLowerCase());
      if (ch.handle) allowedChannelKeys.add(ch.handle.toLowerCase());
      if (ch.title) allowedChannelKeys.add(ch.title.toLowerCase());
    }
  }

  let visibleCount = 0;

  cards.forEach((card, idx) => {
    const el = /** @type {HTMLElement} */ (card.el);
    if (!el.dataset.tpOrigIndex) {
      el.dataset.tpOrigIndex = String(idx);
    }

    let hidden = false;
    const isWatched = Boolean(watchedMap[card.videoId]);

    if (hideWatched && isWatched) hidden = true;
    if (!hidden && hideShorts && card.isShort) hidden = true;
    if (!hidden && hideLive && card.isLive) hidden = true;
    if (!hidden && matchesHideVideoSmartRules(card, state)) hidden = true;

    if (!hidden && minSec !== null && card.durationSec > 0 && card.durationSec < minSec) {
      hidden = true;
    }
    if (!hidden && maxSec !== null && card.durationSec > 0 && card.durationSec > maxSec) {
      hidden = true;
    }

    if (!hidden && searchQ) {
      const hay = `${card.title} ${card.channelTitle}`.toLowerCase();
      if (!hay.includes(searchQ)) hidden = true;
    }

    if (!hidden && allowedChannelKeys) {
      const idMatch = card.channelId && allowedChannelKeys.has(card.channelId.toLowerCase());
      const titleMatch =
        card.channelTitle && allowedChannelKeys.has(card.channelTitle.toLowerCase());
      if (!idMatch && !titleMatch) hidden = true;
    }

    el.classList.toggle('tp-card-hidden', hidden);
    if (!hidden) visibleCount += 1;
  });

  // Sort cards within their parent containers (CSS order or DOM order)
  const parentGroups = new Map();
  for (const card of cards) {
    const parent = card.el.parentElement;
    if (!parent) continue;
    if (!parentGroups.has(parent)) parentGroups.set(parent, []);
    parentGroups.get(parent).push(card);
  }

  for (const [, list] of parentGroups.entries()) {
    const sorted = [...list].sort((a, b) => {
      const idxA = Number(/** @type {HTMLElement} */ (a.el).dataset.tpOrigIndex || 0);
      const idxB = Number(/** @type {HTMLElement} */ (b.el).dataset.tpOrigIndex || 0);
      switch (subFeedFilters.sortBy) {
        case SORT_OPTIONS.DATE_ASC:
          return idxB - idxA;
        case SORT_OPTIONS.DURATION_ASC:
          return (a.durationSec || 0) - (b.durationSec || 0);
        case SORT_OPTIONS.DURATION_DESC:
          return (b.durationSec || 0) - (a.durationSec || 0);
        case SORT_OPTIONS.VIEWS_DESC:
          return (b.views || 0) - (a.views || 0);
        case SORT_OPTIONS.TITLE_ASC:
          return (a.title || '').localeCompare(b.title || '');
        case SORT_OPTIONS.DATE_DESC:
        default:
          return idxA - idxB;
      }
    });

    sorted.forEach((card, orderIdx) => {
      /** @type {HTMLElement} */ (card.el).style.order = String(orderIdx);
    });
  }

  const countEl = document.getElementById('tp-sub-visible-count');
  if (countEl) {
    const lang = state.settings?.language || 'pt-BR';
    countEl.textContent =
      lang === 'pt-BR'
        ? `${visibleCount}/${cards.length} vídeos`
        : `${visibleCount}/${cards.length} videos`;
  }
}

/* ============================================================================
 * 3. GROUP FEED OVERLAY VIEW
 * ========================================================================== */

/**
 * Filter and sort Group Feed RSS entries.
 * @param {any[]} entries
 * @param {import('../shared/types.js').AppState} state
 * @param {import('../shared/types.js').Channel[]} [channels=[]]
 * @returns {any[]}
 */
function getFilteredGroupFeedEntries(entries, state, channels = []) {
  const watchedMap = state?.watched || {};
  const q = groupFeedState.search.trim().toLowerCase();
  const minSec =
    groupFeedState.minDurationMin !== '' && !Number.isNaN(Number(groupFeedState.minDurationMin))
      ? Number(groupFeedState.minDurationMin) * 60
      : null;
  const maxSec =
    groupFeedState.maxDurationMin !== '' && !Number.isNaN(Number(groupFeedState.maxDurationMin))
      ? Number(groupFeedState.maxDurationMin) * 60
      : null;

  let selectedChannelKeys = null;
  if (groupFeedState.selectedChannelId) {
    const selectedCh =
      channels.find((c) => c.id === groupFeedState.selectedChannelId) ||
      state?.channels?.[groupFeedState.selectedChannelId] ||
      null;
    selectedChannelKeys = new Set([groupFeedState.selectedChannelId.toLowerCase()]);
    if (selectedCh) {
      if (selectedCh.id) selectedChannelKeys.add(selectedCh.id.toLowerCase());
      if (selectedCh.ucId) selectedChannelKeys.add(selectedCh.ucId.toLowerCase());
      if (selectedCh.handle) selectedChannelKeys.add(selectedCh.handle.toLowerCase());
      if (selectedCh.title) selectedChannelKeys.add(selectedCh.title.toLowerCase());
    }
  }

  const filtered = (entries || []).filter((item) => {
    const isWatched = Boolean(watchedMap[item.videoId]);
    if (groupFeedState.hideWatched && isWatched) return false;
    if (groupFeedState.hideShorts && item.isShort) return false;
    if (groupFeedState.hideLive && item.isLive) return false;
    if (matchesHideVideoSmartRules(item, state)) return false;
    if (minSec !== null && item.durationSec > 0 && item.durationSec < minSec) return false;
    if (maxSec !== null && item.durationSec > 0 && item.durationSec > maxSec) return false;
    if (selectedChannelKeys) {
      const idMatch = item.channelId && selectedChannelKeys.has(String(item.channelId).toLowerCase());
      const titleMatch =
        item.channelTitle && selectedChannelKeys.has(String(item.channelTitle).toLowerCase());
      if (!idMatch && !titleMatch) return false;
    }
    if (q) {
      const hay = `${item.title || ''} ${item.channelTitle || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return filtered.sort((a, b) => {
    switch (groupFeedState.sortBy) {
      case SORT_OPTIONS.DATE_ASC:
        return (a.publishedAt || 0) - (b.publishedAt || 0);
      case SORT_OPTIONS.DURATION_ASC:
        return (a.durationSec || 0) - (b.durationSec || 0);
      case SORT_OPTIONS.DURATION_DESC:
        return (b.durationSec || 0) - (a.durationSec || 0);
      case SORT_OPTIONS.VIEWS_DESC:
        return (b.views || 0) - (a.views || 0);
      case SORT_OPTIONS.TITLE_ASC:
        return (a.title || '').localeCompare(b.title || '');
      case SORT_OPTIONS.DATE_DESC:
      default:
        return (b.publishedAt || 0) - (a.publishedAt || 0);
    }
  });
}

/**
 * Render the Group Feed overlay if open.
 */
function renderGroupFeedOverlay() {
  const existing = document.getElementById(GROUP_FEED_OVERLAY_ID);
  if (!groupFeedState.open) {
    if (existing) existing.remove();
    return;
  }

  const state = stateNow();
  if (!state) return;
  const lang = state.settings?.language || 'pt-BR';
  const group = state.groups?.[groupFeedState.groupId];
  if (!group) {
    groupFeedState.open = false;
    if (existing) existing.remove();
    return;
  }

  const channels = getChannelsByGroup(state, group.id, { includeDescendants: true }).sort((a, b) =>
    (a.title || '').localeCompare(b.title || '')
  );
  // Clear stale channel filter if channel was removed from group
  if (
    groupFeedState.selectedChannelId &&
    !channels.some((c) => c.id === groupFeedState.selectedChannelId)
  ) {
    groupFeedState.selectedChannelId = null;
  }

  const visibleEntries = getFilteredGroupFeedEntries(groupFeedState.entries, state, channels);
  const watchedMap = state.watched || {};
  const focusOn = Boolean(state.settings?.focusMode);

  let overlay = existing;
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = GROUP_FEED_OVERLAY_ID;
    document.body.appendChild(overlay);
  }

  overlay.className = `tp-group-feed-overlay ${getThemeClass(state)}`;

  const addChannelsLabel = lang === 'pt-BR' ? '+ Adicionar Canais' : '+ Add Channels';
  const openChannelTitle = lang === 'pt-BR' ? 'Abrir canal no YouTube' : 'Open channel on YouTube';
  const removeFromGroupTitle = lang === 'pt-BR' ? 'Remover do grupo' : 'Remove from group';
  const filterByChannelTitle =
    lang === 'pt-BR' ? 'Filtrar vídeos deste canal' : 'Filter videos to this channel';
  const retrySyncLabel =
    lang === 'pt-BR' ? '↻ Tentar novamente / Sincronizar' : '↻ Retry / Sync';

  // Always render Group Channels Bar right below header (Bug B fix)
  const channelsBarHtml = `
    <div class="tp-group-channels-bar" aria-label="${escapeHtml(t('group.groupChannels', lang))}">
      ${
        groupFeedState.selectedChannelId
          ? `<button type="button" class="tp-channel-chip tp-channel-chip-reset" data-tp-gf-filter-ch="">
              <span>✕ ${escapeHtml(t('common.all', lang))}</span>
            </button>`
          : ''
      }
      ${channels
        .map((ch) => {
          const isSel = groupFeedState.selectedChannelId === ch.id;
          const status = ch.status || 'inactive';
          const statusLabel = t(`channel.status.${status}`, lang);
          const chUrl =
            ch.url ||
            (ch.id?.startsWith('UC')
              ? `https://www.youtube.com/channel/${encodeURIComponent(ch.id)}`
              : `https://www.youtube.com/${encodeURIComponent(ch.handle || ch.id)}`);
          return `
            <div class="tp-channel-chip ${isSel ? 'tp-channel-chip-active' : ''}" data-channel-id="${escapeHtml(ch.id)}">
              <button type="button" class="tp-channel-chip-main" data-tp-gf-filter-ch="${escapeHtml(ch.id)}" title="${escapeHtml(filterByChannelTitle)}">
                ${
                  ch.avatarUrl
                    ? `<img class="tp-channel-chip-avatar" src="${escapeHtml(ch.avatarUrl)}" alt="" loading="lazy" />`
                    : `<span class="tp-channel-chip-avatar tp-ch-avatar-fallback">${escapeHtml((ch.title || '?')[0].toUpperCase())}</span>`
                }
                <span class="tp-status-dot tp-status-dot-${escapeHtml(status)}" title="${escapeHtml(statusLabel)}"></span>
                <span class="tp-channel-chip-name">${escapeHtml(ch.title || ch.id)}</span>
              </button>
              <a class="tp-channel-chip-link" href="${escapeHtml(chUrl)}" target="_blank" rel="noopener" title="${escapeHtml(openChannelTitle)}">↗</a>
              <button type="button" class="tp-channel-chip-rm" data-tp-gf-rm-ch="${escapeHtml(ch.id)}" title="${escapeHtml(removeFromGroupTitle)}" aria-label="${escapeHtml(removeFromGroupTitle)}">✕</button>
            </div>`;
        })
        .join('')}
      <button type="button" class="tp-btn tp-btn-xs tp-btn-primary tp-gf-add-ch-btn" data-tp-gf-action="add-channels">
        ${escapeHtml(addChannelsLabel)}
      </button>
    </div>
  `;

  const channelsTabBodyHtml =
    channels.length === 0
      ? `<div class="tp-empty-state">
          <p>${escapeHtml(lang === 'pt-BR' ? 'Nenhum canal neste grupo ainda.' : 'No channels in this group yet.')}</p>
          <button type="button" class="tp-btn tp-btn-primary tp-btn-sm tp-mt-xs" data-tp-gf-action="add-channels">
            ${escapeHtml(addChannelsLabel)}
          </button>
        </div>`
      : `<div class="tp-gf-channels-grid">
          ${channels
            .map((ch) => {
              const status = ch.status || 'inactive';
              const statusLabel = t(`channel.status.${status}`, lang);
              const chUrl =
                ch.url ||
                (ch.id?.startsWith('UC')
                  ? `https://www.youtube.com/channel/${encodeURIComponent(ch.id)}`
                  : `https://www.youtube.com/${encodeURIComponent(ch.handle || ch.id)}`);
              const isSel = groupFeedState.selectedChannelId === ch.id;
              return `
                <article class="tp-card tp-gf-channel-card ${isSel ? 'tp-gf-channel-card-active' : ''}">
                  <div class="tp-gf-channel-card-head">
                    ${
                      ch.avatarUrl
                        ? `<img class="tp-ch-avatar" src="${escapeHtml(ch.avatarUrl)}" alt="" loading="lazy" />`
                        : `<div class="tp-ch-avatar tp-ch-avatar-fallback">${escapeHtml((ch.title || '?')[0].toUpperCase())}</div>`
                    }
                    <div class="tp-gf-channel-card-info">
                      <a class="tp-ch-title tp-ellipsis" href="${escapeHtml(chUrl)}" target="_blank" rel="noopener">${escapeHtml(ch.title || ch.id)}</a>
                      <div class="tp-gf-channel-card-meta">
                        <span class="tp-status-badge tp-status-${escapeHtml(status)}">${escapeHtml(statusLabel)}</span>
                        <span class="tp-muted tp-xs">${escapeHtml(formatRelativeDate(ch.lastVideoAt, lang))}</span>
                      </div>
                    </div>
                  </div>
                  <div class="tp-gf-channel-card-actions">
                    <button type="button" class="tp-btn tp-btn-xs" data-tp-gf-filter-ch="${escapeHtml(ch.id)}">
                      🎬 ${escapeHtml(t('group.viewVideos', lang))}
                    </button>
                    <a class="tp-btn tp-btn-xs" href="${escapeHtml(chUrl)}" target="_blank" rel="noopener">
                      ↗ ${escapeHtml(lang === 'pt-BR' ? 'Canal' : 'Channel')}
                    </a>
                    <button type="button" class="tp-btn tp-btn-xs tp-btn-danger" data-tp-gf-rm-ch="${escapeHtml(ch.id)}" title="${escapeHtml(removeFromGroupTitle)}">
                      ✕
                    </button>
                  </div>
                </article>`;
            })
            .join('')}
        </div>`;

  const videosTabBodyHtml = groupFeedState.loading
    ? `<div class="tp-empty-state">${escapeHtml(t('common.loading', lang))}</div>`
    : visibleEntries.length === 0
      ? `<div class="tp-empty-state">
          <p>${escapeHtml(t('common.empty', lang))}</p>
          ${
            channels.length === 0
              ? `<p class="tp-muted">${escapeHtml(lang === 'pt-BR' ? 'Adicione canais a este grupo no Gerenciador.' : 'Add channels to this group in the Manager.')}</p>
                 <div class="tp-empty-actions">
                   <button type="button" class="tp-btn tp-btn-primary tp-btn-sm" data-tp-gf-action="add-channels">${escapeHtml(addChannelsLabel)}</button>
                 </div>`
              : `<p class="tp-muted">${escapeHtml(
                  lang === 'pt-BR'
                    ? 'Nenhum vídeo encontrado nos feeds RSS recentes ou com os filtros atuais.'
                    : 'No videos found in recent RSS feeds or matching the current filters.'
                )}</p>
                 <div class="tp-empty-actions">
                   <button type="button" class="tp-btn tp-btn-primary tp-btn-sm" data-tp-gf-action="refresh">${escapeHtml(retrySyncLabel)}</button>
                   <button type="button" class="tp-btn tp-btn-sm" data-tp-gf-tab="channels">📺 ${escapeHtml(lang === 'pt-BR' ? `Ver Canais (${channels.length})` : `View Channels (${channels.length})`)}</button>
                   ${
                     groupFeedState.selectedChannelId
                       ? `<button type="button" class="tp-btn tp-btn-sm" data-tp-gf-filter-ch="">${escapeHtml(lang === 'pt-BR' ? 'Mostrar todos os canais' : 'Show all channels')}</button>`
                       : ''
                   }
                 </div>`
          }
        </div>`
      : `<div class="tp-video-grid">
          ${visibleEntries
            .map((v) => {
              const isWatched = Boolean(watchedMap[v.videoId]);
              const thumb =
                v.thumbnailUrl || `https://i.ytimg.com/vi/${encodeURIComponent(v.videoId)}/hqdefault.jpg`;
              const videoUrl = v.url || `https://www.youtube.com/watch?v=${encodeURIComponent(v.videoId)}`;
              return `
                <article class="tp-video-card ${isWatched ? 'tp-card-watched' : ''}">
                  <div class="tp-video-thumb-wrap">
                    <a href="${escapeHtml(videoUrl)}" class="tp-video-thumb-link">
                      <img src="${escapeHtml(thumb)}" alt="" loading="lazy" />
                      ${v.durationSec ? `<span class="tp-video-dur">${escapeHtml(formatDuration(v.durationSec))}</span>` : ''}
                      ${v.isShort ? `<span class="tp-video-short-tag">SHORTS</span>` : ''}
                    </a>
                    <button type="button" class="tp-watched-toggle-btn ${isWatched ? 'tp-is-watched' : ''}" data-tp-gf-watched="${escapeHtml(v.videoId)}" title="${escapeHtml(isWatched ? t('watched.unmark', lang) : t('watched.mark', lang))}">
                      ${isWatched ? '✓' : '○'}
                    </button>
                  </div>
                  <div class="tp-video-meta">
                    <a href="${escapeHtml(videoUrl)}" class="tp-video-title" title="${escapeHtml(v.title)}">${escapeHtml(v.title)}</a>
                    <div class="tp-video-sub">
                      <span class="tp-video-channel">${escapeHtml(v.channelTitle || '')}</span>
                      <span class="tp-video-stats">
                        ${v.views ? `${escapeHtml(formatViews(v.views))} • ` : ''}${escapeHtml(formatRelativeDate(v.publishedAt, lang))}
                      </span>
                    </div>
                  </div>
                </article>
              `;
            })
            .join('')}
        </div>`;

  const videoToolbarHtml =
    groupFeedState.viewTab === 'videos'
      ? `
      <div class="tp-toolbar-controls tp-gf-toolbar">
        <input type="search" class="tp-input tp-input-sm" data-tp-gf-filter="search" value="${escapeHtml(groupFeedState.search)}" placeholder="${escapeHtml(t('common.search', lang))}" />

        <select class="tp-select tp-select-sm" data-tp-gf-filter="sortBy">
          <option value="${SORT_OPTIONS.DATE_DESC}" ${groupFeedState.sortBy === SORT_OPTIONS.DATE_DESC ? 'selected' : ''}>${escapeHtml(t('sort.date_desc', lang))}</option>
          <option value="${SORT_OPTIONS.DATE_ASC}" ${groupFeedState.sortBy === SORT_OPTIONS.DATE_ASC ? 'selected' : ''}>${escapeHtml(t('sort.date_asc', lang))}</option>
          <option value="${SORT_OPTIONS.DURATION_ASC}" ${groupFeedState.sortBy === SORT_OPTIONS.DURATION_ASC ? 'selected' : ''}>${escapeHtml(t('sort.duration_asc', lang))}</option>
          <option value="${SORT_OPTIONS.DURATION_DESC}" ${groupFeedState.sortBy === SORT_OPTIONS.DURATION_DESC ? 'selected' : ''}>${escapeHtml(t('sort.duration_desc', lang))}</option>
          <option value="${SORT_OPTIONS.VIEWS_DESC}" ${groupFeedState.sortBy === SORT_OPTIONS.VIEWS_DESC ? 'selected' : ''}>${escapeHtml(t('sort.views_desc', lang))}</option>
          <option value="${SORT_OPTIONS.TITLE_ASC}" ${groupFeedState.sortBy === SORT_OPTIONS.TITLE_ASC ? 'selected' : ''}>${escapeHtml(t('sort.title_asc', lang))}</option>
        </select>

        <label class="tp-inline-field">
          <span>Min (m)</span>
          <input type="number" min="0" class="tp-input tp-input-xs" data-tp-gf-filter="minDurationMin" value="${escapeHtml(groupFeedState.minDurationMin)}" placeholder="0" />
        </label>

        <label class="tp-inline-field">
          <span>Máx (m)</span>
          <input type="number" min="0" class="tp-input tp-input-xs" data-tp-gf-filter="maxDurationMin" value="${escapeHtml(groupFeedState.maxDurationMin)}" placeholder="∞" />
        </label>

        <label class="tp-check-pill">
          <input type="checkbox" data-tp-gf-filter="hideWatched" ${groupFeedState.hideWatched ? 'checked' : ''} />
          <span>${escapeHtml(t('watched.hideWatched', lang))}</span>
        </label>

        <label class="tp-check-pill">
          <input type="checkbox" data-tp-gf-filter="hideShorts" ${groupFeedState.hideShorts ? 'checked' : ''} />
          <span>${escapeHtml(t('watched.hideShorts', lang))}</span>
        </label>

        <label class="tp-check-pill">
          <input type="checkbox" data-tp-gf-filter="hideLive" ${groupFeedState.hideLive ? 'checked' : ''} />
          <span>${escapeHtml(lang === 'pt-BR' ? 'Ocultar Ao Vivo' : 'Hide Live')}</span>
        </label>
      </div>`
      : '';

  overlay.innerHTML = `
    <div class="tp-group-feed-shell">
      <header class="tp-group-feed-header">
        <div class="tp-group-feed-title-wrap">
          <span class="tp-group-feed-icon" style="color:${escapeHtml(group.color || '#ef233c')}">${renderIconHtml(group.icon, 26)}</span>
          <div>
            <h2 class="tp-group-feed-title">${escapeHtml(group.name)}</h2>
            <div class="tp-muted tp-small">${escapeHtml(t('group.channelsCount', lang, { count: channels.length }))} • ${visibleEntries.length} ${escapeHtml(lang === 'pt-BR' ? 'vídeos' : 'videos')}</div>
          </div>
        </div>
        <div class="tp-group-feed-actions">
          <button type="button" class="tp-btn tp-btn-sm tp-focus-toggle-btn ${focusOn ? 'tp-focus-active' : ''}" data-tp-gf-action="toggle-focus" title="${escapeHtml(t('focus.focusModeDesc', lang))}">
            🎯 ${escapeHtml(t('focus.focusMode', lang))}
          </button>
          <button type="button" class="tp-btn tp-btn-primary tp-btn-sm" data-tp-gf-action="play-playlist">
            ▶ ${escapeHtml(lang === 'pt-BR' ? 'Reproduzir Grupo como Playlist' : 'Play Group as Playlist')}
          </button>
          <button type="button" class="tp-btn tp-btn-sm" data-tp-gf-action="refresh">
            ↻ ${escapeHtml(t('common.refresh', lang))}
          </button>
          <button type="button" class="tp-btn tp-btn-sm" data-tp-gf-action="close">
            ✕ ${escapeHtml(t('common.close', lang))}
          </button>
        </div>
      </header>

      ${channelsBarHtml}

      <div class="tp-group-view-tabs" role="tablist">
        <button type="button" role="tab" aria-selected="${groupFeedState.viewTab === 'videos'}" class="tp-group-view-tab ${groupFeedState.viewTab === 'videos' ? 'tp-group-view-tab-active' : ''}" data-tp-gf-tab="videos">
          🎬 ${escapeHtml(lang === 'pt-BR' ? `Vídeos (${visibleEntries.length})` : `Videos (${visibleEntries.length})`)}
        </button>
        <button type="button" role="tab" aria-selected="${groupFeedState.viewTab === 'channels'}" class="tp-group-view-tab ${groupFeedState.viewTab === 'channels' ? 'tp-group-view-tab-active' : ''}" data-tp-gf-tab="channels">
          📺 ${escapeHtml(lang === 'pt-BR' ? `Canais (${channels.length})` : `Channels (${channels.length})`)}
        </button>
      </div>

      ${videoToolbarHtml}

      <div class="tp-group-feed-body">
        ${groupFeedState.viewTab === 'channels' ? channelsTabBodyHtml : videosTabBodyHtml}
      </div>
    </div>
  `;

  if (overlay.dataset.tpBound !== '1') {
    overlay.dataset.tpBound = '1';
    overlay.addEventListener('click', async (e) => {
      const target = /** @type {HTMLElement | null} */ (e.target instanceof Element ? e.target : null);
      if (!target) return;

      if (target === overlay) {
        groupFeedState.open = false;
        renderGroupFeedOverlay();
        return;
      }

      // Switch Vídeos / Canais tab
      const viewTabBtn = target.closest('[data-tp-gf-tab]');
      if (viewTabBtn) {
        const nextTab = viewTabBtn.getAttribute('data-tp-gf-tab');
        if (nextTab === 'channels' || nextTab === 'videos') {
          groupFeedState.viewTab = nextTab;
          renderGroupFeedOverlay();
        }
        return;
      }

      // Filter videos by single channel chip
      const chFilterBtn = target.closest('[data-tp-gf-filter-ch]');
      if (chFilterBtn) {
        e.preventDefault();
        e.stopPropagation();
        const cid = chFilterBtn.getAttribute('data-tp-gf-filter-ch') || '';
        if (!cid || groupFeedState.selectedChannelId === cid) {
          groupFeedState.selectedChannelId = null;
        } else {
          groupFeedState.selectedChannelId = cid;
          groupFeedState.viewTab = 'videos';
        }
        renderGroupFeedOverlay();
        return;
      }

      // Remove channel from current group (and any descendant subgroups)
      const rmChBtn = target.closest('[data-tp-gf-rm-ch]');
      if (rmChBtn) {
        e.preventDefault();
        e.stopPropagation();
        const cid = rmChBtn.getAttribute('data-tp-gf-rm-ch');
        const st = stateNow();
        const ch = cid ? st?.channels?.[cid] : null;
        if (ch && groupFeedState.groupId) {
          const scopeIds = new Set([
            groupFeedState.groupId,
            ...getDescendants(st.groups || {}, groupFeedState.groupId),
          ]);
          const nextGroupIds = (ch.groupIds || []).filter((gid) => !scopeIds.has(gid));
          const res = await sendBg(MESSAGE_ACTIONS.ASSIGN_CHANNEL_GROUPS, {
            channelId: cid,
            groupIds: nextGroupIds,
          });
          if (res?.ok && res.state) {
            if (groupFeedState.selectedChannelId === cid) {
              groupFeedState.selectedChannelId = null;
            }
            applyNewState(res.state);
            const curLang = res.state.settings?.language || 'pt-BR';
            showToast(t('toast.saved', curLang), 'success');
            renderGroupFeedOverlay();
          }
        }
        return;
      }

      const watchBtn = target.closest('[data-tp-gf-watched]');
      if (watchBtn) {
        e.preventDefault();
        e.stopPropagation();
        const vid = watchBtn.getAttribute('data-tp-gf-watched');
        const entry = groupFeedState.entries.find((x) => x.videoId === vid);
        const res = await sendBg(MESSAGE_ACTIONS.TOGGLE_WATCHED, {
          videoId: vid,
          meta: entry ? { title: entry.title, channelId: entry.channelId, durationSec: entry.durationSec } : {},
        });
        if (res?.ok && res.state) {
          applyNewState(res.state);
          renderGroupFeedOverlay();
        }
        return;
      }

      const actionBtn = target.closest('[data-tp-gf-action]');
      if (actionBtn) {
        const act = actionBtn.getAttribute('data-tp-gf-action');
        if (act === 'close') {
          groupFeedState.open = false;
          renderGroupFeedOverlay();
        } else if (act === 'refresh') {
          await loadGroupFeedData(groupFeedState.groupId, true);
        } else if (act === 'add-channels') {
          openManagerModal('channels');
        } else if (act === 'toggle-focus') {
          await toggleFocusMode();
        } else if (act === 'play-playlist') {
          const st = stateNow();
          const curLang = st?.settings?.language || 'pt-BR';
          const curChs = getChannelsByGroup(st, groupFeedState.groupId, { includeDescendants: true });
          const vids = getFilteredGroupFeedEntries(groupFeedState.entries, st, curChs).map(
            (x) => x.videoId
          );
          playVideosAsPlaylist(vids, curLang);
        }
      }
    });

    const onFilter = (e) => {
      const target = /** @type {HTMLInputElement | HTMLSelectElement} */ (e.target);
      const key = target?.getAttribute?.('data-tp-gf-filter');
      if (!key) return;
      if (target.type === 'checkbox') {
        groupFeedState[key] = target.checked;
      } else {
        groupFeedState[key] = target.value;
      }
      renderGroupFeedOverlay();
    };
    overlay.addEventListener('input', onFilter);
    overlay.addEventListener('change', onFilter);
  }
}

/**
 * Fetch feed entries for a group via the background service worker.
 * @param {string} groupId
 * @param {boolean} [forceRefresh=false]
 */
async function loadGroupFeedData(groupId, forceRefresh = false) {
  groupFeedState.loading = true;
  renderGroupFeedOverlay();

  const res = await sendBg(MESSAGE_ACTIONS.FETCH_GROUP_FEED, {
    groupId,
    forceRefresh,
    sortBy: groupFeedState.sortBy,
    limit: 120,
  });

  groupFeedState.loading = false;
  if (res?.ok && Array.isArray(res.entries)) {
    groupFeedState.entries = res.entries;
  } else {
    groupFeedState.entries = [];
  }
  renderGroupFeedOverlay();
}

/**
 * Open the Group Feed overlay for a specific subscription group.
 * @param {string} groupId
 */
export async function openGroupFeed(groupId) {
  if (!groupId) return;
  const st = stateNow();
  groupFeedState.open = true;
  groupFeedState.groupId = groupId;
  groupFeedState.viewTab = 'videos';
  groupFeedState.selectedChannelId = null;
  groupFeedState.hideWatched = Boolean(st?.settings?.hideWatchedGlobally);
  groupFeedState.hideShorts = Boolean(st?.settings?.hideShortsGlobally);
  renderGroupFeedOverlay();
  await loadGroupFeedData(groupId, false);
}

/* ============================================================================
 * 4. CHANNEL PAGE GROUP & TAG BUTTON
 * ========================================================================== */

/**
 * Extract metadata about the currently viewed YouTube channel page.
 * @returns {{ id: string, handle: string, title: string, avatarUrl: string, url: string } | null}
 */
function scrapeCurrentChannelPage() {
  const ctx = getPageContext();
  if (ctx.type !== 'channel') return null;

  const id = ctx.channelId || ctx.channelHandle;
  if (!id) return null;

  const title = (
    document.querySelector('yt-dynamic-text-view-model h1')?.textContent ||
    document.querySelector('ytd-channel-name#channel-name #text')?.textContent ||
    document.querySelector('#channel-header #text')?.textContent ||
    document.title.replace(/\s*-\s*YouTube$/, '') ||
    id
  ).trim();

  const avatarUrl =
    document.querySelector('yt-avatar-shape img')?.getAttribute('src') ||
    document.querySelector('#channel-header #avatar img')?.getAttribute('src') ||
    '';

  const url = ctx.channelId
    ? `https://www.youtube.com/channel/${ctx.channelId}`
    : `https://www.youtube.com/${ctx.channelHandle}`;

  return {
    id,
    handle: ctx.channelHandle || '',
    title,
    avatarUrl,
    url,
  };
}

/**
 * Find an existing tracked channel matching the current channel page or video owner.
 * @param {import('../shared/types.js').AppState} state
 * @param {{ id: string, ucId?: string, handle?: string }} info
 */
function findChannelInState(state, info) {
  if (!state?.channels || !info) return null;
  if (info.id && state.channels[info.id]) return state.channels[info.id];
  if (info.ucId && state.channels[info.ucId]) return state.channels[info.ucId];
  if (info.handle && state.channels[info.handle]) return state.channels[info.handle];
  const handleLower = info.handle ? info.handle.toLowerCase() : '';
  return (
    Object.values(state.channels).find(
      (c) =>
        (handleLower && c.handle && c.handle.toLowerCase() === handleLower) ||
        (handleLower && c.id && c.id.toLowerCase() === handleLower) ||
        (info.ucId && (c.id === info.ucId || c.ucId === info.ucId)) ||
        (info.id && (c.id === info.id || c.ucId === info.id))
    ) || null
  );
}

/**
 * Inject or update the PlayShelf Group & Tag button near YouTube's Subscribe button.
 * @param {import('../shared/types.js').AppState | null} state
 */
function ensureChannelPageButton(state) {
  if (typeof document === 'undefined' || !state) return;
  const ctx = getPageContext();
  const existing = document.getElementById(CHANNEL_BTN_ID);

  if (ctx.type !== 'channel') {
    if (existing) existing.remove();
    document.getElementById(CHANNEL_POPOVER_ID)?.remove();
    return;
  }

  const info = scrapeCurrentChannelPage();
  if (!info) return;

  const tracked = findChannelInState(state, info);
  const groupCount = tracked?.groupIds?.length || 0;
  const lang = state.settings?.language || 'pt-BR';

  const anchor =
    document.querySelector('yt-flexible-actions-view-model') ||
    document.querySelector('#channel-header #buttons') ||
    document.querySelector('ytd-c4-tabbed-header-renderer #subscribe-button')?.parentElement ||
    document.querySelector('#subscribe-button')?.parentElement;

  if (!anchor) return;

  let wrap = existing;
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = CHANNEL_BTN_ID;
    wrap.className = 'tp-channel-btn-wrap';
    anchor.appendChild(wrap);
  }

  wrap.innerHTML = `
    <button type="button" class="tp-channel-group-btn ${getThemeClass(state)} ${groupCount > 0 ? 'tp-has-groups' : ''}" data-tp-open-ch-popover="1">
      <span>📁</span>
      <span>${escapeHtml(lang === 'pt-BR' ? 'Grupos & Tags' : 'Groups & Tags')}</span>
      ${groupCount > 0 ? `<span class="tp-badge-count">${groupCount}</span>` : ''}
    </button>
  `;

  if (wrap.dataset.tpBound !== '1') {
    wrap.dataset.tpBound = '1';
    wrap.addEventListener('click', (e) => {
      const btn = /** @type {HTMLElement | null} */ (
        e.target instanceof Element ? e.target.closest('[data-tp-open-ch-popover]') : null
      );
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      openChannelAssignPopover(btn);
    });
  }
}

/**
 * Open a popover to assign the current channel to multiple groups and edit its manual tags.
 * @param {HTMLElement} anchorEl
 */
async function openChannelAssignPopover(anchorEl) {
  const existing = document.getElementById(CHANNEL_POPOVER_ID);
  if (existing) {
    existing.remove();
    return;
  }

  const info = scrapeCurrentChannelPage();
  if (!info) return;

  let state = stateNow();
  if (!state) return;

  let tracked = findChannelInState(state, info);
  if (!tracked) {
    const res = await sendBg(MESSAGE_ACTIONS.UPSERT_CHANNELS, { channels: [info] });
    if (res?.ok && res.state) {
      applyNewState(res.state);
      state = res.state;
      tracked = findChannelInState(state, info);
    }
  }
  if (!tracked) return;

  const lang = state.settings?.language || 'pt-BR';
  const subGroups = Object.values(state.groups || {})
    .filter((g) => g.kind === GROUP_KINDS.SUBSCRIPTION)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));

  const popover = document.createElement('div');
  popover.id = CHANNEL_POPOVER_ID;
  popover.className = `tp-popover ${getThemeClass(state)}`;

  const rect = anchorEl.getBoundingClientRect();
  popover.style.top = `${Math.min(window.innerHeight - 340, rect.bottom + 8)}px`;
  popover.style.left = `${Math.max(12, Math.min(window.innerWidth - 330, rect.left))}px`;

  const renderPopoverBody = (curState, curCh) => {
    const selectedSet = new Set(curCh.groupIds || []);
    const manualTags = curCh.tags || [];
    const autoTags = curCh.autoTags || [];

    popover.innerHTML = `
      <div class="tp-popover-header">
        <strong class="tp-ellipsis">${escapeHtml(curCh.title)}</strong>
        <button type="button" class="tp-icon-btn" data-tp-pop-close="1" aria-label="Close">✕</button>
      </div>
      <div class="tp-popover-section">
        <div class="tp-popover-label">${escapeHtml(t('sidebar.subscriptionGroups', lang))}</div>
        ${
          subGroups.length === 0
            ? `<div class="tp-muted tp-small">${escapeHtml(lang === 'pt-BR' ? 'Nenhum grupo criado.' : 'No groups created.')}</div>`
            : `<div class="tp-checklist">
                ${subGroups
                  .map(
                    (g) => `
                  <label class="tp-checklist-item">
                    <input type="checkbox" data-tp-pop-group="${escapeHtml(g.id)}" ${selectedSet.has(g.id) ? 'checked' : ''} />
                    <span style="color:${escapeHtml(g.color || '#ef233c')}">${renderIconHtml(g.icon, 16)}</span>
                    <span>${escapeHtml(g.name)}</span>
                  </label>`
                  )
                  .join('')}
              </div>`
        }
      </div>
      <div class="tp-popover-section">
        <div class="tp-popover-label">${escapeHtml(t('channel.tagsTitle', lang))}</div>
        <div class="tp-tag-list">
          ${manualTags
            .map(
              (tg) =>
                `<span class="tp-tag-chip">${escapeHtml(tg)} <button type="button" data-tp-pop-rm-tag="${escapeHtml(tg)}">×</button></span>`
            )
            .join('')}
          ${autoTags
            .map((tg) => `<span class="tp-tag-chip tp-tag-auto" title="Auto-tag">✨ ${escapeHtml(tg)}</span>`)
            .join('')}
        </div>
        <div class="tp-inline-form">
          <input type="text" class="tp-input tp-input-sm" id="tp-pop-tag-input" placeholder="${escapeHtml(t('channel.tagsPlaceholder', lang))}" />
          <button type="button" class="tp-btn tp-btn-sm tp-btn-primary" data-tp-pop-add-tag="1">+</button>
        </div>
      </div>
      <div class="tp-popover-footer">
        <button type="button" class="tp-btn tp-btn-sm" data-tp-pop-new-group="1">+ ${escapeHtml(t('sidebar.newGroup', lang))}</button>
        <button type="button" class="tp-btn tp-btn-sm tp-btn-primary" data-tp-pop-close="1">${escapeHtml(t('common.done', lang))}</button>
      </div>
    `;
  };

  renderPopoverBody(state, tracked);
  document.body.appendChild(popover);

  const onOutsideClick = (e) => {
    if (!popover.contains(/** @type {Node} */ (e.target)) && !anchorEl.contains(/** @type {Node} */ (e.target))) {
      popover.remove();
      document.removeEventListener('mousedown', onOutsideClick);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', onOutsideClick), 0);

  popover.addEventListener('change', async (e) => {
    const input = /** @type {HTMLInputElement} */ (e.target);
    if (!input?.hasAttribute?.('data-tp-pop-group')) return;
    const checkedIds = Array.from(popover.querySelectorAll('input[data-tp-pop-group]:checked')).map(
      (el) => el.getAttribute('data-tp-pop-group')
    );
    const res = await sendBg(MESSAGE_ACTIONS.ASSIGN_CHANNEL_GROUPS, {
      channelId: tracked.id,
      groupIds: checkedIds,
    });
    if (res?.ok && res.state) {
      applyNewState(res.state);
      tracked = res.state.channels[tracked.id] || tracked;
      ensureChannelPageButton(res.state);
    }
  });

  const addTag = async () => {
    const input = /** @type {HTMLInputElement | null} */ (popover.querySelector('#tp-pop-tag-input'));
    const val = (input?.value || '').trim();
    if (!val) return;
    const nextTags = [...new Set([...(tracked.tags || []), val])];
    const res = await sendBg(MESSAGE_ACTIONS.SET_CHANNEL_TAGS, {
      channelId: tracked.id,
      tags: nextTags,
    });
    if (res?.ok && res.state) {
      applyNewState(res.state);
      tracked = res.state.channels[tracked.id] || tracked;
      renderPopoverBody(res.state, tracked);
    }
  };

  popover.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && /** @type {HTMLElement} */ (e.target).id === 'tp-pop-tag-input') {
      e.preventDefault();
      addTag();
    }
  });

  popover.addEventListener('click', async (e) => {
    const target = /** @type {HTMLElement | null} */ (e.target instanceof Element ? e.target : null);
    if (!target) return;

    if (target.closest('[data-tp-pop-close]')) {
      popover.remove();
      document.removeEventListener('mousedown', onOutsideClick);
      return;
    }

    if (target.closest('[data-tp-pop-new-group]')) {
      popover.remove();
      document.removeEventListener('mousedown', onOutsideClick);
      openManagerModal('groups', { createKind: GROUP_KINDS.SUBSCRIPTION });
      return;
    }

    if (target.closest('[data-tp-pop-add-tag]')) {
      await addTag();
      return;
    }

    const rmBtn = target.closest('[data-tp-pop-rm-tag]');
    if (rmBtn) {
      const tagToRemove = rmBtn.getAttribute('data-tp-pop-rm-tag');
      const nextTags = (tracked.tags || []).filter((tg) => tg !== tagToRemove);
      const res = await sendBg(MESSAGE_ACTIONS.SET_CHANNEL_TAGS, {
        channelId: tracked.id,
        tags: nextTags,
      });
      if (res?.ok && res.state) {
        applyNewState(res.state);
        tracked = res.state.channels[tracked.id] || tracked;
        renderPopoverBody(res.state, tracked);
      }
    }
  });
}

/* ============================================================================
 * 4b. WATCH & SHORTS 1-CLICK CHANNEL GROUP PILL + POPOVER
 * ========================================================================== */

/**
 * Locate the DOM host element where the watch/shorts Channel Group Pill should mount.
 * @returns {Element | null}
 */
function getWatchChannelMountHost() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null;
  const isShorts = (window.location?.pathname || '').startsWith('/shorts/');
  if (isShorts) {
    return (
      document.querySelector('ytd-reel-video-renderer[is-active] ytd-reel-player-header-renderer') ||
      document.querySelector('ytd-reel-video-renderer[is-active] reel-player-header-renderer') ||
      document.querySelector('ytd-reel-video-renderer[is-active] #channel-container') ||
      document.querySelector('ytd-reel-player-header-renderer')
    );
  }
  return (
    document.querySelector('ytd-watch-metadata ytd-video-owner-renderer') ||
    document.querySelector('#owner ytd-video-owner-renderer') ||
    document.querySelector('ytd-video-owner-renderer') ||
    document.querySelector('#owner')
  );
}

/**
 * Extract the video owner channel metadata on `/watch` or `/shorts/`.
 * @returns {{ id: string, ucId: string, handle: string, title: string, avatarUrl: string, url: string } | null}
 */
function scrapeWatchPageChannel() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null;
  const ctx = getPageContext();
  if (ctx.type !== 'watch') return null;

  const isShorts = (window.location?.pathname || '').startsWith('/shorts/');
  const ownerRoot = isShorts
    ? document.querySelector('ytd-reel-video-renderer[is-active] ytd-reel-player-header-renderer') ||
      document.querySelector('ytd-reel-video-renderer[is-active]') ||
      document.querySelector('ytd-reel-player-header-renderer')
    : document.querySelector('ytd-watch-metadata ytd-video-owner-renderer') ||
      document.querySelector('#owner ytd-video-owner-renderer') ||
      document.querySelector('ytd-video-owner-renderer') ||
      document.querySelector('#owner');

  if (!ownerRoot) return null;

  const links = Array.from(
    ownerRoot.querySelectorAll(
      'a.yt-simple-endpoint[href*="/@"], a[href*="/@"], a.yt-simple-endpoint[href*="/channel/"], a[href*="/channel/"], ytd-channel-name a[href], #channel-name a[href]'
    )
  );

  let ucId = '';
  let handle = '';
  let primaryHref = '';

  for (const a of links) {
    const href = a.getAttribute('href') || '';
    if (!primaryHref && href) primaryHref = href;
    const ucMatch = href.match(/\/channel\/(UC[\w-]{10,})/);
    if (ucMatch && !ucId) ucId = ucMatch[1];
    const hMatch = href.match(/\/(@[^/?#]+)/);
    if (hMatch && !handle) handle = decodeURIComponent(hMatch[1]);
  }

  if (!ucId) {
    const domUc = ctx.channelId || detectChannelIdFromDom();
    if (domUc && /^UC[\w-]{10,}$/.test(domUc)) {
      ucId = domUc;
    }
  }

  const id = ucId || handle;
  if (!id) return null;

  const titleEl =
    ownerRoot.querySelector('#channel-name yt-formatted-string') ||
    ownerRoot.querySelector('ytd-channel-name yt-formatted-string') ||
    ownerRoot.querySelector('ytd-channel-name #text') ||
    ownerRoot.querySelector('#channel-name a');
  const title = (
    titleEl?.textContent ||
    links.find((a) => (a.textContent || '').trim())?.textContent ||
    handle ||
    id
  ).trim();

  const avatarEl =
    ownerRoot.querySelector('#avatar img') ||
    ownerRoot.querySelector('yt-img-shadow img') ||
    ownerRoot.querySelector('img');
  const avatarUrl = avatarEl?.getAttribute('src') || '';

  const url = ucId
    ? `https://www.youtube.com/channel/${ucId}`
    : handle
      ? `https://www.youtube.com/${handle}`
      : primaryHref
        ? new URL(primaryHref, 'https://www.youtube.com').href
        : `https://www.youtube.com/${id}`;

  return {
    id,
    ucId,
    handle,
    title: title || id,
    avatarUrl,
    url,
  };
}

/**
 * Idempotently inject or update the 1-Click Channel Group Pill on `/watch` and `/shorts/`.
 * @param {import('../shared/types.js').AppState | null} state
 */
function ensureWatchChannelGroupButton(state) {
  if (typeof document === 'undefined' || !state) return;
  const ctx = getPageContext();
  const existing = document.getElementById(WATCH_CHANNEL_BTN_ID);

  if (ctx.type !== 'watch') {
    if (existing) existing.remove();
    document.getElementById(WATCH_CHANNEL_POPOVER_ID)?.remove();
    return;
  }

  const host = getWatchChannelMountHost();
  const info = scrapeWatchPageChannel();
  if (!host || !info) return;

  const tracked = findChannelInState(state, info);
  const assignedGroups = (tracked?.groupIds || [])
    .map((gid) => state.groups?.[gid])
    .filter((g) => g && g.kind === GROUP_KINDS.SUBSCRIPTION);

  const lang = state.settings?.language || 'pt-BR';
  const themeClass = getThemeClass(state);
  const renderKey = `${info.id}|${info.handle}|${assignedGroups.map((g) => `${g.id}:${g.name}`).join(',')}|${themeClass}|${lang}`;

  let wrap = existing;
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = WATCH_CHANNEL_BTN_ID;
    wrap.className = 'tp-watch-channel-btn-wrap';
  }

  if (wrap.parentElement !== host) {
    host.appendChild(wrap);
  }

  if (wrap.dataset.tpRenderKey !== renderKey) {
    wrap.dataset.tpRenderKey = renderKey;
    const hasGroups = assignedGroups.length > 0;
    const previewNames = assignedGroups.slice(0, 2).map((g) => g.name);
    const extraCount = assignedGroups.length > 2 ? assignedGroups.length - 2 : 0;
    const labelHtml = hasGroups
      ? `<span class="tp-watch-group-ico" aria-hidden="true">📁</span>
         <span class="tp-watch-group-names">${previewNames.map((n) => escapeHtml(n)).join('<span class="tp-watch-group-sep">·</span>')}${extraCount > 0 ? ` <span class="tp-watch-group-more">+${extraCount}</span>` : ''}</span>`
      : `<span>${escapeHtml(lang === 'pt-BR' ? '+ Grupo' : '+ Group')}</span>`;

    const tooltip = hasGroups
      ? `${info.title} — ${assignedGroups.map((g) => g.name).join(', ')}`
      : lang === 'pt-BR'
        ? `Adicionar ${info.title} a um grupo`
        : `Add ${info.title} to a group`;

    wrap.innerHTML = `
      <button type="button" class="tp-watch-channel-group-btn ${themeClass} ${hasGroups ? 'tp-has-groups' : ''}" data-tp-open-watch-ch-popover="1" title="${escapeHtml(tooltip)}">
        ${labelHtml}
      </button>
    `;
  }

  if (wrap.dataset.tpBound !== '1') {
    wrap.dataset.tpBound = '1';
    wrap.addEventListener('click', (e) => {
      const btn = /** @type {HTMLElement | null} */ (
        e.target instanceof Element ? e.target.closest('[data-tp-open-watch-ch-popover]') : null
      );
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      openWatchChannelGroupPopover(btn);
    });
  }
}

/**
 * Open an instant 1-Click Subscription Group Checklist Popover anchored to the watch pill.
 * Allows immediate check/uncheck assignment and inline "+ Novo Grupo" creation in 1 step.
 * @param {HTMLElement} anchorEl
 */
async function openWatchChannelGroupPopover(anchorEl) {
  const existing = document.getElementById(WATCH_CHANNEL_POPOVER_ID);
  if (existing) {
    existing.remove();
    return;
  }

  const info = scrapeWatchPageChannel();
  if (!info) return;

  let state = stateNow();
  if (!state) return;

  let tracked = findChannelInState(state, info);

  const popover = document.createElement('div');
  popover.id = WATCH_CHANNEL_POPOVER_ID;
  popover.className = `tp-popover tp-watch-popover ${getThemeClass(state)}`;

  const rect = anchorEl.getBoundingClientRect();
  const estHeight = 340;
  const openAbove = rect.bottom + 8 + estHeight > window.innerHeight && rect.top > estHeight;
  const topPos = openAbove
    ? Math.max(12, rect.top - estHeight - 8)
    : Math.max(12, Math.min(window.innerHeight - estHeight, rect.bottom + 8));
  const leftPos = Math.max(12, Math.min(window.innerWidth - 332, rect.left));
  popover.style.top = `${topPos}px`;
  popover.style.left = `${leftPos}px`;

  /**
   * Ensure the channel is persisted in state before assigning groups.
   * @returns {Promise<import('../shared/types.js').Channel | null>}
   */
  const ensureTrackedChannel = async () => {
    const curState = stateNow();
    let ch = findChannelInState(curState, info);
    if (ch) {
      tracked = ch;
      return ch;
    }
    const res = await sendBg(MESSAGE_ACTIONS.UPSERT_CHANNELS, {
      channels: [
        {
          id: info.id,
          ucId: info.ucId || undefined,
          handle: info.handle,
          title: info.title,
          avatarUrl: info.avatarUrl,
          url: info.url,
        },
      ],
    });
    if (res?.ok && res.state) {
      applyNewState(res.state);
      ch = findChannelInState(res.state, info);
      tracked = ch;
      return ch;
    }
    return null;
  };

  const renderBody = (curState) => {
    const lang = curState?.settings?.language || 'pt-BR';
    const isPt = lang === 'pt-BR';
    const curCh = findChannelInState(curState, info);
    tracked = curCh;
    const selectedSet = new Set(curCh?.groupIds || []);
    const subGroups = Object.values(curState?.groups || {})
      .filter((g) => g.kind === GROUP_KINDS.SUBSCRIPTION)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));

    popover.className = `tp-popover tp-watch-popover ${getThemeClass(curState)}`;
    popover.innerHTML = `
      <div class="tp-popover-header">
        <div class="tp-watch-pop-ch">
          ${
            info.avatarUrl
              ? `<img class="tp-watch-pop-avatar" src="${escapeHtml(info.avatarUrl)}" alt="" />`
              : ''
          }
          <strong class="tp-ellipsis">${escapeHtml(info.title)}</strong>
        </div>
        <button type="button" class="tp-icon-btn" data-tp-watch-pop-close="1" aria-label="Close">✕</button>
      </div>
      <div class="tp-popover-section">
        <div class="tp-popover-label">${escapeHtml(t('sidebar.subscriptionGroups', lang))}</div>
        ${
          subGroups.length === 0
            ? `<div class="tp-muted tp-small">${escapeHtml(
                isPt ? 'Nenhum grupo ainda. Crie um abaixo!' : 'No groups yet. Create one below!'
              )}</div>`
            : `<div class="tp-checklist tp-watch-checklist">
                ${subGroups
                  .map(
                    (g) => `
                  <label class="tp-checklist-item">
                    <input type="checkbox" data-tp-watch-pop-group="${escapeHtml(g.id)}" ${selectedSet.has(g.id) ? 'checked' : ''} />
                    <span class="tp-watch-chk-ico" style="color:${escapeHtml(g.color || '#ef233c')}">${renderIconHtml(g.icon, 16)}</span>
                    <span class="tp-ellipsis">${escapeHtml(g.name)}</span>
                  </label>`
                  )
                  .join('')}
              </div>`
        }
      </div>
      <div class="tp-popover-section tp-watch-new-group-sec">
        <div class="tp-popover-label">${escapeHtml(isPt ? '+ Novo Grupo' : '+ New Group')}</div>
        <div class="tp-inline-form tp-watch-new-group-row">
          <input type="text" class="tp-input tp-input-sm" id="tp-watch-new-group-input" placeholder="${escapeHtml(
            isPt ? 'Nome do grupo...' : 'Group name...'
          )}" />
          <button type="button" class="tp-btn tp-btn-sm tp-btn-primary" data-tp-watch-create-group="1">${escapeHtml(
            isPt ? 'Criar' : 'Create'
          )}</button>
        </div>
      </div>
    `;
  };

  renderBody(state);
  document.body.appendChild(popover);

  const closePopover = () => {
    popover.remove();
    document.removeEventListener('mousedown', onOutsideClick);
    document.removeEventListener('keydown', onEscapeKey);
  };

  const onOutsideClick = (e) => {
    if (!popover.contains(/** @type {Node} */ (e.target)) && !anchorEl.contains(/** @type {Node} */ (e.target))) {
      closePopover();
    }
  };
  const onEscapeKey = (e) => {
    if (e.key === 'Escape') {
      closePopover();
    }
  };
  setTimeout(() => {
    document.addEventListener('mousedown', onOutsideClick);
    document.addEventListener('keydown', onEscapeKey);
  }, 0);

  // Instant 1-click group checkbox assignment
  popover.addEventListener('change', async (e) => {
    const input = /** @type {HTMLInputElement} */ (e.target);
    if (!input?.hasAttribute?.('data-tp-watch-pop-group')) return;

    const checkedIds = Array.from(
      popover.querySelectorAll('input[data-tp-watch-pop-group]:checked')
    )
      .map((el) => el.getAttribute('data-tp-watch-pop-group'))
      .filter(Boolean);

    const ch = await ensureTrackedChannel();
    if (!ch) return;

    const res = await sendBg(MESSAGE_ACTIONS.ASSIGN_CHANNEL_GROUPS, {
      channelId: ch.id,
      groupIds: checkedIds,
    });
    if (res?.ok && res.state) {
      applyNewState(res.state);
      ensureWatchChannelGroupButton(res.state);
      const lang = res.state.settings?.language || 'pt-BR';
      showToast(t('toast.saved', lang), 'success');
    } else if (res?.error) {
      const lang = stateNow()?.settings?.language || 'pt-BR';
      showToast(t('toast.error', lang, { message: res.error }), 'error');
    }
  });

  // Inline "+ Novo Grupo" creation + instant channel assignment in 1 step
  const createAndAssignGroup = async () => {
    const input = /** @type {HTMLInputElement | null} */ (
      popover.querySelector('#tp-watch-new-group-input')
    );
    const name = (input?.value || '').trim();
    if (!name) {
      input?.focus();
      return;
    }

    const createRes = await sendBg(MESSAGE_ACTIONS.CREATE_GROUP, {
      group: {
        name,
        kind: GROUP_KINDS.SUBSCRIPTION,
        parentId: null,
        color: DEFAULT_GROUP_COLORS[0],
        icon: { type: 'emoji', value: '📁' },
      },
    });

    if (!createRes?.ok || !createRes.state || !createRes.group?.id) {
      const lang = stateNow()?.settings?.language || 'pt-BR';
      showToast(t('toast.error', lang, { message: createRes?.error || 'Failed to create group' }), 'error');
      return;
    }

    applyNewState(createRes.state);

    const ch = await ensureTrackedChannel();
    if (!ch) {
      renderBody(stateNow());
      return;
    }

    const nextGroupIds = [...new Set([...(ch.groupIds || []), createRes.group.id])];
    const assignRes = await sendBg(MESSAGE_ACTIONS.ASSIGN_CHANNEL_GROUPS, {
      channelId: ch.id,
      groupIds: nextGroupIds,
    });

    if (assignRes?.ok && assignRes.state) {
      applyNewState(assignRes.state);
      renderBody(assignRes.state);
      ensureWatchChannelGroupButton(assignRes.state);
      const lang = assignRes.state.settings?.language || 'pt-BR';
      showToast(
        lang === 'pt-BR'
          ? `Grupo "${name}" criado e canal adicionado!`
          : `Group "${name}" created & channel assigned!`,
        'success'
      );
    }
  };

  popover.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && /** @type {HTMLElement} */ (e.target).id === 'tp-watch-new-group-input') {
      e.preventDefault();
      createAndAssignGroup();
    }
  });

  popover.addEventListener('click', async (e) => {
    const target = /** @type {HTMLElement | null} */ (e.target instanceof Element ? e.target : null);
    if (!target) return;

    if (target.closest('[data-tp-watch-pop-close]')) {
      closePopover();
      return;
    }

    if (target.closest('[data-tp-watch-create-group]')) {
      await createAndAssignGroup();
    }
  });
}

/* ============================================================================
 * 5. FULL MANAGER MODAL (GRUPOS | CANAIS | COMUNIDADE)
 * ========================================================================== */

/**
 * Open the Full Manager Modal on the requested tab.
 * @param {'groups' | 'playlists' | 'channels' | 'community'} [initialTab='groups']
 * @param {{ createKind?: 'subscription' | 'playlist', editGroupId?: string, createPlaylist?: boolean, editPlaylistId?: string }} [options={}]
 */
export function openManagerModal(initialTab = 'groups', options = {}) {
  modalState.open = true;
  modalState.tab = initialTab || 'groups';

  if (options?.createPlaylist) {
    modalState.tab = 'playlists';
    modalState.showPlaylistForm = true;
    modalState.editingPlaylistId = null;
    modalState.groupFormName = '';
    modalState.groupFormColor = DEFAULT_GROUP_COLORS[0];
    modalState.groupFormIcon = { type: 'emoji', value: '🎵' };
    modalState.iconSearch = '';
    modalState.iconCategory = 'all';
  } else if (options?.editPlaylistId) {
    const st = stateNow();
    const pl = st?.playlists?.[options.editPlaylistId];
    modalState.tab = 'playlists';
    modalState.showPlaylistForm = true;
    modalState.editingPlaylistId = options.editPlaylistId;
    modalState.groupFormName = pl?.title || '';
    modalState.groupFormColor = pl?.color || DEFAULT_GROUP_COLORS[0];
    if (pl?.customThumbnailUrl) {
      modalState.groupFormIcon = { type: 'custom', value: pl.customThumbnailUrl };
    } else if (pl?.icon && typeof pl.icon === 'object' && pl.icon.type && pl.icon.value) {
      modalState.groupFormIcon = pl.icon;
    } else if (typeof pl?.icon === 'string' && pl.icon) {
      modalState.groupFormIcon = { type: 'emoji', value: pl.icon };
    } else {
      modalState.groupFormIcon = { type: 'emoji', value: '🎵' };
    }
    modalState.iconSearch = '';
    modalState.iconCategory = 'all';
  } else if (options?.createKind) {
    modalState.tab = 'groups';
    modalState.showGroupForm = true;
    modalState.editingGroupId = null;
    modalState.groupFormKind = options.createKind;
    modalState.groupFormName = '';
    modalState.groupFormParentId = '';
    modalState.groupFormColor = DEFAULT_GROUP_COLORS[0];
    modalState.groupFormIcon = {
      type: 'emoji',
      value: options.createKind === GROUP_KINDS.PLAYLIST ? '🎵' : '📁',
    };
  } else if (options?.editGroupId) {
    const st = stateNow();
    const g = st?.groups?.[options.editGroupId];
    if (g) {
      modalState.tab = 'groups';
      modalState.showGroupForm = true;
      modalState.editingGroupId = g.id;
      modalState.groupFormKind = g.kind;
      modalState.groupFormName = g.name;
      modalState.groupFormParentId = g.parentId || '';
      modalState.groupFormColor = g.color || DEFAULT_GROUP_COLORS[0];
      modalState.groupFormIcon = g.icon || { type: 'emoji', value: '📁' };
    }
  }

  renderManagerModal();

  if (modalState.tab === 'community' && modalState.communityPosts.length === 0 && !modalState.communityLoading) {
    loadCommunityPosts(false);
  }
}

/**
 * Close the Manager Modal.
 */
function closeManagerModal() {
  modalState.open = false;
  document.getElementById(MANAGER_MODAL_ID)?.remove();
}

/**
 * Render the flat Subscription Groups tab inside the Manager Modal (no subgroups).
 * @param {import('../shared/types.js').AppState} state
 * @param {string} lang
 * @returns {string}
 */
function renderGroupsTab(state, lang) {
  const subGroups = Object.values(state.groups || {})
    .filter((g) => g && g.kind === GROUP_KINDS.SUBSCRIPTION)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.name || '').localeCompare(b.name || ''));

  const renderFlatGroupList = (groups) => {
    if (!groups.length) return '';
    return groups
      .map((node, idx) => {
        const count = getChannelsByGroup(state, node.id, { includeDescendants: true }).length;
        const canUp = idx > 0;
        const canDown = idx < groups.length - 1;
        return `
          <div class="tp-group-row" style="border-left:3px solid ${escapeHtml(node.color || '#ef233c')}">
            <div class="tp-group-row-info">
              <span class="tp-group-row-ico" style="color:${escapeHtml(node.color || '#ef233c')}">${renderIconHtml(node.icon, 20)}</span>
              <span class="tp-group-row-name">${escapeHtml(node.name)}</span>
              <span class="tp-badge-count">${count}</span>
            </div>
            <div class="tp-group-row-actions">
              <button type="button" class="tp-icon-btn" data-tp-grp-move="${escapeHtml(node.id)}" data-tp-dir="up" ${canUp ? '' : 'disabled'} title="Subir">↑</button>
              <button type="button" class="tp-icon-btn" data-tp-grp-move="${escapeHtml(node.id)}" data-tp-dir="down" ${canDown ? '' : 'disabled'} title="Descer">↓</button>
              <button type="button" class="tp-icon-btn" data-tp-grp-edit="${escapeHtml(node.id)}" title="${escapeHtml(t('common.edit', lang))}">✎</button>
              <button type="button" class="tp-icon-btn tp-danger" data-tp-grp-del="${escapeHtml(node.id)}" title="${escapeHtml(t('common.delete', lang))}">🗑</button>
            </div>
          </div>
        `;
      })
      .join('');
  };

  const icons = searchIcons(modalState.iconSearch, modalState.iconCategory);

  const formHtml = modalState.showGroupForm
    ? renderUnifiedIconColorForm({
        titleText: modalState.editingGroupId ? t('group.editTitle', lang) : t('group.createTitle', lang),
        nameLabel: t('group.nameLabel', lang),
        namePlaceholder: t('group.namePlaceholder', lang),
        formAttr: 'data-tp-grp-form',
        icons,
        lang,
      })
    : '';

  return `
    <div class="tp-tab-toolbar">
      <button type="button" class="tp-btn tp-btn-primary tp-btn-sm" data-tp-grp-new="${GROUP_KINDS.SUBSCRIPTION}">
        + ${escapeHtml(t('sidebar.newGroup', lang))}
      </button>
    </div>

    ${formHtml}

    <section class="tp-card">
      <h4 class="tp-card-title">${escapeHtml(t('sidebar.subscriptionGroups', lang))}</h4>
      ${
        subGroups.length > 0
          ? renderFlatGroupList(subGroups)
          : `<div class="tp-muted tp-small">${escapeHtml(t('common.empty', lang))}</div>`
      }
    </section>
  `;
}

/**
 * Shared Name + Color + Searchable Icon Picker + Custom Image Upload form
 * used identically for both Subscription Groups and Playlists.
 */
function renderUnifiedIconColorForm({ titleText, nameLabel, namePlaceholder, formAttr, icons, lang }) {
  const isPt = lang === 'pt-BR' || lang === 'pt-PT';
  return `
    <div class="tp-card tp-group-form">
      <div class="tp-form-header">
        <h3>${escapeHtml(titleText)}</h3>
        <button type="button" class="tp-icon-btn" ${formAttr}="cancel">✕</button>
      </div>

      <div class="tp-form-grid">
        <label class="tp-field">
          <span>${escapeHtml(nameLabel)}</span>
          <input type="text" class="tp-input" data-tp-grp-input="groupFormName" value="${escapeHtml(modalState.groupFormName)}" placeholder="${escapeHtml(namePlaceholder)}" />
        </label>
      </div>

      <div class="tp-field">
        <span>${escapeHtml(t('group.colorLabel', lang))}</span>
        <div class="tp-color-swatches">
          ${DEFAULT_GROUP_COLORS.map(
            (c) =>
              `<button type="button" class="tp-swatch ${modalState.groupFormColor === c ? 'tp-swatch-active' : ''}" style="background:${c}" data-tp-pick-color="${c}" aria-label="${c}"></button>`
          ).join('')}
          <input type="color" class="tp-color-input" data-tp-grp-input="groupFormColor" value="${escapeHtml(modalState.groupFormColor)}" />
        </div>
      </div>

      <div class="tp-field">
        <div class="tp-icon-picker-head">
          <span>${escapeHtml(t('group.iconLabel', lang))} <span class="tp-icon-preview" style="color:${escapeHtml(modalState.groupFormColor)}">${renderIconHtml(modalState.groupFormIcon, 22)}</span></span>
          <label class="tp-btn tp-btn-sm tp-upload-label">
            📤 ${escapeHtml(t('group.iconUpload', lang))}
            <input type="file" accept="image/*" id="tp-custom-icon-upload" hidden />
          </label>
        </div>

        <input type="search" class="tp-input tp-input-sm" data-tp-grp-input="iconSearch" value="${escapeHtml(modalState.iconSearch)}" placeholder="${escapeHtml(t('group.iconSearch', lang))}" />

        <div class="tp-icon-cats">
          ${ICON_CATEGORIES.map(
            (cat) => `
            <button type="button" class="tp-pill tp-pill-xs ${modalState.iconCategory === cat.id ? 'tp-pill-active' : ''}" data-tp-icon-cat="${escapeHtml(cat.id)}">
              ${escapeHtml(isPt ? cat.labelPt : cat.labelEn)}
            </button>`
          ).join('')}
        </div>

        <div class="tp-icon-grid">
          ${icons
            .map((ic) => {
              const isSel =
                modalState.groupFormIcon?.type === ic.type &&
                modalState.groupFormIcon?.value === ic.value;
              return `
                <button type="button" class="tp-icon-choice ${isSel ? 'tp-icon-choice-active' : ''}" data-tp-pick-icon-type="${escapeHtml(ic.type)}" data-tp-pick-icon-id="${escapeHtml(ic.id)}" title="${escapeHtml(isPt ? ic.labelPt : ic.labelEn)}">
                  ${renderIconHtml({ type: ic.type, value: ic.value }, 20)}
                </button>`;
            })
            .join('')}
        </div>
      </div>

      <div class="tp-form-actions">
        <button type="button" class="tp-btn" ${formAttr}="cancel">${escapeHtml(t('common.cancel', lang))}</button>
        <button type="button" class="tp-btn tp-btn-primary" ${formAttr}="save">${escapeHtml(t('common.save', lang))}</button>
      </div>
    </div>
  `;
}

/**
 * Render the Playlists tab inside the Manager Modal using the exact same
 * creation & customization workflow as Subscription Groups.
 * @param {import('../shared/types.js').AppState} state
 * @param {string} lang
 * @returns {string}
 */
function renderPlaylistsTab(state, lang) {
  const playlists = Object.values(state.playlists || {})
    .filter((p) => Boolean(p?.id))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) || (a.title || '').localeCompare(b.title || ''));

  const icons = searchIcons(modalState.iconSearch, modalState.iconCategory);
  const newPlLabel = t('playlists.newCustom', lang) || (lang === 'en' ? 'New Playlist' : 'Nova Playlist');
  const editPlTitle = lang === 'en' ? 'Customize Playlist' : lang === 'es' ? 'Personalizar Lista' : 'Personalizar Playlist';
  const nameLabel = lang === 'en' ? 'Playlist name' : lang === 'es' ? 'Nombre de la lista' : 'Nome da playlist';
  const namePh = lang === 'en' ? 'e.g. Study, Favorites, Watch Weekend' : lang === 'es' ? 'ej. Estudios, Favoritos' : 'ex: Estudos, Favoritos, Assistir no FDS';

  const formHtml = modalState.showPlaylistForm
    ? renderUnifiedIconColorForm({
        titleText: modalState.editingPlaylistId ? editPlTitle : newPlLabel,
        nameLabel,
        namePlaceholder: namePh,
        formAttr: 'data-tp-pl-form',
        icons,
        lang,
      })
    : '';

  const renderPlVisual = (pl) => {
    if (pl.customThumbnailUrl) {
      return `<img class="tp-pl-sb-thumb" src="${escapeHtml(pl.customThumbnailUrl)}" alt="" style="width:22px;height:22px;border-radius:5px;object-fit:cover;" />`;
    }
    if (pl.icon && typeof pl.icon === 'object' && pl.icon.type && pl.icon.value) {
      return renderIconHtml(pl.icon, 20);
    }
    if (typeof pl.icon === 'string' && pl.icon) {
      return escapeHtml(pl.icon);
    }
    return '🎵';
  };

  const rowsHtml = playlists
    .map((pl) => {
      const count = Array.isArray(pl.videos) ? pl.videos.length : pl.videoCount || 0;
      const accent = pl.color || '#ef233c';
      const sourceBadge = pl.isCustom
        ? ''
        : `<span class="tp-badge-count" title="YouTube">YouTube</span>`;
      const deleteBtn = pl.isCustom
        ? `<button type="button" class="tp-icon-btn tp-danger" data-tp-pl-del="${escapeHtml(pl.id)}" title="${escapeHtml(t('common.delete', lang))}">🗑</button>`
        : '';
      return `
        <div class="tp-group-row" style="border-left:3px solid ${escapeHtml(accent)}">
          <div class="tp-group-row-info">
            <span class="tp-group-row-ico" style="color:${escapeHtml(accent)}">${renderPlVisual(pl)}</span>
            <span class="tp-group-row-name">${escapeHtml(pl.title || pl.id)}</span>
            <span class="tp-badge-count">${count}</span>
            ${sourceBadge}
          </div>
          <div class="tp-group-row-actions">
            <button type="button" class="tp-icon-btn" data-tp-pl-edit="${escapeHtml(pl.id)}" title="${escapeHtml(t('common.edit', lang))}">✎</button>
            ${deleteBtn}
          </div>
        </div>
      `;
    })
    .join('');

  return `
    <div class="tp-tab-toolbar">
      <button type="button" class="tp-btn tp-btn-primary tp-btn-sm" data-tp-pl-new="1">
        + ${escapeHtml(newPlLabel)}
      </button>
    </div>

    ${formHtml}

    <section class="tp-card">
      <h4 class="tp-card-title">${escapeHtml(t('playlists.title', lang) || 'Listas de reprodução')}</h4>
      ${
        playlists.length > 0
          ? rowsHtml
          : `<div class="tp-muted tp-small">${escapeHtml(t('common.empty', lang))}</div>`
      }
    </section>
  `;
}

/**
 * Render the Channels tab inside the Manager Modal.
 * @param {import('../shared/types.js').AppState} state
 * @param {string} lang
 * @returns {string}
 */
function renderChannelsTab(state, lang) {
  const allChannels = Object.values(state.channels || {});
  const subGroups = Object.values(state.groups || {})
    .filter((g) => g.kind === GROUP_KINDS.SUBSCRIPTION)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Filter by unlimited tags (AND / OR / Exclude)
  let filtered = filterChannelsByTags(allChannels, {
    includeAll: modalState.tagIncludeAll,
    includeAny: modalState.tagIncludeAny,
    exclude: modalState.tagExclude,
  });

  // Filter by status
  if (modalState.channelStatusFilter !== 'all') {
    filtered = filtered.filter((ch) => ch.status === modalState.channelStatusFilter);
  }

  // Filter by group
  if (modalState.channelGroupFilter === 'ungrouped') {
    filtered = filtered.filter((ch) => !ch.groupIds || ch.groupIds.length === 0);
  } else if (modalState.channelGroupFilter !== 'all') {
    const allowed = new Set(
      getChannelsByGroup(state, modalState.channelGroupFilter, { includeDescendants: true }).map(
        (c) => c.id
      )
    );
    filtered = filtered.filter((ch) => allowed.has(ch.id));
  }

  // Filter by search
  if (modalState.channelSearch.trim()) {
    const q = modalState.channelSearch.trim().toLowerCase();
    filtered = filtered.filter((ch) =>
      `${ch.title} ${ch.handle} ${(ch.tags || []).join(' ')} ${(ch.autoTags || []).join(' ')}`
        .toLowerCase()
        .includes(q)
    );
  }

  filtered.sort((a, b) => (a.title || '').localeCompare(b.title || ''));

  const uniqueTags = getAllUniqueTags(allChannels);
  const statusCfg = state.settings?.statusConfig || DEFAULT_STATUS_CONFIG;
  const selectedCount = modalState.selectedChannelIds.size;

  const thresholdHtml = modalState.showThresholdEditor
    ? `
      <div class="tp-card tp-threshold-bar">
        <div class="tp-threshold-title">${escapeHtml(t('options.statusThresholds', lang))}</div>
        <div class="tp-threshold-inputs">
          <label class="tp-inline-field">
            <span>${escapeHtml(t('channel.status.active', lang))} ≤</span>
            <input type="number" min="1" class="tp-input tp-input-xs" id="tp-cfg-activeDays" value="${statusCfg.activeDays}" />
            <span>d</span>
          </label>
          <label class="tp-inline-field">
            <span>${escapeHtml(t('channel.status.slow', lang))} ≤</span>
            <input type="number" min="2" class="tp-input tp-input-xs" id="tp-cfg-slowDays" value="${statusCfg.slowDays}" />
            <span>d</span>
          </label>
          <label class="tp-inline-field">
            <span>${escapeHtml(t('channel.status.inactive', lang))} ≤</span>
            <input type="number" min="3" class="tp-input tp-input-xs" id="tp-cfg-inactiveDays" value="${statusCfg.inactiveDays}" />
            <span>d</span>
          </label>
          <button type="button" class="tp-btn tp-btn-primary tp-btn-sm" data-tp-ch-action="save-thresholds">${escapeHtml(t('common.save', lang))}</button>
        </div>
      </div>
    `
    : '';

  const unsubHelperHtml = modalState.showUnsubHelper
    ? `
      <div class="tp-card tp-unsub-helper">
        <div class="tp-form-header">
          <strong>${escapeHtml(lang === 'pt-BR' ? 'Assistente de Cancelamento em Massa' : 'Bulk Unsubscribe Helper')} (${selectedCount})</strong>
          <button type="button" class="tp-icon-btn" data-tp-ch-action="close-unsub-helper">✕</button>
        </div>
        <p class="tp-muted tp-small">
          ${escapeHtml(
            lang === 'pt-BR'
              ? `Abra os canais selecionados no YouTube para cancelar a inscrição com segurança, ou remova-os do ${BRAND_NAME}.`
              : `Open selected channels on YouTube to safely unsubscribe, or remove them from ${BRAND_NAME}.`
          )}
        </p>
        <div class="tp-unsub-actions">
          <a class="tp-btn tp-btn-sm" href="https://www.youtube.com/feed/channels" target="_blank" rel="noopener">
            🔗 ${escapeHtml(lang === 'pt-BR' ? 'Abrir Gerenciador de Inscrições do YouTube' : 'Open YouTube Subscriptions Manager')}
          </a>
          <button type="button" class="tp-btn tp-btn-sm" data-tp-ch-action="open-selected-channels">
            ↗ ${escapeHtml(lang === 'pt-BR' ? 'Abrir canais selecionados (máx. 5)' : 'Open selected channels (max 5)')}
          </button>
          <button type="button" class="tp-btn tp-btn-sm tp-btn-danger" data-tp-ch-action="remove-selected-channels">
            🗑 ${escapeHtml(lang === 'pt-BR' ? `Remover selecionados do ${BRAND_NAME}` : `Remove selected from ${BRAND_NAME}`)}
          </button>
        </div>
      </div>
    `
    : '';

  const bulkBarHtml =
    selectedCount > 0
      ? `
      <div class="tp-bulk-bar">
        <span><strong>${selectedCount}</strong> ${escapeHtml(lang === 'pt-BR' ? 'selecionados' : 'selected')}</span>
        <select class="tp-select tp-select-sm" id="tp-bulk-group-select">
          <option value="">${escapeHtml(lang === 'pt-BR' ? 'Escolher grupo...' : 'Choose group...')}</option>
          ${subGroups.map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`).join('')}
        </select>
        <button type="button" class="tp-btn tp-btn-sm tp-btn-primary" data-tp-ch-action="bulk-add-group">+ ${escapeHtml(t('common.add', lang))}</button>
        <button type="button" class="tp-btn tp-btn-sm" data-tp-ch-action="bulk-rm-group">- ${escapeHtml(t('common.remove', lang))}</button>
        <button type="button" class="tp-btn tp-btn-sm tp-btn-danger" data-tp-ch-action="open-unsub-helper">${escapeHtml(lang === 'pt-BR' ? 'Cancelar Inscrição...' : 'Unsubscribe...')}</button>
        <button type="button" class="tp-btn tp-btn-sm" data-tp-ch-action="clear-selection">${escapeHtml(t('common.none', lang))}</button>
      </div>
    `
      : '';

  const activeTagFiltersCount =
    modalState.tagIncludeAll.length +
    modalState.tagIncludeAny.length +
    modalState.tagExclude.length;

  return `
    <div class="tp-tab-toolbar tp-wrap">
      <button type="button" class="tp-btn tp-btn-primary tp-btn-sm" data-tp-ch-action="sync-youtube">
        🔄 ${escapeHtml(lang === 'pt-BR' ? 'Importar / Sincronizar do YouTube' : 'Import / Sync from YouTube')}
      </button>
      <button type="button" class="tp-btn tp-btn-sm" data-tp-ch-action="auto-tag-all">
        ✨ ${escapeHtml(t('channel.autoTagAll', lang))}
      </button>
      <button type="button" class="tp-btn tp-btn-sm" data-tp-ch-action="refresh-statuses">
        📡 ${escapeHtml(t('channel.refreshStatuses', lang))}
      </button>
      <button type="button" class="tp-btn tp-btn-sm" data-tp-ch-action="toggle-thresholds">
        ⏱ ${escapeHtml(lang === 'pt-BR' ? 'Limites de Status' : 'Status Thresholds')}
      </button>
      <button type="button" class="tp-btn tp-btn-sm" data-tp-ch-action="export-csv">
        📄 ${escapeHtml(t('options.exportCsv', lang))}
      </button>
    </div>

    ${thresholdHtml}
    ${unsubHelperHtml}

    <div class="tp-channels-filters">
      <input type="search" class="tp-input tp-input-sm" data-tp-ch-filter="channelSearch" value="${escapeHtml(modalState.channelSearch)}" placeholder="${escapeHtml(t('common.search', lang))}" />

      <select class="tp-select tp-select-sm" data-tp-ch-filter="channelGroupFilter">
        <option value="all" ${modalState.channelGroupFilter === 'all' ? 'selected' : ''}>${escapeHtml(t('common.all', lang))} (${allChannels.length})</option>
        <option value="ungrouped" ${modalState.channelGroupFilter === 'ungrouped' ? 'selected' : ''}>${escapeHtml(t('sidebar.ungrouped', lang))}</option>
        ${subGroups
          .map(
            (g) =>
              `<option value="${escapeHtml(g.id)}" ${modalState.channelGroupFilter === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`
          )
          .join('')}
      </select>

      <div class="tp-status-pills">
        ${['all', CHANNEL_STATUSES.ACTIVE, CHANNEL_STATUSES.SLOW, CHANNEL_STATUSES.INACTIVE, CHANNEL_STATUSES.DEAD]
          .map((st) => {
            const label = st === 'all' ? t('common.all', lang) : t(`channel.status.${st}`, lang);
            return `<button type="button" class="tp-pill tp-pill-xs ${modalState.channelStatusFilter === st ? 'tp-pill-active' : ''}" data-tp-status-filter="${st}">${escapeHtml(label)}</button>`;
          })
          .join('')}
      </div>
    </div>

    ${
      uniqueTags.length > 0
        ? `
      <div class="tp-tag-filter-panel">
        <div class="tp-tag-filter-head">
          <span class="tp-small"><strong>${escapeHtml(lang === 'pt-BR' ? 'Filtro de Tags (Ilimitado):' : 'Tag Filter (Unlimited):')}</strong></span>
          <div class="tp-mode-switch">
            <button type="button" class="tp-pill tp-pill-xs ${modalState.tagFilterMode === 'includeAll' ? 'tp-pill-active' : ''}" data-tp-tag-mode="includeAll">AND</button>
            <button type="button" class="tp-pill tp-pill-xs ${modalState.tagFilterMode === 'includeAny' ? 'tp-pill-active' : ''}" data-tp-tag-mode="includeAny">OR</button>
            <button type="button" class="tp-pill tp-pill-xs ${modalState.tagFilterMode === 'exclude' ? 'tp-pill-active' : ''}" data-tp-tag-mode="exclude">NOT</button>
          </div>
          ${
            activeTagFiltersCount > 0
              ? `<button type="button" class="tp-btn tp-btn-xs" data-tp-ch-action="clear-tag-filters">${escapeHtml(t('common.reset', lang))} (${activeTagFiltersCount})</button>`
              : ''
          }
        </div>
        <div class="tp-tag-pills-wrap">
          ${uniqueTags
            .map((item) => {
              const inAll = modalState.tagIncludeAll.includes(item.tag);
              const inAny = modalState.tagIncludeAny.includes(item.tag);
              const inExc = modalState.tagExclude.includes(item.tag);
              const cls = inAll
                ? 'tp-tag-pill-and'
                : inAny
                  ? 'tp-tag-pill-or'
                  : inExc
                    ? 'tp-tag-pill-not'
                    : '';
              const prefix = inAll ? 'AND ' : inAny ? 'OR ' : inExc ? 'NOT ' : '';
              return `<button type="button" class="tp-pill tp-pill-xs ${cls}" data-tp-toggle-tag="${escapeHtml(item.tag)}">${escapeHtml(prefix)}${item.isAuto ? '✨ ' : ''}${escapeHtml(item.tag)} (${item.count})</button>`;
            })
            .join('')}
        </div>
      </div>`
        : ''
    }

    ${bulkBarHtml}

    <div class="tp-channel-list-head">
      <label class="tp-check-pill">
        <input type="checkbox" data-tp-ch-action="toggle-select-all" ${filtered.length > 0 && filtered.every((c) => modalState.selectedChannelIds.has(c.id)) ? 'checked' : ''} />
        <span>${escapeHtml(lang === 'pt-BR' ? `Mostrando ${filtered.length} de ${allChannels.length} canais` : `Showing ${filtered.length} of ${allChannels.length} channels`)}</span>
      </label>
    </div>

    <div class="tp-channel-list">
      ${
        filtered.length === 0
          ? `<div class="tp-empty-state">${escapeHtml(t('common.empty', lang))}</div>`
          : filtered
              .map((ch) => {
                const isSel = modalState.selectedChannelIds.has(ch.id);
                const statusLabel = t(`channel.status.${ch.status || 'inactive'}`, lang);
                const isEditingTags = modalState.editingChannelTagsId === ch.id;
                const chGroups = (ch.groupIds || [])
                  .map((gid) => state.groups?.[gid])
                  .filter(Boolean);

                return `
                  <div class="tp-channel-row" data-channel-id="${escapeHtml(ch.id)}">
                    <input type="checkbox" data-tp-ch-select="${escapeHtml(ch.id)}" ${isSel ? 'checked' : ''} />
                    ${
                      ch.avatarUrl
                        ? `<img class="tp-ch-avatar" src="${escapeHtml(ch.avatarUrl)}" alt="" loading="lazy" />`
                        : `<div class="tp-ch-avatar tp-ch-avatar-fallback">${escapeHtml((ch.title || '?')[0].toUpperCase())}</div>`
                    }
                    <div class="tp-ch-main">
                      <div class="tp-ch-top">
                        <a class="tp-ch-title" href="${escapeHtml(ch.url || '#')}" target="_blank" rel="noopener">${escapeHtml(ch.title)}</a>
                        <span class="tp-status-badge tp-status-${escapeHtml(ch.status || 'inactive')}">${escapeHtml(statusLabel)}</span>
                        ${ch.lastVideoAt ? `<span class="tp-muted tp-xs">${escapeHtml(formatRelativeDate(ch.lastVideoAt, lang))}</span>` : ''}
                      </div>
                      <div class="tp-ch-meta-pills">
                        ${chGroups
                          .map(
                            (g) =>
                              `<span class="tp-mini-chip" style="border-color:${escapeHtml(g.color || '#ef233c')}">${renderIconHtml(g.icon, 12)} ${escapeHtml(g.name)}</span>`
                          )
                          .join('')}
                        ${(ch.tags || [])
                          .map(
                            (tg) =>
                              `<span class="tp-tag-chip">${escapeHtml(tg)} <button type="button" data-tp-ch-rm-tag="${escapeHtml(ch.id)}" data-tp-tag="${escapeHtml(tg)}">×</button></span>`
                          )
                          .join('')}
                        ${(ch.autoTags || [])
                          .map((tg) => `<span class="tp-tag-chip tp-tag-auto">✨ ${escapeHtml(tg)}</span>`)
                          .join('')}
                      </div>
                      ${
                        isEditingTags
                          ? `<div class="tp-inline-form tp-mt-xs">
                              <input type="text" class="tp-input tp-input-xs" data-tp-ch-tag-input="${escapeHtml(ch.id)}" placeholder="${escapeHtml(t('channel.tagsPlaceholder', lang))}" />
                              <button type="button" class="tp-btn tp-btn-xs tp-btn-primary" data-tp-ch-add-tag="${escapeHtml(ch.id)}">+</button>
                              <button type="button" class="tp-btn tp-btn-xs" data-tp-ch-close-tags="1">${escapeHtml(t('common.done', lang))}</button>
                            </div>`
                          : ''
                      }
                    </div>
                    <div class="tp-ch-actions">
                      <button type="button" class="tp-icon-btn" data-tp-ch-edit-tags="${escapeHtml(ch.id)}" title="${escapeHtml(t('channel.tagsTitle', lang))}">🏷️</button>
                      <button type="button" class="tp-icon-btn tp-danger" data-tp-ch-remove="${escapeHtml(ch.id)}" title="${escapeHtml(t('common.remove', lang))}">🗑</button>
                    </div>
                  </div>`;
              })
              .join('')
      }
    </div>
  `;
}

/* ============================================================================
 * 6. COMMUNITY POSTS TAB (GRACEFUL FETCHER & RENDERER)
 * ========================================================================== */

/**
 * Recursively extract `backstagePostRenderer` objects from parsed ytInitialData.
 * @param {any} node
 * @param {any[]} out
 * @param {number} [depth=0]
 */
function collectCommunityPostRenderers(node, out, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 25) return;
  if (node.backstagePostRenderer) {
    out.push(node.backstagePostRenderer);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectCommunityPostRenderers(item, out, depth + 1);
    return;
  }
  for (const val of Object.values(node)) {
    if (val && typeof val === 'object') {
      collectCommunityPostRenderers(val, out, depth + 1);
    }
  }
}

/**
 * Extract plain text from a YouTube runs/simpleText object.
 * @param {any} obj
 * @returns {string}
 */
function extractYtText(obj) {
  if (!obj) return '';
  if (typeof obj === 'string') return obj;
  if (typeof obj.simpleText === 'string') return obj.simpleText;
  if (Array.isArray(obj.runs)) return obj.runs.map((r) => r.text || '').join('');
  return '';
}

/**
 * Fetch and parse recent community posts for a single channel (same-origin on youtube.com).
 * @param {import('../shared/types.js').Channel} channel
 * @returns {Promise<any[]>}
 */
async function fetchChannelCommunityPosts(channel) {
  const base = channel.id?.startsWith('UC')
    ? `https://www.youtube.com/channel/${encodeURIComponent(channel.id)}`
    : channel.url?.replace(/\/+$/, '');
  if (!base) return [];

  try {
    const res = await fetch(`${base}/posts`, { credentials: 'include' });
    if (!res.ok) return [];
    const html = await res.text();

    const dataMatch =
      html.match(/var\s+ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/) ||
      html.match(/window\["ytInitialData"\]\s*=\s*(\{[\s\S]*?\});/);
    if (!dataMatch) return [];

    const initialData = JSON.parse(dataMatch[1]);
    const renderers = [];
    collectCommunityPostRenderers(initialData, renderers);

    return renderers.slice(0, 4).map((r) => {
      const postId = r.postId || '';
      const text = extractYtText(r.contentText);
      const publishedText = extractYtText(r.publishedTimeText);
      const likes = extractYtText(r.voteCount);
      const imgThumbs =
        r.backstageAttachment?.backstageImageRenderer?.image?.thumbnails ||
        r.backstageAttachment?.postMultiImageRenderer?.images?.[0]?.backstageImageRenderer?.image
          ?.thumbnails ||
        [];
      const imageUrl = imgThumbs.length > 0 ? imgThumbs[imgThumbs.length - 1].url : '';
      const postUrl = postId
        ? `https://www.youtube.com/post/${encodeURIComponent(postId)}`
        : `${base}/posts`;

      return {
        postId: postId || `${channel.id}_${publishedText}`,
        channelId: channel.id,
        channelTitle: channel.title,
        channelAvatar: channel.avatarUrl || '',
        channelPostsUrl: `${base}/posts`,
        text,
        publishedText,
        likes,
        imageUrl,
        postUrl,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Load community posts for channels in the selected group (or all channels), cached 5 min.
 * @param {boolean} [forceRefresh=false]
 */
async function loadCommunityPosts(forceRefresh = false) {
  const state = stateNow();
  if (!state) return;

  const cacheKey = modalState.communityGroupId || 'all';
  const cached = communityCache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < COMMUNITY_CACHE_TTL_MS) {
    modalState.communityPosts = cached.posts;
    modalState.communityLoading = false;
    renderManagerModal();
    return;
  }

  const channels =
    cacheKey === 'all'
      ? Object.values(state.channels || {})
      : getChannelsByGroup(state, cacheKey, { includeDescendants: true });

  modalState.communityLoading = true;
  modalState.communityError = '';
  renderManagerModal();

  const targets = channels.slice(0, 12);
  const posts = [];

  for (let i = 0; i < targets.length; i += 3) {
    const batch = targets.slice(i, i + 3);
    const batchResults = await Promise.all(batch.map((ch) => fetchChannelCommunityPosts(ch)));
    for (const list of batchResults) posts.push(...list);
  }

  communityCache.set(cacheKey, { fetchedAt: Date.now(), posts });
  modalState.communityPosts = posts;
  modalState.communityLoading = false;
  renderManagerModal();
}

/**
 * Render the Community tab inside the Manager Modal.
 * @param {import('../shared/types.js').AppState} state
 * @param {string} lang
 * @returns {string}
 */
function renderCommunityTab(state, lang) {
  const subGroups = Object.values(state.groups || {})
    .filter((g) => g.kind === GROUP_KINDS.SUBSCRIPTION)
    .sort((a, b) => a.name.localeCompare(b.name));

  const channelsInScope =
    modalState.communityGroupId === 'all'
      ? Object.values(state.channels || {})
      : getChannelsByGroup(state, modalState.communityGroupId, { includeDescendants: true });

  const postsHtml = modalState.communityLoading
    ? `<div class="tp-empty-state">${escapeHtml(t('common.loading', lang))}</div>`
    : modalState.communityPosts.length > 0
      ? `<div class="tp-community-list">
          ${modalState.communityPosts
            .map(
              (p) => `
            <article class="tp-card tp-community-card">
              <div class="tp-community-head">
                ${
                  p.channelAvatar
                    ? `<img class="tp-ch-avatar" src="${escapeHtml(p.channelAvatar)}" alt="" />`
                    : `<div class="tp-ch-avatar tp-ch-avatar-fallback">${escapeHtml((p.channelTitle || '?')[0].toUpperCase())}</div>`
                }
                <div class="tp-community-meta">
                  <strong>${escapeHtml(p.channelTitle)}</strong>
                  <span class="tp-muted tp-xs">${escapeHtml(p.publishedText || '')}</span>
                </div>
                <a class="tp-btn tp-btn-xs" href="${escapeHtml(p.postUrl)}" target="_blank" rel="noopener">
                  ↗ ${escapeHtml(lang === 'pt-BR' ? 'Abrir Post' : 'Open Post')}
                </a>
              </div>
              <p class="tp-community-text">${escapeHtml(p.text || '')}</p>
              ${p.imageUrl ? `<img class="tp-community-img" src="${escapeHtml(p.imageUrl)}" alt="" loading="lazy" />` : ''}
              ${p.likes ? `<div class="tp-muted tp-xs">👍 ${escapeHtml(p.likes)}</div>` : ''}
            </article>`
            )
            .join('')}
        </div>`
      : `<div class="tp-empty-state">
          <p>${escapeHtml(lang === 'pt-BR' ? 'Nenhuma postagem da comunidade carregada.' : 'No community posts loaded.')}</p>
          ${
            channelsInScope.length > 0
              ? `<div class="tp-community-links">
                  ${channelsInScope
                    .slice(0, 12)
                    .map(
                      (ch) =>
                        `<a class="tp-pill tp-pill-xs" href="${escapeHtml((ch.url || '').replace(/\/+$/, ''))}/posts" target="_blank" rel="noopener">${escapeHtml(ch.title)} ↗</a>`
                    )
                    .join('')}
                </div>`
              : `<p class="tp-muted tp-small">${escapeHtml(lang === 'pt-BR' ? 'Importe seus canais na aba Canais primeiro.' : 'Import your channels in the Channels tab first.')}</p>`
          }
        </div>`;

  return `
    <div class="tp-tab-toolbar">
      <select class="tp-select tp-select-sm" data-tp-comm-group="1">
        <option value="all" ${modalState.communityGroupId === 'all' ? 'selected' : ''}>${escapeHtml(t('common.all', lang))}</option>
        ${subGroups
          .map(
            (g) =>
              `<option value="${escapeHtml(g.id)}" ${modalState.communityGroupId === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`
          )
          .join('')}
      </select>
      <button type="button" class="tp-btn tp-btn-primary tp-btn-sm" data-tp-comm-refresh="1">
        ↻ ${escapeHtml(t('common.refresh', lang))}
      </button>
    </div>
    ${postsHtml}
  `;
}

/**
 * Render the Full Manager Modal DOM and bind delegated events.
 */
function renderManagerModal() {
  const existing = document.getElementById(MANAGER_MODAL_ID);
  if (!modalState.open) {
    if (existing) existing.remove();
    return;
  }

  const state = stateNow();
  if (!state) return;
  const lang = state.settings?.language || 'pt-BR';

  let backdrop = existing;
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = MANAGER_MODAL_ID;
    document.body.appendChild(backdrop);
  }

  backdrop.className = `tp-modal-backdrop ${getThemeClass(state)}`;

  const tabBody =
    modalState.tab === 'playlists'
      ? renderPlaylistsTab(state, lang)
      : modalState.tab === 'channels'
        ? renderChannelsTab(state, lang)
        : modalState.tab === 'community'
          ? renderCommunityTab(state, lang)
          : renderGroupsTab(state, lang);

  const tabGroupsLabel = t('sidebar.subscriptionGroups', lang);
  const tabPlaylistsLabel = t('playlists.title', lang) || 'Playlists';
  const tabChannelsLabel = t('channels.title', lang) || (lang === 'en' ? 'Channels' : 'Canais');
  const tabCommunityLabel = t('community.title', lang) || (lang === 'en' ? 'Community' : 'Comunidade');
  const modalLogoSvg = `<svg class="tp-brand-svg" viewBox="0 0 32 32" width="20" height="20" aria-hidden="true"><defs><linearGradient id="tpModGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#ff4d6d"/><stop offset="55%" stop-color="#ef233c"/><stop offset="100%" stop-color="#6366f1"/></linearGradient></defs><rect x="1.5" y="1.5" width="29" height="29" rx="8" fill="url(#tpModGrad)"/><rect x="6" y="7" width="3" height="14" rx="1.5" fill="rgba(255,255,255,0.9)"/><path d="M13 8.8 L24 14.5 L13 20.2 Z" fill="#ffffff"/><rect x="6" y="23" width="20" height="2.4" rx="1.2" fill="rgba(255,255,255,0.85)"/></svg>`;

  backdrop.innerHTML = `
    <div class="tp-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(BRAND_NAME)} Manager">
      <header class="tp-modal-header">
        <div class="tp-modal-brand">
          ${modalLogoSvg}
          <strong>${escapeHtml(BRAND_NAME)}</strong>
          <nav class="tp-modal-tabs">
            <button type="button" class="tp-tab-btn ${modalState.tab === 'groups' ? 'tp-tab-active' : ''}" data-tp-tab="groups">🗂️ ${escapeHtml(tabGroupsLabel)}</button>
            <button type="button" class="tp-tab-btn ${modalState.tab === 'playlists' ? 'tp-tab-active' : ''}" data-tp-tab="playlists">🎵 ${escapeHtml(tabPlaylistsLabel)}</button>
            <button type="button" class="tp-tab-btn ${modalState.tab === 'channels' ? 'tp-tab-active' : ''}" data-tp-tab="channels">📺 ${escapeHtml(tabChannelsLabel)} (${Object.keys(state.channels || {}).length})</button>
            <button type="button" class="tp-tab-btn ${modalState.tab === 'community' ? 'tp-tab-active' : ''}" data-tp-tab="community">💬 ${escapeHtml(tabCommunityLabel)}</button>
          </nav>
        </div>
        <button type="button" class="tp-icon-btn" data-tp-modal-close="1" aria-label="Close">✕</button>
      </header>
      <div class="tp-modal-body">
        ${tabBody}
      </div>
    </div>
  `;

  if (backdrop.dataset.tpBound !== '1') {
    backdrop.dataset.tpBound = '1';
    bindManagerModalEvents(backdrop);
  }
}

/**
 * Attach delegated event listeners for all Manager Modal interactions.
 * @param {HTMLElement} backdrop
 */
function bindManagerModalEvents(backdrop) {
  backdrop.addEventListener('click', async (e) => {
    const target = /** @type {HTMLElement | null} */ (e.target instanceof Element ? e.target : null);
    if (!target) return;

    if (target === backdrop || target.closest('[data-tp-modal-close]')) {
      closeManagerModal();
      return;
    }

    const st = stateNow();
    const lang = st?.settings?.language || 'pt-BR';

    // Switch tab
    const tabBtn = target.closest('[data-tp-tab]');
    if (tabBtn) {
      modalState.tab = tabBtn.getAttribute('data-tp-tab') || 'groups';
      renderManagerModal();
      if (modalState.tab === 'community' && modalState.communityPosts.length === 0 && !modalState.communityLoading) {
        loadCommunityPosts(false);
      }
      return;
    }

    // ---- GROUPS TAB ACTIONS ----
    const newGrpBtn = target.closest('[data-tp-grp-new]');
    if (newGrpBtn) {
      modalState.showGroupForm = true;
      modalState.editingGroupId = null;
      modalState.groupFormKind = GROUP_KINDS.SUBSCRIPTION;
      modalState.groupFormName = '';
      modalState.groupFormParentId = '';
      modalState.groupFormColor = DEFAULT_GROUP_COLORS[0];
      modalState.groupFormIcon = { type: 'emoji', value: '📁' };
      renderManagerModal();
      return;
    }

    const editGrpBtn = target.closest('[data-tp-grp-edit]');
    if (editGrpBtn) {
      const gid = editGrpBtn.getAttribute('data-tp-grp-edit');
      const g = st?.groups?.[gid];
      if (g) {
        modalState.showGroupForm = true;
        modalState.editingGroupId = g.id;
        modalState.groupFormKind = GROUP_KINDS.SUBSCRIPTION;
        modalState.groupFormName = g.name;
        modalState.groupFormParentId = '';
        modalState.groupFormColor = g.color || DEFAULT_GROUP_COLORS[0];
        modalState.groupFormIcon = g.icon || { type: 'emoji', value: '📁' };
        renderManagerModal();
      }
      return;
    }

    const moveGrpBtn = target.closest('[data-tp-grp-move]');
    if (moveGrpBtn) {
      const gid = moveGrpBtn.getAttribute('data-tp-grp-move');
      const dir = moveGrpBtn.getAttribute('data-tp-dir');
      const g = st?.groups?.[gid];
      if (g) {
        const siblings = Object.values(st.groups)
          .filter((s) => s && s.kind === GROUP_KINDS.SUBSCRIPTION)
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.name || '').localeCompare(b.name || ''));
        const curIdx = siblings.findIndex((s) => s.id === gid);
        const nextIdx = dir === 'up' ? Math.max(0, curIdx - 1) : Math.min(siblings.length - 1, curIdx + 1);
        if (nextIdx !== curIdx) {
          const res = await sendBg(MESSAGE_ACTIONS.MOVE_GROUP, {
            id: gid,
            newParentId: null,
            newOrder: nextIdx,
          });
          if (res?.ok && res.state) {
            applyNewState(res.state);
            renderManagerModal();
          }
        }
      }
      return;
    }

    const delGrpBtn = target.closest('[data-tp-grp-del]');
    if (delGrpBtn) {
      const gid = delGrpBtn.getAttribute('data-tp-grp-del');
      const g = st?.groups?.[gid];
      if (!g) return;
      if (!window.confirm(t('group.deleteConfirm', lang, { name: g.name }))) {
        return;
      }
      const res = await sendBg(MESSAGE_ACTIONS.DELETE_GROUP, { id: gid, options: { mode: 'reparent' } });
      if (res?.ok && res.state) {
        applyNewState(res.state);
        showToast(t('toast.saved', lang), 'success');
        renderManagerModal();
      }
      return;
    }

    const colorBtn = target.closest('[data-tp-pick-color]');
    if (colorBtn) {
      modalState.groupFormColor = colorBtn.getAttribute('data-tp-pick-color') || DEFAULT_GROUP_COLORS[0];
      renderManagerModal();
      return;
    }

    const catBtn = target.closest('[data-tp-icon-cat]');
    if (catBtn) {
      modalState.iconCategory = catBtn.getAttribute('data-tp-icon-cat') || 'all';
      renderManagerModal();
      return;
    }

    const iconBtn = target.closest('[data-tp-pick-icon-id]');
    if (iconBtn) {
      const iconId = iconBtn.getAttribute('data-tp-pick-icon-id');
      const found = searchIcons('', 'all').find((ic) => ic.id === iconId);
      if (found) {
        modalState.groupFormIcon = { type: found.type, value: found.value };
        renderManagerModal();
      }
      return;
    }

    const grpFormBtn = target.closest('[data-tp-grp-form]');
    if (grpFormBtn) {
      const act = grpFormBtn.getAttribute('data-tp-grp-form');
      if (act === 'cancel') {
        modalState.showGroupForm = false;
        renderManagerModal();
      } else if (act === 'save') {
        const name = modalState.groupFormName.trim();
        if (!name) {
          showToast(lang === 'pt-BR' ? 'Digite o nome do grupo.' : 'Enter a group name.', 'warning');
          return;
        }
        let res;
        if (modalState.editingGroupId) {
          res = await sendBg(MESSAGE_ACTIONS.UPDATE_GROUP, {
            id: modalState.editingGroupId,
            patch: {
              name,
              parentId: null,
              color: modalState.groupFormColor,
              icon: modalState.groupFormIcon,
            },
          });
        } else {
          res = await sendBg(MESSAGE_ACTIONS.CREATE_GROUP, {
            group: {
              name,
              kind: GROUP_KINDS.SUBSCRIPTION,
              parentId: null,
              color: modalState.groupFormColor,
              icon: modalState.groupFormIcon,
            },
          });
        }
        if (res?.ok && res.state) {
          applyNewState(res.state);
          modalState.showGroupForm = false;
          showToast(t('toast.saved', lang), 'success');
          renderManagerModal();
        } else if (res?.error) {
          showToast(t('toast.error', lang, { message: res.error }), 'error');
        }
      }
      return;
    }

    // ---- PLAYLISTS TAB ACTIONS (identical flow to Groups) ----
    const newPlBtn = target.closest('[data-tp-pl-new]');
    if (newPlBtn) {
      modalState.showPlaylistForm = true;
      modalState.editingPlaylistId = null;
      modalState.groupFormName = '';
      modalState.groupFormColor = DEFAULT_GROUP_COLORS[0];
      modalState.groupFormIcon = { type: 'emoji', value: '🎵' };
      modalState.iconSearch = '';
      modalState.iconCategory = 'all';
      renderManagerModal();
      return;
    }

    const editPlBtn = target.closest('[data-tp-pl-edit]');
    if (editPlBtn) {
      const pid = editPlBtn.getAttribute('data-tp-pl-edit');
      const pl = st?.playlists?.[pid];
      if (pl) {
        modalState.showPlaylistForm = true;
        modalState.editingPlaylistId = pl.id;
        modalState.groupFormName = pl.title || '';
        modalState.groupFormColor = pl.color || DEFAULT_GROUP_COLORS[0];
        if (pl.customThumbnailUrl) {
          modalState.groupFormIcon = { type: 'custom', value: pl.customThumbnailUrl };
        } else if (pl.icon && typeof pl.icon === 'object' && pl.icon.type && pl.icon.value) {
          modalState.groupFormIcon = pl.icon;
        } else if (typeof pl.icon === 'string' && pl.icon) {
          modalState.groupFormIcon = { type: 'emoji', value: pl.icon };
        } else {
          modalState.groupFormIcon = { type: 'emoji', value: '🎵' };
        }
        renderManagerModal();
      }
      return;
    }

    const delPlBtn = target.closest('[data-tp-pl-del]');
    if (delPlBtn) {
      const pid = delPlBtn.getAttribute('data-tp-pl-del');
      const pl = st?.playlists?.[pid];
      if (!pl || !pl.isCustom) return;
      if (!window.confirm(t('group.deleteConfirm', lang, { name: pl.title || pl.id }))) {
        return;
      }
      const res = await sendBg(MESSAGE_ACTIONS.REMOVE_PLAYLIST, { id: pid });
      if (res?.ok && res.state) {
        applyNewState(res.state);
        showToast(t('toast.saved', lang), 'success');
        renderManagerModal();
      }
      return;
    }

    const plFormBtn = target.closest('[data-tp-pl-form]');
    if (plFormBtn) {
      const act = plFormBtn.getAttribute('data-tp-pl-form');
      if (act === 'cancel') {
        modalState.showPlaylistForm = false;
        renderManagerModal();
      } else if (act === 'save') {
        const title = modalState.groupFormName.trim();
        if (!title) {
          showToast(lang === 'en' ? 'Enter a playlist name.' : 'Digite o nome da playlist.', 'warning');
          return;
        }
        const isCustomImg = modalState.groupFormIcon?.type === 'custom' && modalState.groupFormIcon?.value;
        let res;
        if (modalState.editingPlaylistId) {
          res = await sendBg(MESSAGE_ACTIONS.CUSTOMIZE_PLAYLIST, {
            id: modalState.editingPlaylistId,
            playlistId: modalState.editingPlaylistId,
            title,
            color: modalState.groupFormColor,
            icon: modalState.groupFormIcon,
            customThumbnailUrl: isCustomImg ? modalState.groupFormIcon.value : '',
          });
        } else {
          const newId = createId('pl');
          res = await sendBg(MESSAGE_ACTIONS.UPSERT_PLAYLISTS, {
            playlists: [
              {
                id: newId,
                title,
                isCustom: true,
                color: modalState.groupFormColor,
                icon: modalState.groupFormIcon,
                customThumbnailUrl: isCustomImg ? modalState.groupFormIcon.value : '',
                videos: [],
                videoCount: 0,
                watchedCount: 0,
                groupIds: [],
                thumbnailUrl: '',
                updatedAt: Date.now(),
              },
            ],
          });
        }
        if (res?.ok && res.state) {
          applyNewState(res.state);
          modalState.showPlaylistForm = false;
          showToast(t('toast.saved', lang), 'success');
          renderManagerModal();
        } else if (res?.error) {
          showToast(t('toast.error', lang, { message: res.error }), 'error');
        }
      }
      return;
    }

    // ---- CHANNELS TAB ACTIONS ----
    const statusFilterBtn = target.closest('[data-tp-status-filter]');
    if (statusFilterBtn) {
      modalState.channelStatusFilter = statusFilterBtn.getAttribute('data-tp-status-filter') || 'all';
      renderManagerModal();
      return;
    }

    const tagModeBtn = target.closest('[data-tp-tag-mode]');
    if (tagModeBtn) {
      modalState.tagFilterMode = tagModeBtn.getAttribute('data-tp-tag-mode') || 'includeAll';
      renderManagerModal();
      return;
    }

    const toggleTagBtn = target.closest('[data-tp-toggle-tag]');
    if (toggleTagBtn) {
      const tag = toggleTagBtn.getAttribute('data-tp-toggle-tag');
      if (tag) {
        const modeKey =
          modalState.tagFilterMode === 'includeAny'
            ? 'tagIncludeAny'
            : modalState.tagFilterMode === 'exclude'
              ? 'tagExclude'
              : 'tagIncludeAll';
        const alreadyInActive = modalState[modeKey].includes(tag);
        // Remove from all buckets first
        modalState.tagIncludeAll = modalState.tagIncludeAll.filter((x) => x !== tag);
        modalState.tagIncludeAny = modalState.tagIncludeAny.filter((x) => x !== tag);
        modalState.tagExclude = modalState.tagExclude.filter((x) => x !== tag);
        if (!alreadyInActive) {
          modalState[modeKey] = [...modalState[modeKey], tag];
        }
        renderManagerModal();
      }
      return;
    }

    const editTagsBtn = target.closest('[data-tp-ch-edit-tags]');
    if (editTagsBtn) {
      const cid = editTagsBtn.getAttribute('data-tp-ch-edit-tags');
      modalState.editingChannelTagsId = modalState.editingChannelTagsId === cid ? null : cid;
      renderManagerModal();
      return;
    }

    if (target.closest('[data-tp-ch-close-tags]')) {
      modalState.editingChannelTagsId = null;
      renderManagerModal();
      return;
    }

    const addTagBtn = target.closest('[data-tp-ch-add-tag]');
    if (addTagBtn) {
      const cid = addTagBtn.getAttribute('data-tp-ch-add-tag');
      const input = /** @type {HTMLInputElement | null} */ (
        backdrop.querySelector(`input[data-tp-ch-tag-input="${CSS.escape(cid)}"]`)
      );
      const val = (input?.value || '').trim();
      const ch = st?.channels?.[cid];
      if (ch && val) {
        const nextTags = [...new Set([...(ch.tags || []), val])];
        const res = await sendBg(MESSAGE_ACTIONS.SET_CHANNEL_TAGS, { channelId: cid, tags: nextTags });
        if (res?.ok && res.state) {
          applyNewState(res.state);
          renderManagerModal();
        }
      }
      return;
    }

    const rmTagBtn = target.closest('[data-tp-ch-rm-tag]');
    if (rmTagBtn) {
      const cid = rmTagBtn.getAttribute('data-tp-ch-rm-tag');
      const tag = rmTagBtn.getAttribute('data-tp-tag');
      const ch = st?.channels?.[cid];
      if (ch && tag) {
        const nextTags = (ch.tags || []).filter((x) => x !== tag);
        const res = await sendBg(MESSAGE_ACTIONS.SET_CHANNEL_TAGS, { channelId: cid, tags: nextTags });
        if (res?.ok && res.state) {
          applyNewState(res.state);
          renderManagerModal();
        }
      }
      return;
    }

    const rmChBtn = target.closest('[data-tp-ch-remove]');
    if (rmChBtn) {
      const cid = rmChBtn.getAttribute('data-tp-ch-remove');
      const res = await sendBg(MESSAGE_ACTIONS.REMOVE_CHANNEL, { channelId: cid });
      if (res?.ok && res.state) {
        modalState.selectedChannelIds.delete(cid);
        applyNewState(res.state);
        renderManagerModal();
      }
      return;
    }

    const chActionBtn = target.closest('[data-tp-ch-action]');
    if (chActionBtn) {
      const act = chActionBtn.getAttribute('data-tp-ch-action');
      await handleChannelsAction(act, backdrop, st, lang);
      return;
    }

    // ---- COMMUNITY TAB ACTIONS ----
    if (target.closest('[data-tp-comm-refresh]')) {
      await loadCommunityPosts(true);
    }
  });

  backdrop.addEventListener('change', async (e) => {
    const target = /** @type {HTMLInputElement | HTMLSelectElement} */ (e.target);
    if (!target) return;

    // Custom icon file upload
    if (target.id === 'tp-custom-icon-upload' && target.files?.[0]) {
      try {
        const dataUrl = await resizeImageToDataUrl(target.files[0], 64);
        modalState.groupFormIcon = { type: 'custom', value: dataUrl };
        renderManagerModal();
      } catch (err) {
        showToast(err?.message || 'Failed to load image.', 'error');
      }
      return;
    }

    // Group form selects / color
    const grpKey = target.getAttribute('data-tp-grp-input');
    if (grpKey) {
      modalState[grpKey] = target.value;
      if (grpKey === 'groupFormKind') {
        modalState.groupFormParentId = '';
      }
      renderManagerModal();
      return;
    }

    // Channel group filter select
    const chFilter = target.getAttribute('data-tp-ch-filter');
    if (chFilter) {
      modalState[chFilter] = target.value;
      renderManagerModal();
      return;
    }

    // Channel checkbox selection
    const chSel = target.getAttribute('data-tp-ch-select');
    if (chSel) {
      if (target.checked) modalState.selectedChannelIds.add(chSel);
      else modalState.selectedChannelIds.delete(chSel);
      renderManagerModal();
      return;
    }

    // Select all visible channels
    if (target.getAttribute('data-tp-ch-action') === 'toggle-select-all') {
      const checkboxes = backdrop.querySelectorAll('input[data-tp-ch-select]');
      for (const cb of checkboxes) {
        const cid = cb.getAttribute('data-tp-ch-select');
        if (!cid) continue;
        if (target.checked) modalState.selectedChannelIds.add(cid);
        else modalState.selectedChannelIds.delete(cid);
      }
      renderManagerModal();
      return;
    }

    // Community group select
    if (target.hasAttribute('data-tp-comm-group')) {
      modalState.communityGroupId = target.value || 'all';
      await loadCommunityPosts(false);
    }
  });

  backdrop.addEventListener('input', (e) => {
    const target = /** @type {HTMLInputElement} */ (e.target);
    if (!target) return;

    const grpKey = target.getAttribute('data-tp-grp-input');
    if (grpKey === 'groupFormName') {
      modalState.groupFormName = target.value;
      return;
    }
    if (grpKey === 'iconSearch') {
      modalState.iconSearch = target.value;
      renderManagerModal();
      const searchEl = backdrop.querySelector('input[data-tp-grp-input="iconSearch"]');
      if (searchEl instanceof HTMLInputElement) {
        searchEl.focus();
        searchEl.setSelectionRange(searchEl.value.length, searchEl.value.length);
      }
      return;
    }

    const chFilter = target.getAttribute('data-tp-ch-filter');
    if (chFilter === 'channelSearch') {
      modalState.channelSearch = target.value;
      renderManagerModal();
      const searchEl = backdrop.querySelector('input[data-tp-ch-filter="channelSearch"]');
      if (searchEl instanceof HTMLInputElement) {
        searchEl.focus();
        searchEl.setSelectionRange(searchEl.value.length, searchEl.value.length);
      }
    }
  });

  backdrop.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') {
      closeManagerModal();
      return;
    }
    const target = /** @type {HTMLInputElement} */ (e.target);
    if (e.key === 'Enter' && target?.hasAttribute?.('data-tp-ch-tag-input')) {
      e.preventDefault();
      const cid = target.getAttribute('data-tp-ch-tag-input');
      const val = target.value.trim();
      const st = stateNow();
      const ch = st?.channels?.[cid];
      if (ch && val) {
        const nextTags = [...new Set([...(ch.tags || []), val])];
        const res = await sendBg(MESSAGE_ACTIONS.SET_CHANNEL_TAGS, { channelId: cid, tags: nextTags });
        if (res?.ok && res.state) {
          applyNewState(res.state);
          renderManagerModal();
        }
      }
    }
  });
}

/**
 * Execute toolbar and bulk actions on the Channels tab.
 * @param {string} act
 * @param {HTMLElement} backdrop
 * @param {import('../shared/types.js').AppState | null} st
 * @param {string} lang
 */
async function handleChannelsAction(act, backdrop, st, lang) {
  if (act === 'sync-youtube') {
    const scraped = scrapeSidebarSubscriptions();
    if (scraped.length === 0) {
      showToast(
        lang === 'pt-BR'
          ? 'Abra o menu lateral do YouTube ou /feed/channels para sincronizar inscrições.'
          : 'Open YouTube sidebar or /feed/channels to sync subscriptions.',
        'warning'
      );
      return;
    }
    const res = await sendBg(MESSAGE_ACTIONS.UPSERT_CHANNELS, { channels: scraped });
    if (res?.ok && res.state) {
      applyNewState(res.state);
      showToast(t('toast.synced', lang, { count: scraped.length }), 'success');
      renderManagerModal();
    }
    return;
  }

  if (act === 'auto-tag-all') {
    const res = await sendBg(MESSAGE_ACTIONS.AUTO_TAG_CHANNELS);
    if (res?.ok && res.state) {
      applyNewState(res.state);
      showToast(t('toast.saved', lang), 'success');
      renderManagerModal();
    } else if (st) {
      // Local fallback preview using tagAllChannels
      const tagged = tagAllChannels(st.channels);
      applyNewState({ ...st, channels: tagged });
      renderManagerModal();
    }
    return;
  }

  if (act === 'refresh-statuses') {
    showToast(t('common.loading', lang), 'info');
    const res = await sendBg(MESSAGE_ACTIONS.REFRESH_CHANNEL_STATUSES, { forceRefresh: true });
    if (res?.ok && res.state) {
      applyNewState(res.state);
      showToast(t('toast.synced', lang, { count: res.refreshedCount || 0 }), 'success');
      renderManagerModal();
    }
    return;
  }

  if (act === 'toggle-thresholds') {
    modalState.showThresholdEditor = !modalState.showThresholdEditor;
    renderManagerModal();
    return;
  }

  if (act === 'save-thresholds') {
    const activeDays = Math.max(
      1,
      parseInt(/** @type {HTMLInputElement} */ (backdrop.querySelector('#tp-cfg-activeDays'))?.value || '14', 10)
    );
    const slowDays = Math.max(
      activeDays + 1,
      parseInt(/** @type {HTMLInputElement} */ (backdrop.querySelector('#tp-cfg-slowDays'))?.value || '60', 10)
    );
    const inactiveDays = Math.max(
      slowDays + 1,
      parseInt(/** @type {HTMLInputElement} */ (backdrop.querySelector('#tp-cfg-inactiveDays'))?.value || '180', 10)
    );
    const res = await sendBg(MESSAGE_ACTIONS.UPDATE_SETTINGS, {
      settings: { statusConfig: { activeDays, slowDays, inactiveDays } },
    });
    if (res?.ok && res.state) {
      applyNewState(res.state);
      modalState.showThresholdEditor = false;
      showToast(t('toast.saved', lang), 'success');
      renderManagerModal();
    }
    return;
  }

  if (act === 'export-csv') {
    const res = await sendBg(MESSAGE_ACTIONS.EXPORT_CSV);
    const csv = res?.ok && res.csv ? res.csv : exportChannelsCsv(st?.channels || {}, st?.groups || {});
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${BRAND_NAME.toLowerCase()}-channels-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast(t('toast.exported', lang), 'success');
    return;
  }

  if (act === 'clear-tag-filters') {
    modalState.tagIncludeAll = [];
    modalState.tagIncludeAny = [];
    modalState.tagExclude = [];
    renderManagerModal();
    return;
  }

  if (act === 'clear-selection') {
    modalState.selectedChannelIds.clear();
    modalState.showUnsubHelper = false;
    renderManagerModal();
    return;
  }

  if (act === 'bulk-add-group' || act === 'bulk-rm-group') {
    const select = /** @type {HTMLSelectElement | null} */ (backdrop.querySelector('#tp-bulk-group-select'));
    const groupId = select?.value;
    if (!groupId) {
      showToast(lang === 'pt-BR' ? 'Selecione um grupo.' : 'Select a group.', 'warning');
      return;
    }
    const res = await sendBg(MESSAGE_ACTIONS.BULK_ASSIGN_CHANNELS, {
      channelIds: Array.from(modalState.selectedChannelIds),
      groupId,
      mode: act === 'bulk-rm-group' ? 'remove' : 'add',
    });
    if (res?.ok && res.state) {
      applyNewState(res.state);
      showToast(t('toast.saved', lang), 'success');
      renderManagerModal();
    }
    return;
  }

  if (act === 'open-unsub-helper') {
    modalState.showUnsubHelper = true;
    renderManagerModal();
    return;
  }

  if (act === 'close-unsub-helper') {
    modalState.showUnsubHelper = false;
    renderManagerModal();
    return;
  }

  if (act === 'open-selected-channels') {
    const ids = Array.from(modalState.selectedChannelIds).slice(0, 5);
    for (const cid of ids) {
      const ch = st?.channels?.[cid];
      if (ch?.url) window.open(ch.url, '_blank', 'noopener');
    }
    return;
  }

  if (act === 'remove-selected-channels') {
    const ids = Array.from(modalState.selectedChannelIds);
    let latestState = st;
    for (const cid of ids) {
      const res = await sendBg(MESSAGE_ACTIONS.REMOVE_CHANNEL, { channelId: cid });
      if (res?.ok && res.state) latestState = res.state;
    }
    modalState.selectedChannelIds.clear();
    modalState.showUnsubHelper = false;
    applyNewState(latestState);
    showToast(t('toast.saved', lang), 'success');
    renderManagerModal();
  }
}

/* ============================================================================
 * 7. PUBLIC LIFECYCLE EXPORTS
 * ========================================================================== */

/**
 * Attach a scoped MutationObserver ONLY to `ytd-page-manager` / `#page-manager`
 * (never `document.body`) to detect infinite-scroll video cards with minimal CPU/RAM.
 */
function attachPageManagerObserver() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;

  const target =
    document.querySelector('ytd-page-manager') || document.getElementById('page-manager');

  if (!target) {
    if (pageManagerAttachAttempts < 25 && !pageManagerAttachTimer) {
      pageManagerAttachAttempts += 1;
      pageManagerAttachTimer = setTimeout(() => {
        pageManagerAttachTimer = null;
        attachPageManagerObserver();
      }, 300);
    }
    return;
  }

  pageManagerAttachAttempts = 0;
  if (observedPageManager === target && cardObserver) return;

  if (cardObserver) {
    cardObserver.disconnect();
  }

  observedPageManager = target;
  cardObserver = new MutationObserver(() => {
    scheduleCardScan();
  });
  cardObserver.observe(target, {
    childList: true,
    subtree: true,
  });
}

/**
 * Initialize the Subscription Manager module.
 * @param {{ getState?: () => import('../shared/types.js').AppState, onStateChange?: (state: any) => void, onOpenDeck?: () => void }} opts
 */
export function initSubscriptions(opts = {}) {
  hooks = { ...opts };
  localState = hooks.getState?.() || localState;

  bindWatchedToggleDelegation();

  if (localState) {
    refreshSubscriptionsUI(localState);
  }

  attachPageManagerObserver();
}

/**
 * Handle YouTube SPA navigation updates.
 * @param {ReturnType<typeof getPageContext>} pageContext
 * @param {import('../shared/types.js').AppState} state
 */
export function onSubscriptionsNavigate(pageContext, state) {
  localState = state || localState;
  const st = stateNow();
  if (!st) return;

  if (!observedPageManager || !observedPageManager.isConnected) {
    attachPageManagerObserver();
  }

  toggleFocusModeCss(Boolean(st.settings?.focusMode));

  if (pageContext?.type === 'subscriptions') {
    ensureSubFeedToolbar(st);
    applySubFeedFiltersAndSort(st);
  } else {
    lastSubToolbarSig = '';
    document.getElementById(SUB_TOOLBAR_ID)?.remove();
  }

  if (pageContext?.type === 'channel') {
    ensureChannelPageButton(st);
    // Retry shortly after navigation as YouTube renders channel header asynchronously
    setTimeout(() => ensureChannelPageButton(stateNow()), 600);
  } else {
    document.getElementById(CHANNEL_BTN_ID)?.remove();
    document.getElementById(CHANNEL_POPOVER_ID)?.remove();
  }

  if (pageContext?.type === 'watch') {
    // Close any stale popover from previous video
    document.getElementById(WATCH_CHANNEL_POPOVER_ID)?.remove();
    ensureWatchChannelGroupButton(st);
    // Retry as YouTube hydrates ytd-video-owner-renderer asynchronously after yt-navigate-finish
    setTimeout(() => ensureWatchChannelGroupButton(stateNow()), 400);
    setTimeout(() => ensureWatchChannelGroupButton(stateNow()), 1200);
  } else {
    document.getElementById(WATCH_CHANNEL_BTN_ID)?.remove();
    document.getElementById(WATCH_CHANNEL_POPOVER_ID)?.remove();
  }

  scheduleIdle(() => {
    const cur = stateNow();
    if (cur) enhanceVideoCards(cur, { onlyNew: false });
  });
}

/**
 * Refresh all mounted subscription UI pieces when AppState updates.
 * Does NOT rebuild Manager modal or Group Feed overlay when they are closed.
 * @param {import('../shared/types.js').AppState} state
 */
export function refreshSubscriptionsUI(state) {
  localState = state || localState;
  const st = stateNow();
  if (!st) return;

  toggleFocusModeCss(Boolean(st.settings?.focusMode));

  const nextCardSig = computeCardStateSig(st);
  if (nextCardSig !== lastCardStateSig) {
    lastCardStateSig = nextCardSig;
    enhanceVideoCards(st, { onlyNew: false });
  } else {
    enhanceVideoCards(st, { onlyNew: true });
  }

  const ctx = getPageContext();
  if (ctx.type === 'subscriptions') {
    ensureSubFeedToolbar(st);
    applySubFeedFiltersAndSort(st);
  }
  if (ctx.type === 'channel') {
    ensureChannelPageButton(st);
  }
  if (ctx.type === 'watch') {
    ensureWatchChannelGroupButton(st);
  }
  // Only rebuild overlays/modals when they are actually open
  if (groupFeedState.open) {
    renderGroupFeedOverlay();
  }
  if (modalState.open) {
    renderManagerModal();
  }
}
