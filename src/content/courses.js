/**
 * @fileoverview TubeNook Courses Catalog, Course Builder/Organizer,
 * Full-Screen Course Player, and Library Insights Dashboard UI.
 */

import { BRAND_NAME } from '../shared/brand.js';
import { MESSAGE_ACTIONS } from '../shared/types.js';
import { suggestCourseSequence, getCourseProgress } from '../shared/courses.js';
import { computeInsights } from '../shared/insights.js';
import { DEFAULT_GROUP_COLORS, searchIcons, renderIconHtml } from '../shared/icons.js';
import { t } from '../shared/i18n.js';
import {
  escapeHtml,
  sendBg,
  showToast,
  extractVideoIdFromUrl,
  getCurrentWatchVideoInfo,
  parseDurationToSeconds,
  toggleFocusModeCss,
} from './yt-dom.js';

const COURSES_MODAL_ID = 'tp-courses-modal-backdrop';
const COURSE_PLAYER_ID = 'tp-course-player-overlay';
const INSIGHTS_MODAL_ID = 'tp-insights-modal-backdrop';

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{6,20}$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const DEFAULT_COURSE_COLOR = '#ef233c';
const DEFAULT_COURSE_ICON = Object.freeze({ type: 'emoji', value: '🎓' });

/** @type {(() => import('../shared/types.js').AppState | null) | null} */
let getStateFn = null;
/** @type {((state: import('../shared/types.js').AppState) => void) | null} */
let onStateChangeFn = null;
/** @type {import('../shared/types.js').AppState | null} */
let cachedState = null;

/** Internal UI state for the Courses Catalog / Creator / Organizer modal */
const modalState = {
  isOpen: false,
  /** @type {'catalog' | 'create' | 'organizer'} */
  view: 'catalog',
  /** @type {string | null} */
  activeCourseId: null,
  /** @type {{ modules: any[], lessons: any[], summary: string } | null} */
  suggestedSequence: null,
  createColor: DEFAULT_COURSE_COLOR,
  createIcon: { ...DEFAULT_COURSE_ICON },
  iconQuery: '',
};

/** Internal UI state for the Full-Screen Course Player */
const playerState = {
  isOpen: false,
  /** @type {string | null} */
  courseId: null,
  /** @type {string | null} */
  lessonId: null,
  /** @type {string | null} */
  renderedVideoId: null,
  focusMode: false,
  /** @type {Set<string>} */
  collapsedModules: new Set(),
};

/** Internal UI state for the Insights Dashboard modal */
const insightsState = {
  isOpen: false,
};

let escListenerBound = false;

/* ============================================================================
 * HELPERS & VALIDATION
 * ========================================================================== */

/**
 * Return the latest AppState.
 * @returns {import('../shared/types.js').AppState | null}
 */
function getState() {
  const s = typeof getStateFn === 'function' ? getStateFn() : null;
  if (s) cachedState = s;
  return cachedState;
}

/**
 * Return current UI language ('pt-BR' | 'en').
 * @returns {'pt-BR' | 'en'}
 */
function getLang() {
  return getState()?.settings?.language === 'en' ? 'en' : 'pt-BR';
}

/**
 * Notify parent entrypoint when a background mutation returns updated AppState.
 * @param {import('../shared/types.js').AppState | undefined} nextState
 */
function notifyState(nextState) {
  if (!nextState) return;
  cachedState = nextState;
  if (typeof onStateChangeFn === 'function') {
    onStateChangeFn(nextState);
  }
}

/**
 * Validate that a URL uses strict https:// protocol.
 * @param {string | null | undefined} rawUrl
 * @returns {string}
 */
function validateHttpsUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol === 'https:') {
      return parsed.href;
    }
  } catch {
    // invalid URL
  }
  return '';
}

/**
 * Validate a hex color string, falling back to DEFAULT_COURSE_COLOR.
 * @param {string | null | undefined} color
 * @returns {string}
 */
function safeColor(color) {
  return typeof color === 'string' && HEX_COLOR_RE.test(color.trim())
    ? color.trim()
    : DEFAULT_COURSE_COLOR;
}

/**
 * Extract a validated YouTube video ID from a URL or raw ID input.
 * @param {string} rawInput
 * @returns {string | null}
 */
function parseVideoIdInput(rawInput) {
  const input = String(rawInput || '').trim();
  if (!input) return null;

  if (VIDEO_ID_RE.test(input) && !input.includes('/')) {
    return input;
  }

  // Handle youtu.be/<id> and youtube.com/live/<id>
  try {
    const parsed = new URL(input.startsWith('http') ? input : `https://${input}`);
    if (parsed.hostname === 'youtu.be' || parsed.hostname === 'www.youtu.be') {
      const id = parsed.pathname.replace(/^\/+/, '').split('/')[0];
      if (id && VIDEO_ID_RE.test(id)) return id;
    }
    const liveMatch = parsed.pathname.match(/^\/live\/([^/?#]+)/);
    if (liveMatch && VIDEO_ID_RE.test(liveMatch[1])) return liveMatch[1];
  } catch {
    // fall through to extractVideoIdFromUrl
  }

  const fromHelper = extractVideoIdFromUrl(input);
  if (fromHelper && VIDEO_ID_RE.test(fromHelper)) {
    return fromHelper;
  }
  return null;
}

/**
 * Build a safe YouTube thumbnail URL for a validated videoId.
 * @param {string} videoId
 * @returns {string}
 */
function buildThumbUrl(videoId) {
  if (!VIDEO_ID_RE.test(String(videoId || ''))) return '';
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}

/**
 * Format seconds into human-readable "Xh Ym" (or "Ym" / "0m").
 * @param {number} totalSec
 * @returns {string}
 */
function formatDurationHuman(totalSec) {
  const sec = Number.isFinite(totalSec) && totalSec > 0 ? Math.floor(totalSec) : 0;
  if (sec === 0) return '0m';
  const totalMin = Math.ceil(sec / 60);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours > 0) {
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h 0m`;
  }
  return `${mins}m`;
}

/**
 * Format seconds into clock notation (H:MM:SS or M:SS).
 * @param {number} totalSec
 * @returns {string}
 */
function formatDurationClock(totalSec) {
  const sec = Number.isFinite(totalSec) && totalSec > 0 ? Math.floor(totalSec) : 0;
  if (sec <= 0) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Return course lessons ordered by module order then lesson.order.
 * @param {import('../shared/types.js').Course | null | undefined} course
 * @returns {import('../shared/types.js').CourseLesson[]}
 */
function getOrderedLessons(course) {
  const lessons = Array.isArray(course?.lessons) ? course.lessons : [];
  const moduleOrderMap = new Map(
    (Array.isArray(course?.modules) ? course.modules : []).map((m, idx) => [
      m.id,
      Number.isFinite(m.order) ? m.order : idx,
    ])
  );

  return [...lessons].sort((a, b) => {
    const aMod = a.moduleId && moduleOrderMap.has(a.moduleId) ? moduleOrderMap.get(a.moduleId) : 9999;
    const bMod = b.moduleId && moduleOrderMap.has(b.moduleId) ? moduleOrderMap.get(b.moduleId) : 9999;
    if (aMod !== bMod) return aMod - bMod;
    return (a.order ?? 0) - (b.order ?? 0);
  });
}

/**
 * Group ordered course lessons into modules with a fallback module for unassigned lessons.
 * @param {import('../shared/types.js').Course} course
 * @param {'pt-BR' | 'en'} lang
 * @returns {Array<{ id: string, title: string, order: number, lessons: import('../shared/types.js').CourseLesson[] }>}
 */
function groupLessonsByModules(course, lang) {
  const modules = Array.isArray(course?.modules)
    ? [...course.modules].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    : [];
  const orderedLessons = getOrderedLessons(course);

  const byModId = new Map();
  for (const mod of modules) {
    byModId.set(mod.id, {
      id: mod.id,
      title: mod.title || (lang === 'en' ? 'Module' : 'Módulo'),
      order: mod.order ?? 0,
      lessons: [],
    });
  }

  /** @type {import('../shared/types.js').CourseLesson[]} */
  const unassigned = [];
  for (const lesson of orderedLessons) {
    if (lesson.moduleId && byModId.has(lesson.moduleId)) {
      byModId.get(lesson.moduleId).lessons.push(lesson);
    } else {
      unassigned.push(lesson);
    }
  }

  const result = Array.from(byModId.values()).filter((m) => m.lessons.length > 0);
  if (unassigned.length > 0) {
    result.push({
      id: '__unassigned__',
      title:
        result.length === 0
          ? lang === 'en'
            ? 'Course Lessons'
            : 'Aulas do Curso'
          : lang === 'en'
            ? 'Other Lessons'
            : 'Outras Aulas',
      order: 9999,
      lessons: unassigned,
    });
  }
  return result;
}

/**
 * Ensure global Escape key closes the topmost open TubeNook Course/Insights overlay.
 */
function ensureEscapeListener() {
  if (escListenerBound || typeof window === 'undefined') return;
  escListenerBound = true;
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (insightsState.isOpen) {
      closeInsightsModal();
    } else if (modalState.isOpen) {
      closeCoursesModal();
    } else if (playerState.isOpen) {
      closeCoursePlayer();
    }
  });
}

/* ============================================================================
 * PUBLIC API: INIT & REFRESH
 * ========================================================================== */

/**
 * Initialize the Courses & Insights UI module.
 * @param {{ getState: () => import('../shared/types.js').AppState | null, onStateChange?: (state: import('../shared/types.js').AppState) => void }} options
 */
export function initCourses({ getState: getStateCb, onStateChange }) {
  getStateFn = typeof getStateCb === 'function' ? getStateCb : null;
  onStateChangeFn = typeof onStateChange === 'function' ? onStateChange : null;
  cachedState = getState();
  ensureEscapeListener();
}

/**
 * Refresh any currently open Courses modal, Course Player, or Insights modal.
 * @param {import('../shared/types.js').AppState} state
 */
export function refreshCoursesUI(state) {
  if (state) cachedState = state;
  if (!modalState.isOpen && !playerState.isOpen && !insightsState.isOpen) return;
  if (modalState.isOpen) {
    renderCoursesModal();
  }
  if (playerState.isOpen) {
    renderCoursePlayer({ preserveIframeIfSame: true });
  }
  if (insightsState.isOpen) {
    renderInsightsModal();
  }
}

/* ============================================================================
 * 1. COURSE CATALOG, CREATOR & ORGANIZER MODAL
 * ========================================================================== */

/**
 * Open the Courses Catalog modal, or jump directly to the Organizer for `courseId`.
 * @param {string | null} [courseId=null]
 */
export function openCoursesModal(courseId = null) {
  if (typeof document === 'undefined' || !document.body) return;
  ensureEscapeListener();

  const state = getState();
  if (courseId && state?.courses?.[courseId]) {
    modalState.view = 'organizer';
    modalState.activeCourseId = courseId;
  } else {
    modalState.view = 'catalog';
    modalState.activeCourseId = null;
  }
  modalState.suggestedSequence = null;
  modalState.isOpen = true;

  renderCoursesModal();
}

/**
 * Close the Courses Catalog/Organizer modal.
 */
function closeCoursesModal() {
  modalState.isOpen = false;
  modalState.suggestedSequence = null;
  const el = document.getElementById(COURSES_MODAL_ID);
  if (el) el.remove();
}

/**
 * Render (or re-render) the Courses modal DOM.
 */
function renderCoursesModal() {
  if (typeof document === 'undefined' || !document.body) return;
  const state = getState();
  const lang = getLang();

  let backdrop = document.getElementById(COURSES_MODAL_ID);
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = COURSES_MODAL_ID;
    backdrop.className = 'tp-modal-backdrop';
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeCoursesModal();
    });
    document.body.appendChild(backdrop);
  }

  // Fallback to catalog if active course was deleted
  if (
    modalState.view === 'organizer' &&
    (!modalState.activeCourseId || !state?.courses?.[modalState.activeCourseId])
  ) {
    modalState.view = 'catalog';
    modalState.activeCourseId = null;
  }

  let headerTitle = `${BRAND_NAME} ${t('courses.courses', lang)}`;
  let headerLeftBtn = '';
  let headerRightActions = '';
  let bodyHtml = '';

  if (modalState.view === 'catalog') {
    headerRightActions = `
      <button type="button" class="tp-btn tp-btn-primary tp-btn-sm" data-crs-action="go-create">
        + ${escapeHtml(t('courses.newCourse', lang))}
      </button>
    `;
    bodyHtml = renderCatalogBodyHtml(state, lang);
  } else if (modalState.view === 'create') {
    headerTitle = t('courses.newCourse', lang);
    headerLeftBtn = `
      <button type="button" class="tp-btn tp-btn-ghost tp-btn-sm" data-crs-action="go-catalog">
        ← ${escapeHtml(t('courses.courses', lang))}
      </button>
    `;
    bodyHtml = renderCreateCourseBodyHtml(state, lang);
  } else if (modalState.view === 'organizer') {
    const course = state?.courses?.[modalState.activeCourseId];
    headerTitle = course?.title || t('courses.courses', lang);
    headerLeftBtn = `
      <button type="button" class="tp-btn tp-btn-ghost tp-btn-sm" data-crs-action="go-catalog">
        ← ${escapeHtml(t('courses.courses', lang))}
      </button>
    `;
    headerRightActions = `
      <button type="button" class="tp-btn tp-btn-primary tp-btn-sm" data-crs-action="open-player" data-course-id="${escapeHtml(course?.id || '')}">
        ▶ ${escapeHtml(lang === 'en' ? 'Open Player' : 'Abrir Player')}
      </button>
    `;
    bodyHtml = renderOrganizerBodyHtml(course, lang);
  }

  backdrop.innerHTML = `
    <div class="tp-modal tp-crs-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(headerTitle)}">
      <div class="tp-modal-header">
        <div class="tp-crs-header-left">
          ${headerLeftBtn}
          <span class="tp-crs-brand-badge">🎓 ${escapeHtml(BRAND_NAME)}</span>
          <h2 class="tp-modal-title">${escapeHtml(headerTitle)}</h2>
        </div>
        <div class="tp-crs-header-actions">
          ${headerRightActions}
          <button type="button" class="tp-btn-icon" data-crs-action="close-modal" aria-label="${escapeHtml(t('common.close', lang))}">✕</button>
        </div>
      </div>
      <div class="tp-modal-body">
        ${bodyHtml}
      </div>
    </div>
  `;

  bindCoursesModalEvents(backdrop);
}

/**
 * Render Catalog view HTML listing all courses as cards.
 * @param {import('../shared/types.js').AppState | null} state
 * @param {'pt-BR' | 'en'} lang
 */
function renderCatalogBodyHtml(state, lang) {
  const courses = Object.values(state?.courses || {}).sort(
    (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
  );

  if (courses.length === 0) {
    return `
      <div class="tp-crs-empty">
        <div class="tp-crs-empty-icon">🎓</div>
        <h3>${escapeHtml(lang === 'en' ? 'Turn YouTube videos into structured courses' : 'Transforme vídeos do YouTube em cursos completos')}</h3>
        <p>${escapeHtml(
          lang === 'en'
            ? 'Group tutorials or playlists into modules, track your lesson progress, take study notes, and watch in a distraction-free course player.'
            : 'Agrupe tutoriais ou playlists em módulos, acompanhe seu progresso aula por aula, faça anotações de estudo e assista em um player de curso focado.'
        )}</p>
        <button type="button" class="tp-btn tp-btn-primary" data-crs-action="go-create">
          + ${escapeHtml(t('courses.newCourse', lang))}
        </button>
      </div>
    `;
  }

  const cardsHtml = courses
    .map((course) => {
      const progress = getCourseProgress(course);
      const color = safeColor(/** @type {any} */ (course).color);
      const icon = /** @type {any} */ (course).icon || DEFAULT_COURSE_ICON;
      const ordered = getOrderedLessons(course);
      const coverUrl =
        validateHttpsUrl(course.thumbnailUrl) ||
        validateHttpsUrl(ordered[0]?.thumbnailUrl) ||
        (ordered[0]?.videoId ? buildThumbUrl(ordered[0].videoId) : '');

      const isContinue = progress.completedCount > 0 && progress.completedCount < progress.totalCount;
      const playLabel = isContinue
        ? t('courses.continueCourse', lang)
        : t('courses.startCourse', lang);
      const remainingLabel =
        progress.remainingDurationSec > 0
          ? `${formatDurationHuman(progress.remainingDurationSec)} ${lang === 'en' ? 'left' : 'restantes'}`
          : progress.totalCount > 0 && progress.percent === 100
            ? t('courses.completed', lang)
            : `${progress.totalCount} ${t('courses.lessons', lang).toLowerCase()}`;

      return `
        <article class="tp-crs-card" style="border-top: 3px solid ${escapeHtml(color)};">
          <div class="tp-crs-card-cover">
            ${
              coverUrl
                ? `<img src="${escapeHtml(coverUrl)}" alt="${escapeHtml(course.title)}" loading="lazy" />`
                : `<div class="tp-crs-card-cover-placeholder">${renderIconHtml(icon, 42)}</div>`
            }
            <div class="tp-crs-card-icon-badge" style="border-color: ${escapeHtml(color)};">
              ${renderIconHtml(icon, 18)}
            </div>
            <span class="tp-crs-card-duration-pill">${escapeHtml(remainingLabel)}</span>
          </div>
          <div class="tp-crs-card-body">
            <h3 class="tp-crs-card-title">${escapeHtml(course.title)}</h3>
            <p class="tp-crs-card-desc">${escapeHtml(course.description || (lang === 'en' ? 'No description yet.' : 'Sem descrição.'))}</p>
            <div class="tp-crs-progress-wrap">
              <div class="tp-crs-progress-meta">
                <span>${escapeHtml(`${progress.completedCount}/${progress.totalCount} · ${progress.percent}%`)}</span>
                <span>${escapeHtml(
                  progress.totalDurationSec > 0 ? formatDurationHuman(progress.totalDurationSec) : ''
                )}</span>
              </div>
              <div class="tp-crs-progress-bar">
                <div class="tp-crs-progress-fill ${progress.percent === 100 ? 'is-complete' : ''}" style="width: ${progress.percent}%; background: ${progress.percent === 100 ? 'var(--tp-success)' : escapeHtml(color)};"></div>
              </div>
            </div>
          </div>
          <div class="tp-crs-card-actions">
            <button type="button" class="tp-btn tp-btn-primary tp-btn-sm" data-crs-action="open-player" data-course-id="${escapeHtml(course.id)}">
              ▶ ${escapeHtml(playLabel)}
            </button>
            <button type="button" class="tp-btn tp-btn-secondary tp-btn-sm" data-crs-action="open-organizer" data-course-id="${escapeHtml(course.id)}">
              ${escapeHtml(lang === 'en' ? 'Organize' : 'Organizar')}
            </button>
            <button type="button" class="tp-btn-icon" data-crs-action="delete-course" data-course-id="${escapeHtml(course.id)}" title="${escapeHtml(t('common.delete', lang))}" aria-label="${escapeHtml(t('common.delete', lang))}">
              🗑
            </button>
          </div>
        </article>
      `;
    })
    .join('');

  return `<div class="tp-crs-grid">${cardsHtml}</div>`;
}

/**
 * Render "+ Novo Curso" form HTML.
 * @param {import('../shared/types.js').AppState | null} state
 * @param {'pt-BR' | 'en'} lang
 */
function renderCreateCourseBodyHtml(state, lang) {
  const playlistsWithVideos = Object.values(state?.playlists || {}).filter(
    (pl) => Array.isArray(pl.videos) && pl.videos.length > 0
  );

  const swatchesHtml = DEFAULT_GROUP_COLORS.map((hex) => {
    const selected = hex.toLowerCase() === modalState.createColor.toLowerCase();
    return `<button type="button" class="tp-crs-swatch ${selected ? 'is-selected' : ''}" data-crs-swatch="${escapeHtml(hex)}" style="background:${escapeHtml(hex)};" aria-label="${escapeHtml(hex)}"></button>`;
  }).join('');

  const filteredIcons = searchIcons(modalState.iconQuery, 'all').slice(0, 48);
  const iconsHtml = filteredIcons
    .map((entry) => {
      const selected =
        modalState.createIcon?.type === entry.type && modalState.createIcon?.value === entry.value;
      return `
        <button type="button" class="tp-crs-icon-btn ${selected ? 'is-selected' : ''}" data-crs-icon-type="${escapeHtml(entry.type)}" data-crs-icon-val="${escapeHtml(entry.value)}" title="${escapeHtml(lang === 'en' ? entry.labelEn : entry.labelPt)}">
          ${renderIconHtml({ type: entry.type, value: entry.value }, 20)}
        </button>
      `;
    })
    .join('');

  const playlistOptions = playlistsWithVideos
    .map(
      (pl) =>
        `<option value="${escapeHtml(pl.id)}">${escapeHtml(pl.title)} (${pl.videos.length} ${escapeHtml(lang === 'en' ? 'videos' : 'vídeos')})</option>`
    )
    .join('');

  return `
    <form id="tp-crs-create-form">
      <div class="tp-form-group">
        <label class="tp-form-label" for="tp-crs-title-input">${escapeHtml(lang === 'en' ? 'Course Title' : 'Título do Curso')}</label>
        <input id="tp-crs-title-input" class="tp-input" type="text" required maxlength="140" placeholder="${escapeHtml(lang === 'en' ? 'e.g. Full-Stack JavaScript Bootcamp' : 'Ex: Curso Completo de JavaScript Moderno')}" />
      </div>

      <div class="tp-form-group">
        <label class="tp-form-label" for="tp-crs-desc-input">${escapeHtml(lang === 'en' ? 'Description (optional)' : 'Descrição (opcional)')}</label>
        <textarea id="tp-crs-desc-input" class="tp-textarea" rows="2" maxlength="500" placeholder="${escapeHtml(lang === 'en' ? 'What will you learn in this course?' : 'O que você vai aprender neste curso?')}"></textarea>
      </div>

      <div class="tp-form-group">
        <label class="tp-form-label">${escapeHtml(t('group.colorLabel', lang))}</label>
        <div class="tp-crs-swatches">${swatchesHtml}</div>
      </div>

      <div class="tp-form-group">
        <label class="tp-form-label" for="tp-crs-icon-search">${escapeHtml(t('group.iconLabel', lang))}</label>
        <div class="tp-crs-icon-picker">
          <input id="tp-crs-icon-search" class="tp-input" type="search" value="${escapeHtml(modalState.iconQuery)}" placeholder="${escapeHtml(t('group.iconSearch', lang))}" />
          <div class="tp-crs-icon-grid" id="tp-crs-icon-grid">${iconsHtml}</div>
        </div>
      </div>

      <div class="tp-form-group">
        <label class="tp-form-label" for="tp-crs-import-playlist">${escapeHtml(lang === 'en' ? 'Import videos from an existing Playlist (optional)' : 'Importar vídeos de uma Playlist existente (opcional)')}</label>
        <select id="tp-crs-import-playlist" class="tp-select">
          <option value="">${escapeHtml(lang === 'en' ? '— Start empty (add lessons later) —' : '— Começar vazio (adicionar aulas depois) —')}</option>
          ${playlistOptions}
        </select>
      </div>

      <div class="tp-crs-org-row" style="justify-content: flex-end; margin-top: 16px;">
        <button type="button" class="tp-btn tp-btn-secondary" data-crs-action="go-catalog">${escapeHtml(t('common.cancel', lang))}</button>
        <button type="submit" class="tp-btn tp-btn-primary">${escapeHtml(t('common.create', lang))}</button>
      </div>
    </form>
  `;
}

/**
 * Render Course Builder / Organizer view HTML.
 * @param {import('../shared/types.js').Course} course
 * @param {'pt-BR' | 'en'} lang
 */
function renderOrganizerBodyHtml(course, lang) {
  if (!course) return '';
  const orderedLessons = getOrderedLessons(course);
  const currentWatch = getCurrentWatchVideoInfo();
  const moduleTitleMap = new Map(
    (Array.isArray(course.modules) ? course.modules : []).map((m) => [m.id, m.title])
  );
  const courseColor = safeColor(/** @type {any} */ (course).color);

  const suggestPreviewHtml = modalState.suggestedSequence
    ? renderSuggestedSequencePreviewHtml(modalState.suggestedSequence, lang)
    : '';

  const lessonsHtml =
    orderedLessons.length === 0
      ? `<p class="tp-ins-empty-note">${escapeHtml(
          lang === 'en'
            ? 'No lessons yet. Paste a YouTube URL/Video ID above or add the currently playing video.'
            : 'Nenhuma aula ainda. Cole uma URL/ID do YouTube acima ou adicione o vídeo atual.'
        )}</p>`
      : orderedLessons
          .map((lesson, idx) => {
            const thumb = validateHttpsUrl(lesson.thumbnailUrl) || buildThumbUrl(lesson.videoId);
            const modTitle = lesson.moduleId ? moduleTitleMap.get(lesson.moduleId) || '' : '';
            const durText = formatDurationClock(lesson.durationSec);
            return `
              <div class="tp-crs-lesson-row">
                <span class="tp-crs-lesson-index">${idx + 1}</span>
                ${
                  thumb
                    ? `<img class="tp-crs-lesson-thumb" src="${escapeHtml(thumb)}" alt="" loading="lazy" />`
                    : ''
                }
                <div class="tp-crs-lesson-info">
                  <div class="tp-crs-lesson-title">${escapeHtml(lesson.title || lesson.videoId)}</div>
                  <div class="tp-crs-lesson-sub">
                    ${modTitle ? `<span class="tp-pill">${escapeHtml(modTitle)}</span>` : ''}
                    ${durText ? `<span>${escapeHtml(durText)}</span>` : ''}
                    ${lesson.completed ? `<span class="tp-pill tp-pill-success">✓ ${escapeHtml(t('courses.completed', lang))}</span>` : ''}
                  </div>
                </div>
                <div class="tp-crs-lesson-actions">
                  <button type="button" class="tp-btn-icon" data-crs-action="move-lesson-up" data-lesson-id="${escapeHtml(lesson.id)}" ${idx === 0 ? 'disabled' : ''} title="${escapeHtml(lang === 'en' ? 'Move up' : 'Mover para cima')}">↑</button>
                  <button type="button" class="tp-btn-icon" data-crs-action="move-lesson-down" data-lesson-id="${escapeHtml(lesson.id)}" ${idx === orderedLessons.length - 1 ? 'disabled' : ''} title="${escapeHtml(lang === 'en' ? 'Move down' : 'Mover para baixo')}">↓</button>
                  <button type="button" class="tp-btn-icon" data-crs-action="remove-lesson" data-lesson-id="${escapeHtml(lesson.id)}" title="${escapeHtml(t('common.remove', lang))}">✕</button>
                </div>
              </div>
            `;
          })
          .join('');

  return `
    <div class="tp-crs-org-section">
      <div class="tp-crs-org-section-title">
        <span>${escapeHtml(lang === 'en' ? 'Course Details' : 'Detalhes do Curso')}</span>
      </div>
      <form id="tp-crs-edit-meta-form" class="tp-crs-org-row">
        <input id="tp-crs-edit-title" class="tp-input" type="text" value="${escapeHtml(course.title)}" placeholder="${escapeHtml(lang === 'en' ? 'Course title' : 'Título do curso')}" required />
        <input id="tp-crs-edit-desc" class="tp-input" type="text" value="${escapeHtml(course.description || '')}" placeholder="${escapeHtml(lang === 'en' ? 'Description' : 'Descrição')}" />
        <input id="tp-crs-edit-color" type="color" value="${escapeHtml(courseColor)}" title="${escapeHtml(t('group.colorLabel', lang))}" style="width:36px;height:34px;border:1px solid var(--tp-border);border-radius:6px;background:var(--tp-surface);cursor:pointer;padding:2px;" />
        <button type="submit" class="tp-btn tp-btn-secondary tp-btn-sm">${escapeHtml(t('common.save', lang))}</button>
      </form>
    </div>

    <div class="tp-crs-org-section">
      <div class="tp-crs-org-section-title">
        <span>${escapeHtml(lang === 'en' ? 'Add Lesson' : 'Adicionar Aula')}</span>
        ${
          currentWatch
            ? `<button type="button" class="tp-btn tp-btn-primary tp-btn-sm" data-crs-action="add-current-video">+ ${escapeHtml(lang === 'en' ? 'Add current video' : 'Adicionar vídeo atual')}</button>`
            : ''
        }
      </div>
      <form id="tp-crs-add-lesson-form" class="tp-crs-org-row">
        <input id="tp-crs-lesson-url" class="tp-input" type="text" placeholder="${escapeHtml(lang === 'en' ? 'YouTube URL or Video ID (e.g. dQw4w9WgXcQ)' : 'URL do YouTube ou ID do Vídeo')}" required />
        <input id="tp-crs-lesson-title" class="tp-input" type="text" placeholder="${escapeHtml(lang === 'en' ? 'Lesson title (optional)' : 'Título da aula (opcional)')}" />
        <button type="submit" class="tp-btn tp-btn-primary tp-btn-sm">+ ${escapeHtml(t('common.add', lang))}</button>
      </form>
    </div>

    <div class="tp-crs-ai-bar">
      <span class="tp-pill">${orderedLessons.length} ${escapeHtml(t('courses.lessons', lang))} · ${(course.modules || []).length} ${escapeHtml(t('courses.modules', lang))}</span>
      <button type="button" class="tp-btn tp-btn-secondary tp-btn-sm" data-crs-action="suggest-sequence" ${orderedLessons.length < 2 ? 'disabled' : ''}>
        ✨ ${escapeHtml(lang === 'en' ? 'Suggest Auto-Organization' : 'Sugerir Organização Automática')}
      </button>
    </div>

    ${suggestPreviewHtml}

    <div class="tp-crs-lesson-list">
      ${lessonsHtml}
    </div>
  `;
}

/**
 * Render the Auto-Organize preview box with Modules, ordered lessons, summary, and Apply button.
 * @param {{ modules: any[], lessons: any[], summary: string }} seq
 * @param {'pt-BR' | 'en'} lang
 */
function renderSuggestedSequencePreviewHtml(seq, lang) {
  const modulesHtml = (seq.modules || [])
    .map((mod) => {
      const modLessons = (seq.lessons || []).filter((l) => l.moduleId === mod.id);
      return `
        <div class="tp-crs-suggest-module">
          <div class="tp-crs-suggest-module-title">${escapeHtml(mod.title)} (${modLessons.length})</div>
          ${modLessons
            .map(
              (l, idx) => `
                <div class="tp-crs-suggest-lesson">
                  <span>${idx + 1}. ${escapeHtml(l.title || l.videoId)}</span>
                  <span style="color: var(--tp-text-muted);">${escapeHtml(formatDurationClock(l.durationSec))}</span>
                </div>
              `
            )
            .join('')}
        </div>
      `;
    })
    .join('');

  return `
    <div class="tp-crs-suggest-preview">
      <div class="tp-crs-suggest-header">
        <div class="tp-crs-suggest-summary">✨ ${escapeHtml(seq.summary || '')}</div>
        <div class="tp-crs-header-actions">
          <button type="button" class="tp-btn tp-btn-ghost tp-btn-sm" data-crs-action="discard-suggestion">${escapeHtml(t('common.cancel', lang))}</button>
          <button type="button" class="tp-btn tp-btn-primary tp-btn-sm" data-crs-action="apply-sequence">${escapeHtml(t('courses.applySequence', lang))}</button>
        </div>
      </div>
      ${modulesHtml}
    </div>
  `;
}

/**
 * Bind click/submit/input listeners inside the Courses modal.
 * @param {HTMLElement} backdrop
 */
function bindCoursesModalEvents(backdrop) {
  const lang = getLang();

  backdrop.querySelectorAll('[data-crs-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const action = btn.getAttribute('data-crs-action');
      const courseId = btn.getAttribute('data-course-id') || modalState.activeCourseId;
      const lessonId = btn.getAttribute('data-lesson-id');

      if (action === 'close-modal') {
        closeCoursesModal();
        return;
      }
      if (action === 'go-catalog') {
        modalState.view = 'catalog';
        modalState.activeCourseId = null;
        modalState.suggestedSequence = null;
        renderCoursesModal();
        return;
      }
      if (action === 'go-create') {
        modalState.view = 'create';
        modalState.createColor = DEFAULT_COURSE_COLOR;
        modalState.createIcon = { ...DEFAULT_COURSE_ICON };
        modalState.iconQuery = '';
        renderCoursesModal();
        return;
      }
      if (action === 'open-organizer' && courseId) {
        modalState.view = 'organizer';
        modalState.activeCourseId = courseId;
        modalState.suggestedSequence = null;
        renderCoursesModal();
        return;
      }
      if (action === 'open-player' && courseId) {
        closeCoursesModal();
        openCoursePlayer(courseId);
        return;
      }
      if (action === 'delete-course' && courseId) {
        const course = getState()?.courses?.[courseId];
        const msg =
          lang === 'en'
            ? `Delete course "${course?.title || ''}"?`
            : `Excluir o curso "${course?.title || ''}"?`;
        if (!window.confirm(msg)) return;
        const res = await sendBg(MESSAGE_ACTIONS.DELETE_COURSE, { courseId });
        if (res?.ok && res.state) {
          notifyState(res.state);
          showToast(t('toast.saved', lang), 'success');
          renderCoursesModal();
        } else {
          showToast(t('toast.error', lang, { message: res?.error || 'Failed' }), 'error');
        }
        return;
      }
      if (action === 'add-current-video' && courseId) {
        const info = getCurrentWatchVideoInfo();
        if (!info || !VIDEO_ID_RE.test(info.videoId)) {
          showToast(
            lang === 'en' ? 'No active YouTube video detected.' : 'Nenhum vídeo ativo detectado.',
            'error'
          );
          return;
        }
        const res = await sendBg(MESSAGE_ACTIONS.ADD_LESSON_TO_COURSE, {
          courseId,
          lesson: {
            videoId: info.videoId,
            title: info.title || info.videoId,
            channelTitle: info.channelTitle || '',
            channelId: info.channelId || '',
            durationSec: info.durationSec || 0,
            thumbnailUrl: buildThumbUrl(info.videoId),
          },
        });
        if (res?.ok && res.state) {
          modalState.suggestedSequence = null;
          notifyState(res.state);
          showToast(lang === 'en' ? 'Lesson added!' : 'Aula adicionada!', 'success');
          renderCoursesModal();
        }
        return;
      }
      if (action === 'suggest-sequence' && courseId) {
        const course = getState()?.courses?.[courseId];
        if (!course) return;
        modalState.suggestedSequence = suggestCourseSequence(course.lessons || []);
        renderCoursesModal();
        return;
      }
      if (action === 'discard-suggestion') {
        modalState.suggestedSequence = null;
        renderCoursesModal();
        return;
      }
      if (action === 'apply-sequence' && courseId && modalState.suggestedSequence) {
        const res = await sendBg(MESSAGE_ACTIONS.APPLY_COURSE_SEQUENCE, {
          courseId,
          sequence: modalState.suggestedSequence,
        });
        if (res?.ok && res.state) {
          modalState.suggestedSequence = null;
          notifyState(res.state);
          showToast(
            lang === 'en' ? 'Course sequence applied!' : 'Sequência do curso aplicada!',
            'success'
          );
          renderCoursesModal();
        }
        return;
      }
      if ((action === 'move-lesson-up' || action === 'move-lesson-down') && courseId && lessonId) {
        await handleReorderLesson(courseId, lessonId, action === 'move-lesson-up' ? -1 : 1);
        return;
      }
      if (action === 'remove-lesson' && courseId && lessonId) {
        const res = await sendBg(MESSAGE_ACTIONS.REMOVE_LESSON_FROM_COURSE, {
          courseId,
          lessonId,
        });
        if (res?.ok && res.state) {
          modalState.suggestedSequence = null;
          notifyState(res.state);
          renderCoursesModal();
        }
      }
    });
  });

  // Color swatch selection in Create form
  backdrop.querySelectorAll('[data-crs-swatch]').forEach((sw) => {
    sw.addEventListener('click', () => {
      modalState.createColor = safeColor(sw.getAttribute('data-crs-swatch'));
      backdrop.querySelectorAll('[data-crs-swatch]').forEach((el) => {
        el.classList.toggle('is-selected', el === sw);
      });
    });
  });

  // Icon picker search & selection in Create form
  const iconSearchInput = /** @type {HTMLInputElement | null} */ (
    backdrop.querySelector('#tp-crs-icon-search')
  );
  const iconGrid = backdrop.querySelector('#tp-crs-icon-grid');
  const bindIconButtons = () => {
    if (!iconGrid) return;
    iconGrid.querySelectorAll('[data-crs-icon-val]').forEach((ib) => {
      ib.addEventListener('click', () => {
        const type = ib.getAttribute('data-crs-icon-type') === 'svg' ? 'svg' : 'emoji';
        const value = ib.getAttribute('data-crs-icon-val') || '🎓';
        modalState.createIcon = { type, value };
        iconGrid.querySelectorAll('[data-crs-icon-val]').forEach((el) => {
          el.classList.toggle('is-selected', el === ib);
        });
      });
    });
  };
  bindIconButtons();

  if (iconSearchInput && iconGrid) {
    iconSearchInput.addEventListener('input', () => {
      modalState.iconQuery = iconSearchInput.value;
      const results = searchIcons(modalState.iconQuery, 'all').slice(0, 48);
      iconGrid.innerHTML = results
        .map((entry) => {
          const selected =
            modalState.createIcon?.type === entry.type &&
            modalState.createIcon?.value === entry.value;
          return `
            <button type="button" class="tp-crs-icon-btn ${selected ? 'is-selected' : ''}" data-crs-icon-type="${escapeHtml(entry.type)}" data-crs-icon-val="${escapeHtml(entry.value)}" title="${escapeHtml(lang === 'en' ? entry.labelEn : entry.labelPt)}">
              ${renderIconHtml({ type: entry.type, value: entry.value }, 20)}
            </button>
          `;
        })
        .join('');
      bindIconButtons();
    });
  }

  // Create Course form submit
  const createForm = backdrop.querySelector('#tp-crs-create-form');
  if (createForm) {
    createForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const titleInput = /** @type {HTMLInputElement | null} */ (
        backdrop.querySelector('#tp-crs-title-input')
      );
      const descInput = /** @type {HTMLTextAreaElement | null} */ (
        backdrop.querySelector('#tp-crs-desc-input')
      );
      const plSelect = /** @type {HTMLSelectElement | null} */ (
        backdrop.querySelector('#tp-crs-import-playlist')
      );

      const title = (titleInput?.value || '').trim();
      if (!title) return;

      const description = (descInput?.value || '').trim();
      const playlistId = plSelect?.value || '';
      const importedLessons = [];

      if (playlistId) {
        const pl = getState()?.playlists?.[playlistId];
        if (pl && Array.isArray(pl.videos)) {
          for (const v of pl.videos) {
            if (!v?.videoId || !VIDEO_ID_RE.test(v.videoId)) continue;
            importedLessons.push({
              videoId: v.videoId,
              title: v.title || v.videoId,
              channelTitle: v.channelTitle || '',
              channelId: v.channelId || '',
              durationSec: Number.isFinite(v.durationSec) ? v.durationSec : 0,
              thumbnailUrl: validateHttpsUrl(v.thumbnailUrl) || buildThumbUrl(v.videoId),
            });
          }
        }
      }

      const res = await sendBg(MESSAGE_ACTIONS.CREATE_COURSE, {
        course: {
          title,
          description,
          lessons: importedLessons,
          thumbnailUrl: importedLessons[0]?.thumbnailUrl || '',
        },
      });

      if (res?.ok && res.course?.id) {
        const patchRes = await sendBg(MESSAGE_ACTIONS.UPDATE_COURSE, {
          courseId: res.course.id,
          patch: {
            color: modalState.createColor,
            icon: modalState.createIcon,
          },
        });
        notifyState(patchRes?.state || res.state);
        modalState.view = 'organizer';
        modalState.activeCourseId = res.course.id;
        modalState.suggestedSequence = null;
        showToast(t('toast.saved', lang), 'success');
        renderCoursesModal();
      } else {
        showToast(t('toast.error', lang, { message: res?.error || 'Failed' }), 'error');
      }
    });
  }

  // Edit Course metadata submit
  const editMetaForm = backdrop.querySelector('#tp-crs-edit-meta-form');
  if (editMetaForm && modalState.activeCourseId) {
    editMetaForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const titleEl = /** @type {HTMLInputElement | null} */ (
        backdrop.querySelector('#tp-crs-edit-title')
      );
      const descEl = /** @type {HTMLInputElement | null} */ (
        backdrop.querySelector('#tp-crs-edit-desc')
      );
      const colorEl = /** @type {HTMLInputElement | null} */ (
        backdrop.querySelector('#tp-crs-edit-color')
      );
      const title = (titleEl?.value || '').trim();
      if (!title) return;

      const res = await sendBg(MESSAGE_ACTIONS.UPDATE_COURSE, {
        courseId: modalState.activeCourseId,
        patch: {
          title,
          description: (descEl?.value || '').trim(),
          color: safeColor(colorEl?.value),
        },
      });
      if (res?.ok && res.state) {
        notifyState(res.state);
        showToast(t('toast.saved', lang), 'success');
        renderCoursesModal();
      }
    });
  }

  // Add lesson by URL or Video ID submit
  const addLessonForm = backdrop.querySelector('#tp-crs-add-lesson-form');
  if (addLessonForm && modalState.activeCourseId) {
    addLessonForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const urlEl = /** @type {HTMLInputElement | null} */ (
        backdrop.querySelector('#tp-crs-lesson-url')
      );
      const titleEl = /** @type {HTMLInputElement | null} */ (
        backdrop.querySelector('#tp-crs-lesson-title')
      );

      const videoId = parseVideoIdInput(urlEl?.value || '');
      if (!videoId) {
        showToast(
          lang === 'en'
            ? 'Invalid YouTube URL or Video ID.'
            : 'URL do YouTube ou ID de vídeo inválido.',
          'error'
        );
        return;
      }

      const title = (titleEl?.value || '').trim() || `Video ${videoId}`;
      const res = await sendBg(MESSAGE_ACTIONS.ADD_LESSON_TO_COURSE, {
        courseId: modalState.activeCourseId,
        lesson: {
          videoId,
          title,
          thumbnailUrl: buildThumbUrl(videoId),
        },
      });
      if (res?.ok && res.state) {
        modalState.suggestedSequence = null;
        notifyState(res.state);
        showToast(lang === 'en' ? 'Lesson added!' : 'Aula adicionada!', 'success');
        renderCoursesModal();
      }
    });
  }
}

/**
 * Move a lesson up (-1) or down (+1) in the ordered list and persist via UPDATE_COURSE.
 * @param {string} courseId
 * @param {string} lessonId
 * @param {-1 | 1} delta
 */
async function handleReorderLesson(courseId, lessonId, delta) {
  const course = getState()?.courses?.[courseId];
  if (!course) return;
  const ordered = getOrderedLessons(course);
  const idx = ordered.findIndex((l) => l.id === lessonId);
  const targetIdx = idx + delta;
  if (idx < 0 || targetIdx < 0 || targetIdx >= ordered.length) return;

  const swapped = [...ordered];
  const moved = swapped[idx];
  const neighbor = swapped[targetIdx];
  // If crossing module boundaries, adopt neighbor's moduleId so the move is visually preserved
  const updatedMoved = { ...moved, moduleId: neighbor.moduleId };
  swapped[idx] = neighbor;
  swapped[targetIdx] = updatedMoved;

  const reindexed = swapped.map((l, i) => ({ ...l, order: i }));
  const res = await sendBg(MESSAGE_ACTIONS.UPDATE_COURSE, {
    courseId,
    patch: { lessons: reindexed },
  });
  if (res?.ok && res.state) {
    modalState.suggestedSequence = null;
    notifyState(res.state);
    renderCoursesModal();
  }
}

/* ============================================================================
 * 2. FULL-SCREEN COURSE PLAYER
 * ========================================================================== */

/**
 * Open the Full-Screen Course Player overlay for `courseId` and optional `lessonId`.
 * @param {string} courseId
 * @param {string | null} [lessonId=null]
 */
export function openCoursePlayer(courseId, lessonId = null) {
  if (typeof document === 'undefined' || !document.body) return;
  ensureEscapeListener();

  const state = getState();
  const course = state?.courses?.[courseId];
  if (!course) {
    showToast(getLang() === 'en' ? 'Course not found.' : 'Curso não encontrado.', 'error');
    return;
  }

  // Close catalog modal if open so the player takes over cleanly
  if (modalState.isOpen) closeCoursesModal();

  const ordered = getOrderedLessons(course);
  const progress = getCourseProgress(course);

  let selectedLessonId = lessonId;
  if (!selectedLessonId || !ordered.some((l) => l.id === selectedLessonId || l.videoId === selectedLessonId)) {
    selectedLessonId = progress.nextLessonId || ordered[0]?.id || null;
  }

  playerState.isOpen = true;
  playerState.courseId = courseId;
  playerState.lessonId = selectedLessonId;
  playerState.renderedVideoId = null;
  playerState.focusMode = Boolean(state?.settings?.focusMode);
  playerState.collapsedModules = new Set();

  renderCoursePlayer({ preserveIframeIfSame: false });
}

/**
 * Close the Full-Screen Course Player overlay.
 */
function closeCoursePlayer() {
  playerState.isOpen = false;
  playerState.renderedVideoId = null;
  const el = document.getElementById(COURSE_PLAYER_ID);
  if (el) el.remove();
}

/**
 * Render or incrementally update the Full-Screen Course Player overlay.
 * @param {{ preserveIframeIfSame?: boolean }} [options]
 */
function renderCoursePlayer(options = {}) {
  if (typeof document === 'undefined' || !document.body) return;
  const state = getState();
  const lang = getLang();
  const course = playerState.courseId ? state?.courses?.[playerState.courseId] : null;
  if (!course) {
    closeCoursePlayer();
    return;
  }

  const ordered = getOrderedLessons(course);
  const progress = getCourseProgress(course);
  const groupedModules = groupLessonsByModules(course, lang);

  let activeIndex = ordered.findIndex(
    (l) => l.id === playerState.lessonId || l.videoId === playerState.lessonId
  );
  if (activeIndex < 0 && ordered.length > 0) {
    activeIndex = 0;
    playerState.lessonId = ordered[0].id;
  }
  const activeLesson = activeIndex >= 0 ? ordered[activeIndex] : null;
  const activeVideoId =
    activeLesson && VIDEO_ID_RE.test(activeLesson.videoId) ? activeLesson.videoId : '';
  const prevLesson = activeIndex > 0 ? ordered[activeIndex - 1] : null;
  const nextLesson = activeIndex >= 0 && activeIndex < ordered.length - 1 ? ordered[activeIndex + 1] : null;

  const moduleTitleMap = new Map(
    (Array.isArray(course.modules) ? course.modules : []).map((m) => [m.id, m.title])
  );
  const activeModuleTitle =
    activeLesson?.moduleId && moduleTitleMap.has(activeLesson.moduleId)
      ? moduleTitleMap.get(activeLesson.moduleId)
      : '';

  const courseColor = safeColor(/** @type {any} */ (course).color);
  const courseIcon = /** @type {any} */ (course).icon || DEFAULT_COURSE_ICON;

  let overlay = document.getElementById(COURSE_PLAYER_ID);
  const canPreserveIframe =
    Boolean(options.preserveIframeIfSame) &&
    Boolean(overlay) &&
    Boolean(activeVideoId) &&
    playerState.renderedVideoId === activeVideoId &&
    Boolean(overlay.querySelector('.tp-cp-video-shell iframe'));

  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = COURSE_PLAYER_ID;
    overlay.className = 'tp-cp-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    document.body.appendChild(overlay);
  }

  overlay.classList.toggle('is-focus', Boolean(playerState.focusMode));

  const topbarHtml = renderPlayerTopbarHtml(course, courseIcon, courseColor, progress, lang);
  const lessonMetaAndNavHtml = renderPlayerLessonControlsHtml(
    activeLesson,
    activeVideoId,
    activeModuleTitle,
    prevLesson,
    nextLesson,
    lang
  );
  const notesHtml = renderPlayerNotesHtml(state, activeVideoId, lang);
  const sidebarHtml = renderPlayerSidebarHtml(groupedModules, activeLesson, lang);

  if (canPreserveIframe) {
    // Update everything around the iframe so playback is never interrupted!
    const topbarEl = overlay.querySelector('.tp-cp-topbar');
    const controlsEl = overlay.querySelector('#tp-cp-controls-slot');
    const notesEl = overlay.querySelector('#tp-cp-notes-slot');
    const sidebarEl = overlay.querySelector('.tp-cp-sidebar');
    if (topbarEl) topbarEl.innerHTML = topbarHtml;
    if (controlsEl) controlsEl.innerHTML = lessonMetaAndNavHtml;
    if (notesEl) notesEl.innerHTML = notesHtml;
    if (sidebarEl) sidebarEl.innerHTML = sidebarHtml;
  } else {
    playerState.renderedVideoId = activeVideoId || null;
    const videoShellHtml = activeVideoId
      ? `<iframe src="https://www.youtube.com/embed/${encodeURIComponent(activeVideoId)}?rel=0" title="${escapeHtml(activeLesson?.title || course.title)}" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin"></iframe>`
      : `
        <div class="tp-cp-video-empty">
          <div style="font-size:36px;">🎬</div>
          <div>${escapeHtml(lang === 'en' ? 'Add lessons to this course to start watching.' : 'Adicione aulas a este curso para começar a assistir.')}</div>
          <button type="button" class="tp-btn tp-btn-primary tp-btn-sm" data-cp-action="organize">
            ${escapeHtml(lang === 'en' ? 'Organize Course' : 'Organizar Curso')}
          </button>
        </div>
      `;

    overlay.innerHTML = `
      <header class="tp-cp-topbar">${topbarHtml}</header>
      <div class="tp-cp-body">
        <main class="tp-cp-main">
          <div class="tp-cp-video-shell">${videoShellHtml}</div>
          <div id="tp-cp-controls-slot">${lessonMetaAndNavHtml}</div>
          <div id="tp-cp-notes-slot">${notesHtml}</div>
        </main>
        <aside class="tp-cp-sidebar">${sidebarHtml}</aside>
      </div>
    `;
  }

  bindCoursePlayerEvents(overlay, course, activeLesson, activeVideoId, prevLesson, nextLesson);
}

/**
 * Render Course Player top bar inner HTML.
 */
function renderPlayerTopbarHtml(course, courseIcon, courseColor, progress, lang) {
  const lessonsWord = lang === 'en' ? 'lessons' : 'aulas';
  return `
    <div class="tp-cp-topbar-left">
      <span class="tp-crs-brand-badge">🎓 ${escapeHtml(BRAND_NAME)} Courses</span>
      ${renderIconHtml(courseIcon, 18)}
      <h1 class="tp-cp-course-title">${escapeHtml(course.title)}</h1>
    </div>
    <div class="tp-cp-topbar-progress">
      <div class="tp-crs-progress-bar">
        <div class="tp-crs-progress-fill ${progress.percent === 100 ? 'is-complete' : ''}" style="width:${progress.percent}%; background:${progress.percent === 100 ? 'var(--tp-success)' : escapeHtml(courseColor)};"></div>
      </div>
      <span class="tp-cp-topbar-progress-label">${escapeHtml(`${progress.percent}% · ${progress.completedCount}/${progress.totalCount} ${lessonsWord}`)}</span>
    </div>
    <div class="tp-cp-topbar-actions">
      <button type="button" class="tp-btn tp-btn-secondary tp-btn-sm" data-cp-action="organize">
        ${escapeHtml(lang === 'en' ? 'Organize' : 'Organizar')}
      </button>
      <button type="button" class="tp-btn tp-btn-sm ${playerState.focusMode ? 'tp-btn-primary' : 'tp-btn-secondary'}" data-cp-action="toggle-focus">
        🎯 ${escapeHtml(t('focus.focusMode', lang))}
      </button>
      <button type="button" class="tp-btn-icon" data-cp-action="close-player" aria-label="${escapeHtml(t('common.close', lang))}">✕</button>
    </div>
  `;
}

/**
 * Render lesson header + course navigation bar HTML.
 */
function renderPlayerLessonControlsHtml(
  activeLesson,
  activeVideoId,
  activeModuleTitle,
  prevLesson,
  nextLesson,
  lang
) {
  if (!activeLesson) return '';

  const ytWatchUrl = activeVideoId
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(activeVideoId)}`
    : '';
  const durText = formatDurationClock(activeLesson.durationSec);
  const completeLabel = activeLesson.completed
    ? `✓ ${lang === 'en' ? 'Completed' : 'Concluída'}`
    : `✓ ${lang === 'en' ? 'Complete lesson' : 'Concluir aula'}`;
  const nextLabel =
    !activeLesson.completed && nextLesson
      ? lang === 'en'
        ? 'Complete & Next →'
        : 'Concluir e Próxima →'
      : lang === 'en'
        ? 'Next lesson →'
        : 'Próxima aula →';

  return `
    <div class="tp-cp-lesson-header">
      <div class="tp-cp-lesson-meta">
        <div class="tp-cp-lesson-pills">
          ${activeModuleTitle ? `<span class="tp-pill tp-pill-accent">${escapeHtml(activeModuleTitle)}</span>` : ''}
          ${activeLesson.channelTitle ? `<span class="tp-pill">${escapeHtml(activeLesson.channelTitle)}</span>` : ''}
          ${durText ? `<span class="tp-pill">⏱ ${escapeHtml(durText)}</span>` : ''}
        </div>
        <h2 class="tp-cp-lesson-title">${escapeHtml(activeLesson.title || activeLesson.videoId)}</h2>
      </div>
      ${
        ytWatchUrl
          ? `<a class="tp-btn tp-btn-secondary tp-btn-sm" href="${escapeHtml(ytWatchUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(lang === 'en' ? 'Open on YouTube' : 'Abrir no YouTube')} ↗</a>`
          : ''
      }
    </div>

    <div class="tp-cp-navbar">
      <button type="button" class="tp-btn tp-btn-secondary tp-btn-sm" data-cp-action="prev-lesson" ${prevLesson ? '' : 'disabled'}>
        ← ${escapeHtml(lang === 'en' ? 'Previous lesson' : 'Aula anterior')}
      </button>
      <div class="tp-cp-navbar-center">
        <button type="button" class="tp-btn tp-btn-secondary tp-btn-sm tp-cp-btn-complete ${activeLesson.completed ? 'is-completed' : ''}" data-cp-action="toggle-complete">
          ${escapeHtml(completeLabel)}
        </button>
      </div>
      <button type="button" class="tp-btn tp-btn-primary tp-btn-sm" data-cp-action="next-lesson" ${nextLesson ? '' : 'disabled'}>
        ${escapeHtml(nextLabel)}
      </button>
    </div>
  `;
}

/**
 * Render Lesson Notes section HTML below the video player.
 * @param {import('../shared/types.js').AppState | null} state
 * @param {string} videoId
 * @param {'pt-BR' | 'en'} lang
 */
function renderPlayerNotesHtml(state, videoId, lang) {
  if (!videoId) return '';
  const notes = Array.isArray(state?.videoNotes?.[videoId])
    ? [...state.videoNotes[videoId]].sort(
        (a, b) => (a.timestampSec || 0) - (b.timestampSec || 0) || (a.createdAt || 0) - (b.createdAt || 0)
      )
    : [];

  const notesListHtml =
    notes.length === 0
      ? `<p class="tp-ins-empty-note">${escapeHtml(
          lang === 'en'
            ? 'No study notes for this lesson yet.'
            : 'Nenhuma nota de estudo para esta aula ainda.'
        )}</p>`
      : notes
          .map((note) => {
            const tsLabel = note.timestampSec > 0 ? formatDurationClock(note.timestampSec) : '';
            const dateStr = note.createdAt
              ? new Date(note.createdAt).toLocaleDateString(lang === 'en' ? 'en-US' : 'pt-BR')
              : '';
            return `
              <div class="tp-cp-note-item">
                <div class="tp-cp-note-content">
                  <div class="tp-cp-note-meta">
                    ${tsLabel ? `<span class="tp-pill tp-pill-accent">⏱ ${escapeHtml(tsLabel)}</span>` : ''}
                    ${dateStr ? `<span>${escapeHtml(dateStr)}</span>` : ''}
                  </div>
                  <div class="tp-cp-note-text">${escapeHtml(note.text)}</div>
                </div>
                <button type="button" class="tp-btn-icon" data-cp-delete-note="${escapeHtml(note.id)}" title="${escapeHtml(t('common.delete', lang))}" aria-label="${escapeHtml(t('common.delete', lang))}">✕</button>
              </div>
            `;
          })
          .join('');

  return `
    <section class="tp-cp-notes">
      <h3 class="tp-cp-notes-title">📝 ${escapeHtml(lang === 'en' ? 'Lesson Notes' : 'Notas da Aula')} <span class="tp-badge">${notes.length}</span></h3>
      <form id="tp-cp-note-form" class="tp-cp-notes-form">
        <input id="tp-cp-note-time" class="tp-input tp-cp-notes-time-input" type="text" placeholder="00:00" title="${escapeHtml(lang === 'en' ? 'Optional timestamp (MM:SS)' : 'Tempo opcional (MM:SS)')}" />
        <input id="tp-cp-note-text" class="tp-input tp-cp-notes-text-input" type="text" required maxlength="1000" placeholder="${escapeHtml(t('notes.notePlaceholder', lang))}" />
        <button type="submit" class="tp-btn tp-btn-primary tp-btn-sm">+ ${escapeHtml(t('notes.addNote', lang))}</button>
      </form>
      <div class="tp-cp-notes-list">${notesListHtml}</div>
    </section>
  `;
}

/**
 * Render Right Sidebar Curriculum HTML grouped by modules.
 */
function renderPlayerSidebarHtml(groupedModules, activeLesson, lang) {
  let globalNumber = 0;

  const modulesHtml = groupedModules
    .map((mod) => {
      const collapsed = playerState.collapsedModules.has(mod.id);
      const completedInMod = mod.lessons.filter((l) => l.completed).length;

      const lessonsHtml = mod.lessons
        .map((lesson) => {
          globalNumber++;
          const isActive = activeLesson && lesson.id === activeLesson.id;
          const dur = formatDurationClock(lesson.durationSec);
          return `
            <div class="tp-cp-lesson-item ${isActive ? 'is-active' : ''} ${lesson.completed ? 'is-completed' : ''}" data-cp-select-lesson="${escapeHtml(lesson.id)}">
              <input type="checkbox" class="tp-cp-lesson-check" data-cp-check-lesson="${escapeHtml(lesson.id)}" ${lesson.completed ? 'checked' : ''} aria-label="${escapeHtml(t('courses.completeLesson', lang))}" />
              <div class="tp-cp-lesson-item-body">
                <div class="tp-cp-lesson-item-title">${globalNumber}. ${escapeHtml(lesson.title || lesson.videoId)}</div>
                <div class="tp-cp-lesson-item-meta">
                  ${dur ? `<span>${escapeHtml(dur)}</span>` : ''}
                  ${isActive ? `<span class="tp-pill tp-pill-accent">${escapeHtml(lang === 'en' ? 'Playing' : 'Assistindo')}</span>` : ''}
                </div>
              </div>
            </div>
          `;
        })
        .join('');

      return `
        <div class="tp-cp-module ${collapsed ? 'is-collapsed' : ''}" data-cp-module="${escapeHtml(mod.id)}">
          <button type="button" class="tp-cp-module-header" data-cp-toggle-module="${escapeHtml(mod.id)}">
            <span class="tp-cp-module-title-wrap">
              <span class="tp-cp-module-chevron">▾</span>
              <span>${escapeHtml(mod.title)}</span>
            </span>
            <span class="tp-cp-module-count">${completedInMod}/${mod.lessons.length}</span>
          </button>
          <div class="tp-cp-module-lessons">${lessonsHtml}</div>
        </div>
      `;
    })
    .join('');

  return `
    <div class="tp-cp-sidebar-header">
      <span>📚 ${escapeHtml(lang === 'en' ? 'Course Curriculum' : 'Conteúdo do Curso')}</span>
      <span class="tp-badge">${globalNumber}</span>
    </div>
    <div class="tp-cp-curriculum">
      ${
        modulesHtml ||
        `<div style="padding:16px;"><p class="tp-ins-empty-note">${escapeHtml(t('common.empty', lang))}</p></div>`
      }
    </div>
  `;
}

/**
 * Bind all Course Player events (top bar, nav bar, notes form, sidebar curriculum).
 */
function bindCoursePlayerEvents(overlay, course, activeLesson, activeVideoId, prevLesson, nextLesson) {
  const lang = getLang();

  overlay.querySelectorAll('[data-cp-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const action = btn.getAttribute('data-cp-action');

      if (action === 'close-player') {
        closeCoursePlayer();
        return;
      }
      if (action === 'organize') {
        const cid = course.id;
        closeCoursePlayer();
        openCoursesModal(cid);
        return;
      }
      if (action === 'toggle-focus') {
        playerState.focusMode = !playerState.focusMode;
        overlay.classList.toggle('is-focus', playerState.focusMode);
        toggleFocusModeCss(playerState.focusMode);
        const res = await sendBg(MESSAGE_ACTIONS.UPDATE_SETTINGS, {
          settings: { focusMode: playerState.focusMode },
        });
        if (res?.ok && res.state) {
          notifyState(res.state);
        } else {
          renderCoursePlayer({ preserveIframeIfSame: true });
        }
        return;
      }
      if (action === 'prev-lesson' && prevLesson) {
        playerState.lessonId = prevLesson.id;
        renderCoursePlayer({ preserveIframeIfSame: false });
        return;
      }
      if (action === 'toggle-complete' && activeLesson) {
        const res = await sendBg(MESSAGE_ACTIONS.TOGGLE_LESSON_COMPLETE, {
          courseId: course.id,
          lessonId: activeLesson.id,
        });
        if (res?.ok && res.state) {
          notifyState(res.state);
          renderCoursePlayer({ preserveIframeIfSame: true });
        }
        return;
      }
      if (action === 'next-lesson' && nextLesson) {
        if (activeLesson && !activeLesson.completed) {
          const res = await sendBg(MESSAGE_ACTIONS.TOGGLE_LESSON_COMPLETE, {
            courseId: course.id,
            lessonId: activeLesson.id,
            completed: true,
          });
          if (res?.ok && res.state) {
            notifyState(res.state);
          }
        }
        playerState.lessonId = nextLesson.id;
        renderCoursePlayer({ preserveIframeIfSame: false });
      }
    });
  });

  // Collapsible module headers
  overlay.querySelectorAll('[data-cp-toggle-module]').forEach((hdr) => {
    hdr.addEventListener('click', () => {
      const modId = hdr.getAttribute('data-cp-toggle-module');
      if (!modId) return;
      if (playerState.collapsedModules.has(modId)) {
        playerState.collapsedModules.delete(modId);
      } else {
        playerState.collapsedModules.add(modId);
      }
      const modEl = hdr.closest('.tp-cp-module');
      if (modEl) modEl.classList.toggle('is-collapsed', playerState.collapsedModules.has(modId));
    });
  });

  // Lesson completion checkboxes in sidebar
  overlay.querySelectorAll('[data-cp-check-lesson]').forEach((cb) => {
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', async () => {
      const targetLessonId = cb.getAttribute('data-cp-check-lesson');
      if (!targetLessonId) return;
      const checked = /** @type {HTMLInputElement} */ (cb).checked;
      const res = await sendBg(MESSAGE_ACTIONS.TOGGLE_LESSON_COMPLETE, {
        courseId: course.id,
        lessonId: targetLessonId,
        completed: checked,
      });
      if (res?.ok && res.state) {
        notifyState(res.state);
        renderCoursePlayer({ preserveIframeIfSame: true });
      }
    });
  });

  // Click any lesson row to load it immediately
  overlay.querySelectorAll('[data-cp-select-lesson]').forEach((row) => {
    row.addEventListener('click', () => {
      const targetLessonId = row.getAttribute('data-cp-select-lesson');
      if (!targetLessonId || targetLessonId === playerState.lessonId) return;
      playerState.lessonId = targetLessonId;
      renderCoursePlayer({ preserveIframeIfSame: false });
    });
  });

  // Lesson Notes form submit
  const noteForm = overlay.querySelector('#tp-cp-note-form');
  if (noteForm && activeVideoId) {
    noteForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const timeEl = /** @type {HTMLInputElement | null} */ (
        overlay.querySelector('#tp-cp-note-time')
      );
      const textEl = /** @type {HTMLInputElement | null} */ (
        overlay.querySelector('#tp-cp-note-text')
      );
      const text = (textEl?.value || '').trim();
      if (!text) return;

      const rawTime = (timeEl?.value || '').trim();
      const timestampSec = rawTime ? parseDurationToSeconds(rawTime) : 0;

      const res = await sendBg(MESSAGE_ACTIONS.UPSERT_VIDEO_NOTE, {
        videoId: activeVideoId,
        note: { timestampSec, text },
      });
      if (res?.ok && res.state) {
        notifyState(res.state);
        showToast(t('toast.saved', lang), 'success');
        renderCoursePlayer({ preserveIframeIfSame: true });
      } else {
        showToast(t('toast.error', lang, { message: res?.error || 'Failed' }), 'error');
      }
    });
  }

  // Delete note buttons
  overlay.querySelectorAll('[data-cp-delete-note]').forEach((delBtn) => {
    delBtn.addEventListener('click', async () => {
      const noteId = delBtn.getAttribute('data-cp-delete-note');
      if (!noteId || !activeVideoId) return;
      const res = await sendBg(MESSAGE_ACTIONS.DELETE_VIDEO_NOTE, {
        videoId: activeVideoId,
        noteId,
      });
      if (res?.ok && res.state) {
        notifyState(res.state);
        renderCoursePlayer({ preserveIframeIfSame: true });
      }
    });
  });
}

/* ============================================================================
 * 3. INSIGHTS DASHBOARD MODAL
 * ========================================================================== */

/**
 * Open the Library Insights & Analytics Dashboard modal.
 */
export function openInsightsModal() {
  if (typeof document === 'undefined' || !document.body) return;
  ensureEscapeListener();
  insightsState.isOpen = true;
  renderInsightsModal();
}

/**
 * Close the Insights Dashboard modal.
 */
function closeInsightsModal() {
  insightsState.isOpen = false;
  const el = document.getElementById(INSIGHTS_MODAL_ID);
  if (el) el.remove();
}

/**
 * Render (or re-render) the Insights Dashboard modal using `computeInsights(state)`.
 */
function renderInsightsModal() {
  if (typeof document === 'undefined' || !document.body) return;
  const state = getState();
  const lang = getLang();
  const insights = computeInsights(state);

  let backdrop = document.getElementById(INSIGHTS_MODAL_ID);
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = INSIGHTS_MODAL_ID;
    backdrop.className = 'tp-modal-backdrop';
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeInsightsModal();
    });
    document.body.appendChild(backdrop);
  }

  const { totals, channelHealth, playlistsSummary, coursesSummary, topGroups } = insights;

  // Channel health percentages for stacked bar
  const chTotal =
    channelHealth.active + channelHealth.slow + channelHealth.inactive + channelHealth.dead;
  const pct = (n) => (chTotal > 0 ? ((n / chTotal) * 100).toFixed(1) : '0');

  const topPlaylistsHtml =
    playlistsSummary.topPlaylists.length === 0
      ? `<p class="tp-ins-empty-note">${escapeHtml(t('common.empty', lang))}</p>`
      : playlistsSummary.topPlaylists
          .slice(0, 6)
          .map(
            (pl) => `
              <div class="tp-ins-list-row">
                <div class="tp-ins-list-row-top">
                  <span class="tp-ins-list-name">${escapeHtml(pl.title)}</span>
                  <span class="tp-ins-list-val">${pl.watchedCount}/${pl.videoCount} · ${pl.percent}%</span>
                </div>
                <div class="tp-crs-progress-bar">
                  <div class="tp-crs-progress-fill ${pl.percent === 100 ? 'is-complete' : ''}" style="width:${pl.percent}%;"></div>
                </div>
              </div>
            `
          )
          .join('');

  const maxGroupChannels = topGroups.reduce((max, g) => Math.max(max, g.channelCount), 0) || 1;
  const topGroupsHtml =
    topGroups.length === 0
      ? `<p class="tp-ins-empty-note">${escapeHtml(t('common.empty', lang))}</p>`
      : topGroups
          .slice(0, 6)
          .map((g) => {
            const barWidth = Math.round((g.channelCount / maxGroupChannels) * 100);
            const gColor = safeColor(g.color);
            return `
              <div class="tp-ins-list-row">
                <div class="tp-ins-list-row-top">
                  <span class="tp-ins-list-name">${renderIconHtml(g.icon, 15)} ${escapeHtml(g.name)}</span>
                  <span class="tp-ins-list-val">${g.channelCount} ${escapeHtml(lang === 'en' ? 'channels' : 'canais')}</span>
                </div>
                <div class="tp-crs-progress-bar">
                  <div class="tp-crs-progress-fill" style="width:${barWidth}%; background:${escapeHtml(gColor)};"></div>
                </div>
              </div>
            `;
          })
          .join('');

  backdrop.innerHTML = `
    <div class="tp-modal tp-ins-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(`${BRAND_NAME} ${t('insights.insights', lang)}`)}">
      <div class="tp-modal-header">
        <div class="tp-crs-header-left">
          <span class="tp-crs-brand-badge">📊 ${escapeHtml(BRAND_NAME)}</span>
          <h2 class="tp-modal-title">${escapeHtml(t('insights.insights', lang))}</h2>
        </div>
        <button type="button" class="tp-btn-icon" data-ins-action="close" aria-label="${escapeHtml(t('common.close', lang))}">✕</button>
      </div>

      <div class="tp-modal-body">
        <div class="tp-ins-kpi-grid">
          <div class="tp-ins-kpi-card">
            <span class="tp-ins-kpi-value">${totals.channels}</span>
            <span class="tp-ins-kpi-label">${escapeHtml(lang === 'en' ? 'Channels' : 'Canais')}</span>
          </div>
          <div class="tp-ins-kpi-card">
            <span class="tp-ins-kpi-value">${totals.groups}</span>
            <span class="tp-ins-kpi-label">${escapeHtml(lang === 'en' ? 'Groups' : 'Grupos')}</span>
          </div>
          <div class="tp-ins-kpi-card">
            <span class="tp-ins-kpi-value">${totals.playlists}</span>
            <span class="tp-ins-kpi-label">${escapeHtml(lang === 'en' ? 'Playlists' : 'Playlists')}</span>
          </div>
          <div class="tp-ins-kpi-card">
            <span class="tp-ins-kpi-value">${totals.courses}</span>
            <span class="tp-ins-kpi-label">${escapeHtml(t('courses.courses', lang))}</span>
          </div>
          <div class="tp-ins-kpi-card">
            <span class="tp-ins-kpi-value">${totals.watchedVideos}</span>
            <span class="tp-ins-kpi-label">${escapeHtml(lang === 'en' ? 'Watched Videos' : 'Vídeos Assistidos')}</span>
          </div>
          <div class="tp-ins-kpi-card">
            <span class="tp-ins-kpi-value">${totals.videoNotes}</span>
            <span class="tp-ins-kpi-label">${escapeHtml(lang === 'en' ? 'Study Notes' : 'Notas de Estudo')}</span>
          </div>
        </div>

        <div class="tp-ins-sections-grid">
          <section class="tp-ins-section">
            <h3 class="tp-ins-section-title">
              <span>⏱ ${escapeHtml(lang === 'en' ? 'Playlist Time' : 'Tempo de Playlists')}</span>
              <span class="tp-badge">${playlistsSummary.watchedVideos}/${playlistsSummary.totalVideos}</span>
            </h3>
            <div class="tp-ins-time-stats">
              <div class="tp-ins-time-box">
                <span class="tp-ins-time-val">${escapeHtml(formatDurationHuman(playlistsSummary.totalDurationSec))}</span>
                <span class="tp-ins-time-lbl">${escapeHtml(t('insights.totalWatchTime', lang))}</span>
              </div>
              <div class="tp-ins-time-box">
                <span class="tp-ins-time-val">${escapeHtml(formatDurationHuman(playlistsSummary.remainingDurationSec))}</span>
                <span class="tp-ins-time-lbl">${escapeHtml(t('insights.remainingTime', lang))}</span>
              </div>
            </div>
            <div class="tp-ins-list">${topPlaylistsHtml}</div>
          </section>

          <section class="tp-ins-section">
            <h3 class="tp-ins-section-title">
              <span>💚 ${escapeHtml(t('insights.channelHealth', lang))}</span>
              <span class="tp-badge">${chTotal}</span>
            </h3>
            <div class="tp-ins-health-bar" role="img" aria-label="${escapeHtml(t('insights.channelHealth', lang))}">
              <div class="tp-ins-health-seg is-active" style="width:${pct(channelHealth.active)}%;" title="${escapeHtml(lang === 'en' ? 'Active' : 'Ativos')}: ${channelHealth.active}"></div>
              <div class="tp-ins-health-seg is-slow" style="width:${pct(channelHealth.slow)}%;" title="${escapeHtml(lang === 'en' ? 'Slow' : 'Lentos')}: ${channelHealth.slow}"></div>
              <div class="tp-ins-health-seg is-inactive" style="width:${pct(channelHealth.inactive)}%;" title="${escapeHtml(lang === 'en' ? 'Inactive' : 'Inativos')}: ${channelHealth.inactive}"></div>
              <div class="tp-ins-health-seg is-dead" style="width:${pct(channelHealth.dead)}%;" title="${escapeHtml(lang === 'en' ? 'No activity' : 'Sem atividade')}: ${channelHealth.dead}"></div>
            </div>
            <div class="tp-ins-health-legend">
              <div class="tp-ins-legend-item">
                <span class="tp-ins-legend-left"><span class="tp-ins-dot is-active"></span>${escapeHtml(lang === 'en' ? 'Active' : 'Ativos')}</span>
                <strong>${channelHealth.active}</strong>
              </div>
              <div class="tp-ins-legend-item">
                <span class="tp-ins-legend-left"><span class="tp-ins-dot is-slow"></span>${escapeHtml(lang === 'en' ? 'Slow' : 'Lentos')}</span>
                <strong>${channelHealth.slow}</strong>
              </div>
              <div class="tp-ins-legend-item">
                <span class="tp-ins-legend-left"><span class="tp-ins-dot is-inactive"></span>${escapeHtml(lang === 'en' ? 'Inactive' : 'Inativos')}</span>
                <strong>${channelHealth.inactive}</strong>
              </div>
              <div class="tp-ins-legend-item">
                <span class="tp-ins-legend-left"><span class="tp-ins-dot is-dead"></span>${escapeHtml(lang === 'en' ? 'No activity' : 'Sem atividade')}</span>
                <strong>${channelHealth.dead}</strong>
              </div>
            </div>

            <h3 class="tp-ins-section-title" style="margin-top:8px;">
              <span>🎓 ${escapeHtml(lang === 'en' ? 'Course Progress' : 'Progresso dos Cursos')}</span>
              <span class="tp-badge">${coursesSummary.avgProgressPercent}%</span>
            </h3>
            <div class="tp-ins-course-stats">
              <div class="tp-ins-time-box">
                <span class="tp-ins-time-val">${coursesSummary.totalLessons}</span>
                <span class="tp-ins-time-lbl">${escapeHtml(lang === 'en' ? 'Total Lessons' : 'Total de Aulas')}</span>
              </div>
              <div class="tp-ins-time-box">
                <span class="tp-ins-time-val">${coursesSummary.completedLessons}</span>
                <span class="tp-ins-time-lbl">${escapeHtml(lang === 'en' ? 'Completed' : 'Concluídas')}</span>
              </div>
              <div class="tp-ins-time-box">
                <span class="tp-ins-time-val">${coursesSummary.avgProgressPercent}%</span>
                <span class="tp-ins-time-lbl">${escapeHtml(lang === 'en' ? 'Average %' : 'Média %')}</span>
              </div>
            </div>
            <div class="tp-crs-progress-bar">
              <div class="tp-crs-progress-fill ${coursesSummary.avgProgressPercent === 100 ? 'is-complete' : ''}" style="width:${coursesSummary.avgProgressPercent}%;"></div>
            </div>
          </section>

          <section class="tp-ins-section tp-ins-section-full">
            <h3 class="tp-ins-section-title">
              <span>📂 ${escapeHtml(lang === 'en' ? 'Largest Groups' : 'Maiores Grupos')}</span>
              <span class="tp-badge">${topGroups.length}</span>
            </h3>
            <div class="tp-ins-list">${topGroupsHtml}</div>
          </section>
        </div>
      </div>
    </div>
  `;

  const closeBtn = backdrop.querySelector('[data-ins-action="close"]');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeInsightsModal);
  }
}
