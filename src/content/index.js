/**
 * @fileoverview Main YouTube Content Script Entrypoint for TubeNook.
 * Injects scoped stylesheets, loads AppState from the background service worker,
 * initializes Sidebar, Subscriptions, Playlists, Courses, and Deck modules, hooks SPA navigation,
 * listens for runtime messages, and handles global keyboard shortcuts.
 */

import { BRAND_NAME } from '../shared/brand.js';
import { MESSAGE_ACTIONS } from '../shared/types.js';
import {
  sendBg,
  getPageContext,
  onYouTubeNavigate,
  showToast,
  isDarkTheme,
  toggleFocusModeCss,
} from './yt-dom.js';
import { initSidebar, refreshSidebar } from './sidebar.js';
import {
  initSubscriptions,
  onSubscriptionsNavigate,
  openManagerModal,
  openGroupFeed,
  refreshSubscriptionsUI,
} from './subscriptions.js';
import {
  initPlaylists,
  onPlaylistsNavigate,
  openPlaylistGroupView,
  openCustomPlaylistView,
  openPlaylistCustomizeModal,
  refreshPlaylistsUI,
  handlePlaylistShortcut,
} from './playlists.js';
import {
  initDeck,
  openDeckModal,
  closeDeckModal,
  refreshDeck,
} from './deck.js';
import {
  initCourses,
  openCoursesModal,
  openInsightsModal,
  refreshCoursesUI,
} from './courses.js';

const STYLESHEETS = [
  'src/content/styles.css',
  'src/content/styles-sub.css',
  'src/content/styles-playlist.css',
  'src/content/styles-deck.css',
  'src/content/styles-courses.css',
];

/** @type {import('../shared/types.js').AppState | null} */
let currentState = null;
let booted = false;
/** @type {import('../shared/types.js').AppState | null} */
let pendingState = null;
/** @type {number | null} */
let stateRafId = null;

/**
 * Idempotently inject all TubeNook content stylesheets into document.head.
 */
function injectStylesheets() {
  if (typeof document === 'undefined' || !chrome?.runtime?.getURL) return;
  const head = document.head || document.documentElement;
  for (const relPath of STYLESHEETS) {
    const id = `tp-style-${relPath.replace(/[^a-z0-9]/gi, '-')}`;
    if (document.getElementById(id)) continue;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL(relPath);
    head.appendChild(link);
  }
}

/**
 * Sync light/dark helper class on documentElement according to user settings or YouTube theme.
 */
function syncThemeClass(state) {
  if (typeof document === 'undefined') return;
  const theme = state?.settings?.theme || 'auto';
  const dark = theme === 'dark' ? true : theme === 'light' ? false : isDarkTheme();
  document.documentElement.classList.toggle('tp-light', !dark);
}

/**
 * Update local state cache and notify all UI modules.
 * @param {import('../shared/types.js').AppState} nextState
 */
function applyState(nextState) {
  if (!nextState) return;
  currentState = nextState;
  syncThemeClass(currentState);
  toggleFocusModeCss(Boolean(currentState.settings?.focusMode));
  refreshSidebar(currentState);
  refreshSubscriptionsUI(currentState);
  refreshPlaylistsUI(currentState);
  refreshCoursesUI(currentState);
  refreshDeck(currentState);
}

/**
 * Coalesce rapid STATE_UPDATED / mutation updates into a single animation-frame UI sync.
 * Keeps `currentState` synchronously up-to-date for callers while avoiding redundant DOM churn.
 * @param {import('../shared/types.js').AppState} nextState
 */
function scheduleApplyState(nextState) {
  if (!nextState) return;
  currentState = nextState;
  pendingState = nextState;
  if (stateRafId !== null) return;
  const flush = () => {
    stateRafId = null;
    const latest = pendingState;
    pendingState = null;
    if (latest) applyState(latest);
  };
  if (typeof requestAnimationFrame === 'function') {
    stateRafId = requestAnimationFrame(flush);
  } else {
    stateRafId = setTimeout(flush, 16);
  }
}

/**
 * Check whether the user is currently typing in an input, textarea, or contentEditable field.
 * @param {KeyboardEvent} e
 * @returns {boolean}
 */
function isTypingTarget(e) {
  const el = e.target;
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

/**
 * Global keyboard shortcuts handler on YouTube.
 * @param {KeyboardEvent} e
 */
function handleGlobalKeydown(e) {
  if (!currentState?.settings?.keyboardShortcuts) return;
  if (isTypingTarget(e)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (e.shiftKey) {
    const key = e.key.toUpperCase();
    if (key === 'D') {
      e.preventDefault();
      if (document.getElementById('tp-deck-overlay')) {
        closeDeckModal();
      } else {
        openDeckModal();
      }
      return;
    }
    if (key === 'M') {
      e.preventDefault();
      openManagerModal('groups');
      return;
    }
  }

  handlePlaylistShortcut(e, currentState);
}

/**
 * Handle deep-link URL hashes such as #tubenook-deck, #tubenook-manager, #tubenook-courses, #tubenook-insights.
 */
function handleHashIntent() {
  const hash = window.location.hash || '';
  if (hash === '#tubenook-deck' || hash === '#playshelf-deck' || hash === '#tubepocket-deck') {
    openDeckModal();
  } else if (hash === '#tubenook-manager' || hash === '#playshelf-manager' || hash === '#tubepocket-manager') {
    openManagerModal('groups');
  } else if (hash === '#tubenook-courses') {
    openCoursesModal();
  } else if (hash === '#tubenook-insights') {
    openInsightsModal();
  } else if (hash.startsWith('#tubenook-group-')) {
    const groupId = decodeURIComponent(hash.slice('#tubenook-group-'.length));
    if (groupId) openGroupFeed(groupId);
  } else if (hash.startsWith('#playshelf-group-')) {
    const groupId = decodeURIComponent(hash.slice('#playshelf-group-'.length));
    if (groupId) openGroupFeed(groupId);
  } else if (hash.startsWith('#tubepocket-group-')) {
    const groupId = decodeURIComponent(hash.slice('#tubepocket-group-'.length));
    if (groupId) openGroupFeed(groupId);
  } else if (hash.startsWith('#tubenook-playlist-')) {
    const playlistId = decodeURIComponent(hash.slice('#tubenook-playlist-'.length));
    if (playlistId) openCustomPlaylistView(playlistId);
  } else if (hash.startsWith('#playshelf-playlist-')) {
    const playlistId = decodeURIComponent(hash.slice('#playshelf-playlist-'.length));
    if (playlistId) openCustomPlaylistView(playlistId);
  }
}

/**
 * Handle YouTube SPA navigation transitions.
 */
function handleNavigate() {
  if (!currentState) return;
  syncThemeClass(currentState);
  toggleFocusModeCss(Boolean(currentState.settings?.focusMode));
  const ctx = getPageContext();
  onSubscriptionsNavigate(ctx, currentState);
  onPlaylistsNavigate(ctx, currentState);
  handleHashIntent();
}

/**
 * Boot TubeNook on YouTube.
 */
export async function boot() {
  if (booted) return;
  booted = true;

  injectStylesheets();

  const res = await sendBg(MESSAGE_ACTIONS.GET_STATE);
  if (res?.ok && res.state) {
    currentState = res.state;
  }

  const getState = () => currentState;
  const onStateChange = (nextState) => scheduleApplyState(nextState);

  syncThemeClass(currentState);
  toggleFocusModeCss(Boolean(currentState?.settings?.focusMode));

  initSidebar({
    onOpenManager: (tab = 'groups', opts = {}) => openManagerModal(tab, opts),
    onOpenDeck: () => openDeckModal(),
    onSelectSubscriptionGroup: (groupId) => openGroupFeed(groupId),
    onSelectPlaylistGroup: (groupId) => openPlaylistGroupView(groupId),
    onOpenCustomPlaylist: (playlistId) => openCustomPlaylistView(playlistId),
    onCustomizePlaylist: (playlistId) => openPlaylistCustomizeModal(playlistId),
    onOpenCourses: () => openCoursesModal(),
    onOpenInsights: () => openInsightsModal(),
  });

  initSubscriptions({
    getState,
    onStateChange,
    onOpenDeck: () => openDeckModal(),
  });

  initPlaylists({
    getState,
    onStateChange,
  });

  initCourses({
    getState,
    onStateChange,
  });

  initDeck({
    getState,
    onStateChange,
  });

  if (currentState) {
    refreshSidebar(currentState);
    refreshSubscriptionsUI(currentState);
    refreshPlaylistsUI(currentState);
    refreshCoursesUI(currentState);
    handleNavigate();
  }

  onYouTubeNavigate(() => handleNavigate());
  window.addEventListener('hashchange', handleHashIntent);
  document.addEventListener('keydown', handleGlobalKeydown);

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || !msg.action) return;
      switch (msg.action) {
        case MESSAGE_ACTIONS.STATE_UPDATED:
          if (msg.state) scheduleApplyState(msg.state);
          break;
        case MESSAGE_ACTIONS.OPEN_DECK:
          openDeckModal();
          break;
        case 'OPEN_MANAGER':
          openManagerModal(msg.tab || 'groups', msg.options || {});
          break;
        case 'OPEN_PLAYLIST_GROUP':
          if (msg.groupId) openPlaylistGroupView(msg.groupId);
          break;
        case 'OPEN_CUSTOM_PLAYLIST':
          if (msg.playlistId) openCustomPlaylistView(msg.playlistId);
          break;
        case 'OPEN_COURSES':
          openCoursesModal(msg.courseId || null);
          break;
        case 'OPEN_INSIGHTS':
          openInsightsModal();
          break;
        case MESSAGE_ACTIONS.OPEN_GROUP_IN_YOUTUBE:
          if (msg.groupId) openGroupFeed(msg.groupId);
          break;
        case MESSAGE_ACTIONS.CONTEXT_ADD_CHANNEL:
          openManagerModal('channels', { linkUrl: msg.linkUrl });
          break;
        case MESSAGE_ACTIONS.CONTEXT_TOGGLE_WATCHED: {
          const ctx = getPageContext();
          const targetUrl = msg.linkUrl || window.location.href;
          let videoId = ctx.videoId || '';
          try {
            const u = new URL(targetUrl);
            videoId = u.searchParams.get('v') || (u.pathname.startsWith('/shorts/') ? u.pathname.split('/')[2] : '') || videoId;
          } catch {
            // keep ctx.videoId
          }
          if (videoId) {
            sendBg(MESSAGE_ACTIONS.TOGGLE_WATCHED, { videoId }).then((r) => {
              if (r?.ok && r.state) {
                applyState(r.state);
                showToast(
                  r.watched
                    ? (currentState?.settings?.language === 'en' ? 'Marked as watched' : 'Marcado como assistido')
                    : (currentState?.settings?.language === 'en' ? 'Unmarked watched' : 'Desmarcado como assistido'),
                  'success'
                );
              }
            });
          }
          break;
        }
        default:
          break;
      }
    });
  }
}

// Auto-boot when loaded in a browser page
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  boot().catch((err) => console.error(`[${BRAND_NAME}] Boot error:`, err));
}
