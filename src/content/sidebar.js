/**
 * @fileoverview TubeNook native-looking YouTube Left Sidebar section.
 * Renders compact header actions, a prominent top-level Deck item, and collapsible flat sections:
 *  1. Grupos de Inscrições (flat list + quick create)
 *  2. Listas de reprodução (ALL native + custom TubeNook playlists with custom icon/color/thumb + hover 🎨 customize)
 *  3. Cursos (user courses with % progress pills)
 * Also leaves YouTube's native "Você" (You) section 100% untouched, idempotently reorders
 * native "Inscrições" right after "Você", auto-scrapes native sidebar playlists (debounced),
 * and observes ONLY `ytd-guide-renderer` with memoized render signatures for minimal CPU/RAM.
 */

import { BRAND_NAME } from '../shared/brand.js';
import { GROUP_KINDS, MESSAGE_ACTIONS, createId } from '../shared/types.js';
import { getChannelsByGroup } from '../shared/storage.js';
import { renderIconHtml } from '../shared/icons.js';
import { t } from '../shared/i18n.js';
import {
  escapeHtml,
  isDarkTheme,
  sendBg,
  showToast,
  scrapeSidebarPlaylists,
  debounce,
  scheduleIdle,
} from './yt-dom.js';

const SIDEBAR_SECTION_ID = 'tp-sidebar-section';
const LEGACY_NATIVE_CUSTOM_PL_ID = 'tp-native-custom-playlists';
const SECTION_COLLAPSE_STORAGE_KEY = 'tubenook_sidebar_sections_v1';

/**
 * @type {{
 *   onOpenManager?: Function,
 *   onOpenDeck?: Function,
 *   onSelectSubscriptionGroup?: Function,
 *   onSelectPlaylistGroup?: Function,
 *   onOpenCustomPlaylist?: Function,
 *   onOpenCourses?: Function,
 *   onOpenInsights?: Function,
 *   onCustomizePlaylist?: Function,
 * }}
 */
let callbacks = {};
/** @type {import('../shared/types.js').AppState | null} */
let currentState = null;
/** @type {MutationObserver | null} */
let guideObserver = null;
/** @type {Element | null} */
let observedGuideRoot = null;
let guideAttachTimer = null;
let guideAttachAttempts = 0;
let activeGroupId = null;
let lastRenderSignature = '';

/** Track playlist IDs already auto-scraped in this session so we never upsert duplicates. */
const scrapedPlaylistIds = new Set();
let autoScrapeInFlight = false;

/** @type {{ subs: boolean, playlists: boolean, courses: boolean }} */
let collapsedSections = loadCollapsedSections();

/**
 * Load persisted sidebar section collapse state from localStorage.
 * @returns {{ subs: boolean, playlists: boolean, courses: boolean }}
 */
function loadCollapsedSections() {
  const defaults = { subs: false, playlists: false, courses: false };
  try {
    if (typeof localStorage === 'undefined') return defaults;
    const raw = localStorage.getItem(SECTION_COLLAPSE_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return {
      subs: Boolean(parsed?.subs),
      playlists: Boolean(parsed?.playlists),
      courses: Boolean(parsed?.courses),
    };
  } catch {
    return defaults;
  }
}

/**
 * Persist sidebar section collapse state to localStorage.
 */
function saveCollapsedSections() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SECTION_COLLAPSE_STORAGE_KEY, JSON.stringify(collapsedSections));
    }
  } catch {
    // Ignore storage quota or privacy-mode errors
  }
}

/**
 * Resolve effective theme class for TubeNook elements.
 * @param {import('../shared/types.js').AppState | null} state
 * @returns {'tp-theme-dark' | 'tp-theme-light'}
 */
function getThemeClass(state) {
  const pref = state?.settings?.theme || 'auto';
  if (pref === 'dark') return 'tp-theme-dark';
  if (pref === 'light') return 'tp-theme-light';
  return isDarkTheme() ? 'tp-theme-dark' : 'tp-theme-light';
}

/**
 * Get flat sorted subscription groups (no subgroups).
 * @param {import('../shared/types.js').AppState | null} state
 * @returns {import('../shared/types.js').Group[]}
 */
function getFlatSubscriptionGroups(state) {
  return Object.values(state?.groups || {})
    .filter((g) => g && g.kind === GROUP_KINDS.SUBSCRIPTION)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.name || '').localeCompare(b.name || ''));
}

/**
 * Get ALL user playlists (both native YouTube playlists and TubeNook custom playlists),
 * sorted by custom/updatedAt descending then title ascending.
 * @param {import('../shared/types.js').AppState | null} state
 * @returns {import('../shared/types.js').PlaylistRecord[]}
 */
function getAllPlaylists(state) {
  return Object.values(state?.playlists || {})
    .filter((p) => Boolean(p?.id))
    .sort(
      (a, b) =>
        (b.updatedAt || 0) - (a.updatedAt || 0) || (a.title || '').localeCompare(b.title || '')
    );
}

/**
 * Get all courses sorted by most recently updated.
 * @param {import('../shared/types.js').AppState | null} state
 * @returns {import('../shared/types.js').Course[]}
 */
function getSortedCourses(state) {
  return Object.values(state?.courses || {}).sort(
    (a, b) =>
      (b.updatedAt || 0) - (a.updatedAt || 0) || (a.title || '').localeCompare(b.title || '')
  );
}

/**
 * Compute completion percentage for a course.
 * @param {import('../shared/types.js').Course} course
 * @returns {number}
 */
function getCourseProgressPercent(course) {
  const lessons = Array.isArray(course?.lessons) ? course.lessons : [];
  if (lessons.length === 0) return 0;
  const completed = lessons.filter((l) => Boolean(l?.completed)).length;
  return Math.round((completed / lessons.length) * 100);
}

/**
 * Compute a lightweight deterministic signature for sidebar content so we can skip
 * DOM writes completely when nothing relevant has changed.
 * @param {import('../shared/types.js').AppState | null} state
 * @returns {string}
 */
function computeSidebarSignature(state) {
  const themeClass = getThemeClass(state);
  const lang = state?.settings?.language || 'pt-BR';
  const col = `${collapsedSections.subs ? 1 : 0}${collapsedSections.playlists ? 1 : 0}${collapsedSections.courses ? 1 : 0}`;

  const subSig = getFlatSubscriptionGroups(state)
    .map((g) => {
      const count = state ? getChannelsByGroup(state, g.id, { includeDescendants: true }).length : 0;
      const ico = typeof g.icon === 'string' ? g.icon : `${g.icon?.type || ''}:${g.icon?.value || ''}`;
      return `${g.id}|${g.name}|${g.color || ''}|${g.order ?? 0}|${ico}|${count}`;
    })
    .join(';');

  const plSig = getAllPlaylists(state)
    .map((pl) => {
      const count = Array.isArray(pl.videos) ? pl.videos.length : pl.videoCount || 0;
      const ico = typeof pl.icon === 'string' ? pl.icon : `${pl.icon?.type || ''}:${pl.icon?.value || ''}`;
      return `${pl.id}|${pl.title}|${pl.isCustom ? 1 : 0}|${count}|${pl.color || ''}|${ico}|${pl.customThumbnailUrl || ''}|${pl.updatedAt || 0}`;
    })
    .join(';');

  const courseSig = getSortedCourses(state)
    .map((c) => `${c.id}|${c.title}|${getCourseProgressPercent(c)}|${c.updatedAt || 0}`)
    .join(';');

  return `${themeClass}::${lang}::${col}::${activeGroupId || ''}::${subSig}::${plSig}::${courseSig}`;
}

/**
 * Render playlist visual icon/thumbnail for TubeNook's sidebar section.
 * @param {any} pl
 * @returns {string}
 */
function renderPlaylistVisual(pl) {
  if (pl?.customThumbnailUrl) {
    return `<span class="tp-tree-icon tp-tree-icon-pl-thumb" aria-hidden="true"><img class="tp-pl-sb-thumb" src="${escapeHtml(pl.customThumbnailUrl)}" alt="" /></span>`;
  }
  const colorStyle = pl?.color ? ` style="color:${escapeHtml(pl.color)}"` : '';
  if (pl?.icon) {
    if (typeof pl.icon === 'string') {
      return `<span class="tp-tree-icon"${colorStyle} aria-hidden="true">${escapeHtml(pl.icon)}</span>`;
    }
    if (pl.icon.type && pl.icon.value) {
      return `<span class="tp-tree-icon"${colorStyle} aria-hidden="true">${renderIconHtml(pl.icon, 18)}</span>`;
    }
  }
  return `<span class="tp-tree-icon tp-tree-icon-pl"${colorStyle} aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M22 7H2v1h20V7zm-9 5H2v-1h11v1zm0 4H2v-1h11v1zm2 3v-8l7 4-7 4z"></path></svg></span>`;
}

/**
 * Render flat Subscription Groups list items (no subgroups, no nested indentation).
 * @param {import('../shared/types.js').Group[]} groups
 * @param {import('../shared/types.js').AppState | null} state
 * @returns {string}
 */
function renderFlatSubscriptionGroups(groups, state) {
  if (!groups || groups.length === 0) return '';

  return groups
    .map((g) => {
      const count = state ? getChannelsByGroup(state, g.id, { includeDescendants: true }).length : 0;
      const isActive = activeGroupId === g.id;
      const colorStyle = g.color ? `border-left-color:${escapeHtml(g.color)};` : '';

      return `
        <li class="tp-tree-item" data-group-id="${escapeHtml(g.id)}">
          <div class="tp-tree-row tp-flat-row ${isActive ? 'tp-active' : ''}" style="${colorStyle}">
            <button type="button" class="tp-tree-select" data-tp-select-group="${escapeHtml(g.id)}" data-tp-kind="${GROUP_KINDS.SUBSCRIPTION}" title="${escapeHtml(g.name)}">
              <span class="tp-tree-icon" style="color:${escapeHtml(g.color || '#ef233c')}">${renderIconHtml(g.icon, 18)}</span>
              <span class="tp-tree-name">${escapeHtml(g.name)}</span>
              <span class="tp-tree-badge">${count}</span>
            </button>
          </div>
        </li>
      `;
    })
    .join('');
}

/**
 * Render the complete inner HTML of the TubeNook sidebar section.
 * @param {import('../shared/types.js').AppState | null} state
 * @returns {string}
 */
function buildSidebarHtml(state) {
  const lang = state?.settings?.language || 'pt-BR';
  const isPt = lang === 'pt-BR';
  const subGroups = getFlatSubscriptionGroups(state);
  const allPlaylists = getAllPlaylists(state);
  const courses = getSortedCourses(state);

  const playlistsSectionTitle = isPt ? 'Listas de reprodução' : 'Playlists';
  const coursesSectionTitle = isPt ? 'Cursos' : 'Courses';
  const subEmptyText = isPt ? 'Nenhum grupo de canais ainda.' : 'No subscription groups yet.';
  const plEmptyText = isPt ? 'Nenhuma playlist ainda.' : 'No playlists yet.';
  const coursesEmptyText = isPt ? 'Nenhum curso criado ainda.' : 'No courses created yet.';
  const newCustomPlTitle = isPt ? 'Nova playlist personalizada' : 'New custom playlist';
  const newCourseTitle = isPt ? 'Novo curso' : 'New course';
  const customizePlTitle = isPt ? 'Personalizar layout' : 'Customize layout';
  const deckLabel = 'Deck';

  const subsCollapsed = Boolean(collapsedSections.subs);
  const plCollapsed = Boolean(collapsedSections.playlists);
  const coursesCollapsed = Boolean(collapsedSections.courses);

  const playlistsBodyHtml =
    allPlaylists.length > 0
      ? `<ul class="tp-tree-list">
          ${allPlaylists
            .map((pl) => {
              const count = Array.isArray(pl.videos) ? pl.videos.length : pl.videoCount || 0;
              const rowStyle = pl.color ? `border-left-color:${escapeHtml(pl.color)};` : '';
              const badgeHtml = count > 0 || pl.isCustom ? `<span class="tp-tree-badge">${count}</span>` : '';
              return `
                <li class="tp-tree-item" data-pl-id="${escapeHtml(pl.id)}">
                  <div class="tp-tree-row tp-flat-row tp-pl-row" style="${rowStyle}">
                    <button type="button" class="tp-tree-select" data-tp-open-pl="${escapeHtml(pl.id)}" data-tp-pl-custom="${pl.isCustom ? '1' : '0'}" title="${escapeHtml(pl.title)}">
                      ${renderPlaylistVisual(pl)}
                      <span class="tp-tree-name">${escapeHtml(pl.title)}</span>
                      ${badgeHtml}
                    </button>
                    <button type="button" class="tp-pl-customize-btn" data-tp-customize-pl="${escapeHtml(pl.id)}" title="${escapeHtml(customizePlTitle)}" aria-label="${escapeHtml(customizePlTitle)}">🎨</button>
                  </div>
                </li>`;
            })
            .join('')}
        </ul>`
      : `<div class="tp-sidebar-empty">${escapeHtml(plEmptyText)}</div>`;

  const coursesBodyHtml =
    courses.length > 0
      ? `<ul class="tp-tree-list">
          ${courses
            .map((course) => {
              const pct = getCourseProgressPercent(course);
              const doneClass = pct >= 100 ? 'tp-course-pct-done' : pct > 0 ? 'tp-course-pct-active' : '';
              return `
                <li class="tp-tree-item" data-course-id="${escapeHtml(course.id)}">
                  <div class="tp-tree-row tp-flat-row">
                    <button type="button" class="tp-tree-select" data-tp-open-course="${escapeHtml(course.id)}" title="${escapeHtml(course.title)}">
                      <span class="tp-tree-icon" aria-hidden="true">🎓</span>
                      <span class="tp-tree-name">${escapeHtml(course.title)}</span>
                      <span class="tp-course-pct-pill ${doneClass}">${pct}%</span>
                    </button>
                  </div>
                </li>`;
            })
            .join('')}
        </ul>`
      : `<div class="tp-sidebar-empty">${escapeHtml(coursesEmptyText)}</div>`;

  const brandLogoSvg = `<svg class="tp-brand-svg" viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
    <defs>
      <linearGradient id="tpNookGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#ff4d6d"/>
        <stop offset="55%" stop-color="#ef233c"/>
        <stop offset="100%" stop-color="#6366f1"/>
      </linearGradient>
    </defs>
    <rect x="1.5" y="1.5" width="29" height="29" rx="8" fill="url(#tpNookGrad)"/>
    <rect x="6" y="7" width="3" height="14" rx="1.5" fill="rgba(255,255,255,0.9)"/>
    <path d="M13 8.8 L24 14.5 L13 20.2 Z" fill="#ffffff"/>
    <rect x="6" y="23" width="20" height="2.4" rx="1.2" fill="rgba(255,255,255,0.85)"/>
  </svg>`;

  return `
    <div class="tp-sidebar-inner">
      <div class="tp-sidebar-header tp-sidebar-brand-card">
        <div class="tp-sidebar-brand">
          ${brandLogoSvg}
          <span class="tp-brand-title">${escapeHtml(BRAND_NAME)}</span>
        </div>
        <div class="tp-sidebar-header-actions">
          <button type="button" class="tp-icon-btn tp-sb-hdr-btn" data-tp-action="open-manager" title="${escapeHtml(t('sidebar.manageAll', lang))}" aria-label="${escapeHtml(t('sidebar.manageAll', lang))}">⚙️</button>
          <button type="button" class="tp-icon-btn tp-sb-hdr-btn" data-tp-action="open-deck" title="${escapeHtml(t('sidebar.openDeck', lang))}" aria-label="${escapeHtml(t('sidebar.openDeck', lang))}">📺</button>
          <button type="button" class="tp-icon-btn tp-sb-hdr-btn" data-tp-action="open-insights" title="Insights" aria-label="Insights">📊</button>
        </div>
      </div>

      <!-- Uniform Top-Level Item: Deck (with › arrow instead of +) -->
      <div class="tp-sb-group tp-sb-group-deck">
        <div class="tp-sb-group-head">
          <button type="button" class="tp-sb-group-toggle" data-tp-action="open-deck" title="${escapeHtml(t('sidebar.openDeck', lang))}">
            <span class="tp-sb-chevron tp-sb-deck-glyph" aria-hidden="true">📺</span>
            <span class="tp-sb-group-title">${escapeHtml(deckLabel)}</span>
          </button>
          <div class="tp-sb-group-btns">
            <button type="button" class="tp-mini-add-btn tp-mini-arrow-btn" data-tp-action="open-deck" title="${escapeHtml(t('sidebar.openDeck', lang))}" aria-label="${escapeHtml(t('sidebar.openDeck', lang))}">›</button>
          </div>
        </div>
      </div>

      <!-- Section 1: Inscrições (Flat) -->
      <div class="tp-sb-group ${subsCollapsed ? 'tp-sb-collapsed' : ''}">
        <div class="tp-sb-group-head">
          <button type="button" class="tp-sb-group-toggle" data-tp-toggle-section="subs" aria-expanded="${!subsCollapsed}">
            <span class="tp-sb-chevron ${subsCollapsed ? 'tp-collapsed' : ''}" aria-hidden="true">▾</span>
            <span class="tp-sb-group-title">${escapeHtml(t('sidebar.subscriptionGroups', lang))}</span>
          </button>
          <div class="tp-sb-group-btns">
            <button type="button" class="tp-mini-add-btn" data-tp-action="create-sub-group" title="${escapeHtml(t('sidebar.newGroup', lang))}" aria-label="${escapeHtml(t('sidebar.newGroup', lang))}">+</button>
          </div>
        </div>
        ${
          subsCollapsed
            ? ''
            : `<div class="tp-sb-group-body">
                ${
                  subGroups.length > 0
                    ? `<ul class="tp-tree-list">${renderFlatSubscriptionGroups(subGroups, state)}</ul>`
                    : `<div class="tp-sidebar-empty">${escapeHtml(subEmptyText)}</div>`
                }
              </div>`
        }
      </div>

      <!-- Section 2: Listas de reprodução (All Native + Custom TubeNook Playlists) -->
      <div class="tp-sb-group ${plCollapsed ? 'tp-sb-collapsed' : ''}">
        <div class="tp-sb-group-head">
          <button type="button" class="tp-sb-group-toggle" data-tp-toggle-section="playlists" aria-expanded="${!plCollapsed}">
            <span class="tp-sb-chevron ${plCollapsed ? 'tp-collapsed' : ''}" aria-hidden="true">▾</span>
            <span class="tp-sb-group-title">${escapeHtml(playlistsSectionTitle)}</span>
          </button>
          <div class="tp-sb-group-btns">
            <button type="button" class="tp-mini-add-btn" data-tp-action="create-custom-playlist" title="${escapeHtml(newCustomPlTitle)}" aria-label="${escapeHtml(newCustomPlTitle)}">+</button>
          </div>
        </div>
        ${plCollapsed ? '' : `<div class="tp-sb-group-body">${playlistsBodyHtml}</div>`}
      </div>

      <!-- Section 3: Cursos -->
      <div class="tp-sb-group ${coursesCollapsed ? 'tp-sb-collapsed' : ''}">
        <div class="tp-sb-group-head">
          <button type="button" class="tp-sb-group-toggle" data-tp-toggle-section="courses" aria-expanded="${!coursesCollapsed}">
            <span class="tp-sb-chevron ${coursesCollapsed ? 'tp-collapsed' : ''}" aria-hidden="true">▾</span>
            <span class="tp-sb-group-title">${escapeHtml(coursesSectionTitle)}</span>
          </button>
          <div class="tp-sb-group-btns">
            <button type="button" class="tp-mini-add-btn" data-tp-action="open-courses" title="${escapeHtml(newCourseTitle)}" aria-label="${escapeHtml(newCourseTitle)}">+</button>
          </div>
        </div>
        ${coursesCollapsed ? '' : `<div class="tp-sb-group-body">${coursesBodyHtml}</div>`}
      </div>
    </div>
  `;
}

/**
 * Attach delegated click handlers to the sidebar section container.
 * @param {HTMLElement} sectionEl
 */
function bindSidebarEvents(sectionEl) {
  if (sectionEl.dataset.tpBound === '1') return;
  sectionEl.dataset.tpBound = '1';

  sectionEl.addEventListener('click', async (e) => {
    const target = /** @type {HTMLElement | null} */ (e.target instanceof Element ? e.target : null);
    if (!target) return;

    // 0. Collapse / expand top-level sidebar section
    const toggleSecBtn = target.closest('[data-tp-toggle-section]');
    if (toggleSecBtn) {
      e.preventDefault();
      e.stopPropagation();
      const secKey = toggleSecBtn.getAttribute('data-tp-toggle-section');
      if (secKey && Object.prototype.hasOwnProperty.call(collapsedSections, secKey)) {
        collapsedSections[secKey] = !collapsedSections[secKey];
        saveCollapsedSections();
        refreshSidebar(currentState);
      }
      return;
    }

    // 1. Customize playlist layout (hover 🎨 button)
    const customizePlBtn = target.closest('[data-tp-customize-pl]');
    if (customizePlBtn) {
      e.preventDefault();
      e.stopPropagation();
      const plId = customizePlBtn.getAttribute('data-tp-customize-pl');
      if (plId) {
        if (typeof callbacks.onCustomizePlaylist === 'function') {
          callbacks.onCustomizePlaylist(plId);
        } else {
          callbacks.onOpenCustomPlaylist?.(plId);
        }
      }
      return;
    }

    // 2. Open playlist (native YouTube playlist OR custom TubeNook playlist)
    const openPlBtn = target.closest('[data-tp-open-pl]');
    if (openPlBtn) {
      e.preventDefault();
      e.stopPropagation();
      const plId = openPlBtn.getAttribute('data-tp-open-pl');
      const isCustom = openPlBtn.getAttribute('data-tp-pl-custom') === '1';
      if (!plId) return;
      if (isCustom) {
        callbacks.onOpenCustomPlaylist?.(plId);
      } else if (typeof window !== 'undefined') {
        window.location.assign(`/playlist?list=${encodeURIComponent(plId)}`);
      }
      return;
    }

    // 3. Select subscription group
    const selectBtn = target.closest('[data-tp-select-group]');
    if (selectBtn) {
      e.preventDefault();
      e.stopPropagation();
      const groupId = selectBtn.getAttribute('data-tp-select-group');
      const kind = selectBtn.getAttribute('data-tp-kind');
      if (!groupId) return;

      activeGroupId = groupId;
      refreshSidebar(currentState);

      if (kind === GROUP_KINDS.PLAYLIST) {
        callbacks.onSelectPlaylistGroup?.(groupId);
      } else {
        callbacks.onSelectSubscriptionGroup?.(groupId);
      }
      return;
    }

    // 4. Open course
    const courseBtn = target.closest('[data-tp-open-course]');
    if (courseBtn) {
      e.preventDefault();
      e.stopPropagation();
      const courseId = courseBtn.getAttribute('data-tp-open-course');
      if (courseId) {
        callbacks.onOpenCourses?.(courseId);
      }
      return;
    }

    // 5. Quick actions
    const actionBtn = target.closest('[data-tp-action]');
    if (actionBtn) {
      e.preventDefault();
      e.stopPropagation();
      const action = actionBtn.getAttribute('data-tp-action');
      if (action === 'open-manager') {
        callbacks.onOpenManager?.('groups');
      } else if (action === 'open-community') {
        callbacks.onOpenManager?.('community');
      } else if (action === 'open-deck') {
        callbacks.onOpenDeck?.();
      } else if (action === 'open-courses') {
        callbacks.onOpenCourses?.();
      } else if (action === 'open-insights') {
        callbacks.onOpenInsights?.();
      } else if (action === 'create-sub-group') {
        callbacks.onOpenManager?.('groups', { createKind: GROUP_KINDS.SUBSCRIPTION });
      } else if (action === 'create-custom-playlist') {
        const lang = currentState?.settings?.language || 'pt-BR';
        const promptLabel =
          lang === 'pt-BR' ? 'Nome da nova playlist personalizada:' : 'New custom playlist name:';
        const rawName = window.prompt(promptLabel, '');
        const title = (rawName || '').trim();
        if (!title) return;
        const newId = createId('pl');
        const res = await sendBg(MESSAGE_ACTIONS.UPSERT_PLAYLISTS, {
          playlists: [
            {
              id: newId,
              title,
              isCustom: true,
              videos: [],
              videoCount: 0,
              watchedCount: 0,
              groupIds: [],
              thumbnailUrl: '',
              updatedAt: Date.now(),
            },
          ],
        });
        if (res?.ok && res.state) {
          currentState = res.state;
          refreshSidebar(res.state);
          showToast(t('toast.saved', lang), 'success');
          callbacks.onOpenCustomPlaylist?.(newId);
        } else if (res?.error) {
          showToast(t('toast.error', lang, { message: res.error }), 'error');
        }
      }
    }
  });
}

/**
 * Idempotently reorder YouTube's native `ytd-guide-renderer #sections` so that
 * native "Inscrições" (Subscriptions) appears immediately AFTER native "Você" (You),
 * while keeping YouTube's "Você" section 100% native.
 * @param {Element} sections
 */
function reorderNativeGuideSections(sections) {
  if (!sections) return;

  // Remove any legacy injected node from older versions so "Você" stays 100% native
  const legacyNative = document.getElementById(LEGACY_NATIVE_CUSTOM_PL_ID);
  if (legacyNative) legacyNative.remove();

  const nativeSections = Array.from(sections.children).filter(
    (el) => el.tagName?.toLowerCase() === 'ytd-guide-section-renderer'
  );
  if (nativeSections.length < 2) return;

  const youSection = nativeSections.find((sec) =>
    Boolean(
      sec.querySelector(
        'a[href="/feed/you"], a[href="/feed/history"], a[href="/feed/playlists"]'
      )
    )
  );
  if (!youSection) return;

  const subsSection = nativeSections.find(
    (sec) =>
      sec !== youSection &&
      Boolean(
        sec.querySelector(
          'a[href="/feed/channels"], a[href^="/@"], a[href^="/channel/"]'
        )
      )
  );
  if (!subsSection) return;

  // Already placed immediately after "Você" — zero DOM mutations
  if (youSection.nextElementSibling === subsSection) return;

  sections.insertBefore(subsSection, youSection.nextSibling);
}

/**
 * Auto-scrape YouTube's native sidebar playlists once (only upserting newly discovered IDs)
 * so all user playlists automatically appear under TubeNook -> Listas de reprodução.
 */
async function autoScrapeNativePlaylists() {
  if (autoScrapeInFlight || !currentState) return;
  const scraped = scrapeSidebarPlaylists();
  if (!scraped.length) return;

  const existingPlaylists = currentState.playlists || {};
  const newlyFound = [];
  for (const pl of scraped) {
    if (!pl?.id || existingPlaylists[pl.id] || scrapedPlaylistIds.has(pl.id)) continue;
    scrapedPlaylistIds.add(pl.id);
    newlyFound.push({
      id: pl.id,
      title: pl.title,
      url: pl.url,
      isCustom: false,
      updatedAt: Date.now(),
    });
  }

  if (newlyFound.length === 0) return;

  autoScrapeInFlight = true;
  try {
    const res = await sendBg(MESSAGE_ACTIONS.UPSERT_PLAYLISTS, { playlists: newlyFound });
    if (res?.ok && res.state) {
      currentState = res.state;
      refreshSidebar(res.state);
    }
  } finally {
    autoScrapeInFlight = false;
  }
}

const scheduleAutoScrapePlaylists = debounce(() => {
  scheduleIdle(() => {
    autoScrapeNativePlaylists();
  });
}, 350);

/**
 * Find YouTube's guide sections container and ensure our TubeNook section is mounted.
 * Skips DOM writes completely when the sidebar is already mounted and its render signature is unchanged.
 */
function ensureSidebarInjected() {
  if (typeof document === 'undefined') return;

  const sections = document.querySelector('ytd-guide-renderer #sections');
  if (!sections) return;

  reorderNativeGuideSections(sections);

  let sectionEl = document.getElementById(SIDEBAR_SECTION_ID);
  const wasMounted = Boolean(sectionEl && sectionEl.parentElement === sections);

  const nextSig = computeSidebarSignature(currentState);
  if (wasMounted && nextSig === lastRenderSignature) {
    return;
  }

  if (!sectionEl) {
    sectionEl = document.createElement('div');
    sectionEl.id = SIDEBAR_SECTION_ID;
    sectionEl.className = `tp-sidebar-section ${getThemeClass(currentState)}`;
    bindSidebarEvents(sectionEl);
  }

  if (sectionEl.parentElement !== sections) {
    // Insert right after the first primary section (Home/Shorts/Subscriptions) if present, else at top
    const firstSection = sections.querySelector('ytd-guide-section-renderer');
    if (firstSection && firstSection.nextSibling) {
      sections.insertBefore(sectionEl, firstSection.nextSibling);
    } else {
      sections.prepend(sectionEl);
    }
  }

  sectionEl.className = `tp-sidebar-section ${getThemeClass(currentState)}`;
  sectionEl.innerHTML = buildSidebarHtml(currentState);
  lastRenderSignature = nextSig;

  scheduleAutoScrapePlaylists();
}

/**
 * Debounced (350ms) reaction to mutations inside `ytd-guide-renderer`.
 */
const handleGuideMutation = debounce(() => {
  const sections = document.querySelector('ytd-guide-renderer #sections');
  if (!sections) return;

  reorderNativeGuideSections(sections);

  if (!sections.querySelector(`#${SIDEBAR_SECTION_ID}`)) {
    lastRenderSignature = '';
    ensureSidebarInjected();
  } else {
    scheduleAutoScrapePlaylists();
  }
}, 350);

/**
 * Attach a scoped MutationObserver ONLY to `ytd-guide-renderer` (or `#guide-inner-content`),
 * never to `document.body`.
 */
function attachGuideObserver() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;

  const target =
    document.querySelector('ytd-guide-renderer #guide-inner-content') ||
    document.querySelector('ytd-guide-renderer');

  if (!target) {
    if (guideAttachAttempts < 25 && !guideAttachTimer) {
      guideAttachAttempts += 1;
      guideAttachTimer = setTimeout(() => {
        guideAttachTimer = null;
        attachGuideObserver();
      }, 300);
    }
    return;
  }

  guideAttachAttempts = 0;
  if (observedGuideRoot === target && guideObserver) return;

  if (guideObserver) {
    guideObserver.disconnect();
  }

  observedGuideRoot = target;
  guideObserver = new MutationObserver(() => {
    handleGuideMutation();
  });
  guideObserver.observe(target, {
    childList: true,
    subtree: true,
  });

  ensureSidebarInjected();
}

/**
 * Initialize the TubeNook sidebar integration and scoped guide MutationObserver.
 * @param {{
 *   onOpenManager?: Function,
 *   onOpenDeck?: Function,
 *   onSelectSubscriptionGroup?: Function,
 *   onSelectPlaylistGroup?: Function,
 *   onOpenCustomPlaylist?: Function,
 *   onOpenCourses?: Function,
 *   onOpenInsights?: Function,
 *   onCustomizePlaylist?: Function,
 * }} opts
 */
export function initSidebar(opts = {}) {
  callbacks = { ...opts };

  ensureSidebarInjected();
  attachGuideObserver();
}

/**
 * Re-render the TubeNook sidebar section with updated AppState.
 * Does zero DOM writes if the sidebar render signature has not changed.
 * @param {import('../shared/types.js').AppState | null} state
 */
export function refreshSidebar(state) {
  currentState = state || currentState;
  ensureSidebarInjected();
  if (!observedGuideRoot || !observedGuideRoot.isConnected) {
    attachGuideObserver();
  }
}
