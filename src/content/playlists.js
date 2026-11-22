/**
 * @fileoverview PlayShelf YouTube Playlist Manager (Pro-level).
 *
 * Features:
 * - Save-to-Playlist Modal Injection across ALL YouTube pages (classic + modern Wiz dialogs)
 *   with live search filtering native & PlayShelf playlists, PlayShelf custom playlist checklist,
 *   and inline "+ Nova Playlist" quick creator
 * - /watch Action Bar: "+ PlayShelf" quick-save popover & "📝 Notas" Video Notes & Timestamps
 * - /feed/playlists: Native card enhancements + injected PlayShelf custom playlist cards
 * - Native Playlist Page (/playlist?list=...):
 *   - Left sidebar stats (Total Duration, reverse/sort buttons, Watched %, circular action icons)
 *   - Top toolbar (Filter, Search, Hide Watched, Select All, Sort, selection counter, circular bulk buttons)
 *   - Every video row: top-right thumbnail checkbox + 1-click Trash button above native ⋮ menu
 * - Full Custom Playlist Detail View (`openCustomPlaylistView(playlistId)`):
 *   - Two-column YouTube-native layout (left gradient info card + right scrollable video list)
 *   - Full 10-item ⋮ context menu, bulk actions, inline editing, export, notes, and reorder
 * - Playlist Group View Drawer (clicking custom playlists opens `openCustomPlaylistView`)
 * - Keyboard Shortcuts: Shift+W (toggle watched), Shift+F (focus search), Shift+S (toggle multi-select)
 */

import { BRAND_NAME } from '../shared/brand.js';
import { MESSAGE_ACTIONS, GROUP_KINDS } from '../shared/types.js';
import {
  DEFAULT_GROUP_COLORS,
  ICON_CATEGORIES,
  searchIcons,
  renderIconHtml,
  resizeImageToDataUrl,
} from '../shared/icons.js';
import { t } from '../shared/i18n.js';
import {
  sendBg,
  getPageContext,
  parseDurationToSeconds,
  parseViewsCount,
  showToast,
  getCurrentWatchVideoInfo,
  seekVideoPlayer,
  toggleFocusModeCss,
} from './yt-dom.js';

/* ============================================================================
 * LOCAL BILINGUAL STRINGS
 * ========================================================================== */

const PL_STRINGS = {
  'pt-BR': {
    searchPlaceholder: 'Buscar por título ou canal...',
    statusAll: 'Todos',
    statusUnwatched: 'Não assistidos',
    statusWatched: 'Assistidos',
    durAll: 'Qualquer duração',
    durUnder5: '< 5 min',
    dur5to20: '5–20 min',
    durOver20: '> 20 min',
    durCustom: 'Personalizado',
    minPlaceholder: 'Mín',
    maxPlaceholder: 'Máx',
    hideShorts: 'Ocultar Shorts',
    hideWatched: 'Ocultar assistidos',
    sortDateDesc: 'Data de inclusão (mais recente)',
    sortOriginal: 'Ordem personalizada',
    sortDurAsc: 'Duração (menor → maior)',
    sortDurDesc: 'Duração (maior → menor)',
    sortViewsDesc: 'Visualizações (maior)',
    sortTitleAsc: 'Título (A → Z)',
    sortTitleDesc: 'Título (Z → A)',
    sortChannelAsc: 'Canal (A → Z)',
    multiSelect: 'Seleção múltipla',
    resetFilters: 'Limpar filtros',
    totalDur: 'Total',
    remainingDur: 'Restante',
    showingCount: 'Exibindo {visible} de {total}',
    assignGroups: 'Grupos',
    assignPlaylistTitle: 'Atribuir playlist aos grupos',
    noPlaylistGroups: 'Nenhum grupo de playlists criado ainda.',
    newPlaylistGroup: '+ Novo Grupo de Playlists',
    selectedCount: '{count} selecionada(s)',
    selectAllVisible: 'Sel. visíveis',
    selectWatched: 'Sel. assistidos',
    invertSelection: 'Inverter',
    clearSelection: 'Limpar',
    markWatched: 'Marcar assistidos',
    markUnwatched: 'Desmarcar assistidos',
    playQueue: 'Fila / Reproduzir',
    copyMove: 'Salvar na playlist',
    removeSelected: 'Remover',
    queueTruncated: 'YouTube limita filas temporárias a 50 vídeos. Abrindo os primeiros 50.',
    noSelection: 'Selecione ao menos um vídeo.',
    removeConfirmTitle: 'Remover vídeos da playlist?',
    removeConfirmBody:
      'Isso acionará o menu nativo do YouTube para remover {count} vídeo(s) sequencialmente. Você pode cancelar a qualquer momento.',
    removingProgress: 'Removendo {done} de {total}...',
    removeCancelled: 'Remoção cancelada ({done}/{total} removidos).',
    removeDone: '{done} vídeo(s) removido(s) da playlist.',
    copyMoveTitle: 'Salvar {count} vídeo(s) em playlist',
    copyMoveVirtualTitle: `Criar Nova Playlist ${BRAND_NAME}`,
    copyMoveVirtualPlaceholder: 'Nome da nova playlist...',
    copyMoveVirtualBtn: 'Criar e Salvar Vídeos',
    copyMoveExistingCustom: `Adicionar a uma Playlist ${BRAND_NAME} existente`,
    copyMoveExistingTitle: 'Ou abrir diálogo "Salvar na playlist" do YouTube',
    copyMoveNativeHint:
      `Salve os vídeos selecionados em uma playlist personalizada do ${BRAND_NAME} (acessível na sidebar, em /feed/playlists e no Deck) ou abra o diálogo nativo do YouTube.`,
    copyMoveNativeBtn: 'Abrir "Salvar na playlist" (1º selecionado)',
    copyMoveGroupLabel: 'Adicionar playlist ao grupo (opcional)',
    virtualCreated: 'Playlist "{title}" criada com {count} vídeo(s)!',
    addedToPlaylist: 'Adicionado a "{title}"!',
    removedFromPlaylist: 'Removido de "{title}".',
    groupViewAll: 'Todas as Playlists',
    includeSubgroups: 'Incluir subgrupos',
    sortPlTitle: 'Título (A-Z)',
    sortPlCount: 'Qtd. de vídeos',
    sortPlWatchedDesc: '% Assistido (maior)',
    sortPlWatchedAsc: '% Assistido (menor)',
    sortPlUpdated: 'Atualizado recentemente',
    openPlaylist: 'Abrir',
    playAll: 'Reproduzir tudo',
    editGroups: 'Grupos',
    removeFromGroup: 'Remover do grupo',
    videosCount: '{count} vídeos',
    noPlaylistsInGroup: 'Nenhuma playlist neste grupo ainda. Abra qualquer playlist no YouTube e clique em "Grupos" para adicioná-la.',
    groupNamePlaceholder: 'Nome do grupo de playlists...',
    parentGroup: 'Grupo pai',
    rootNone: 'Nenhum (Raiz)',
    createGroupBtn: 'Criar Grupo',
    iconSearchPlaceholder: 'Buscar ícone...',
    uploadIcon: 'Enviar imagem',
    watchedMarked: 'Marcado como assistido',
    watchedUnmarked: 'Desmarcado como assistido',
    multiSelectOn: 'Modo seleção múltipla ativado',
    multiSelectOff: 'Modo seleção múltipla desativado',
    groupsSaved: 'Grupos da playlist atualizados!',
    removedFromGroup: 'Playlist removida do grupo.',
    groupCreated: 'Grupo "{name}" criado!',
    playlistSaved: 'Playlist adicionada aos grupos.',
    saveModalTitle: `${BRAND_NAME} — Minhas Playlists`,
    saveModalSearch: 'Filtrar playlists...',
    newPlaylistBtn: '+ Nova Playlist',
    newPlaylistPlaceholder: 'Nome da playlist...',
    noCustomPlaylists: 'Nenhuma playlist personalizada ainda. Crie uma abaixo!',
    videoNotesTitle: 'Notas & Timestamps',
    notePlaceholder: 'Escreva uma anotação para este momento...',
    addNoteBtn: '+ Adicionar',
    noNotesYet: 'Nenhuma nota para este vídeo ainda.',
    noteAdded: 'Nota salva!',
    noteDeleted: 'Nota removida.',
    copiedLink: 'Link copiado para a área de transferência!',
    addVideoUrlPlaceholder: 'Cole URL ou ID do vídeo do YouTube...',
    addVideoTitlePlaceholder: 'Título (opcional)',
    addVideoBtn: 'Adicionar vídeo',
    invalidVideoUrl: 'URL ou ID de vídeo inválido.',
    reverseOrder: 'Inverter ordem',
    removeWatched: 'Remover assistidos',
    copyAllToPlaylist: 'Copiar para outra playlist',
    exportJson: 'Exportar JSON',
    exportUrls: 'Exportar URLs (.txt)',
    deletePlaylist: 'Excluir playlist',
    deletePlaylistConfirm: 'Tem certeza que deseja excluir a playlist "{title}"?',
    playlistDeleted: 'Playlist excluída.',
    editPlaylist: 'Editar playlist',
    descriptionPlaceholder: 'Adicionar descrição...',
    ctxAddQueue: 'Adicionar à fila',
    ctxWatchLater: 'Salvar em "Assistir mais tarde"',
    ctxSaveToPl: 'Salvar na playlist',
    ctxRemoveFrom: 'Remover de {title}',
    ctxCopyUrl: 'Copiar URL / Exportar',
    ctxShare: 'Compartilhar',
    ctxMoveTop: 'Mover para o início',
    ctxMoveBottom: 'Mover para o fim',
    ctxSetThumb: 'Definir como miniatura da playlist',
    ctxNotes: 'Notas & Timestamps',
    thumbUpdated: 'Miniatura da playlist atualizada!',
    movedToTop: 'Vídeo movido para o início.',
    movedToBottom: 'Vídeo movido para o fim.',
    noWatchedToRemove: 'Nenhum vídeo assistido para remover.',
    removedWatchedCount: '{count} vídeo(s) assistido(s) removido(s).',
    qbPlaylist: '+ Playlist',
    qbCourse: '+ Curso',
    qbWatched: 'Assistido',
    qbNotes: 'Notas',
    qbFocus: 'Foco',
    qbFocusOn: 'Modo Foco ativado',
    qbFocusOff: 'Modo Foco desativado',
    coursePopoverTitle: 'Adicionar ao Curso',
    courseSearchPlaceholder: 'Filtrar cursos...',
    newCoursePlaceholder: '+ Novo curso...',
    noCoursesYet: 'Nenhum curso ainda. Crie um abaixo!',
    courseCreated: 'Curso "{title}" criado com {count} aula(s)!',
    addedToCourse: 'Adicionado ao curso "{title}"!',
    removedFromCourse: 'Removido do curso "{title}".',
    convertToCourse: 'Transformar em Curso',
    convertToCourseEmpty: 'Nenhum vídeo carregado nesta playlist para criar curso.',
    cardQuickAddTitle: `Adicionar à Playlist ${BRAND_NAME}`,
    quickCreatePlaylistPlaceholder: '+ Nova playlist...',
    quickSaveBtn: 'Criar',
    customizePlaylist: 'Personalizar',
    customizeModalTitle: 'Personalizar aparência da playlist',
    customizeLayoutHint: `Esta personalização altera apenas o visual na barra lateral e nas telas do ${BRAND_NAME}. O menu nativo do YouTube permanece intacto.`,
    customizeSaved: 'Personalização da playlist salva!',
    customThumbLabel: 'Imagem / Capa personalizada',
    customThumbPlaceholder: 'Cole uma URL (https://...) ou envie uma imagem abaixo',
    uploadCover: 'Enviar capa',
    clearCover: 'Remover imagem',
    resetAppearance: 'Restaurar padrão',
    sidebarPreview: `Prévia na barra lateral (${BRAND_NAME})`,
    noPlaylistsYet: 'Nenhuma playlist encontrada ainda. Visite /feed/playlists ou crie uma playlist personalizada.',
  },
  en: {
    searchPlaceholder: 'Search by title or channel...',
    statusAll: 'All',
    statusUnwatched: 'Unwatched',
    statusWatched: 'Watched',
    durAll: 'Any duration',
    durUnder5: '< 5 min',
    dur5to20: '5–20 min',
    durOver20: '> 20 min',
    durCustom: 'Custom',
    minPlaceholder: 'Min',
    maxPlaceholder: 'Max',
    hideShorts: 'Hide Shorts',
    hideWatched: 'Hide watched',
    sortDateDesc: 'Date added (newest)',
    sortOriginal: 'Custom order',
    sortDurAsc: 'Duration (shortest)',
    sortDurDesc: 'Duration (longest)',
    sortViewsDesc: 'Views (highest)',
    sortTitleAsc: 'Title (A → Z)',
    sortTitleDesc: 'Title (Z → A)',
    sortChannelAsc: 'Channel (A → Z)',
    multiSelect: 'Multi-select',
    resetFilters: 'Reset filters',
    totalDur: 'Total',
    remainingDur: 'Remaining',
    showingCount: 'Showing {visible} of {total}',
    assignGroups: 'Groups',
    assignPlaylistTitle: 'Assign playlist to groups',
    noPlaylistGroups: 'No playlist groups created yet.',
    newPlaylistGroup: '+ New Playlist Group',
    selectedCount: '{count} selected',
    selectAllVisible: 'Select visible',
    selectWatched: 'Select watched',
    invertSelection: 'Invert',
    clearSelection: 'Clear',
    markWatched: 'Mark watched',
    markUnwatched: 'Mark unwatched',
    playQueue: 'Play queue',
    copyMove: 'Save to playlist',
    removeSelected: 'Remove',
    queueTruncated: 'YouTube limits temporary queues to 50 videos. Opening the first 50.',
    noSelection: 'Select at least one video first.',
    removeConfirmTitle: 'Remove videos from playlist?',
    removeConfirmBody:
      'This will trigger YouTube’s native menu to remove {count} video(s) sequentially. You can cancel at any time.',
    removingProgress: 'Removing {done} of {total}...',
    removeCancelled: 'Removal cancelled ({done}/{total} removed).',
    removeDone: 'Removed {done} video(s) from playlist.',
    copyMoveTitle: 'Save {count} video(s) to playlist',
    copyMoveVirtualTitle: `Create New ${BRAND_NAME} Playlist`,
    copyMoveVirtualPlaceholder: 'New playlist name...',
    copyMoveVirtualBtn: 'Create & Save Videos',
    copyMoveExistingCustom: `Add to an existing ${BRAND_NAME} Playlist`,
    copyMoveExistingTitle: 'Or open YouTube’s native "Save to playlist" dialog',
    copyMoveNativeHint:
      `Save selected videos into a custom ${BRAND_NAME} playlist (accessible in sidebar, /feed/playlists, and Deck) or trigger YouTube’s native dialog.`,
    copyMoveNativeBtn: 'Open "Save to playlist" (1st selected)',
    copyMoveGroupLabel: 'Assign playlist to group (optional)',
    virtualCreated: 'Playlist "{title}" created with {count} video(s)!',
    addedToPlaylist: 'Added to "{title}"!',
    removedFromPlaylist: 'Removed from "{title}".',
    groupViewAll: 'All Playlists',
    includeSubgroups: 'Include nested subgroups',
    sortPlTitle: 'Title (A-Z)',
    sortPlCount: 'Video count',
    sortPlWatchedDesc: 'Watched % (high)',
    sortPlWatchedAsc: 'Watched % (low)',
    sortPlUpdated: 'Recently updated',
    openPlaylist: 'Open',
    playAll: 'Play all',
    editGroups: 'Groups',
    removeFromGroup: 'Remove from group',
    videosCount: '{count} videos',
    noPlaylistsInGroup: 'No playlists in this group yet. Open any playlist on YouTube and click "Groups" to add it.',
    groupNamePlaceholder: 'Playlist group name...',
    parentGroup: 'Parent group',
    rootNone: 'None (Root)',
    createGroupBtn: 'Create Group',
    iconSearchPlaceholder: 'Search icon...',
    uploadIcon: 'Upload image',
    watchedMarked: 'Marked as watched',
    watchedUnmarked: 'Marked as unwatched',
    multiSelectOn: 'Multi-select mode enabled',
    multiSelectOff: 'Multi-select mode disabled',
    groupsSaved: 'Playlist groups updated!',
    removedFromGroup: 'Playlist removed from group.',
    groupCreated: 'Group "{name}" created!',
    playlistSaved: 'Playlist added to groups.',
    saveModalTitle: `${BRAND_NAME} — My Playlists`,
    saveModalSearch: 'Filter playlists...',
    newPlaylistBtn: '+ New Playlist',
    newPlaylistPlaceholder: 'Playlist name...',
    noCustomPlaylists: 'No custom playlists yet. Create one below!',
    videoNotesTitle: 'Notes & Timestamps',
    notePlaceholder: 'Write a note for this timestamp...',
    addNoteBtn: '+ Add',
    noNotesYet: 'No notes for this video yet.',
    noteAdded: 'Note saved!',
    noteDeleted: 'Note deleted.',
    copiedLink: 'Link copied to clipboard!',
    addVideoUrlPlaceholder: 'Paste YouTube video URL or ID...',
    addVideoTitlePlaceholder: 'Title (optional)',
    addVideoBtn: 'Add video',
    invalidVideoUrl: 'Invalid YouTube video URL or ID.',
    reverseOrder: 'Reverse order',
    removeWatched: 'Remove watched',
    copyAllToPlaylist: 'Copy to another playlist',
    exportJson: 'Export JSON',
    exportUrls: 'Export URLs (.txt)',
    deletePlaylist: 'Delete playlist',
    deletePlaylistConfirm: 'Are you sure you want to delete playlist "{title}"?',
    playlistDeleted: 'Playlist deleted.',
    editPlaylist: 'Edit playlist',
    descriptionPlaceholder: 'Add a description...',
    ctxAddQueue: 'Add to queue',
    ctxWatchLater: 'Save to "Watch Later"',
    ctxSaveToPl: 'Save to playlist',
    ctxRemoveFrom: 'Remove from {title}',
    ctxCopyUrl: 'Copy URL / Export',
    ctxShare: 'Share',
    ctxMoveTop: 'Move to top',
    ctxMoveBottom: 'Move to bottom',
    ctxSetThumb: 'Set as playlist thumbnail',
    ctxNotes: 'Notes & Timestamps',
    thumbUpdated: 'Playlist thumbnail updated!',
    movedToTop: 'Video moved to top.',
    movedToBottom: 'Video moved to bottom.',
    noWatchedToRemove: 'No watched videos to remove.',
    removedWatchedCount: 'Removed {count} watched video(s).',
    qbPlaylist: '+ Playlist',
    qbCourse: '+ Course',
    qbWatched: 'Watched',
    qbNotes: 'Notes',
    qbFocus: 'Focus',
    qbFocusOn: 'Focus Mode enabled',
    qbFocusOff: 'Focus Mode disabled',
    coursePopoverTitle: 'Add to Course',
    courseSearchPlaceholder: 'Filter courses...',
    newCoursePlaceholder: '+ New course...',
    noCoursesYet: 'No courses yet. Create one below!',
    courseCreated: 'Course "{title}" created with {count} lesson(s)!',
    addedToCourse: 'Added to course "{title}"!',
    removedFromCourse: 'Removed from course "{title}".',
    convertToCourse: 'Convert to Course',
    convertToCourseEmpty: 'No loaded videos in this playlist to create a course.',
    cardQuickAddTitle: `Add to ${BRAND_NAME} Playlist`,
    quickCreatePlaylistPlaceholder: '+ New playlist...',
    quickSaveBtn: 'Create',
    customizePlaylist: 'Customize',
    customizeModalTitle: 'Customize playlist appearance',
    customizeLayoutHint: `This customization only changes how the playlist appears in ${BRAND_NAME}'s sidebar and views. YouTube's native menu stays untouched.`,
    customizeSaved: 'Playlist customization saved!',
    customThumbLabel: 'Custom Image / Cover',
    customThumbPlaceholder: 'Paste an image URL (https://...) or upload below',
    uploadCover: 'Upload cover',
    clearCover: 'Remove image',
    resetAppearance: 'Reset default',
    sidebarPreview: `Sidebar preview (${BRAND_NAME})`,
    noPlaylistsYet: 'No playlists found yet. Visit /feed/playlists or create a custom playlist.',
  },
};

/* ============================================================================
 * MODULE STATE
 * ========================================================================== */

/** @type {{ getState: () => any, onStateChange: (s: any) => void } | null} */
let hooks = null;

/** @type {any} */
let currentPageCtx = { type: 'other', playlistId: null, videoId: null };

/** @type {string | null} */
let activePlaylistId = null;

/** @type {MutationObserver | null} */
let popupObserver = null;

/** @type {MutationObserver | null} */
let pageManagerObserver = null;

/** @type {number | null} */
let observerRetryTimer = null;

let observerRetryCount = 0;

/** @type {number | null} */
let scanDebounceTimer = null;

/** @type {number | null} */
let cardScanDebounceTimer = null;

/** @type {number | null} */
let nativeFeedSyncTimer = null;

/** @type {Set<string>} */
const syncedNativeFeedIds = new Set();

/** @type {WeakSet<HTMLElement>} */
const processedCardEls = new WeakSet();

/** @type {WeakSet<HTMLElement>} */
const processedRowEls = new WeakSet();

/** @type {WeakMap<HTMLElement, HTMLButtonElement>} */
const cardQuickAddBtnMap = new WeakMap();

const VIDEO_CARD_SELECTOR = [
  'ytd-rich-item-renderer',
  'ytd-video-renderer',
  'ytd-grid-video-renderer',
  'ytd-compact-video-renderer',
  'yt-lockup-view-model',
].join(', ');

function scheduleIdleTask(fn) {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => fn(), { timeout: 600 });
  } else {
    setTimeout(fn, 40);
  }
}

/** @type {number[]} */
let navRetryTimers = [];

/** @type {{ el: HTMLElement, cleanup: () => void, mode: 'playlist' | 'course', videoId: string } | null} */
let activeAnchoredPopover = null;

/** @type {number | null} */
let saveModalTimer = null;

/** @type {number | null} */
let progressSyncTimer = null;

/** @type {string} */
let lastSyncedProgressKey = '';

/** @type {HTMLElement | null} */
let lastHoveredVideoEl = null;

/** @type {{ videoId: string, title: string, channelTitle: string, channelId: string, durationSec: number, thumbnailUrl: string, capturedAt: number } | null} */
let lastMenuVideo = null;

/** @type {number} */
let origIndexCounter = 0;

/** Current filter/sort/selection state for the active native playlist page */
const plView = {
  search: '',
  watchedFilter: 'all', // 'all' | 'unwatched' | 'watched'
  durationFilter: 'all', // 'all' | 'under5' | '5to20' | 'over20' | 'custom'
  customMinMin: '',
  customMaxMin: '',
  hideShorts: false,
  sortBy: 'original', // 'original' | 'reversed' | 'duration_asc' | 'duration_desc' | 'views_desc' | 'title_asc' | 'title_desc' | 'channel_asc'
  multiSelect: false,
  selectedIds: new Set(),
};

/** Open modal state for Playlist Group View */
const groupViewState = {
  open: false,
  groupId: null,
  includeDescendants: true,
  sortBy: 'title_asc',
  search: '',
  creatingGroup: false,
};

/** Open modal state for Custom Playlist Detail View */
const customPlView = {
  open: false,
  playlistId: null,
  search: '',
  watchedFilter: 'all', // 'all' | 'unwatched' | 'watched'
  hideWatched: false,
  sortBy: 'date_desc', // 'date_desc' | 'original' | 'duration_asc' | 'duration_desc' | 'title_asc' | 'channel_asc'
  selectedIds: new Set(),
  editingMeta: false,
  addingVideo: false,
};

/** Active removal cancellation flag */
let cancelRemovalFlag = false;

/* ============================================================================
 * SAFE UTILITIES
 * ========================================================================== */

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrl(url, fallback = '') {
  if (!url || typeof url !== 'string') return fallback;
  const trimmed = url.trim();
  if (
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('/') ||
    /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(trimmed)
  ) {
    return trimmed;
  }
  return fallback;
}

function normText(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function getAppState() {
  return hooks?.getState?.() || {
    groups: {},
    channels: {},
    playlists: {},
    watched: {},
    videoNotes: {},
    settings: { language: 'pt-BR', keyboardShortcuts: true, showProgressOnPlaylists: true },
  };
}

function getLang() {
  const lang = getAppState()?.settings?.language;
  if (lang === 'en' || lang === 'es' || lang === 'pt-PT' || lang === 'pt-BR') {
    return lang;
  }
  return 'pt-BR';
}

function pt(key, params) {
  const lang = getLang();
  const dictKey = lang === 'pt-PT' ? 'pt-BR' : lang === 'es' ? 'en' : lang;
  const dict = PL_STRINGS[dictKey] || PL_STRINGS['pt-BR'];
  let text = dict[key] ?? PL_STRINGS.en[key];
  if (text === undefined) {
    return t(key, lang, params);
  }
  if (params && typeof params === 'object') {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

function formatDuration(totalSeconds) {
  const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  if (sec === 0) return '0m';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return s > 0 && m < 10 ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

function formatDurationFull(totalSeconds) {
  const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatTimestamp(seconds) {
  const sec = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function formatVideoBadgeDuration(seconds) {
  const sec = Math.max(0, Math.floor(Number(seconds) || 0));
  if (!sec) return '';
  return formatTimestamp(sec);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback below
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    return true;
  } catch {
    return false;
  }
}

function downloadTextFile(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function callBg(action, payload = {}) {
  try {
    const res = await sendBg(action, payload);
    if (res?.ok && res.state && hooks?.onStateChange) {
      hooks.onStateChange(res.state);
    }
    return res;
  } catch (err) {
    console.warn(`[${BRAND_NAME}:playlists] background call failed:`, action, err);
    return { ok: false, error: err?.message || String(err) };
  }
}

function getDescendantGroupIds(groups, groupId) {
  const result = [];
  const visited = new Set([groupId]);
  const queue = [groupId];
  while (queue.length > 0) {
    const curr = queue.shift();
    for (const g of Object.values(groups || {})) {
      if (g.parentId === curr && !visited.has(g.id)) {
        visited.add(g.id);
        result.push(g.id);
        queue.push(g.id);
      }
    }
  }
  return result;
}

function getAncestorGroups(groups, groupId) {
  const chain = [];
  const visited = new Set([groupId]);
  let curr = groups?.[groupId]?.parentId || null;
  while (curr && groups[curr] && !visited.has(curr)) {
    visited.add(curr);
    chain.unshift(groups[curr]);
    curr = groups[curr].parentId || null;
  }
  return chain;
}

function getFlattenedPlaylistGroups(groups) {
  const all = Object.values(groups || {}).filter((g) => g.kind === GROUP_KINDS.PLAYLIST);
  const byParent = new Map();
  for (const g of all) {
    const pid = g.parentId && groups[g.parentId]?.kind === GROUP_KINDS.PLAYLIST ? g.parentId : null;
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid).push(g);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
  }
  const out = [];
  const visit = (parentId, depth, seen) => {
    const children = byParent.get(parentId) || [];
    for (const child of children) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push({ group: child, depth });
      visit(child.id, depth + 1, seen);
    }
  };
  visit(null, 0, new Set());
  return out;
}

function getCustomPlaylists(state) {
  return Object.values(state?.playlists || {})
    .filter((pl) => Boolean(pl?.isCustom))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function getPlaylistThumb(pl) {
  const firstVid = Array.isArray(pl?.videos) && pl.videos.length > 0 ? pl.videos[0] : null;
  const candidate =
    pl?.customThumbnailUrl ||
    firstVid?.thumbnailUrl ||
    (firstVid?.videoId ? `https://i.ytimg.com/vi/${encodeURIComponent(firstVid.videoId)}/hqdefault.jpg` : '') ||
    pl?.thumbnailUrl ||
    '';
  return safeUrl(candidate, '');
}

/* ============================================================================
 * YOUTUBE DOM SCRAPING FOR VIDEOS & PLAYLISTS
 * ========================================================================== */

function extractVideoIdFromHref(href) {
  if (!href) return null;
  const trimmed = String(href).trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const u = new URL(trimmed, location.origin);
    if (u.hostname.includes('youtu.be')) {
      const seg = u.pathname.replace(/^\/+/, '').split('/')[0];
      if (seg && seg.length >= 6) return seg;
    }
    const v = u.searchParams.get('v');
    if (v) return v;
    const shortsMatch = u.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{6,})/);
    if (shortsMatch) return shortsMatch[1];
    const embedMatch = u.pathname.match(/\/embed\/([a-zA-Z0-9_-]{6,})/);
    if (embedMatch) return embedMatch[1];
  } catch {
    const m = trimmed.match(/[?&]v=([a-zA-Z0-9_-]{6,})/) || trimmed.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/);
    if (m) return m[1];
  }
  return null;
}

function extractPlaylistIdFromHref(href) {
  if (!href) return null;
  try {
    const u = new URL(href, location.origin);
    return u.searchParams.get('list');
  } catch {
    const m = String(href).match(/[?&]list=([a-zA-Z0-9_-]+)/);
    return m ? m[1] : null;
  }
}

/**
 * Extract structured video info from any YouTube video card renderer element.
 * @param {Element} card
 */
function extractVideoInfoFromCard(card) {
  if (!card) return null;
  const link =
    card.querySelector('a#video-title-link[href]') ||
    card.querySelector('a#video-title[href]') ||
    card.querySelector('a#thumbnail[href]') ||
    card.querySelector('a[href*="/watch?v="]') ||
    card.querySelector('a[href*="/shorts/"]');
  const href = link?.getAttribute('href') || '';
  const videoId = extractVideoIdFromHref(href) || (card instanceof HTMLElement ? card.dataset.tpVideoId : '');
  if (!videoId) return null;

  const titleEl =
    card.querySelector('#video-title') ||
    card.querySelector('a#video-title-link') ||
    card.querySelector('h3 a') ||
    card.querySelector('.yt-lockup-metadata-view-model__title');
  const title = (titleEl?.getAttribute('title') || titleEl?.textContent || '').trim() || videoId;

  const channelLink =
    card.querySelector('ytd-channel-name a[href]') ||
    card.querySelector('#channel-name a[href]') ||
    card.querySelector('#byline-container a[href]') ||
    card.querySelector('a[href^="/@"]') ||
    card.querySelector('a[href^="/channel/"]');
  const channelTitle = (
    channelLink?.textContent ||
    card.querySelector('ytd-channel-name #text')?.textContent ||
    card.querySelector('#channel-name')?.textContent ||
    ''
  ).trim();
  const chHref = channelLink?.getAttribute('href') || '';
  const ucMatch = chHref.match(/\/channel\/(UC[\w-]+)/);
  const handleMatch = chHref.match(/\/(@[^/?#]+)/);
  const channelId = ucMatch ? ucMatch[1] : handleMatch ? decodeURIComponent(handleMatch[1]) : '';

  const durEl =
    card.querySelector('ytd-thumbnail-overlay-time-status-renderer #text') ||
    card.querySelector('badge-shape .badge-shape-wiz__text') ||
    card.querySelector('.yt-badge-shape__text');
  const durationSec = parseDurationToSeconds((durEl?.textContent || '').trim()) || 0;

  const imgSrc = card.querySelector('img')?.getAttribute('src') || '';
  const thumbnailUrl =
    safeUrl(imgSrc, '') || `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;

  return {
    videoId,
    title,
    channelTitle,
    channelId,
    durationSec,
    thumbnailUrl,
  };
}

/**
 * Resolve the target video when YouTube's Save-to-Playlist modal opens.
 */
function resolveTargetVideoForSave() {
  if (lastMenuVideo && Date.now() - lastMenuVideo.capturedAt < 15000) {
    return lastMenuVideo;
  }
  const watchInfo = typeof getCurrentWatchVideoInfo === 'function' ? getCurrentWatchVideoInfo() : null;
  if (watchInfo && watchInfo.videoId) {
    return {
      videoId: watchInfo.videoId,
      title: watchInfo.title || watchInfo.videoId,
      channelTitle: watchInfo.channelTitle || '',
      channelId: watchInfo.channelId || '',
      durationSec: watchInfo.durationSec || 0,
      thumbnailUrl:
        watchInfo.thumbnailUrl ||
        `https://i.ytimg.com/vi/${encodeURIComponent(watchInfo.videoId)}/hqdefault.jpg`,
    };
  }
  return lastMenuVideo || null;
}

function scrapeCurrentPlaylistMeta(playlistId) {
  const titleEl =
    document.querySelector('ytd-browse[page-subtype="playlist"]:not([hidden]) ytd-playlist-header-renderer yt-formatted-string.title') ||
    document.querySelector('ytd-browse[page-subtype="playlist"]:not([hidden]) yt-page-header-view-model h1') ||
    document.querySelector('ytd-playlist-header-renderer yt-formatted-string.title') ||
    document.querySelector('ytd-playlist-header-renderer #title') ||
    document.querySelector('yt-page-header-view-model h1 .yt-core-attributed-string') ||
    document.querySelector('yt-page-header-renderer h1 .yt-core-attributed-string') ||
    document.querySelector('yt-dynamic-text-view-model h1') ||
    document.querySelector('h1.ytd-playlist-header-renderer');

  let title = titleEl?.textContent?.trim() || '';
  if (!title) {
    title = document.title.replace(/\s*-\s*YouTube\s*$/i, '').trim() || playlistId;
  }

  const authorEl =
    document.querySelector('ytd-playlist-header-renderer .metadata-owner a') ||
    document.querySelector('ytd-playlist-header-renderer ytd-channel-name a') ||
    document.querySelector('yt-content-metadata-view-model a');
  const author = authorEl?.textContent?.trim() || '';

  const thumbEl =
    document.querySelector('ytd-playlist-header-renderer img#img') ||
    document.querySelector('yt-thumbnail-view-model img') ||
    document.querySelector('ytd-playlist-video-renderer img');
  const thumbnailUrl = thumbEl?.getAttribute('src') || '';

  const rows = document.querySelectorAll('ytd-playlist-video-renderer');
  let videoCount = rows.length;

  const statsEls = document.querySelectorAll(
    'ytd-playlist-header-renderer .metadata-stats yt-formatted-string, yt-content-metadata-view-model .yt-core-attributed-string'
  );
  for (const el of statsEls) {
    const txt = el.textContent?.trim() || '';
    const m = txt.match(/([\d.,\s]+)\s*(?:videos?|v[ií]deos?)/i);
    if (m) {
      const parsed = parseInt(m[1].replace(/[^\d]/g, ''), 10);
      if (Number.isFinite(parsed) && parsed > videoCount) {
        videoCount = parsed;
      }
    }
  }

  return {
    id: playlistId,
    title,
    url: `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`,
    thumbnailUrl,
    author,
    videoCount,
  };
}

function parsePlaylistVideoRow(row) {
  if (!row.dataset.tpOrigIdx) {
    const idxText = row.querySelector('#index')?.textContent?.trim() || '';
    const idxNum = parseInt(idxText, 10);
    row.dataset.tpOrigIdx = Number.isFinite(idxNum)
      ? String(idxNum * 1000 + origIndexCounter++)
      : String(1000000 + origIndexCounter++);
  }

  const linkEl =
    row.querySelector('a#video-title') ||
    row.querySelector('a#thumbnail[href*="/watch"], a#thumbnail[href*="/shorts"]');
  const href = linkEl?.getAttribute('href') || '';
  const videoId = extractVideoIdFromHref(href) || row.dataset.tpVideoId || '';
  if (videoId) row.dataset.tpVideoId = videoId;

  const title =
    row.querySelector('#video-title')?.textContent?.trim() ||
    row.querySelector('#video-title')?.getAttribute('title')?.trim() ||
    '';

  const channelEl =
    row.querySelector('ytd-channel-name a') ||
    row.querySelector('#channel-name a') ||
    row.querySelector('#byline-container a');
  const channelTitle = channelEl?.textContent?.trim() || '';
  const channelHref = channelEl?.getAttribute('href') || '';
  const channelIdMatch = channelHref.match(/\/channel\/(UC[a-zA-Z0-9_-]+)/);
  const channelId = channelIdMatch ? channelIdMatch[1] : '';

  const durEl =
    row.querySelector('ytd-thumbnail-overlay-time-status-renderer #text') ||
    row.querySelector('badge-shape .badge-shape-wiz__text') ||
    row.querySelector('span.ytd-thumbnail-overlay-time-status-renderer');
  const durText = durEl?.textContent?.trim() || '';
  const durationSec = parseDurationToSeconds(durText) || 0;

  const infoSpans = row.querySelectorAll('#video-info span, #metadata-line span');
  let views = 0;
  for (const sp of infoSpans) {
    const txt = sp.textContent?.trim() || '';
    if (/(views?|visualiza)/i.test(txt)) {
      views = parseViewsCount(txt) || 0;
      break;
    }
  }

  const hasShortsBadge = Boolean(
    row.querySelector('[overlay-style="SHORTS"], [aria-label="Shorts"]')
  );
  const isShort =
    href.includes('/shorts/') ||
    hasShortsBadge ||
    /#shorts?\b/i.test(title) ||
    durText.toUpperCase() === 'SHORTS';

  const thumbUrl =
    safeUrl(row.querySelector('img')?.getAttribute('src') || '', '') ||
    (videoId ? `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg` : '');

  return {
    el: row,
    origIdx: Number(row.dataset.tpOrigIdx) || 0,
    videoId,
    title,
    channelTitle,
    channelId,
    durationSec,
    views,
    isShort,
    thumbnailUrl: thumbUrl,
  };
}

function getPlaylistVideoListContainer() {
  const activeBrowse =
    document.querySelector('ytd-browse[page-subtype="playlist"]:not([hidden])') ||
    document.querySelector('ytd-browse[role="main"]:not([hidden])');
  if (activeBrowse) {
    const inside =
      activeBrowse.querySelector('ytd-playlist-video-list-renderer #contents') ||
      activeBrowse.querySelector('ytd-playlist-video-list-renderer > #contents');
    if (inside) return inside;
  }
  return (
    document.querySelector('ytd-playlist-video-list-renderer #contents') ||
    document.querySelector('ytd-playlist-video-list-renderer > #contents') ||
    null
  );
}

function getPlaylistVideoItems() {
  const container = getPlaylistVideoListContainer();
  const root = container || document;
  const rows = Array.from(root.querySelectorAll('ytd-playlist-video-renderer'));
  return rows.map((row) => parsePlaylistVideoRow(row));
}

/* ============================================================================
 * BUG A FIX — SAVE-TO-PLAYLIST MODAL INJECTION (ALL YOUTUBE PAGES)
 * ========================================================================== */

/**
 * Find any currently open YouTube "Save to playlist" dialog (classic or modern Wiz).
 * @returns {HTMLElement[]}
 */
function findOpenSaveDialogs() {
  const popupContainer = document.querySelector('ytd-popup-container');
  if (!popupContainer) return [];

  const found = [];

  // 1. Classic Polymer dialog: ytd-add-to-playlist-renderer
  const classicList = popupContainer.querySelectorAll('ytd-add-to-playlist-renderer');
  for (const el of classicList) {
    const dialog = el.closest('tp-yt-paper-dialog');
    if (dialog && (dialog.getAttribute('aria-hidden') === 'true' || dialog.style.display === 'none')) {
      continue;
    }
    if (el instanceof HTMLElement) found.push(el);
  }

  // 2. Modern Wiz sheet: yt-sheet-view-model / yt-list-view-model
  const wizSheets = popupContainer.querySelectorAll('yt-sheet-view-model, tp-yt-paper-dialog yt-list-view-model');
  for (const sheet of wizSheets) {
    if (!(sheet instanceof HTMLElement)) continue;
    if (sheet.closest('ytd-add-to-playlist-renderer')) continue;
    const dropdown = sheet.closest('tp-yt-iron-dropdown, tp-yt-paper-dialog');
    if (dropdown && (dropdown.getAttribute('aria-hidden') === 'true' || dropdown.style.display === 'none')) {
      continue;
    }
    const hasSaveItems = Boolean(
      sheet.querySelector('toggleable-list-item-view-model, ytd-playlist-add-to-option-renderer')
    );
    const headerText = (
      sheet.querySelector('yt-panel-header-view-model, h2, [role="heading"], .yt-panel-header-view-model__title')
        ?.textContent || ''
    ).trim();
    const looksLikeSave = hasSaveItems || /(save\s+video|save\s+to|salvar\s+(o\s+v[ií]deo\s+)?em|salvar\s+na\s+playlist|guardar\s+en)/i.test(headerText);
    if (looksLikeSave) {
      found.push(sheet);
    }
  }

  return found;
}

/**
 * Filter native YouTube playlist rows inside a Save dialog by query text.
 * @param {HTMLElement} dialog
 * @param {string} query
 */
function filterNativeSaveRows(dialog, query) {
  const q = normText(query).trim();
  const nativeRows = dialog.querySelectorAll(
    'ytd-playlist-add-to-option-renderer, toggleable-list-item-view-model, yt-list-item-view-model'
  );
  for (const row of nativeRows) {
    if (!(row instanceof HTMLElement)) continue;
    if (row.closest('.tp-save-modal-block')) continue;
    if (!q) {
      row.style.display = '';
    } else {
      const text = normText(row.textContent || '');
      row.style.display = text.includes(q) ? '' : 'none';
    }
  }
}

/**
 * Render/update the PlayShelf custom playlists block inside a Save-to-Playlist dialog or popover.
 * @param {HTMLElement} block
 * @param {HTMLElement | null} nativeDialog
 * @param {{ videoId: string, title: string, channelTitle: string, channelId: string, durationSec: number, thumbnailUrl: string } | null} targetVideo
 * @param {string} [currentSearch='']
 */
function renderSaveModalBlockContent(block, nativeDialog, targetVideo, currentSearch = '') {
  const state = getAppState();
  const customPlaylists = getCustomPlaylists(state);
  const q = normText(currentSearch).trim();

  const filtered = q
    ? customPlaylists.filter((pl) => normText(pl.title || '').includes(q))
    : customPlaylists;

  const listHtml =
    filtered.length === 0
      ? `<div class="tp-save-empty">${esc(pt('noCustomPlaylists'))}</div>`
      : filtered
          .map((pl) => {
            const videos = Array.isArray(pl.videos) ? pl.videos : [];
            const hasVideo = Boolean(targetVideo?.videoId && videos.some((v) => v.videoId === targetVideo.videoId));
            const iconHtml = pl.icon
              ? `<span class="tp-save-pl-ico" style="color:${esc(pl.color || '#ef233c')}">${renderIconHtml(pl.icon, 15)}</span>`
              : '';

            return `
              <label class="tp-save-pl-row">
                <input type="checkbox" class="tp-save-pl-cb" data-tp-save-pl="${esc(pl.id)}" ${hasVideo ? 'checked' : ''} ${!targetVideo?.videoId ? 'disabled' : ''} />
                <span class="tp-save-pl-info">
                  <span class="tp-save-pl-name">${iconHtml}${esc(pl.title)}</span>
                  <span class="tp-save-pl-meta">
                    <span class="tp-save-pl-count">${videos.length}</span>
                  </span>
                </span>
              </label>
            `;
          })
          .join('');

  // Keep search input value if already rendered
  let searchInput = block.querySelector('.tp-save-search-input');
  const hadFocus = document.activeElement === searchInput;

  if (!block.dataset.tpInitialized) {
    block.dataset.tpInitialized = '1';
    block.innerHTML = `
      <div class="tp-save-header">
        <span class="tp-pl-brand">${esc(BRAND_NAME)}</span>
        <span class="tp-save-title">${esc(pt('saveModalTitle'))}</span>
      </div>
      <div class="tp-save-search-wrap">
        <span class="tp-save-search-ico">🔍</span>
        <input type="text" class="tp-save-search-input" placeholder="${esc(pt('saveModalSearch'))}" value="${esc(currentSearch)}" />
      </div>
      <div class="tp-save-list" data-tp-save-list></div>
      <div class="tp-save-create-box">
        <button type="button" class="tp-pl-btn tp-pl-btn-sm tp-pl-btn-ghost tp-save-create-toggle" data-tp-save-toggle-create>
          ${esc(pt('newPlaylistBtn'))}
        </button>
        <div class="tp-save-create-form" data-tp-save-create-form hidden>
          <input type="text" class="tp-pl-input tp-save-new-name" data-tp-save-new-name placeholder="${esc(pt('newPlaylistPlaceholder'))}" />
          <div class="tp-save-create-actions">
            <button type="button" class="tp-pl-btn tp-pl-btn-sm tp-pl-btn-ghost" data-tp-save-cancel-create>${esc(t('common.cancel', getLang()))}</button>
            <button type="button" class="tp-pl-btn tp-pl-btn-sm tp-pl-btn-accent" data-tp-save-confirm-create>${esc(t('common.create', getLang()))}</button>
          </div>
        </div>
      </div>
    `;

    searchInput = block.querySelector('.tp-save-search-input');
    searchInput?.addEventListener('input', () => {
      const val = searchInput.value;
      if (nativeDialog) filterNativeSaveRows(nativeDialog, val);
      renderSaveModalBlockContent(block, nativeDialog, resolveTargetVideoForSave() || targetVideo, val);
    });

    const toggleBtn = block.querySelector('[data-tp-save-toggle-create]');
    const formEl = block.querySelector('[data-tp-save-create-form]');
    const cancelBtn = block.querySelector('[data-tp-save-cancel-create]');
    const confirmBtn = block.querySelector('[data-tp-save-confirm-create]');
    const nameInput = block.querySelector('[data-tp-save-new-name]');

    toggleBtn?.addEventListener('click', () => {
      if (formEl) {
        formEl.hidden = !formEl.hidden;
        if (!formEl.hidden) nameInput?.focus();
      }
    });

    cancelBtn?.addEventListener('click', () => {
      if (formEl) formEl.hidden = true;
    });

    const doCreate = async () => {
      const title = nameInput?.value?.trim();
      if (!title) {
        nameInput?.focus();
        return;
      }
      const vid = resolveTargetVideoForSave() || targetVideo;
      const newId = `ps_pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const videos = vid?.videoId ? [{ ...vid, addedAt: Date.now() }] : [];
      const res = await callBg(MESSAGE_ACTIONS.UPSERT_PLAYLISTS, {
        playlists: [
          {
            id: newId,
            title,
            url: vid?.videoId
              ? `https://www.youtube.com/watch_videos?video_ids=${encodeURIComponent(vid.videoId)}`
              : 'https://www.youtube.com/feed/playlists',
            thumbnailUrl: vid?.thumbnailUrl || '',
            videoCount: videos.length,
            watchedCount: 0,
            groupIds: [],
            author: BRAND_NAME,
            isCustom: true,
            description: '',
            videos,
          },
        ],
      });
      if (res?.ok) {
        showToast(pt('virtualCreated', { title, count: videos.length }), 'success');
        if (nameInput) nameInput.value = '';
        if (formEl) formEl.hidden = true;
        renderSaveModalBlockContent(block, nativeDialog, vid, searchInput?.value || '');
      }
    };

    confirmBtn?.addEventListener('click', doCreate);
    nameInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doCreate();
      }
    });
  }

  const listContainer = block.querySelector('[data-tp-save-list]');
  if (listContainer) {
    listContainer.innerHTML = listHtml;
    listContainer.querySelectorAll('.tp-save-pl-cb').forEach((cb) => {
      cb.addEventListener('change', async () => {
        const plId = cb.getAttribute('data-tp-save-pl');
        const vid = resolveTargetVideoForSave() || targetVideo;
        if (!plId || !vid?.videoId) return;
        const pl = getAppState().playlists?.[plId];
        const plTitle = pl?.title || plId;

        if (cb.checked) {
          const res = await callBg(MESSAGE_ACTIONS.ADD_VIDEO_TO_PLAYLIST, {
            playlistId: plId,
            video: {
              videoId: vid.videoId,
              title: vid.title || vid.videoId,
              channelTitle: vid.channelTitle || '',
              channelId: vid.channelId || '',
              durationSec: vid.durationSec || 0,
              thumbnailUrl:
                vid.thumbnailUrl ||
                `https://i.ytimg.com/vi/${encodeURIComponent(vid.videoId)}/hqdefault.jpg`,
              addedAt: Date.now(),
            },
          });
          if (res?.ok) {
            showToast(pt('addedToPlaylist', { title: plTitle }), 'success');
            renderSaveModalBlockContent(block, nativeDialog, vid, searchInput?.value || '');
          }
        } else {
          const res = await callBg(MESSAGE_ACTIONS.REMOVE_VIDEO_FROM_PLAYLIST, {
            playlistId: plId,
            videoId: vid.videoId,
          });
          if (res?.ok) {
            showToast(pt('removedFromPlaylist', { title: plTitle }), 'info');
            renderSaveModalBlockContent(block, nativeDialog, vid, searchInput?.value || '');
          }
        }
      });
    });
  }

  if (hadFocus && searchInput instanceof HTMLInputElement) {
    searchInput.focus();
  }
}

/**
 * Scan YouTube's popup container and inject `.tp-save-modal-block` into any open Save dialog.
 */
function scanSaveToPlaylistModals() {
  const dialogs = findOpenSaveDialogs();
  if (dialogs.length === 0) return;

  const targetVideo = resolveTargetVideoForSave();

  for (const dialog of dialogs) {
    let block = dialog.querySelector('.tp-save-modal-block');
    if (!block) {
      block = document.createElement('div');
      block.className = 'tp-save-modal-block';
      block.addEventListener('click', (e) => e.stopPropagation());

      const playlistsSlot =
        dialog.querySelector('#playlists') ||
        dialog.querySelector('yt-list-view-model') ||
        dialog;
      if (playlistsSlot && playlistsSlot !== dialog && playlistsSlot.parentElement) {
        playlistsSlot.parentElement.insertBefore(block, playlistsSlot);
      } else {
        dialog.prepend(block);
      }
    }

    const searchVal = block.querySelector('.tp-save-search-input')?.value || '';
    renderSaveModalBlockContent(block, dialog, targetVideo, searchVal);
  }
}

function scheduleSaveModalScan() {
  if (saveModalTimer) clearTimeout(saveModalTimer);
  saveModalTimer = setTimeout(scanSaveToPlaylistModals, 150);
}

/* ============================================================================
 * /watch & /shorts/ QUICK BAR (#tp-watch-quickbar), ANCHORED 1-CLICK POPOVERS
 * & VIDEO CARD HOVER "+ PLAYLIST" BUTTON
 * ========================================================================== */

function closeAnchoredPopover() {
  if (activeAnchoredPopover) {
    try {
      activeAnchoredPopover.cleanup();
    } catch {
      // ignore
    }
    activeAnchoredPopover.el?.remove();
    activeAnchoredPopover = null;
  }
  document.getElementById('tp-anchored-popover')?.remove();
}

function positionAnchoredPopover(popover, anchorEl) {
  if (!(popover instanceof HTMLElement) || !(anchorEl instanceof Element)) return;
  const rect = anchorEl.getBoundingClientRect();
  const popWidth = Math.min(310, window.innerWidth - 16);
  const popHeight = Math.min(360, popover.offsetHeight || 300);

  let top = rect.bottom + 6;
  if (top + popHeight > window.innerHeight - 10) {
    const above = rect.top - popHeight - 6;
    top = above >= 10 ? above : Math.max(10, window.innerHeight - popHeight - 10);
  }

  let left = rect.left;
  if (left + popWidth > window.innerWidth - 10) {
    left = Math.max(10, rect.right - popWidth);
  }
  if (left < 10) left = 10;

  popover.style.top = `${Math.round(top)}px`;
  popover.style.left = `${Math.round(left)}px`;
}

function getCoursesList(state) {
  return Object.values(state?.courses || {}).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function countCustomPlaylistsContainingVideo(state, videoId) {
  if (!videoId) return 0;
  let count = 0;
  for (const pl of Object.values(state?.playlists || {})) {
    if (pl?.isCustom && Array.isArray(pl.videos) && pl.videos.some((v) => v.videoId === videoId)) {
      count++;
    }
  }
  return count;
}

function countCoursesContainingVideo(state, videoId) {
  if (!videoId) return 0;
  let count = 0;
  for (const course of Object.values(state?.courses || {})) {
    if (Array.isArray(course?.lessons) && course.lessons.some((l) => l.videoId === videoId)) {
      count++;
    }
  }
  return count;
}

function resolveWatchVideoInfoFallback(fallbackVideoId) {
  const info = typeof getCurrentWatchVideoInfo === 'function' ? getCurrentWatchVideoInfo() : null;
  if (info && info.videoId) return info;
  const vid = fallbackVideoId || currentPageCtx.videoId || '';
  if (!vid) return null;
  return {
    videoId: vid,
    title: document.title.replace(/\s*-\s*YouTube\s*$/i, '').trim() || vid,
    channelTitle: '',
    channelId: '',
    durationSec: 0,
    thumbnailUrl: `https://i.ytimg.com/vi/${encodeURIComponent(vid)}/hqdefault.jpg`,
  };
}

/**
 * Open an anchored 1-Click Playlist Checklist Popover for any video (watch page or video card).
 * @param {HTMLElement} anchorEl
 * @param {{ videoId: string, title: string, channelTitle?: string, channelId?: string, durationSec?: number, thumbnailUrl?: string }} targetVideo
 */
function openAnchoredPlaylistPopover(anchorEl, targetVideo) {
  if (!anchorEl || !targetVideo?.videoId) return;

  // Toggle closed if clicking the same anchor for the same mode & video
  if (
    activeAnchoredPopover &&
    activeAnchoredPopover.mode === 'playlist' &&
    activeAnchoredPopover.videoId === targetVideo.videoId &&
    activeAnchoredPopover.el.dataset.tpAnchorKey === (anchorEl.dataset.tpAnchorKey || '')
  ) {
    closeAnchoredPopover();
    return;
  }

  closeAnchoredPopover();

  const anchorKey = `pl_${Date.now().toString(36)}`;
  anchorEl.dataset.tpAnchorKey = anchorKey;

  const popover = document.createElement('div');
  popover.id = 'tp-anchored-popover';
  popover.className = 'tp-anchored-popover';
  popover.dataset.tpAnchorKey = anchorKey;
  popover.setAttribute('role', 'dialog');
  popover.addEventListener('click', (e) => e.stopPropagation());

  let searchQuery = '';

  const renderList = () => {
    const state = getAppState();
    const customPlaylists = getCustomPlaylists(state);
    const q = normText(searchQuery).trim();
    const filtered = q
      ? customPlaylists.filter((pl) => normText(pl.title || '').includes(q))
      : customPlaylists;

    const listEl = popover.querySelector('[data-tp-ap-list]');
    if (!listEl) return;

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="tp-ap-empty">${esc(pt('noCustomPlaylists'))}</div>`;
      return;
    }

    listEl.innerHTML = filtered
      .map((pl) => {
        const videos = Array.isArray(pl.videos) ? pl.videos : [];
        const checked = videos.some((v) => v.videoId === targetVideo.videoId);
        return `
          <label class="tp-ap-row ${checked ? 'is-checked' : ''}">
            <input type="checkbox" class="tp-ap-cb" data-tp-ap-pl="${esc(pl.id)}" ${checked ? 'checked' : ''} />
            <span class="tp-ap-name" title="${esc(pl.title)}">${esc(pl.title)}</span>
            <span class="tp-ap-count">${videos.length}</span>
          </label>
        `;
      })
      .join('');

    listEl.querySelectorAll('.tp-ap-cb').forEach((cb) => {
      cb.addEventListener('change', async () => {
        const plId = cb.getAttribute('data-tp-ap-pl');
        if (!plId) return;
        const pl = getAppState().playlists?.[plId];
        const plTitle = pl?.title || plId;

        if (cb.checked) {
          const res = await callBg(MESSAGE_ACTIONS.ADD_VIDEO_TO_PLAYLIST, {
            playlistId: plId,
            video: {
              videoId: targetVideo.videoId,
              title: targetVideo.title || targetVideo.videoId,
              channelTitle: targetVideo.channelTitle || '',
              channelId: targetVideo.channelId || '',
              durationSec: targetVideo.durationSec || 0,
              thumbnailUrl:
                safeUrl(targetVideo.thumbnailUrl, '') ||
                `https://i.ytimg.com/vi/${encodeURIComponent(targetVideo.videoId)}/hqdefault.jpg`,
              addedAt: Date.now(),
            },
          });
          if (res?.ok) {
            showToast(pt('addedToPlaylist', { title: plTitle }), 'success');
            renderList();
            ensureWatchActionButtons();
            updateQuickAddButtonsState();
          }
        } else {
          const res = await callBg(MESSAGE_ACTIONS.REMOVE_VIDEO_FROM_PLAYLIST, {
            playlistId: plId,
            videoId: targetVideo.videoId,
          });
          if (res?.ok) {
            showToast(pt('removedFromPlaylist', { title: plTitle }), 'info');
            renderList();
            ensureWatchActionButtons();
            updateQuickAddButtonsState();
          }
        }
      });
    });
  };

  popover.innerHTML = `
    <div class="tp-ap-header">
      <div class="tp-ap-header-title">
        <span class="tp-pl-brand">${esc(BRAND_NAME)}</span>
        <span>${esc(t('playlist.myCustomPlaylists', getLang()))}</span>
      </div>
      <button type="button" class="tp-ap-close" data-tp-ap-close aria-label="Close">&times;</button>
    </div>
    <div class="tp-ap-video-sub" title="${esc(targetVideo.title || targetVideo.videoId)}">
      ${esc(targetVideo.title || targetVideo.videoId)}
    </div>
    <div class="tp-ap-search-wrap">
      <input type="text" class="tp-ap-search" data-tp-ap-search placeholder="${esc(pt('saveModalSearch'))}" />
    </div>
    <div class="tp-ap-list" data-tp-ap-list></div>
    <div class="tp-ap-create-row">
      <input type="text" class="tp-ap-create-input" data-tp-ap-new-name placeholder="${esc(pt('quickCreatePlaylistPlaceholder'))}" />
      <button type="button" class="tp-ap-create-btn" data-tp-ap-create>${esc(pt('quickSaveBtn'))}</button>
    </div>
  `;

  popover.querySelector('[data-tp-ap-close]')?.addEventListener('click', closeAnchoredPopover);

  const searchInput = popover.querySelector('[data-tp-ap-search]');
  searchInput?.addEventListener('input', () => {
    searchQuery = searchInput.value;
    renderList();
  });

  const newInput = popover.querySelector('[data-tp-ap-new-name]');
  const createBtn = popover.querySelector('[data-tp-ap-create]');

  const doQuickCreate = async () => {
    const title = newInput?.value?.trim();
    if (!title) {
      newInput?.focus();
      return;
    }
    const newId = `ps_pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const thumb =
      safeUrl(targetVideo.thumbnailUrl, '') ||
      `https://i.ytimg.com/vi/${encodeURIComponent(targetVideo.videoId)}/hqdefault.jpg`;
    const videoObj = {
      videoId: targetVideo.videoId,
      title: targetVideo.title || targetVideo.videoId,
      channelTitle: targetVideo.channelTitle || '',
      channelId: targetVideo.channelId || '',
      durationSec: targetVideo.durationSec || 0,
      thumbnailUrl: thumb,
      addedAt: Date.now(),
    };
    const res = await callBg(MESSAGE_ACTIONS.UPSERT_PLAYLISTS, {
      playlists: [
        {
          id: newId,
          title,
          url: `https://www.youtube.com/watch_videos?video_ids=${encodeURIComponent(targetVideo.videoId)}`,
          thumbnailUrl: thumb,
          videoCount: 1,
          watchedCount: 0,
          groupIds: [],
          author: BRAND_NAME,
          isCustom: true,
          description: '',
          videos: [videoObj],
        },
      ],
    });
    if (res?.ok) {
      showToast(pt('virtualCreated', { title, count: 1 }), 'success');
      if (newInput) newInput.value = '';
      renderList();
      ensureWatchActionButtons();
      updateQuickAddButtonsState();
    }
  };

  createBtn?.addEventListener('click', doQuickCreate);
  newInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doQuickCreate();
    }
  });

  document.body.appendChild(popover);
  renderList();
  positionAnchoredPopover(popover, anchorEl);

  const onOutsideClick = (e) => {
    if (!(e.target instanceof Node)) return;
    if (popover.contains(e.target) || anchorEl.contains(e.target)) return;
    closeAnchoredPopover();
  };
  const onReposition = () => {
    if (!document.contains(anchorEl)) {
      closeAnchoredPopover();
      return;
    }
    positionAnchoredPopover(popover, anchorEl);
  };

  setTimeout(() => {
    document.addEventListener('click', onOutsideClick, true);
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('resize', onReposition);
  }, 0);

  activeAnchoredPopover = {
    el: popover,
    mode: 'playlist',
    videoId: targetVideo.videoId,
    cleanup: () => {
      document.removeEventListener('click', onOutsideClick, true);
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
    },
  };
}

/**
 * Open an anchored 1-Click Course Checklist Popover for any video.
 * @param {HTMLElement} anchorEl
 * @param {{ videoId: string, title: string, channelTitle?: string, channelId?: string, durationSec?: number, thumbnailUrl?: string }} targetVideo
 */
function openAnchoredCoursePopover(anchorEl, targetVideo) {
  if (!anchorEl || !targetVideo?.videoId) return;

  if (
    activeAnchoredPopover &&
    activeAnchoredPopover.mode === 'course' &&
    activeAnchoredPopover.videoId === targetVideo.videoId &&
    activeAnchoredPopover.el.dataset.tpAnchorKey === (anchorEl.dataset.tpAnchorKey || '')
  ) {
    closeAnchoredPopover();
    return;
  }

  closeAnchoredPopover();

  const anchorKey = `crs_${Date.now().toString(36)}`;
  anchorEl.dataset.tpAnchorKey = anchorKey;

  const popover = document.createElement('div');
  popover.id = 'tp-anchored-popover';
  popover.className = 'tp-anchored-popover';
  popover.dataset.tpAnchorKey = anchorKey;
  popover.setAttribute('role', 'dialog');
  popover.addEventListener('click', (e) => e.stopPropagation());

  let searchQuery = '';

  const renderList = () => {
    const state = getAppState();
    const courses = getCoursesList(state);
    const q = normText(searchQuery).trim();
    const filtered = q
      ? courses.filter((c) => normText(c.title || '').includes(q))
      : courses;

    const listEl = popover.querySelector('[data-tp-ap-list]');
    if (!listEl) return;

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="tp-ap-empty">${esc(pt('noCoursesYet'))}</div>`;
      return;
    }

    listEl.innerHTML = filtered
      .map((course) => {
        const lessons = Array.isArray(course.lessons) ? course.lessons : [];
        const checked = lessons.some((l) => l.videoId === targetVideo.videoId);
        return `
          <label class="tp-ap-row ${checked ? 'is-checked' : ''}">
            <input type="checkbox" class="tp-ap-cb" data-tp-ap-course="${esc(course.id)}" ${checked ? 'checked' : ''} />
            <span class="tp-ap-name" title="${esc(course.title)}">🎓 ${esc(course.title)}</span>
            <span class="tp-ap-count">${lessons.length}</span>
          </label>
        `;
      })
      .join('');

    listEl.querySelectorAll('.tp-ap-cb').forEach((cb) => {
      cb.addEventListener('change', async () => {
        const courseId = cb.getAttribute('data-tp-ap-course');
        if (!courseId) return;
        const course = getAppState().courses?.[courseId];
        const courseTitle = course?.title || courseId;

        if (cb.checked) {
          const res = await callBg(MESSAGE_ACTIONS.ADD_LESSON_TO_COURSE, {
            courseId,
            lesson: {
              videoId: targetVideo.videoId,
              title: targetVideo.title || targetVideo.videoId,
              channelTitle: targetVideo.channelTitle || '',
              channelId: targetVideo.channelId || '',
              durationSec: targetVideo.durationSec || 0,
              thumbnailUrl:
                safeUrl(targetVideo.thumbnailUrl, '') ||
                `https://i.ytimg.com/vi/${encodeURIComponent(targetVideo.videoId)}/hqdefault.jpg`,
            },
          });
          if (res?.ok) {
            showToast(pt('addedToCourse', { title: courseTitle }), 'success');
            renderList();
            ensureWatchActionButtons();
          }
        } else {
          const res = await callBg(MESSAGE_ACTIONS.REMOVE_LESSON_FROM_COURSE, {
            courseId,
            videoId: targetVideo.videoId,
          });
          if (res?.ok) {
            showToast(pt('removedFromCourse', { title: courseTitle }), 'info');
            renderList();
            ensureWatchActionButtons();
          }
        }
      });
    });
  };

  popover.innerHTML = `
    <div class="tp-ap-header">
      <div class="tp-ap-header-title">
        <span class="tp-pl-brand">${esc(BRAND_NAME)}</span>
        <span>🎓 ${esc(pt('coursePopoverTitle'))}</span>
      </div>
      <button type="button" class="tp-ap-close" data-tp-ap-close aria-label="Close">&times;</button>
    </div>
    <div class="tp-ap-video-sub" title="${esc(targetVideo.title || targetVideo.videoId)}">
      ${esc(targetVideo.title || targetVideo.videoId)}
    </div>
    <div class="tp-ap-search-wrap">
      <input type="text" class="tp-ap-search" data-tp-ap-search placeholder="${esc(pt('courseSearchPlaceholder'))}" />
    </div>
    <div class="tp-ap-list" data-tp-ap-list></div>
    <div class="tp-ap-create-row">
      <input type="text" class="tp-ap-create-input" data-tp-ap-new-name placeholder="${esc(pt('newCoursePlaceholder'))}" />
      <button type="button" class="tp-ap-create-btn" data-tp-ap-create>${esc(pt('quickSaveBtn'))}</button>
    </div>
  `;

  popover.querySelector('[data-tp-ap-close]')?.addEventListener('click', closeAnchoredPopover);

  const searchInput = popover.querySelector('[data-tp-ap-search]');
  searchInput?.addEventListener('input', () => {
    searchQuery = searchInput.value;
    renderList();
  });

  const newInput = popover.querySelector('[data-tp-ap-new-name]');
  const createBtn = popover.querySelector('[data-tp-ap-create]');

  const doQuickCreateCourse = async () => {
    const title = newInput?.value?.trim();
    if (!title) {
      newInput?.focus();
      return;
    }
    const thumb =
      safeUrl(targetVideo.thumbnailUrl, '') ||
      `https://i.ytimg.com/vi/${encodeURIComponent(targetVideo.videoId)}/hqdefault.jpg`;
    const res = await callBg(MESSAGE_ACTIONS.CREATE_COURSE, {
      course: {
        title,
        description: '',
        thumbnailUrl: thumb,
        lessons: [
          {
            videoId: targetVideo.videoId,
            title: targetVideo.title || targetVideo.videoId,
            channelTitle: targetVideo.channelTitle || '',
            channelId: targetVideo.channelId || '',
            durationSec: targetVideo.durationSec || 0,
            thumbnailUrl: thumb,
          },
        ],
      },
    });
    if (res?.ok) {
      showToast(pt('courseCreated', { title, count: 1 }), 'success');
      if (newInput) newInput.value = '';
      renderList();
      ensureWatchActionButtons();
    }
  };

  createBtn?.addEventListener('click', doQuickCreateCourse);
  newInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doQuickCreateCourse();
    }
  });

  document.body.appendChild(popover);
  renderList();
  positionAnchoredPopover(popover, anchorEl);

  const onOutsideClick = (e) => {
    if (!(e.target instanceof Node)) return;
    if (popover.contains(e.target) || anchorEl.contains(e.target)) return;
    closeAnchoredPopover();
  };
  const onReposition = () => {
    if (!document.contains(anchorEl)) {
      closeAnchoredPopover();
      return;
    }
    positionAnchoredPopover(popover, anchorEl);
  };

  setTimeout(() => {
    document.addEventListener('click', onOutsideClick, true);
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('resize', onReposition);
  }, 0);

  activeAnchoredPopover = {
    el: popover,
    mode: 'course',
    videoId: targetVideo.videoId,
    cleanup: () => {
      document.removeEventListener('click', onOutsideClick, true);
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
    },
  };
}

/**
 * Mount and update the sleek horizontal TubeNook Quick Bar (#tp-watch-quickbar)
 * on every `/watch` and `/shorts/` page.
 */
function ensureWatchActionButtons() {
  // Remove legacy wrapper if present
  document.querySelectorAll('.tp-watch-actions-wrap').forEach((el) => el.remove());

  if (currentPageCtx.type !== 'watch') {
    document.getElementById('tp-watch-quickbar')?.remove();
    return;
  }

  const videoInfo = resolveWatchVideoInfoFallback(currentPageCtx.videoId);
  const videoId = videoInfo?.videoId || currentPageCtx.videoId;
  if (!videoId) return;

  const isShorts = (window.location?.pathname || '').startsWith('/shorts/');
  const state = getAppState();
  const plCount = countCustomPlaylistsContainingVideo(state, videoId);
  const courseCount = countCoursesContainingVideo(state, videoId);
  const isWatched = Boolean(state.watched?.[videoId]);
  const noteCount = (state.videoNotes?.[videoId] || []).length;
  const focusMode = Boolean(state.settings?.focusMode);

  let bar = document.getElementById('tp-watch-quickbar');

  // Ensure bar is mounted in the right container (handle /watch <-> /shorts/ transitions)
  if (bar && document.contains(bar)) {
    const barIsShorts = bar.classList.contains('tp-watch-quickbar-shorts');
    if (barIsShorts !== isShorts) {
      bar.remove();
      bar = null;
    }
  }

  if (!bar || !document.contains(bar)) {
    bar = document.createElement('div');
    bar.id = 'tp-watch-quickbar';
    bar.className = isShorts ? 'tp-watch-quickbar tp-watch-quickbar-shorts' : 'tp-watch-quickbar';

    let mounted = false;
    if (isShorts) {
      const shortsHost =
        document.querySelector('ytd-shorts') ||
        document.querySelector('ytd-reel-video-renderer[is-active]') ||
        document.body;
      if (shortsHost) {
        shortsHost.appendChild(bar);
        mounted = true;
      }
    } else {
      const watchMeta = document.querySelector('ytd-watch-metadata');
      const aboveFold = document.querySelector('#above-the-fold');
      const host = watchMeta || aboveFold;

      if (host) {
        const topRow = host.querySelector('#top-row');
        const titleEl = host.querySelector('#title');
        if (topRow && topRow.parentElement) {
          topRow.parentElement.insertBefore(bar, topRow);
          mounted = true;
        } else if (titleEl && titleEl.parentElement) {
          titleEl.insertAdjacentElement('afterend', bar);
          mounted = true;
        } else {
          host.prepend(bar);
          mounted = true;
        }
      }
    }

    if (!mounted) return;

    bar.innerHTML = `
      <span class="tp-qb-brand">${esc(BRAND_NAME)}</span>
      <div class="tp-qb-pills">
        <button type="button" class="tp-qb-pill" data-tp-qb="playlist"></button>
        <button type="button" class="tp-qb-pill" data-tp-qb="course"></button>
        <button type="button" class="tp-qb-pill" data-tp-qb="watched"></button>
        <button type="button" class="tp-qb-pill" data-tp-qb="notes"></button>
        <button type="button" class="tp-qb-pill" data-tp-qb="focus"></button>
      </div>
    `;

    bar.addEventListener('click', async (e) => {
      const btn = e.target instanceof Element ? e.target.closest('[data-tp-qb]') : null;
      if (!(btn instanceof HTMLElement)) return;
      e.preventDefault();
      e.stopPropagation();

      const act = btn.getAttribute('data-tp-qb');
      const info = resolveWatchVideoInfoFallback(bar?.dataset.tpVideoId || currentPageCtx.videoId);
      if (!info?.videoId && act !== 'focus') return;

      if (act === 'playlist') {
        openAnchoredPlaylistPopover(btn, info);
      } else if (act === 'course') {
        openAnchoredCoursePopover(btn, info);
      } else if (act === 'watched') {
        const res = await callBg(MESSAGE_ACTIONS.TOGGLE_WATCHED, {
          videoId: info.videoId,
          meta: {
            title: info.title,
            channelId: info.channelId,
            durationSec: info.durationSec,
          },
        });
        if (res?.ok) {
          showToast(res.watched ? pt('watchedMarked') : pt('watchedUnmarked'), 'success');
          ensureWatchActionButtons();
        }
      } else if (act === 'notes') {
        closeAnchoredPopover();
        openVideoNotesModal(info.videoId, info.title);
      } else if (act === 'focus') {
        const nextFocus = !Boolean(getAppState().settings?.focusMode);
        toggleFocusModeCss(nextFocus);
        const res = await callBg(MESSAGE_ACTIONS.UPDATE_SETTINGS, {
          settings: { focusMode: nextFocus },
        });
        if (res?.ok) {
          showToast(nextFocus ? pt('qbFocusOn') : pt('qbFocusOff'), 'info');
          ensureWatchActionButtons();
        }
      }
    });
  }

  bar.dataset.tpVideoId = videoId;

  const plBtn = bar.querySelector('[data-tp-qb="playlist"]');
  if (plBtn) {
    plBtn.classList.toggle('is-active', plCount > 0);
    plBtn.title = t('playlist.saveToPlayShelf', getLang());
    plBtn.innerHTML =
      plCount > 0
        ? `<span>📋 ${esc(pt('qbPlaylist'))}</span><span class="tp-qb-badge">${plCount}</span>`
        : `<span>📋 ${esc(pt('qbPlaylist'))}</span>`;
  }

  const courseBtn = bar.querySelector('[data-tp-qb="course"]');
  if (courseBtn) {
    courseBtn.classList.toggle('is-active', courseCount > 0);
    courseBtn.title = pt('coursePopoverTitle');
    courseBtn.innerHTML =
      courseCount > 0
        ? `<span>🎓 ${esc(pt('qbCourse'))}</span><span class="tp-qb-badge">${courseCount}</span>`
        : `<span>🎓 ${esc(pt('qbCourse'))}</span>`;
  }

  const watchedBtn = bar.querySelector('[data-tp-qb="watched"]');
  if (watchedBtn) {
    watchedBtn.classList.toggle('is-watched', isWatched);
    watchedBtn.title = isWatched ? t('watched.unmark', getLang()) : t('watched.mark', getLang());
    watchedBtn.innerHTML = `<span>✓ ${esc(pt('qbWatched'))}</span>`;
  }

  const notesBtn = bar.querySelector('[data-tp-qb="notes"]');
  if (notesBtn) {
    notesBtn.classList.toggle('is-active', noteCount > 0);
    notesBtn.title = pt('videoNotesTitle');
    notesBtn.innerHTML =
      noteCount > 0
        ? `<span>📝 ${esc(pt('qbNotes'))}</span><span class="tp-qb-badge">${noteCount}</span>`
        : `<span>📝 ${esc(pt('qbNotes'))}</span>`;
  }

  const focusBtn = bar.querySelector('[data-tp-qb="focus"]');
  if (focusBtn) {
    focusBtn.classList.toggle('is-active', focusMode);
    focusBtn.title = t('focus.focusMode', getLang());
    focusBtn.innerHTML = `<span>🎯 ${esc(pt('qbFocus'))}</span>`;
  }
}

/**
 * Cheaply update the saved-count label on already-injected `.tp-card-quick-add-btn` buttons
 * without re-querying or re-processing video cards.
 * @param {any} [state]
 */
function updateQuickAddButtonsState(state = getAppState()) {
  const btns = document.querySelectorAll('.tp-card-quick-add-btn');
  if (btns.length === 0) return;
  const titleText = pt('cardQuickAddTitle');
  for (const btn of btns) {
    if (!(btn instanceof HTMLElement)) continue;
    const vid = btn.dataset.tpVideoId;
    if (!vid) continue;
    const savedCount = countCustomPlaylistsContainingVideo(state, vid);
    const nextText = savedCount > 0 ? `✓ ${savedCount}` : '+';
    if (btn.textContent !== nextText) {
      btn.textContent = nextText;
    }
    btn.classList.toggle('is-saved', savedCount > 0);
    if (btn.title !== titleText) btn.title = titleText;
  }
}

/**
 * Inject a subtle, compact 1-click `+` ("Adicionar à Playlist TubeNook") pill button
 * on video card thumbnails across Home, Subscriptions, Search, Channel, and Watch sidebar.
 * Uses `processedCardEls` WeakSet so already-enhanced cards are skipped in O(1),
 * and relies on a single delegated click handler on `document` (zero per-card listeners).
 */
function enhanceVideoCardsQuickAdd() {
  const state = getAppState();
  const root = document.querySelector('ytd-page-manager') || document.getElementById('page-manager') || document;
  const cards = root.querySelectorAll(VIDEO_CARD_SELECTOR);
  const titleText = pt('cardQuickAddTitle');

  for (const card of cards) {
    if (!(card instanceof HTMLElement)) continue;
    // O(1) skip for already-processed DOM nodes
    if (processedCardEls.has(card)) continue;

    if (
      card.closest('#tp-custom-pl-feed-shelf') ||
      card.closest('.tp-pl-modal-backdrop') ||
      card.closest('ytd-playlist-video-renderer')
    ) {
      processedCardEls.add(card);
      continue;
    }
    // Avoid double-injecting on nested yt-lockup-view-model inside ytd-rich-item-renderer
    if (card.tagName === 'YT-LOCKUP-VIEW-MODEL' && card.closest('ytd-rich-item-renderer')) {
      processedCardEls.add(card);
      continue;
    }

    // Skip pure playlist cards
    const videoLink =
      card.querySelector('a#video-title-link[href*="/watch"], a#video-title-link[href*="/shorts/"]') ||
      card.querySelector('a#video-title[href*="/watch"], a#video-title[href*="/shorts/"]') ||
      card.querySelector('a#thumbnail[href*="/watch"], a#thumbnail[href*="/shorts/"]') ||
      card.querySelector('a[href*="/watch?v="], a[href*="/shorts/"]');
    if (!videoLink) continue;

    const href = videoLink.getAttribute('href') || '';
    const videoId = extractVideoIdFromHref(href);
    if (!videoId) continue;

    const thumbHost =
      card.querySelector('ytd-thumbnail') ||
      card.querySelector('yt-thumbnail-view-model') ||
      card.querySelector('.yt-lockup-view-model__content-image') ||
      videoLink.closest('#thumbnail');
    if (!(thumbHost instanceof HTMLElement)) continue;

    processedCardEls.add(card);

    let btn = cardQuickAddBtnMap.get(card) || thumbHost.querySelector('.tp-card-quick-add-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tp-card-quick-add-btn';
      thumbHost.classList.add('tp-card-thumb-host');
      thumbHost.appendChild(btn);
    }
    cardQuickAddBtnMap.set(card, btn);

    const savedCount = countCustomPlaylistsContainingVideo(state, videoId);
    btn.dataset.tpVideoId = videoId;
    btn.title = titleText;
    btn.classList.toggle('is-saved', savedCount > 0);
    btn.textContent = savedCount > 0 ? `✓ ${savedCount}` : '+';
  }
}

function scheduleVideoCardScan() {
  if (cardScanDebounceTimer) clearTimeout(cardScanDebounceTimer);
  cardScanDebounceTimer = setTimeout(() => {
    scheduleIdleTask(enhanceVideoCardsQuickAdd);
  }, 350);
}

/**
 * Open a sleek standalone Quick-Save to PlayShelf Playlist modal (used by `/watch` button
 * and by Custom Playlist Context Menu "Salvar na playlist").
 */
function openQuickSaveToPlaylistModal(targetVideo) {
  closeOverlayModal('tp-pl-quicksave-modal');

  const backdrop = document.createElement('div');
  backdrop.id = 'tp-pl-quicksave-modal';
  backdrop.className = 'tp-pl-modal-backdrop tp-pl-modal-backdrop-top';

  backdrop.innerHTML = `
    <div class="tp-pl-modal tp-pl-modal-sm" role="dialog" aria-modal="true">
      <div class="tp-pl-modal-header">
        <div>
          <h3>${esc(t('playlist.saveToPlayShelf', getLang()))}</h3>
          <div class="tp-pl-subtitle">${esc(targetVideo?.title || targetVideo?.videoId || '')}</div>
        </div>
        <button type="button" class="tp-pl-close-btn" data-tp-close>&times;</button>
      </div>
      <div class="tp-pl-modal-body" data-tp-qs-body></div>
      <div class="tp-pl-modal-footer">
        <button type="button" class="tp-pl-btn tp-pl-btn-ghost" data-tp-close>${esc(t('common.close', getLang()))}</button>
      </div>
    </div>
  `;

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || (e.target instanceof Element && e.target.closest('[data-tp-close]'))) {
      backdrop.remove();
    }
  });

  const body = backdrop.querySelector('[data-tp-qs-body]');
  const block = document.createElement('div');
  block.className = 'tp-save-modal-block tp-save-modal-block-standalone';
  body?.appendChild(block);

  // Temporarily set lastMenuVideo so internal handlers see the exact video
  const prevMenuVideo = lastMenuVideo;
  lastMenuVideo = { ...targetVideo, capturedAt: Date.now() };
  renderSaveModalBlockContent(block, null, targetVideo, '');

  const origRemove = backdrop.remove.bind(backdrop);
  backdrop.remove = () => {
    lastMenuVideo = prevMenuVideo;
    origRemove();
  };

  document.body.appendChild(backdrop);
}

/**
 * Open Video Notes & Timestamps modal for a given videoId.
 * @param {string} videoId
 * @param {string} [videoTitle='']
 */
function openVideoNotesModal(videoId, videoTitle = '') {
  closeOverlayModal('tp-pl-notes-modal');
  if (!videoId) return;

  const backdrop = document.createElement('div');
  backdrop.id = 'tp-pl-notes-modal';
  backdrop.className = 'tp-pl-modal-backdrop tp-pl-modal-backdrop-top';

  const getCurrentPlayerTime = () => {
    const vid = document.querySelector('video.html5-main-video');
    if (vid instanceof HTMLVideoElement && Number.isFinite(vid.currentTime)) {
      return Math.floor(vid.currentTime);
    }
    return 0;
  };

  const renderModal = () => {
    const state = getAppState();
    const notes = [...(state.videoNotes?.[videoId] || [])].sort(
      (a, b) => (a.timestampSec || 0) - (b.timestampSec || 0)
    );
    const currentSec = getCurrentPlayerTime();

    backdrop.innerHTML = `
      <div class="tp-pl-modal tp-pl-modal-md" role="dialog" aria-modal="true">
        <div class="tp-pl-modal-header">
          <div>
            <h3>📝 ${esc(pt('videoNotesTitle'))}</h3>
            <div class="tp-pl-subtitle">${esc(videoTitle || videoId)}</div>
          </div>
          <button type="button" class="tp-pl-close-btn" data-tp-close>&times;</button>
        </div>
        <div class="tp-pl-modal-body">
          <div class="tp-notes-compose">
            <span class="tp-notes-time-pill" data-tp-note-cur-time title="Timestamp atual">⏱ ${esc(formatTimestamp(currentSec))}</span>
            <input type="text" class="tp-pl-input tp-notes-input" data-tp-note-input placeholder="${esc(pt('notePlaceholder'))}" />
            <button type="button" class="tp-pl-btn tp-pl-btn-accent" data-tp-note-add>${esc(pt('addNoteBtn'))}</button>
          </div>
          <div class="tp-notes-list">
            ${
              notes.length === 0
                ? `<div class="tp-pl-empty-state">${esc(pt('noNotesYet'))}</div>`
                : notes
                    .map(
                      (n) => `
                  <div class="tp-note-item" data-note-id="${esc(n.id)}">
                    <button type="button" class="tp-note-ts-chip" data-tp-seek="${Number(n.timestampSec) || 0}" title="${esc(t('notes.jumpToTime', getLang(), { time: formatTimestamp(n.timestampSec) }))}">
                      [${esc(formatTimestamp(n.timestampSec))}]
                    </button>
                    <div class="tp-note-text">${esc(n.text)}</div>
                    <button type="button" class="tp-note-del-btn" data-tp-del-note="${esc(n.id)}" title="${esc(t('common.delete', getLang()))}">🗑</button>
                  </div>
                `
                    )
                    .join('')
            }
          </div>
        </div>
        <div class="tp-pl-modal-footer">
          <button type="button" class="tp-pl-btn tp-pl-btn-ghost" data-tp-close>${esc(t('common.close', getLang()))}</button>
        </div>
      </div>
    `;

    backdrop.querySelectorAll('[data-tp-close]').forEach((el) => {
      el.addEventListener('click', () => backdrop.remove());
    });

    const inputEl = backdrop.querySelector('[data-tp-note-input]');
    const addNote = async () => {
      const text = inputEl?.value?.trim();
      if (!text) {
        inputEl?.focus();
        return;
      }
      const timestampSec = getCurrentPlayerTime();
      const res = await callBg(MESSAGE_ACTIONS.UPSERT_VIDEO_NOTE, {
        videoId,
        note: { timestampSec, text },
      });
      if (res?.ok) {
        showToast(pt('noteAdded'), 'success');
        renderModal();
        ensureWatchActionButtons();
      }
    };

    backdrop.querySelector('[data-tp-note-add]')?.addEventListener('click', addNote);
    inputEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addNote();
      }
    });

    backdrop.querySelectorAll('[data-tp-seek]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const sec = Number(chip.getAttribute('data-tp-seek')) || 0;
        const ok = typeof seekVideoPlayer === 'function' ? seekVideoPlayer(sec) : false;
        if (!ok) {
          window.open(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${sec}s`, '_blank', 'noopener');
        }
      });
    });

    backdrop.querySelectorAll('[data-tp-del-note]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const noteId = btn.getAttribute('data-tp-del-note');
        if (!noteId) return;
        const res = await callBg(MESSAGE_ACTIONS.DELETE_VIDEO_NOTE, { videoId, noteId });
        if (res?.ok) {
          showToast(pt('noteDeleted'), 'info');
          renderModal();
          ensureWatchActionButtons();
        }
      });
    });
  };

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove();
  });

  renderModal();
  document.body.appendChild(backdrop);
  backdrop.querySelector('[data-tp-note-input]')?.focus();
}

/* ============================================================================
 * NATIVE PLAYLIST PAGE: SIDEBAR STATS, TOOLBAR, THUMBNAIL CHECKBOX & TRASH BTN
 * ========================================================================== */

/**
 * Find the active visible playlist header container across both classic Polymer
 * (`ytd-playlist-header-renderer`) and modern Wiz (`yt-page-header-renderer`,
 * `yt-page-header-view-model`, `.immersive-header-container`, `.metadata-wrapper`).
 * @returns {HTMLElement | null}
 */
function findNativePlaylistHeaderRoot() {
  const activeBrowse =
    document.querySelector('ytd-browse[page-subtype="playlist"]:not([hidden])') ||
    document.querySelector('ytd-browse[role="main"]:not([hidden])') ||
    document;

  const selectors = [
    'ytd-playlist-header-renderer .metadata-wrapper',
    'ytd-playlist-header-renderer .immersive-header-content',
    '.immersive-header-container .metadata-wrapper',
    '.immersive-header-container',
    'yt-page-header-view-model .yt-page-header-view-model__page-header-content',
    'yt-page-header-view-model',
    'yt-page-header-renderer .page-header-view-model-wiz__page-header-content',
    'yt-page-header-renderer',
    'ytd-playlist-header-renderer',
    '.metadata-wrapper',
  ];

  for (const sel of selectors) {
    const el = activeBrowse.querySelector(sel);
    if (el instanceof HTMLElement && !el.closest('[hidden]')) {
      return el;
    }
  }
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el instanceof HTMLElement && !el.closest('[hidden]')) {
      return el;
    }
  }
  return null;
}

/**
 * Inject TubeNook stats & quick circular action icons into YouTube's native left playlist sidebar.
 */
function enhancePlaylistSidebarStats({ totalCount, watchedCount, totalDurationSec }) {
  if (!activePlaylistId) return;

  const headerRoot = findNativePlaylistHeaderRoot();
  if (!headerRoot) return;

  // Clean up any stale stats box outside the current headerRoot
  document.querySelectorAll('.tp-pl-sidebar-stats').forEach((el) => {
    if (!headerRoot.contains(el)) el.remove();
  });

  let statsBox = headerRoot.querySelector('.tp-pl-sidebar-stats');
  if (!statsBox) {
    statsBox = document.createElement('div');
    statsBox.className = 'tp-pl-sidebar-stats';
    headerRoot.appendChild(statsBox);
  }

  const pct = totalCount > 0 ? ((watchedCount / totalCount) * 100).toFixed(1) : '0.0';

  statsBox.innerHTML = `
    <div class="tp-pl-side-stat-row">
      <span class="tp-pl-side-stat-val">⏱ ${esc(formatDurationFull(totalDurationSec))}</span>
      <div class="tp-pl-side-mini-btns">
        <button type="button" class="tp-pl-icon-circle-sm" data-tp-side-action="reverse" title="${esc(pt('reverseOrder'))}">⇅</button>
        <button type="button" class="tp-pl-icon-circle-sm" data-tp-side-action="sort-dur" title="${esc(pt('sortDurAsc'))}">⏱↓</button>
      </div>
    </div>
    <div class="tp-pl-side-stat-row">
      <span class="tp-pl-side-stat-val">% ${esc(pct)}% <span class="tp-pl-side-muted">(${watchedCount}/${totalCount})</span></span>
    </div>
    <div class="tp-pl-side-actions-row">
      <button type="button" class="tp-pl-icon-circle" data-tp-side-action="customize" title="${esc(pt('customizePlaylist'))}">🎨</button>
      <button type="button" class="tp-pl-icon-circle" data-tp-side-action="remove-watched" title="${esc(pt('removeWatched'))}">⊖</button>
      <button type="button" class="tp-pl-icon-circle" data-tp-side-action="copy-all" title="${esc(pt('copyAllToPlaylist'))}">≡+</button>
      <button type="button" class="tp-pl-icon-circle" data-tp-side-action="to-course" title="${esc(pt('convertToCourse'))}">🎓</button>
    </div>
  `;

  statsBox.querySelectorAll('[data-tp-side-action]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const act = btn.getAttribute('data-tp-side-action');
      if (act === 'customize' && activePlaylistId) {
        openPlaylistCustomizeModal(activePlaylistId, scrapeCurrentPlaylistMeta(activePlaylistId));
      } else if (act === 'reverse') {
        plView.sortBy = plView.sortBy === 'reversed' ? 'original' : 'reversed';
        const sortSelect = document.querySelector('#tp-pl-toolbar [data-tp-pl-sort]');
        if (sortSelect) sortSelect.value = plView.sortBy === 'reversed' ? 'original' : plView.sortBy;
        applyPlaylistFiltersAndSort();
      } else if (act === 'sort-dur') {
        plView.sortBy = plView.sortBy === 'duration_asc' ? 'duration_desc' : 'duration_asc';
        const sortSelect = document.querySelector('#tp-pl-toolbar [data-tp-pl-sort]');
        if (sortSelect) sortSelect.value = plView.sortBy;
        applyPlaylistFiltersAndSort();
      } else if (act === 'remove-watched') {
        const state = getAppState();
        const watchedItems = getPlaylistVideoItems().filter((it) => it.videoId && state.watched?.[it.videoId]);
        if (watchedItems.length === 0) {
          showToast(pt('noWatchedToRemove'), 'info');
          return;
        }
        openRemoveSelectedModal(watchedItems);
      } else if (act === 'copy-all') {
        const items = getPlaylistVideoItems();
        const target = plView.selectedIds.size > 0
          ? items.filter((it) => it.videoId && plView.selectedIds.has(it.videoId))
          : items;
        if (target.length === 0) {
          showToast(pt('noSelection'), 'info');
          return;
        }
        openCopyMoveModal(target);
      } else if (act === 'to-course' && activePlaylistId) {
        const items = getPlaylistVideoItems().filter((it) => it.videoId);
        if (items.length === 0) {
          showToast(pt('convertToCourseEmpty'), 'info');
          return;
        }
        const meta = scrapeCurrentPlaylistMeta(activePlaylistId);
        const lessons = items.map((it) => ({
          videoId: it.videoId,
          title: it.title || it.videoId,
          channelTitle: it.channelTitle || '',
          channelId: it.channelId || '',
          durationSec: it.durationSec || 0,
          thumbnailUrl:
            safeUrl(it.thumbnailUrl, '') ||
            `https://i.ytimg.com/vi/${encodeURIComponent(it.videoId)}/hqdefault.jpg`,
        }));
        const res = await callBg(MESSAGE_ACTIONS.CREATE_COURSE, {
          course: {
            title: meta.title || activePlaylistId,
            description: meta.author ? `${meta.author} • YouTube Playlist` : '',
            thumbnailUrl: safeUrl(meta.thumbnailUrl, '') || lessons[0]?.thumbnailUrl || '',
            lessons,
          },
        });
        if (res?.ok) {
          showToast(pt('courseCreated', { title: meta.title || activePlaylistId, count: lessons.length }), 'success');
        }
      }
    });
  });
}

function ensurePlaylistToolbar() {
  let toolbar = document.getElementById('tp-pl-toolbar');
  if (toolbar && document.contains(toolbar) && !toolbar.closest('[hidden]')) return toolbar;
  if (toolbar) toolbar.remove();

  const activeBrowse =
    document.querySelector('ytd-browse[page-subtype="playlist"]:not([hidden])') ||
    document.querySelector('ytd-browse[role="main"]:not([hidden])') ||
    document;

  const listContents =
    activeBrowse.querySelector('ytd-playlist-video-list-renderer #contents') ||
    document.querySelector('ytd-playlist-video-list-renderer #contents');
  const listRenderer =
    activeBrowse.querySelector('ytd-playlist-video-list-renderer') ||
    document.querySelector('ytd-playlist-video-list-renderer');
  const itemSectionContents =
    activeBrowse.querySelector('ytd-item-section-renderer #contents') ||
    document.querySelector('ytd-item-section-renderer #contents');
  const primaryInner =
    activeBrowse.querySelector('#primary') ||
    document.querySelector('ytd-two-column-browse-results-renderer #primary');

  if (!listContents && !listRenderer && !itemSectionContents && !primaryInner) return null;

  toolbar = document.createElement('div');
  toolbar.id = 'tp-pl-toolbar';
  toolbar.className = 'tp-pl-toolbar';

  if (listContents && listContents.parentElement) {
    listContents.parentElement.insertBefore(toolbar, listContents);
  } else if (listRenderer && listRenderer.parentElement) {
    listRenderer.parentElement.insertBefore(toolbar, listRenderer);
  } else if (itemSectionContents && itemSectionContents.parentElement) {
    itemSectionContents.parentElement.insertBefore(toolbar, itemSectionContents);
  } else if (primaryInner) {
    primaryInner.prepend(toolbar);
  }

  renderPlaylistToolbarStructure(toolbar);
  bindPlaylistToolbarEvents(toolbar);
  return toolbar;
}

function renderPlaylistToolbarStructure(toolbar) {
  toolbar.innerHTML = `
    <div class="tp-pl-progress-banner">
      <div class="tp-pl-progress-top">
        <div class="tp-pl-progress-title-row">
          <span class="tp-pl-brand">${esc(BRAND_NAME)}</span>
          <span class="tp-pl-progress-stats" data-tp-pl-stats>0/0 (0%)</span>
          <span class="tp-pl-duration-stats" data-tp-pl-durations></span>
          <span class="tp-pl-visible-stats" data-tp-pl-visible></span>
        </div>
        <div class="tp-pl-progress-actions">
          <button type="button" class="tp-pl-btn tp-pl-btn-accent" data-tp-pl-action="customize">
            <span class="tp-pl-btn-ico">🎨</span>
            <span>${esc(pt('customizePlaylist'))}</span>
          </button>
          <button type="button" class="tp-pl-btn" data-tp-pl-action="toggle-multiselect" aria-pressed="false">
            <span class="tp-pl-btn-ico">☑️</span>
            <span>${esc(pt('multiSelect'))}</span>
          </button>
        </div>
      </div>
      <div class="tp-pl-progress-bar-track">
        <div class="tp-pl-progress-bar-fill" data-tp-pl-bar style="width:0%"></div>
      </div>
    </div>

    <div class="tp-pl-controls-row">
      <select class="tp-pl-select" data-tp-pl-watched-select aria-label="Filter watched">
        <option value="all">${esc(pt('statusAll'))}</option>
        <option value="unwatched">${esc(pt('statusUnwatched'))}</option>
        <option value="watched">${esc(pt('statusWatched'))}</option>
      </select>

      <div class="tp-pl-search-wrap">
        <span class="tp-pl-search-ico">🔍</span>
        <input
          type="text"
          class="tp-pl-search-input"
          data-tp-search="playlist"
          placeholder="${esc(pt('searchPlaceholder'))}"
          value="${esc(plView.search)}"
        />
        <button type="button" class="tp-pl-search-clear" data-tp-pl-action="clear-search" title="Clear" hidden>&times;</button>
      </div>

      <button type="button" class="tp-pl-icon-circle-sm ${plView.watchedFilter === 'unwatched' ? 'is-active' : ''}" data-tp-pl-action="toggle-hide-watched" title="${esc(pt('hideWatched'))}">👁️</button>

      <select class="tp-pl-select" data-tp-pl-duration aria-label="Duration filter">
        <option value="all">${esc(pt('durAll'))}</option>
        <option value="under5">${esc(pt('durUnder5'))}</option>
        <option value="5to20">${esc(pt('dur5to20'))}</option>
        <option value="over20">${esc(pt('durOver20'))}</option>
        <option value="custom">${esc(pt('durCustom'))}</option>
      </select>

      <div class="tp-pl-custom-dur" data-tp-pl-custom-dur hidden>
        <input type="number" min="0" class="tp-pl-num-input" data-tp-pl-min placeholder="${esc(pt('minPlaceholder'))}" />
        <span>–</span>
        <input type="number" min="0" class="tp-pl-num-input" data-tp-pl-max placeholder="${esc(pt('maxPlaceholder'))}" />
        <span class="tp-pl-unit">min</span>
      </div>

      <label class="tp-pl-toggle-chip">
        <input type="checkbox" data-tp-pl-hide-shorts ${plView.hideShorts ? 'checked' : ''} />
        <span>${esc(pt('hideShorts'))}</span>
      </label>

      <button type="button" class="tp-pl-btn tp-pl-btn-ghost" data-tp-pl-action="reset-filters" hidden>
        ${esc(pt('resetFilters'))}
      </button>
    </div>

    <div class="tp-pl-selection-row">
      <div class="tp-pl-selection-left">
        <label class="tp-pl-select-all-label" title="${esc(pt('selectAllVisible'))}">
          <input type="checkbox" class="tp-pl-select-all-cb" data-tp-pl-select-all />
        </label>

        <select class="tp-pl-select" data-tp-pl-sort aria-label="Sort playlist">
          <option value="original">${esc(pt('sortDateDesc'))}</option>
          <option value="duration_asc">${esc(pt('sortDurAsc'))}</option>
          <option value="duration_desc">${esc(pt('sortDurDesc'))}</option>
          <option value="views_desc">${esc(pt('sortViewsDesc'))}</option>
          <option value="title_asc">${esc(pt('sortTitleAsc'))}</option>
          <option value="title_desc">${esc(pt('sortTitleDesc'))}</option>
          <option value="channel_asc">${esc(pt('sortChannelAsc'))}</option>
        </select>

        <span class="tp-pl-bulk-count" data-tp-pl-selected-count>✓ ${esc(pt('selectedCount', { count: 0 }))}</span>
      </div>

      <div class="tp-pl-selection-right">
        <button type="button" class="tp-pl-icon-circle" data-tp-pl-bulk="remove" title="${esc(pt('removeSelected'))}">🗑</button>
        <button type="button" class="tp-pl-icon-circle" data-tp-pl-bulk="play-queue" title="${esc(pt('playQueue'))}">≡▶</button>
        <button type="button" class="tp-pl-icon-circle" data-tp-pl-bulk="copy-move" title="${esc(pt('copyMove'))}">≡+</button>
        <button type="button" class="tp-pl-icon-circle" data-tp-pl-bulk="mark-watched" title="${esc(pt('markWatched'))}">👁</button>
        <button type="button" class="tp-pl-btn tp-pl-btn-sm tp-pl-btn-ghost" data-tp-pl-bulk="select-watched">${esc(pt('selectWatched'))}</button>
        <button type="button" class="tp-pl-btn tp-pl-btn-sm tp-pl-btn-ghost" data-tp-pl-bulk="clear">${esc(pt('clearSelection'))}</button>
      </div>
    </div>
  `;

  const watchedSel = toolbar.querySelector('[data-tp-pl-watched-select]');
  if (watchedSel) watchedSel.value = plView.watchedFilter;
  const durSelect = toolbar.querySelector('[data-tp-pl-duration]');
  if (durSelect) durSelect.value = plView.durationFilter;
  const sortSelect = toolbar.querySelector('[data-tp-pl-sort]');
  if (sortSelect) sortSelect.value = plView.sortBy === 'reversed' ? 'original' : plView.sortBy;
}

function bindPlaylistToolbarEvents(toolbar) {
  const searchInput = toolbar.querySelector('.tp-pl-search-input');
  const clearBtn = toolbar.querySelector('[data-tp-pl-action="clear-search"]');
  const watchedSelect = toolbar.querySelector('[data-tp-pl-watched-select]');
  const durSelect = toolbar.querySelector('[data-tp-pl-duration]');
  const customDurWrap = toolbar.querySelector('[data-tp-pl-custom-dur]');
  const minInput = toolbar.querySelector('[data-tp-pl-min]');
  const maxInput = toolbar.querySelector('[data-tp-pl-max]');
  const hideShortsCb = toolbar.querySelector('[data-tp-pl-hide-shorts]');
  const sortSelect = toolbar.querySelector('[data-tp-pl-sort]');
  const selectAllCb = toolbar.querySelector('[data-tp-pl-select-all]');

  searchInput?.addEventListener('input', () => {
    plView.search = searchInput.value;
    if (clearBtn) clearBtn.hidden = !plView.search;
    applyPlaylistFiltersAndSort();
  });

  clearBtn?.addEventListener('click', () => {
    plView.search = '';
    if (searchInput) {
      searchInput.value = '';
      searchInput.focus();
    }
    clearBtn.hidden = true;
    applyPlaylistFiltersAndSort();
  });

  watchedSelect?.addEventListener('change', () => {
    plView.watchedFilter = watchedSelect.value;
    const hideBtn = toolbar.querySelector('[data-tp-pl-action="toggle-hide-watched"]');
    if (hideBtn) hideBtn.classList.toggle('is-active', plView.watchedFilter === 'unwatched');
    applyPlaylistFiltersAndSort();
  });

  durSelect?.addEventListener('change', () => {
    plView.durationFilter = durSelect.value;
    if (customDurWrap) customDurWrap.hidden = plView.durationFilter !== 'custom';
    applyPlaylistFiltersAndSort();
  });

  minInput?.addEventListener('input', () => {
    plView.customMinMin = minInput.value;
    applyPlaylistFiltersAndSort();
  });

  maxInput?.addEventListener('input', () => {
    plView.customMaxMin = maxInput.value;
    applyPlaylistFiltersAndSort();
  });

  hideShortsCb?.addEventListener('change', () => {
    plView.hideShorts = hideShortsCb.checked;
    applyPlaylistFiltersAndSort();
  });

  sortSelect?.addEventListener('change', () => {
    plView.sortBy = sortSelect.value;
    applyPlaylistFiltersAndSort();
  });

  selectAllCb?.addEventListener('change', () => {
    if (selectAllCb.checked) {
      handleBulkAction('select-visible');
    } else {
      handleBulkAction('clear');
    }
  });

  toolbar.addEventListener('click', (e) => {
    const actionEl =
      e.target instanceof Element ? e.target.closest('[data-tp-pl-action]') : null;
    if (actionEl) {
      const action = actionEl.getAttribute('data-tp-pl-action');
      if (action === 'customize' && activePlaylistId) {
        openPlaylistCustomizeModal(activePlaylistId, scrapeCurrentPlaylistMeta(activePlaylistId));
      } else if (action === 'toggle-multiselect') {
        toggleMultiSelectMode();
      } else if (action === 'toggle-hide-watched') {
        plView.watchedFilter = plView.watchedFilter === 'unwatched' ? 'all' : 'unwatched';
        if (watchedSelect) watchedSelect.value = plView.watchedFilter;
        actionEl.classList.toggle('is-active', plView.watchedFilter === 'unwatched');
        applyPlaylistFiltersAndSort();
      } else if (action === 'reset-filters') {
        resetPlaylistFilters();
      }
      return;
    }

    const bulkEl =
      e.target instanceof Element ? e.target.closest('[data-tp-pl-bulk]') : null;
    if (bulkEl) {
      const bulkAction = bulkEl.getAttribute('data-tp-pl-bulk');
      if (bulkAction) handleBulkAction(bulkAction);
    }
  });
}

function resetPlaylistFilters() {
  plView.search = '';
  plView.watchedFilter = 'all';
  plView.durationFilter = 'all';
  plView.customMinMin = '';
  plView.customMaxMin = '';
  plView.hideShorts = false;
  plView.sortBy = 'original';

  const toolbar = document.getElementById('tp-pl-toolbar');
  if (toolbar) {
    const searchInput = toolbar.querySelector('.tp-pl-search-input');
    if (searchInput) searchInput.value = '';
    const clearBtn = toolbar.querySelector('[data-tp-pl-action="clear-search"]');
    if (clearBtn) clearBtn.hidden = true;
    const watchedSelect = toolbar.querySelector('[data-tp-pl-watched-select]');
    if (watchedSelect) watchedSelect.value = 'all';
    const hideBtn = toolbar.querySelector('[data-tp-pl-action="toggle-hide-watched"]');
    if (hideBtn) hideBtn.classList.remove('is-active');
    const durSelect = toolbar.querySelector('[data-tp-pl-duration]');
    if (durSelect) durSelect.value = 'all';
    const customDurWrap = toolbar.querySelector('[data-tp-pl-custom-dur]');
    if (customDurWrap) customDurWrap.hidden = true;
    const minInput = toolbar.querySelector('[data-tp-pl-min]');
    if (minInput) minInput.value = '';
    const maxInput = toolbar.querySelector('[data-tp-pl-max]');
    if (maxInput) maxInput.value = '';
    const hideShortsCb = toolbar.querySelector('[data-tp-pl-hide-shorts]');
    if (hideShortsCb) hideShortsCb.checked = false;
    const sortSelect = toolbar.querySelector('[data-tp-pl-sort]');
    if (sortSelect) sortSelect.value = 'original';
  }
  applyPlaylistFiltersAndSort();
}

function toggleMultiSelectMode(forceValue) {
  plView.multiSelect = typeof forceValue === 'boolean' ? forceValue : !plView.multiSelect;
  if (!plView.multiSelect) {
    plView.selectedIds.clear();
  }
  const toolbar = document.getElementById('tp-pl-toolbar');
  if (toolbar) {
    const btn = toolbar.querySelector('[data-tp-pl-action="toggle-multiselect"]');
    if (btn) {
      btn.classList.toggle('is-active', plView.multiSelect);
      btn.setAttribute('aria-pressed', String(plView.multiSelect));
    }
  }

  const listRenderer = document.querySelector('ytd-playlist-video-list-renderer');
  if (listRenderer) {
    listRenderer.classList.toggle('tp-pl-multiselect-active', plView.multiSelect);
  }

  enhancePlaylistRows();
  updateBulkSelectionCount();
}

/**
 * Inject top-right thumbnail checkbox, quick watched toggle, and 1-click Trash button above native ⋮ menu.
 */
function enhancePlaylistRows() {
  const state = getAppState();
  const watchedMap = state.watched || {};
  const showWatchedBadge = state.settings?.showWatchedBadge !== false;
  const items = getPlaylistVideoItems();
  const lang = getLang();

  for (const item of items) {
    const { el, videoId } = item;
    if (!videoId || !(el instanceof HTMLElement)) continue;
    const isWatched = Boolean(watchedMap[videoId]);
    const isSelected = plView.selectedIds.has(videoId);

    el.classList.toggle('tp-pl-row-watched', isWatched);
    el.classList.toggle('tp-pl-row-selected', isSelected);

    if (!processedRowEls.has(el)) {
      processedRowEls.add(el);

      // 1. Top-right thumbnail checkbox
      const thumbHost =
        el.querySelector('ytd-thumbnail') ||
        el.querySelector('yt-thumbnail-view-model') ||
        el.querySelector('#thumbnail')?.parentElement ||
        el.querySelector('#content');

      if (thumbHost instanceof HTMLElement && !el.querySelector('.tp-pl-thumb-check-wrap')) {
        const thumbCheckWrap = document.createElement('label');
        thumbCheckWrap.className = 'tp-pl-thumb-check-wrap';
        thumbCheckWrap.addEventListener('click', (e) => e.stopPropagation());

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'tp-pl-thumb-check';
        cb.addEventListener('change', (e) => {
          e.stopPropagation();
          const vid = el.dataset.tpVideoId;
          if (!vid) return;
          if (cb.checked) plView.selectedIds.add(vid);
          else plView.selectedIds.delete(vid);
          el.classList.toggle('tp-pl-row-selected', cb.checked);
          thumbCheckWrap.classList.toggle('is-checked', cb.checked);
          updateBulkSelectionCount();
        });

        thumbCheckWrap.appendChild(cb);
        thumbHost.classList.add('tp-card-thumb-host');
        thumbHost.appendChild(thumbCheckWrap);
      }

      // 2. Quick watched toggle button
      if (!el.querySelector('.tp-pl-row-watch-btn')) {
        const watchBtn = document.createElement('button');
        watchBtn.type = 'button';
        watchBtn.className = 'tp-pl-row-watch-btn';
        watchBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const parsed = parsePlaylistVideoRow(el);
          if (!parsed.videoId) return;
          const res = await callBg(MESSAGE_ACTIONS.TOGGLE_WATCHED, {
            videoId: parsed.videoId,
            meta: {
              title: parsed.title,
              channelId: parsed.channelId,
              durationSec: parsed.durationSec,
            },
          });
          if (res?.ok) {
            showToast(res.watched ? pt('watchedMarked') : pt('watchedUnmarked'), 'success');
            applyPlaylistFiltersAndSort();
          }
        });
        const menuTarget = el.querySelector('#menu') || el.querySelector('#content');
        if (menuTarget && menuTarget.parentElement) {
          menuTarget.parentElement.insertBefore(watchBtn, menuTarget);
        } else {
          el.appendChild(watchBtn);
        }
      }

      // 3. One-click Trash button right above native ⋮ menu
      const menuEl = el.querySelector('#menu') || el.querySelector('ytd-menu-renderer')?.parentElement;
      if (menuEl && !menuEl.querySelector('.tp-pl-row-trash-btn')) {
        menuEl.classList.add('tp-pl-menu-stack');
        const trashBtn = document.createElement('button');
        trashBtn.type = 'button';
        trashBtn.className = 'tp-pl-row-trash-btn';
        trashBtn.title = pt('removeSelected');
        trashBtn.textContent = '🗑';
        trashBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          trashBtn.disabled = true;
          const ok = await triggerNativeRowMenuItem(
            el,
            /(remove from|remover de|eliminar de|retirer de)/i
          );
          trashBtn.disabled = false;
          if (ok) {
            plView.selectedIds.delete(el.dataset.tpVideoId || videoId);
            showToast(pt('removeDone', { done: 1 }), 'success');
            setTimeout(applyPlaylistFiltersAndSort, 350);
          }
        });
        menuEl.prepend(trashBtn);
      }
    }

    // Lightweight state sync for all rows
    const thumbCheckWrap = el.querySelector('.tp-pl-thumb-check-wrap');
    if (thumbCheckWrap) {
      thumbCheckWrap.classList.toggle('is-checked', isSelected);
      const cb = thumbCheckWrap.querySelector('input[type="checkbox"]');
      if (cb instanceof HTMLInputElement && cb.checked !== isSelected) cb.checked = isSelected;
    }

    const watchBtn = el.querySelector('.tp-pl-row-watch-btn');
    if (watchBtn instanceof HTMLElement) {
      watchBtn.classList.toggle('is-watched', isWatched);
      const nextTitle = isWatched ? t('watched.unmark', lang) : t('watched.mark', lang);
      const nextText = isWatched ? (showWatchedBadge ? `✓ ${t('watched.badge', lang)}` : '✓') : '○';
      if (watchBtn.title !== nextTitle) watchBtn.title = nextTitle;
      if (watchBtn.textContent !== nextText) watchBtn.textContent = nextText;
    }
  }
}

function applyPlaylistFiltersAndSort() {
  const state = getAppState();
  const watchedMap = state.watched || {};
  const items = getPlaylistVideoItems();
  const container = getPlaylistVideoListContainer();

  enhancePlaylistRows();

  const query = normText(plView.search).trim();
  const minSec =
    plView.durationFilter === 'custom' && plView.customMinMin !== ''
      ? Math.max(0, Number(plView.customMinMin) * 60)
      : plView.durationFilter === '5to20'
        ? 5 * 60
        : plView.durationFilter === 'over20'
          ? 20 * 60
          : null;

  const maxSec =
    plView.durationFilter === 'custom' && plView.customMaxMin !== ''
      ? Math.max(0, Number(plView.customMaxMin) * 60)
      : plView.durationFilter === 'under5'
        ? 5 * 60
        : plView.durationFilter === '5to20'
          ? 20 * 60
          : null;

  const totalCount = items.length;
  let watchedCount = 0;
  let totalDurationSec = 0;
  let remainingDurationSec = 0;
  let visibleCount = 0;

  for (const item of items) {
    const isWatched = Boolean(item.videoId && watchedMap[item.videoId]);
    if (isWatched) watchedCount++;
    totalDurationSec += item.durationSec;
    if (!isWatched) remainingDurationSec += item.durationSec;

    let visible = true;

    if (query) {
      const hay = normText(`${item.title} ${item.channelTitle}`);
      if (!hay.includes(query)) visible = false;
    }

    if (visible && plView.watchedFilter === 'unwatched' && isWatched) visible = false;
    if (visible && plView.watchedFilter === 'watched' && !isWatched) visible = false;
    if (visible && plView.hideShorts && item.isShort) visible = false;

    if (visible && minSec !== null && item.durationSec < minSec) visible = false;
    if (visible && maxSec !== null && item.durationSec > maxSec) visible = false;

    item.el.classList.toggle('tp-pl-row-hidden', !visible);
    if (visible) visibleCount++;
  }

  if (container && items.length > 1) {
    const sorted = [...items];
    switch (plView.sortBy) {
      case 'reversed':
        sorted.sort((a, b) => b.origIdx - a.origIdx);
        break;
      case 'duration_asc':
        sorted.sort((a, b) => a.durationSec - b.durationSec || a.origIdx - b.origIdx);
        break;
      case 'duration_desc':
        sorted.sort((a, b) => b.durationSec - a.durationSec || a.origIdx - b.origIdx);
        break;
      case 'views_desc':
        sorted.sort((a, b) => b.views - a.views || a.origIdx - b.origIdx);
        break;
      case 'title_asc':
        sorted.sort((a, b) => a.title.localeCompare(b.title) || a.origIdx - b.origIdx);
        break;
      case 'title_desc':
        sorted.sort((a, b) => b.title.localeCompare(a.title) || a.origIdx - b.origIdx);
        break;
      case 'channel_asc':
        sorted.sort(
          (a, b) => a.channelTitle.localeCompare(b.channelTitle) || a.origIdx - b.origIdx
        );
        break;
      case 'original':
      default:
        sorted.sort((a, b) => a.origIdx - b.origIdx);
        break;
    }

    const currentRows = Array.from(container.children).filter(
      (c) => c.tagName === 'YTD-PLAYLIST-VIDEO-RENDERER'
    );
    const needsReorder =
      currentRows.length === sorted.length &&
      sorted.some((item, idx) => currentRows[idx] !== item.el);

    if (needsReorder) {
      const continuation = container.querySelector('ytd-continuation-item-renderer');
      const frag = document.createDocumentFragment();
      for (const item of sorted) frag.appendChild(item.el);
      if (continuation) container.insertBefore(frag, continuation);
      else container.appendChild(frag);
    }
  }

  updateToolbarStats({
    totalCount,
    watchedCount,
    totalDurationSec,
    remainingDurationSec,
    visibleCount,
  });

  enhancePlaylistSidebarStats({
    totalCount,
    watchedCount,
    totalDurationSec,
  });

  scheduleProgressSync(activePlaylistId, watchedCount, totalCount);
}

function updateToolbarStats({
  totalCount,
  watchedCount,
  totalDurationSec,
  remainingDurationSec,
  visibleCount,
}) {
  const toolbar = document.getElementById('tp-pl-toolbar');
  if (!toolbar) return;

  const pct = totalCount > 0 ? Math.round((watchedCount / totalCount) * 100) : 0;

  const statsEl = toolbar.querySelector('[data-tp-pl-stats]');
  if (statsEl) {
    statsEl.textContent = t('playlist.progress', getLang(), {
      watched: watchedCount,
      total: totalCount,
      percent: pct,
    });
  }

  const durEl = toolbar.querySelector('[data-tp-pl-durations]');
  if (durEl) {
    durEl.textContent = `⏱ ${formatDurationFull(totalDurationSec)} • ${pt('remainingDur')}: ${formatDuration(remainingDurationSec)}`;
  }

  const visEl = toolbar.querySelector('[data-tp-pl-visible]');
  if (visEl) {
    if (visibleCount !== totalCount) {
      visEl.textContent = pt('showingCount', { visible: visibleCount, total: totalCount });
      visEl.hidden = false;
    } else {
      visEl.textContent = '';
      visEl.hidden = true;
    }
  }

  const barEl = toolbar.querySelector('[data-tp-pl-bar]');
  if (barEl instanceof HTMLElement) {
    barEl.style.width = `${pct}%`;
  }

  const hasActiveFilter =
    Boolean(plView.search) ||
    plView.watchedFilter !== 'all' ||
    plView.durationFilter !== 'all' ||
    plView.hideShorts ||
    plView.sortBy !== 'original';

  const resetBtn = toolbar.querySelector('[data-tp-pl-action="reset-filters"]');
  if (resetBtn) resetBtn.hidden = !hasActiveFilter;

  updateBulkSelectionCount();
}

function scheduleProgressSync(playlistId, watchedCount, totalCount) {
  if (!playlistId || totalCount <= 0) return;
  const key = `${playlistId}:${watchedCount}:${totalCount}`;
  if (key === lastSyncedProgressKey) return;

  if (progressSyncTimer) clearTimeout(progressSyncTimer);
  progressSyncTimer = setTimeout(async () => {
    lastSyncedProgressKey = key;
    const state = getAppState();
    const existing = state.playlists?.[playlistId];
    if (!existing) {
      const meta = scrapeCurrentPlaylistMeta(playlistId);
      await callBg(MESSAGE_ACTIONS.UPSERT_PLAYLISTS, {
        playlists: [{ ...meta, watchedCount, videoCount: Math.max(meta.videoCount, totalCount) }],
      });
    } else {
      await callBg(MESSAGE_ACTIONS.UPDATE_PLAYLIST_PROGRESS, {
        playlistId,
        watchedCount,
        videoCount: Math.max(existing.videoCount || 0, totalCount),
      });
    }
  }, 1000);
}

function updateBulkSelectionCount() {
  const el = document.querySelector('[data-tp-pl-selected-count]');
  if (el) {
    el.textContent = `✓ ${pt('selectedCount', { count: plView.selectedIds.size })}`;
  }
  const selectAllCb = document.querySelector('#tp-pl-toolbar [data-tp-pl-select-all]');
  if (selectAllCb instanceof HTMLInputElement) {
    const visibleItems = getPlaylistVideoItems().filter(
      (it) => it.videoId && !it.el.classList.contains('tp-pl-row-hidden')
    );
    selectAllCb.checked =
      visibleItems.length > 0 && visibleItems.every((it) => plView.selectedIds.has(it.videoId));
  }
}

/* ============================================================================
 * MULTI-SELECT BULK ACTIONS (NATIVE PLAYLIST)
 * ========================================================================== */

async function handleBulkAction(action) {
  const items = getPlaylistVideoItems();
  const state = getAppState();
  const watchedMap = state.watched || {};

  if (action === 'select-visible') {
    for (const item of items) {
      if (item.videoId && !item.el.classList.contains('tp-pl-row-hidden')) {
        plView.selectedIds.add(item.videoId);
      }
    }
    enhancePlaylistRows();
    updateBulkSelectionCount();
    return;
  }

  if (action === 'select-watched') {
    for (const item of items) {
      if (item.videoId && watchedMap[item.videoId]) {
        plView.selectedIds.add(item.videoId);
      }
    }
    enhancePlaylistRows();
    updateBulkSelectionCount();
    return;
  }

  if (action === 'invert') {
    for (const item of items) {
      if (!item.videoId || item.el.classList.contains('tp-pl-row-hidden')) continue;
      if (plView.selectedIds.has(item.videoId)) plView.selectedIds.delete(item.videoId);
      else plView.selectedIds.add(item.videoId);
    }
    enhancePlaylistRows();
    updateBulkSelectionCount();
    return;
  }

  if (action === 'clear') {
    plView.selectedIds.clear();
    enhancePlaylistRows();
    updateBulkSelectionCount();
    return;
  }

  const selectedItems = items.filter((it) => it.videoId && plView.selectedIds.has(it.videoId));
  if (selectedItems.length === 0) {
    showToast(pt('noSelection'), 'info');
    return;
  }

  if (action === 'mark-watched' || action === 'mark-unwatched') {
    const allAlreadyWatched = selectedItems.every((it) => Boolean(watchedMap[it.videoId]));
    const watched = action === 'mark-watched' ? !allAlreadyWatched : false;
    const records = selectedItems.map((it) => ({
      videoId: it.videoId,
      title: it.title,
      channelId: it.channelId,
      durationSec: it.durationSec,
    }));
    const res = await callBg(MESSAGE_ACTIONS.BULK_MARK_WATCHED, { records, watched });
    if (res?.ok) {
      showToast(
        `${records.length} — ${watched ? pt('watchedMarked') : pt('watchedUnmarked')}`,
        'success'
      );
      applyPlaylistFiltersAndSort();
    }
    return;
  }

  if (action === 'play-queue') {
    const ids = selectedItems.map((it) => it.videoId);
    if (ids.length > 50) showToast(pt('queueTruncated'), 'info');
    const queueUrl = `https://www.youtube.com/watch_videos?video_ids=${encodeURIComponent(
      ids.slice(0, 50).join(',')
    )}`;
    window.open(queueUrl, '_blank', 'noopener');
    return;
  }

  if (action === 'copy-move') {
    openCopyMoveModal(selectedItems);
    return;
  }

  if (action === 'remove') {
    openRemoveSelectedModal(selectedItems);
  }
}

function openCopyMoveModal(selectedItems, excludePlaylistId = activePlaylistId) {
  closeOverlayModal('tp-pl-copymove-modal');

  const state = getAppState();
  const customPlaylists = getCustomPlaylists(state).filter((p) => p.id !== excludePlaylistId);

  const backdrop = document.createElement('div');
  backdrop.id = 'tp-pl-copymove-modal';
  backdrop.className = 'tp-pl-modal-backdrop tp-pl-modal-backdrop-top';

  backdrop.innerHTML = `
    <div class="tp-pl-modal tp-pl-modal-md" role="dialog" aria-modal="true">
      <div class="tp-pl-modal-header">
        <h3>${esc(pt('copyMoveTitle', { count: selectedItems.length }))}</h3>
        <button type="button" class="tp-pl-close-btn" data-tp-close>&times;</button>
      </div>
      <div class="tp-pl-modal-body">
        ${
          customPlaylists.length > 0
            ? `<div class="tp-pl-section-box">
                <h4>${esc(pt('copyMoveExistingCustom'))}</h4>
                <div class="tp-pl-mini-list">
                  ${customPlaylists
                    .map(
                      (pl) => `
                    <div class="tp-pl-mini-item">
                      <span class="tp-pl-mini-title">${esc(pl.title)} (${(pl.videos || []).length})</span>
                      <button type="button" class="tp-pl-btn tp-pl-btn-sm tp-pl-btn-accent" data-tp-copy-to="${esc(pl.id)}">
                        + ${esc(t('common.add', getLang()))}
                      </button>
                    </div>
                  `
                    )
                    .join('')}
                </div>
              </div>`
            : ''
        }

        <div class="tp-pl-section-box">
          <h4>${esc(pt('copyMoveVirtualTitle'))}</h4>
          <p class="tp-pl-muted">${esc(pt('copyMoveNativeHint'))}</p>
          <div class="tp-pl-form-row">
            <input type="text" class="tp-pl-input" data-tp-virtual-name placeholder="${esc(pt('copyMoveVirtualPlaceholder'))}" />
          </div>
          <button type="button" class="tp-pl-btn tp-pl-btn-accent" data-tp-save-virtual>
            ${esc(pt('copyMoveVirtualBtn'))}
          </button>
        </div>

        ${
          selectedItems[0]?.el
            ? `<div class="tp-pl-section-box">
                <h4>${esc(pt('copyMoveExistingTitle'))}</h4>
                <button type="button" class="tp-pl-btn" data-tp-native-save>
                  ${esc(pt('copyMoveNativeBtn'))}
                </button>
              </div>`
            : ''
        }
      </div>
      <div class="tp-pl-modal-footer">
        <button type="button" class="tp-pl-btn tp-pl-btn-ghost" data-tp-close>${esc(t('common.close', getLang()))}</button>
      </div>
    </div>
  `;

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || (e.target instanceof Element && e.target.closest('[data-tp-close]'))) {
      backdrop.remove();
    }
  });

  backdrop.querySelectorAll('[data-tp-copy-to]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const targetPlId = btn.getAttribute('data-tp-copy-to');
      if (!targetPlId) return;
      const targetPl = getAppState().playlists?.[targetPlId];
      for (const it of selectedItems) {
        await callBg(MESSAGE_ACTIONS.ADD_VIDEO_TO_PLAYLIST, {
          playlistId: targetPlId,
          video: {
            videoId: it.videoId,
            title: it.title || it.videoId,
            channelTitle: it.channelTitle || '',
            channelId: it.channelId || '',
            durationSec: it.durationSec || 0,
            thumbnailUrl:
              it.thumbnailUrl ||
              `https://i.ytimg.com/vi/${encodeURIComponent(it.videoId)}/hqdefault.jpg`,
            addedAt: Date.now(),
          },
        });
      }
      showToast(pt('addedToPlaylist', { title: targetPl?.title || targetPlId }), 'success');
      backdrop.remove();
    });
  });

  backdrop.querySelector('[data-tp-save-virtual]')?.addEventListener('click', async () => {
    const nameInput = backdrop.querySelector('[data-tp-virtual-name]');
    const title = nameInput?.value?.trim() || `${BRAND_NAME} (${selectedItems.length})`;
    const videos = selectedItems.map((it) => ({
      videoId: it.videoId,
      title: it.title || it.videoId,
      channelTitle: it.channelTitle || '',
      channelId: it.channelId || '',
      durationSec: it.durationSec || 0,
      thumbnailUrl:
        it.thumbnailUrl ||
        `https://i.ytimg.com/vi/${encodeURIComponent(it.videoId)}/hqdefault.jpg`,
      addedAt: Date.now(),
    }));
    const ids = videos.map((v) => v.videoId).slice(0, 50);
    const colId = `ps_pl_${Date.now().toString(36)}`;
    const thumb = videos[0]?.thumbnailUrl || '';
    const url = `https://www.youtube.com/watch_videos?video_ids=${encodeURIComponent(ids.join(','))}`;

    const res = await callBg(MESSAGE_ACTIONS.UPSERT_PLAYLISTS, {
      playlists: [
        {
          id: colId,
          title,
          url,
          thumbnailUrl: thumb,
          videoCount: videos.length,
          watchedCount: 0,
          groupIds: [],
          author: BRAND_NAME,
          isCustom: true,
          description: '',
          videos,
        },
      ],
    });
    if (res?.ok) {
      showToast(pt('virtualCreated', { title, count: videos.length }), 'success');
      backdrop.remove();
    }
  });

  backdrop.querySelector('[data-tp-native-save]')?.addEventListener('click', async () => {
    backdrop.remove();
    const first = selectedItems[0];
    if (first?.el) {
      await triggerNativeRowMenuItem(first.el, /(save to playlist|salvar na playlist|guardar en)/i);
    }
  });

  document.body.appendChild(backdrop);
}

function openRemoveSelectedModal(selectedItems) {
  closeOverlayModal('tp-pl-remove-modal');
  cancelRemovalFlag = false;

  const backdrop = document.createElement('div');
  backdrop.id = 'tp-pl-remove-modal';
  backdrop.className = 'tp-pl-modal-backdrop';

  backdrop.innerHTML = `
    <div class="tp-pl-modal tp-pl-modal-sm" role="dialog" aria-modal="true">
      <div class="tp-pl-modal-header">
        <h3>${esc(pt('removeConfirmTitle'))}</h3>
        <button type="button" class="tp-pl-close-btn" data-tp-close>&times;</button>
      </div>
      <div class="tp-pl-modal-body">
        <p data-tp-remove-msg>${esc(pt('removeConfirmBody', { count: selectedItems.length }))}</p>
        <div class="tp-pl-progress-bar-track" data-tp-remove-track hidden>
          <div class="tp-pl-progress-bar-fill" data-tp-remove-fill style="width:0%"></div>
        </div>
      </div>
      <div class="tp-pl-modal-footer">
        <button type="button" class="tp-pl-btn tp-pl-btn-ghost" data-tp-cancel-btn>${esc(t('common.cancel', getLang()))}</button>
        <button type="button" class="tp-pl-btn tp-pl-btn-danger" data-tp-confirm-remove>${esc(t('common.confirm', getLang()))}</button>
      </div>
    </div>
  `;

  let running = false;
  const cancelAndClose = () => {
    if (running) cancelRemovalFlag = true;
    else backdrop.remove();
  };

  backdrop.querySelector('[data-tp-close]')?.addEventListener('click', cancelAndClose);
  backdrop.querySelector('[data-tp-cancel-btn]')?.addEventListener('click', cancelAndClose);

  backdrop.querySelector('[data-tp-confirm-remove]')?.addEventListener('click', async (e) => {
    const btn = /** @type {HTMLButtonElement} */ (e.currentTarget);
    btn.disabled = true;
    running = true;

    const msgEl = backdrop.querySelector('[data-tp-remove-msg]');
    const trackEl = backdrop.querySelector('[data-tp-remove-track]');
    const fillEl = backdrop.querySelector('[data-tp-remove-fill]');
    if (trackEl) trackEl.hidden = false;

    let removed = 0;
    const total = selectedItems.length;

    for (let i = 0; i < total; i++) {
      if (cancelRemovalFlag) break;
      const item = selectedItems[i];
      if (msgEl) msgEl.textContent = pt('removingProgress', { done: i + 1, total });
      if (fillEl instanceof HTMLElement) {
        fillEl.style.width = `${Math.round(((i + 1) / total) * 100)}%`;
      }

      if (document.contains(item.el)) {
        const ok = await triggerNativeRowMenuItem(
          item.el,
          /(remove from|remover de|eliminar de|retirer de)/i
        );
        if (ok) {
          removed++;
          plView.selectedIds.delete(item.videoId);
        }
      }
      await delay(380);
    }

    running = false;
    backdrop.remove();

    if (cancelRemovalFlag) {
      showToast(pt('removeCancelled', { done: removed, total }), 'info');
    } else {
      showToast(pt('removeDone', { done: removed }), 'success');
    }
    applyPlaylistFiltersAndSort();
  });

  document.body.appendChild(backdrop);
}

async function triggerNativeRowMenuItem(row, pattern) {
  const menuBtn =
    row.querySelector('ytd-menu-renderer button#button') ||
    row.querySelector('ytd-menu-renderer yt-icon-button button') ||
    row.querySelector('ytd-menu-renderer button');
  if (!(menuBtn instanceof HTMLElement)) return false;

  menuBtn.click();
  await delay(220);

  const popup =
    document.querySelector('ytd-popup-container tp-yt-iron-dropdown:not([aria-hidden="true"])') ||
    document.querySelector('ytd-menu-popup-renderer');
  if (!popup) return false;

  const items = Array.from(
    popup.querySelectorAll('ytd-menu-service-item-renderer, ytd-menu-navigation-item-renderer, tp-yt-paper-item')
  );
  for (const item of items) {
    const txt = item.textContent?.trim() || '';
    if (pattern.test(txt) && item instanceof HTMLElement) {
      item.click();
      return true;
    }
  }

  document.body.click();
  return false;
}

/* ============================================================================
 * PLAYLIST HEADER & /feed/playlists CARD ENHANCEMENTS + CUSTOM PLAYLISTS INJECTION
 * ========================================================================== */

function enhancePlaylistHeader() {
  if (!activePlaylistId) return;
  const existingBtn = document.querySelector('.tp-pl-header-group-btn');
  if (existingBtn && !existingBtn.closest('[hidden]')) return;
  if (existingBtn) existingBtn.remove();

  const activeBrowse =
    document.querySelector('ytd-browse[page-subtype="playlist"]:not([hidden])') ||
    document.querySelector('ytd-browse[role="main"]:not([hidden])') ||
    document;

  const headerActions =
    activeBrowse.querySelector('ytd-playlist-header-renderer .play-menu') ||
    activeBrowse.querySelector('ytd-playlist-header-renderer .metadata-buttons-wrapper') ||
    activeBrowse.querySelector('yt-page-header-view-model .yt-flexible-actions-view-model-wiz__action-row') ||
    activeBrowse.querySelector('yt-page-header-renderer .yt-flexible-actions-view-model-wiz__action-row') ||
    activeBrowse.querySelector('.immersive-header-container .play-menu') ||
    document.querySelector('ytd-playlist-header-renderer .play-menu') ||
    document.querySelector('ytd-playlist-header-renderer .metadata-buttons-wrapper') ||
    document.querySelector('yt-page-header-renderer .yt-flexible-actions-view-model-wiz__action-row');

  if (!headerActions) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tp-pl-header-group-btn';
  btn.innerHTML = `<span>🎨</span><span>${esc(pt('customizePlaylist'))}</span>`;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!activePlaylistId) return;
    openPlaylistCustomizeModal(activePlaylistId, scrapeCurrentPlaylistMeta(activePlaylistId));
  });

  headerActions.appendChild(btn);
}

/**
 * Inject PlayShelf custom playlists as native-proportioned cards on `/feed/playlists`.
 */
function injectCustomPlaylistsIntoFeed(state) {
  const customPlaylists = getCustomPlaylists(state);
  const existingShelf = document.getElementById('tp-custom-pl-feed-shelf');

  if (customPlaylists.length === 0) {
    existingShelf?.remove();
    return;
  }

  const primaryHost =
    document.querySelector('ytd-browse[page-subtype="playlists"] ytd-rich-grid-renderer') ||
    document.querySelector('ytd-browse[page-subtype="playlists"] ytd-section-list-renderer') ||
    document.querySelector('ytd-browse[page-subtype="playlists"] #primary') ||
    document.querySelector('ytd-browse ytd-rich-grid-renderer');

  if (!primaryHost) return;

  let shelf = existingShelf;
  if (!shelf || !document.contains(shelf)) {
    shelf = document.createElement('div');
    shelf.id = 'tp-custom-pl-feed-shelf';
    shelf.className = 'tp-custom-pl-shelf';
    primaryHost.prepend(shelf);
  }

  const watchedMap = state.watched || {};
  const showProgress = state.settings?.showProgressOnPlaylists !== false;

  shelf.innerHTML = `
    <div class="tp-custom-pl-shelf-header">
      <div class="tp-custom-pl-shelf-title">
        <span class="tp-pl-brand">${esc(BRAND_NAME)}</span>
        <h3>${esc(t('playlist.myCustomPlaylists', getLang()))}</h3>
        <span class="tp-pl-badge">${customPlaylists.length}</span>
      </div>
      <button type="button" class="tp-pl-btn tp-pl-btn-accent tp-pl-btn-sm" data-tp-feed-new-pl>
        ${esc(pt('newPlaylistBtn'))}
      </button>
    </div>
    <div class="tp-custom-pl-grid">
      ${customPlaylists
        .map((pl) => {
          const videos = Array.isArray(pl.videos) ? pl.videos : [];
          const total = videos.length;
          const watched = videos.filter((v) => watchedMap[v.videoId]).length;
          const pct = total > 0 ? Math.round((watched / total) * 100) : 0;
          const thumb = getPlaylistThumb(pl);
          const accentColor = pl.color || '';
          const iconHtml = pl.icon
            ? `<span class="tp-custom-pl-icon-chip" style="color:${esc(accentColor || '#ef233c')}">${renderIconHtml(pl.icon, 16)}</span>`
            : '';

          return `
            <div class="tp-custom-pl-card" data-tp-custom-pl-id="${esc(pl.id)}" ${accentColor ? `style="border-top:3px solid ${esc(accentColor)};"` : ''}>
              <div class="tp-custom-pl-thumb" data-tp-open-cpl="${esc(pl.id)}">
                ${
                  thumb
                    ? `<img src="${esc(thumb)}" alt="" loading="lazy" />`
                    : `<div class="tp-custom-pl-thumb-empty">${pl.icon ? renderIconHtml(pl.icon, 36) : '🎵'}</div>`
                }
                <span class="tp-custom-pl-pill-tag" ${accentColor ? `style="background:${esc(accentColor)};"` : ''}>${esc(BRAND_NAME)}</span>
                <span class="tp-custom-pl-count-badge">≡ ${total}</span>
              </div>
              <div class="tp-custom-pl-body">
                <div class="tp-custom-pl-title" data-tp-open-cpl="${esc(pl.id)}" title="${esc(pl.title)}">${iconHtml}<span>${esc(pl.title)}</span></div>
                ${
                  showProgress && total > 0
                    ? `<div class="tp-pl-card-progress" title="${esc(t('playlist.progress', getLang(), { watched, total, percent: pct }))}">
                        <div class="tp-pl-card-progress-fill" style="width:${pct}%${accentColor ? `;background:${esc(accentColor)}` : ''}"></div>
                      </div>`
                    : ''
                }
                <div class="tp-custom-pl-actions">
                  <button type="button" class="tp-pl-btn tp-pl-btn-sm tp-pl-btn-accent" data-tp-play-cpl="${esc(pl.id)}" ${total === 0 ? 'disabled' : ''}>▶ ${esc(pt('playAll'))}</button>
                  <button type="button" class="tp-pl-btn tp-pl-btn-sm" data-tp-open-cpl="${esc(pl.id)}">${esc(pt('openPlaylist'))}</button>
                  <button type="button" class="tp-pl-btn tp-pl-btn-sm" data-tp-customize-cpl="${esc(pl.id)}">🎨 ${esc(pt('customizePlaylist'))}</button>
                </div>
              </div>
            </div>
          `;
        })
        .join('')}
    </div>
  `;

  shelf.querySelector('[data-tp-feed-new-pl]')?.addEventListener('click', () => {
    openQuickCreateCustomPlaylistModal();
  });

  shelf.querySelectorAll('[data-tp-open-cpl]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pid = el.getAttribute('data-tp-open-cpl');
      if (pid) openCustomPlaylistView(pid);
    });
  });

  shelf.querySelectorAll('[data-tp-play-cpl]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pid = btn.getAttribute('data-tp-play-cpl');
      const pl = pid ? getAppState().playlists?.[pid] : null;
      const ids = (pl?.videos || []).map((v) => v.videoId).slice(0, 50);
      if (ids.length === 0) return;
      window.open(
        `https://www.youtube.com/watch_videos?video_ids=${encodeURIComponent(ids.join(','))}`,
        '_blank',
        'noopener'
      );
    });
  });

  shelf.querySelectorAll('[data-tp-customize-cpl]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pid = btn.getAttribute('data-tp-customize-cpl');
      if (pid) openPlaylistCustomizeModal(pid);
    });
  });
}

function openQuickCreateCustomPlaylistModal() {
  closeOverlayModal('tp-pl-quickcreate-modal');

  const backdrop = document.createElement('div');
  backdrop.id = 'tp-pl-quickcreate-modal';
  backdrop.className = 'tp-pl-modal-backdrop tp-pl-modal-backdrop-top';

  backdrop.innerHTML = `
    <div class="tp-pl-modal tp-pl-modal-sm" role="dialog" aria-modal="true">
      <div class="tp-pl-modal-header">
        <h3>${esc(t('playlist.newCustomPlaylist', getLang()))}</h3>
        <button type="button" class="tp-pl-close-btn" data-tp-close>&times;</button>
      </div>
      <div class="tp-pl-modal-body">
        <div class="tp-pl-form-row">
          <label class="tp-pl-label">${esc(pt('newPlaylistPlaceholder'))}</label>
          <input type="text" class="tp-pl-input" data-tp-qc-name placeholder="${esc(pt('newPlaylistPlaceholder'))}" />
        </div>
        <div class="tp-pl-form-row">
          <label class="tp-pl-label">${esc(pt('descriptionPlaceholder'))}</label>
          <input type="text" class="tp-pl-input" data-tp-qc-desc placeholder="${esc(pt('descriptionPlaceholder'))}" />
        </div>
      </div>
      <div class="tp-pl-modal-footer">
        <button type="button" class="tp-pl-btn tp-pl-btn-ghost" data-tp-close>${esc(t('common.cancel', getLang()))}</button>
        <button type="button" class="tp-pl-btn tp-pl-btn-accent" data-tp-qc-submit>${esc(t('common.create', getLang()))}</button>
      </div>
    </div>
  `;

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || (e.target instanceof Element && e.target.closest('[data-tp-close]'))) {
      backdrop.remove();
    }
  });

  backdrop.querySelector('[data-tp-qc-submit]')?.addEventListener('click', async () => {
    const title = backdrop.querySelector('[data-tp-qc-name]')?.value?.trim();
    if (!title) {
      backdrop.querySelector('[data-tp-qc-name]')?.focus();
      return;
    }
    const description = backdrop.querySelector('[data-tp-qc-desc]')?.value?.trim() || '';
    const id = `ps_pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    const res = await callBg(MESSAGE_ACTIONS.UPSERT_PLAYLISTS, {
      playlists: [
        {
          id,
          title,
          description,
          url: 'https://www.youtube.com/feed/playlists',
          thumbnailUrl: '',
          videoCount: 0,
          watchedCount: 0,
          groupIds: [],
          author: BRAND_NAME,
          isCustom: true,
          videos: [],
        },
      ],
    });
    if (res?.ok) {
      showToast(pt('virtualCreated', { title, count: 0 }), 'success');
      backdrop.remove();
      openCustomPlaylistView(id);
    }
  });

  document.body.appendChild(backdrop);
  backdrop.querySelector('[data-tp-qc-name]')?.focus();
}

/**
 * Debounced one-shot sync of scraped native YouTube playlists on `/feed/playlists`
 * into `state.playlists` (with `isCustom: false`) so they appear in TubeNook's sidebar.
 * @param {Array<{ id: string, title: string, url: string, thumbnailUrl: string, videoCount: number }>} scraped
 */
function scheduleSyncScrapedNativePlaylists(scraped) {
  if (!Array.isArray(scraped) || scraped.length === 0) return;

  const state = getAppState();
  const toUpsert = [];
  for (const item of scraped) {
    if (!item?.id || syncedNativeFeedIds.has(item.id)) continue;
    const existing = state.playlists?.[item.id];
    if (existing?.isCustom) {
      syncedNativeFeedIds.add(item.id);
      continue;
    }
    if (
      existing &&
      existing.title === item.title &&
      (!item.thumbnailUrl || existing.thumbnailUrl === item.thumbnailUrl) &&
      (!item.videoCount || (existing.videoCount || 0) >= item.videoCount)
    ) {
      syncedNativeFeedIds.add(item.id);
      continue;
    }
    toUpsert.push({
      id: item.id,
      title: item.title,
      url: item.url,
      thumbnailUrl: item.thumbnailUrl || existing?.thumbnailUrl || '',
      videoCount: Math.max(item.videoCount || 0, existing?.videoCount || 0),
      watchedCount: existing?.watchedCount || 0,
      groupIds: existing?.groupIds || [],
      author: existing?.author || '',
      isCustom: false,
    });
  }

  if (toUpsert.length === 0) return;

  if (nativeFeedSyncTimer) clearTimeout(nativeFeedSyncTimer);
  nativeFeedSyncTimer = setTimeout(async () => {
    nativeFeedSyncTimer = null;
    for (const p of toUpsert) syncedNativeFeedIds.add(p.id);
    await callBg(MESSAGE_ACTIONS.UPSERT_PLAYLISTS, { playlists: toUpsert });
  }, 500);
}

function enhancePlaylistCards() {
  const state = getAppState();
  const showProgress = state.settings?.showProgressOnPlaylists !== false;

  // Inject TubeNook custom playlists shelf into /feed/playlists
  injectCustomPlaylistsIntoFeed(state);

  const cardSelectors = [
    'ytd-grid-playlist-renderer',
    'ytd-playlist-renderer',
    'yt-lockup-view-model',
    'ytd-rich-item-renderer',
  ];

  const root = document.querySelector('ytd-page-manager') || document;
  const candidates = root.querySelectorAll(cardSelectors.join(','));
  const scrapedNative = [];

  for (const card of candidates) {
    if (card.closest('#tp-custom-pl-feed-shelf')) continue;
    if (card.closest('.tp-pl-card-enhanced') && !card.classList.contains('tp-pl-card-enhanced')) {
      continue;
    }
    const link = card.querySelector('a[href*="/playlist?list="], a[href*="list="]');
    if (!link) continue;

    const href = link.getAttribute('href') || '';
    const playlistId = extractPlaylistIdFromHref(href);
    if (!playlistId) continue;

    if (
      card.tagName === 'YTD-RICH-ITEM-RENDERER' &&
      !href.includes('/playlist?list=') &&
      !card.querySelector('yt-lockup-view-model, ytd-playlist-thumbnail')
    ) {
      continue;
    }

    card.classList.add('tp-pl-card-enhanced');

    const titleEl =
      card.querySelector('#video-title') ||
      card.querySelector('h3') ||
      card.querySelector('.yt-lockup-metadata-view-model__title') ||
      card.querySelector('a[href*="/playlist?list="]');
    const title = (titleEl?.getAttribute('title') || titleEl?.textContent || '').trim() || playlistId;
    const imgEl = card.querySelector('img');
    const thumbnailUrl = safeUrl(imgEl?.getAttribute('src') || '', '');

    // Best-effort video count extraction from badge text
    let scrapedCount = 0;
    const badgeEl =
      card.querySelector('ytd-thumbnail-overlay-side-panel-renderer yt-formatted-string') ||
      card.querySelector('yt-thumbnail-overlay-badge-view-model .badge-shape-wiz__text') ||
      card.querySelector('.yt-badge-shape__text');
    const badgeTxt = badgeEl?.textContent?.trim() || '';
    const cntMatch = badgeTxt.match(/(\d[\d.,]*)/);
    if (cntMatch) {
      const parsed = parseInt(cntMatch[1].replace(/[^\d]/g, ''), 10);
      if (Number.isFinite(parsed)) scrapedCount = parsed;
    }

    const plUrl = `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
    scrapedNative.push({
      id: playlistId,
      title,
      url: plUrl,
      thumbnailUrl,
      videoCount: scrapedCount,
    });

    const plRecord = state.playlists?.[playlistId];

    let footer = card.querySelector('.tp-pl-card-bar');
    if (!footer) {
      footer = document.createElement('div');
      footer.className = 'tp-pl-card-bar';
      card.appendChild(footer);
    }

    const pct =
      plRecord && plRecord.videoCount > 0
        ? Math.min(100, Math.round(((plRecord.watchedCount || 0) / plRecord.videoCount) * 100))
        : 0;

    const customBadgeHtml =
      plRecord?.icon || plRecord?.color
        ? `<span class="tp-pl-card-pill" style="--tp-pill-color:${esc(plRecord.color || '#ef233c')}">${
            plRecord.icon ? renderIconHtml(plRecord.icon, 12) : '●'
          }<span>${esc(BRAND_NAME)}</span></span>`
        : '';

    footer.innerHTML = `
      ${
        showProgress && plRecord && plRecord.videoCount > 0
          ? `<div class="tp-pl-card-progress" title="${esc(t('playlist.progress', getLang(), { watched: plRecord.watchedCount || 0, total: plRecord.videoCount, percent: pct }))}">
              <div class="tp-pl-card-progress-fill" style="width:${pct}%${plRecord.color ? `;background:${esc(plRecord.color)}` : ''}"></div>
            </div>`
          : ''
      }
      <div class="tp-pl-card-row">
        <div class="tp-pl-card-pills">${customBadgeHtml}</div>
        <button type="button" class="tp-pl-card-assign-btn" title="${esc(pt('customizePlaylist'))}">
          🎨 ${esc(pt('customizePlaylist'))}
        </button>
      </div>
    `;

    footer.querySelector('.tp-pl-card-assign-btn')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPlaylistCustomizeModal(playlistId, {
        id: playlistId,
        title,
        url: plUrl,
        thumbnailUrl,
        videoCount: Math.max(scrapedCount, plRecord?.videoCount || 0),
        isCustom: false,
      });
    });
  }

  if (scrapedNative.length > 0) {
    scheduleSyncScrapedNativePlaylists(scrapedNative);
  }
}

/* ============================================================================
 * FULL CUSTOM PLAYLIST DETAIL VIEW (`openCustomPlaylistView(playlistId)`)
 * Two-column YouTube-native layout matching the user's screenshot
 * ========================================================================== */

/**
 * Open the rich two-column Custom Playlist Detail View modal for a PlayShelf custom playlist.
 * @param {string} playlistId
 */
export function openCustomPlaylistView(playlistId) {
  if (!playlistId) return;
  const isNew = customPlView.playlistId !== playlistId;
  customPlView.open = true;
  customPlView.playlistId = playlistId;
  if (isNew) {
    customPlView.search = '';
    customPlView.watchedFilter = 'all';
    customPlView.hideWatched = false;
    customPlView.sortBy = 'date_desc';
    customPlView.selectedIds.clear();
    customPlView.editingMeta = false;
    customPlView.addingVideo = false;
  }
  renderCustomPlaylistViewModal();
}

function closeCustomPlaylistView() {
  customPlView.open = false;
  document.getElementById('tp-custom-pl-modal')?.remove();
  document.getElementById('tp-cpl-ctx-menu')?.remove();
}

function renderCustomPlaylistViewModal() {
  if (!customPlView.open || !customPlView.playlistId) return;

  const state = getAppState();
  const pl = state.playlists?.[customPlView.playlistId];
  if (!pl) {
    closeCustomPlaylistView();
    return;
  }

  let backdrop = document.getElementById('tp-custom-pl-modal');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'tp-custom-pl-modal';
    backdrop.className = 'tp-pl-modal-backdrop tp-cpl-backdrop';
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeCustomPlaylistView();
    });
    document.body.appendChild(backdrop);
  }

  const watchedMap = state.watched || {};
  const notesMap = state.videoNotes || {};
  const allVideos = Array.isArray(pl.videos) ? pl.videos : [];
  const totalCount = allVideos.length;
  const watchedCount = allVideos.filter((v) => watchedMap[v.videoId]).length;
  const pctNum = totalCount > 0 ? (watchedCount / totalCount) * 100 : 0;
  const pctText = pctNum.toFixed(1);
  const totalDurationSec = allVideos.reduce((acc, v) => acc + (Number(v.durationSec) || 0), 0);

  // Filter
  const q = normText(customPlView.search).trim();
  let visibleVideos = allVideos.filter((v) => {
    const isWatched = Boolean(watchedMap[v.videoId]);
    if (customPlView.hideWatched && isWatched) return false;
    if (customPlView.watchedFilter === 'unwatched' && isWatched) return false;
    if (customPlView.watchedFilter === 'watched' && !isWatched) return false;
    if (q) {
      const hay = normText(`${v.title || ''} ${v.channelTitle || ''}`);
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Sort
  visibleVideos = [...visibleVideos];
  switch (customPlView.sortBy) {
    case 'date_desc':
      visibleVideos.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
      break;
    case 'duration_asc':
      visibleVideos.sort((a, b) => (a.durationSec || 0) - (b.durationSec || 0));
      break;
    case 'duration_desc':
      visibleVideos.sort((a, b) => (b.durationSec || 0) - (a.durationSec || 0));
      break;
    case 'title_asc':
      visibleVideos.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
      break;
    case 'channel_asc':
      visibleVideos.sort((a, b) => (a.channelTitle || '').localeCompare(b.channelTitle || ''));
      break;
    case 'original':
    default:
      break;
  }

  const thumbUrl = getPlaylistThumb(pl);
  const accentColor = pl.color || '';
  const allVisibleSelected =
    visibleVideos.length > 0 && visibleVideos.every((v) => customPlView.selectedIds.has(v.videoId));

  backdrop.innerHTML = `
    <div class="tp-cpl-shell" role="dialog" aria-modal="true">
      <!-- LEFT GRADIENT INFO PANEL -->
      <aside class="tp-cpl-left" ${accentColor ? `style="--tp-pl-accent:${esc(accentColor)};border-top:3px solid ${esc(accentColor)};"` : ''}>
        <div class="tp-cpl-thumb-box">
          ${
            thumbUrl
              ? `<img src="${esc(thumbUrl)}" alt="" />`
              : `<div class="tp-cpl-thumb-empty">${pl.icon ? renderIconHtml(pl.icon, 42) : '🎵'}</div>`
          }
          <button type="button" class="tp-cpl-thumb-edit" data-tp-cpl-action="customize" title="${esc(pt('customizePlaylist'))}">🎨</button>
        </div>

        ${
          customPlView.editingMeta
            ? `<div class="tp-cpl-edit-form">
                <input type="text" class="tp-pl-input" data-tp-cpl-edit-title value="${esc(pl.title)}" />
                <textarea class="tp-pl-input tp-cpl-textarea" data-tp-cpl-edit-desc placeholder="${esc(pt('descriptionPlaceholder'))}">${esc(pl.description || '')}</textarea>
                <div class="tp-cpl-edit-btns">
                  <button type="button" class="tp-pl-btn tp-pl-btn-sm tp-pl-btn-ghost" data-tp-cpl-action="cancel-edit">${esc(t('common.cancel', getLang()))}</button>
                  <button type="button" class="tp-pl-btn tp-pl-btn-sm tp-pl-btn-accent" data-tp-cpl-action="save-edit">${esc(t('common.save', getLang()))}</button>
                </div>
              </div>`
            : `<h2 class="tp-cpl-title" data-tp-cpl-action="start-edit" title="${esc(pt('editPlaylist'))}">${
                pl.icon ? `<span class="tp-cpl-title-icon" style="color:${esc(accentColor || '#ef233c')}">${renderIconHtml(pl.icon, 20)}</span> ` : ''
              }${esc(pl.title)}</h2>
               <p class="tp-cpl-desc">${esc(pl.description || '')}</p>`
        }

        <div class="tp-cpl-meta-line">
          <span class="tp-pl-brand">${esc(BRAND_NAME)}</span>
          <span>· ${esc(pt('videosCount', { count: totalCount }))}</span>
        </div>

        <div class="tp-cpl-stats-block">
          <div class="tp-cpl-stat-row">
            <span>⏱ ${esc(formatDurationFull(totalDurationSec))}</span>
            <div class="tp-pl-side-mini-btns">
              <button type="button" class="tp-pl-icon-circle-sm" data-tp-cpl-action="reverse" title="${esc(pt('reverseOrder'))}">⇅</button>
              <button type="button" class="tp-pl-icon-circle-sm" data-tp-cpl-action="sort-dur" title="${esc(pt('sortDurAsc'))}">⏱↓</button>
            </div>
          </div>
          <div class="tp-cpl-stat-row">
            <span>% ${esc(pctText)}% <span class="tp-pl-side-muted">(${watchedCount}/${totalCount})</span></span>
          </div>
          <div class="tp-pl-progress-bar-track">
            <div class="tp-pl-progress-bar-fill" style="width:${Math.round(pctNum)}%"></div>
          </div>
        </div>

        <div class="tp-cpl-circle-actions">
          <button type="button" class="tp-pl-icon-circle tp-cpl-play-circle" data-tp-cpl-action="play-all" title="${esc(pt('playAll'))}" ${totalCount === 0 ? 'disabled' : ''}>▶</button>
          <button type="button" class="tp-pl-icon-circle" data-tp-cpl-action="toggle-add-video" title="${esc(pt('addVideoBtn'))}">+</button>
          <button type="button" class="tp-pl-icon-circle" data-tp-cpl-action="start-edit" title="${esc(pt('editPlaylist'))}">✏️</button>
          <button type="button" class="tp-pl-icon-circle" data-tp-cpl-action="share" title="${esc(pt('ctxShare'))}">↪</button>
          <button type="button" class="tp-pl-icon-circle" data-tp-cpl-action="more-menu" title="Mais">⋮</button>
          <button type="button" class="tp-pl-icon-circle" data-tp-cpl-action="remove-watched" title="${esc(pt('removeWatched'))}">⊖</button>
          <button type="button" class="tp-pl-icon-circle" data-tp-cpl-action="copy-all" title="${esc(pt('copyAllToPlaylist'))}">≡+</button>
        </div>

        <div class="tp-cpl-groups-row">
          <button type="button" class="tp-pl-btn tp-pl-btn-sm" data-tp-cpl-action="customize">🎨 ${esc(pt('customizePlaylist'))}</button>
        </div>

        ${
          customPlView.addingVideo
            ? `<div class="tp-cpl-add-box">
                <input type="text" class="tp-pl-input" data-tp-cpl-add-url placeholder="${esc(pt('addVideoUrlPlaceholder'))}" />
                <input type="text" class="tp-pl-input" data-tp-cpl-add-title placeholder="${esc(pt('addVideoTitlePlaceholder'))}" />
                <button type="button" class="tp-pl-btn tp-pl-btn-sm tp-pl-btn-accent" data-tp-cpl-action="confirm-add-video">${esc(pt('addVideoBtn'))}</button>
              </div>`
            : ''
        }
      </aside>

      <!-- RIGHT VIDEO LIST PANEL -->
      <main class="tp-cpl-right">
        <div class="tp-cpl-top-bar">
          <div class="tp-cpl-top-row-1">
            <select class="tp-pl-select" data-tp-cpl-filter>
              <option value="all" ${customPlView.watchedFilter === 'all' ? 'selected' : ''}>${esc(pt('statusAll'))}</option>
              <option value="unwatched" ${customPlView.watchedFilter === 'unwatched' ? 'selected' : ''}>${esc(pt('statusUnwatched'))}</option>
              <option value="watched" ${customPlView.watchedFilter === 'watched' ? 'selected' : ''}>${esc(pt('statusWatched'))}</option>
            </select>

            <div class="tp-pl-search-wrap">
              <span class="tp-pl-search-ico">🔍</span>
              <input type="text" class="tp-pl-search-input" data-tp-cpl-search placeholder="${esc(pt('searchPlaceholder'))}" value="${esc(customPlView.search)}" />
            </div>

            <button type="button" class="tp-pl-icon-circle-sm ${customPlView.hideWatched ? 'is-active' : ''}" data-tp-cpl-action="toggle-hide-watched" title="${esc(pt('hideWatched'))}">👁️</button>

            <button type="button" class="tp-pl-close-btn" data-tp-cpl-action="close" title="${esc(t('common.close', getLang()))}">&times;</button>
          </div>

          <div class="tp-cpl-top-row-2">
            <div class="tp-pl-selection-left">
              <label class="tp-pl-select-all-label" title="${esc(pt('selectAllVisible'))}">
                <input type="checkbox" class="tp-pl-select-all-cb" data-tp-cpl-select-all ${allVisibleSelected ? 'checked' : ''} />
              </label>

              <select class="tp-pl-select" data-tp-cpl-sort>
                <option value="date_desc" ${customPlView.sortBy === 'date_desc' ? 'selected' : ''}>${esc(pt('sortDateDesc'))}</option>
                <option value="original" ${customPlView.sortBy === 'original' ? 'selected' : ''}>${esc(pt('sortOriginal'))}</option>
                <option value="duration_asc" ${customPlView.sortBy === 'duration_asc' ? 'selected' : ''}>${esc(pt('sortDurAsc'))}</option>
                <option value="duration_desc" ${customPlView.sortBy === 'duration_desc' ? 'selected' : ''}>${esc(pt('sortDurDesc'))}</option>
                <option value="title_asc" ${customPlView.sortBy === 'title_asc' ? 'selected' : ''}>${esc(pt('sortTitleAsc'))}</option>
                <option value="channel_asc" ${customPlView.sortBy === 'channel_asc' ? 'selected' : ''}>${esc(pt('sortChannelAsc'))}</option>
              </select>

              <span class="tp-pl-bulk-count">✓ ${esc(pt('selectedCount', { count: customPlView.selectedIds.size }))}</span>
            </div>

            <div class="tp-pl-selection-right">
              <button type="button" class="tp-pl-icon-circle" data-tp-cpl-bulk="remove" title="${esc(pt('removeSelected'))}">🗑</button>
              <button type="button" class="tp-pl-icon-circle" data-tp-cpl-bulk="play" title="${esc(pt('playQueue'))}">≡▶</button>
              <button type="button" class="tp-pl-icon-circle" data-tp-cpl-bulk="copy" title="${esc(pt('copyMove'))}">≡+</button>
              <button type="button" class="tp-pl-icon-circle" data-tp-cpl-bulk="watched" title="${esc(pt('markWatched'))}">👁</button>
            </div>
          </div>
        </div>

        <div class="tp-cpl-video-list">
          ${
            visibleVideos.length === 0
              ? `<div class="tp-pl-empty-state">${esc(t('common.empty', getLang()))}</div>`
              : visibleVideos
                  .map((v, idx) => {
                    const isWatched = Boolean(watchedMap[v.videoId]);
                    const isSel = customPlView.selectedIds.has(v.videoId);
                    const vNotes = (notesMap[v.videoId] || []).length;
                    const vUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(v.videoId)}`;
                    const vThumb =
                      safeUrl(v.thumbnailUrl, '') ||
                      `https://i.ytimg.com/vi/${encodeURIComponent(v.videoId)}/hqdefault.jpg`;
                    const durBadge = formatVideoBadgeDuration(v.durationSec);

                    return `
                      <div class="tp-cpl-row ${isWatched ? 'is-watched' : ''} ${isSel ? 'is-selected' : ''}" data-cpl-vid="${esc(v.videoId)}">
                        <span class="tp-cpl-idx">${idx + 1}</span>
                        <div class="tp-cpl-row-thumb">
                          <a href="${esc(vUrl)}" target="_blank" rel="noopener">
                            <img src="${esc(vThumb)}" alt="" loading="lazy" />
                          </a>
                          <label class="tp-pl-thumb-check-wrap ${isSel ? 'is-checked' : ''}">
                            <input type="checkbox" class="tp-pl-thumb-check" data-tp-cpl-cb="${esc(v.videoId)}" ${isSel ? 'checked' : ''} />
                          </label>
                          ${durBadge ? `<span class="tp-cpl-dur-badge">${esc(durBadge)}</span>` : ''}
                        </div>
                        <div class="tp-cpl-row-info">
                          <a class="tp-cpl-row-title" href="${esc(vUrl)}" target="_blank" rel="noopener">${esc(v.title || v.videoId)}</a>
                          <div class="tp-cpl-row-sub">
                            ${v.channelTitle ? `<span>${esc(v.channelTitle)}</span>` : ''}
                            ${isWatched ? `<span class="tp-cpl-watched-pill">✓ ${esc(t('watched.badge', getLang()))}</span>` : ''}
                            ${vNotes > 0 ? `<button type="button" class="tp-cpl-notes-pill" data-tp-cpl-open-notes="${esc(v.videoId)}">📝 ${vNotes}</button>` : ''}
                          </div>
                        </div>
                        <div class="tp-cpl-row-actions">
                          <button type="button" class="tp-pl-row-trash-btn" data-tp-cpl-trash="${esc(v.videoId)}" title="${esc(pt('removeSelected'))}">🗑</button>
                          <button type="button" class="tp-cpl-menu-btn" data-tp-cpl-menu="${esc(v.videoId)}" title="Menu">⋮</button>
                        </div>
                      </div>
                    `;
                  })
                  .join('')
          }
        </div>
      </main>
    </div>
  `;

  wireCustomPlaylistViewEvents(backdrop, pl, visibleVideos);
}

function wireCustomPlaylistViewEvents(backdrop, pl, visibleVideos) {
  const watchedMap = getAppState().watched || {};

  // Search
  const searchEl = backdrop.querySelector('[data-tp-cpl-search]');
  searchEl?.addEventListener('input', () => {
    customPlView.search = searchEl.value;
    renderCustomPlaylistViewModal();
    const next = document.querySelector('#tp-custom-pl-modal [data-tp-cpl-search]');
    if (next instanceof HTMLInputElement) {
      next.focus();
      next.setSelectionRange(next.value.length, next.value.length);
    }
  });

  // Filter & Sort
  backdrop.querySelector('[data-tp-cpl-filter]')?.addEventListener('change', (e) => {
    customPlView.watchedFilter = /** @type {HTMLSelectElement} */ (e.target).value;
    renderCustomPlaylistViewModal();
  });

  backdrop.querySelector('[data-tp-cpl-sort]')?.addEventListener('change', (e) => {
    customPlView.sortBy = /** @type {HTMLSelectElement} */ (e.target).value;
    renderCustomPlaylistViewModal();
  });

  // Select All
  backdrop.querySelector('[data-tp-cpl-select-all]')?.addEventListener('change', (e) => {
    const checked = /** @type {HTMLInputElement} */ (e.target).checked;
    if (checked) {
      for (const v of visibleVideos) customPlView.selectedIds.add(v.videoId);
    } else {
      customPlView.selectedIds.clear();
    }
    renderCustomPlaylistViewModal();
  });

  // Row checkboxes
  backdrop.querySelectorAll('[data-tp-cpl-cb]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const vid = cb.getAttribute('data-tp-cpl-cb');
      if (!vid) return;
      if (cb.checked) customPlView.selectedIds.add(vid);
      else customPlView.selectedIds.delete(vid);
      renderCustomPlaylistViewModal();
    });
  });

  // Row 1-click trash
  backdrop.querySelectorAll('[data-tp-cpl-trash]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const vid = btn.getAttribute('data-tp-cpl-trash');
      if (!vid) return;
      const res = await callBg(MESSAGE_ACTIONS.REMOVE_VIDEO_FROM_PLAYLIST, {
        playlistId: pl.id,
        videoId: vid,
      });
      if (res?.ok) {
        customPlView.selectedIds.delete(vid);
        showToast(pt('removedFromPlaylist', { title: pl.title }), 'info');
        renderCustomPlaylistViewModal();
      }
    });
  });

  // Row notes pill
  backdrop.querySelectorAll('[data-tp-cpl-open-notes]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const vid = btn.getAttribute('data-tp-cpl-open-notes');
      const vObj = (pl.videos || []).find((v) => v.videoId === vid);
      if (vid) openVideoNotesModal(vid, vObj?.title || vid);
    });
  });

  // Row ⋮ Context Menu (all 10 items)
  backdrop.querySelectorAll('[data-tp-cpl-menu]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const vid = btn.getAttribute('data-tp-cpl-menu');
      const video = (pl.videos || []).find((v) => v.videoId === vid);
      if (video && btn instanceof HTMLElement) {
        openCustomPlaylistRowContextMenu(btn, pl, video);
      }
    });
  });

  // Bulk buttons
  backdrop.querySelectorAll('[data-tp-cpl-bulk]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const act = btn.getAttribute('data-tp-cpl-bulk');
      const selected = (pl.videos || []).filter((v) => customPlView.selectedIds.has(v.videoId));
      if (selected.length === 0) {
        showToast(pt('noSelection'), 'info');
        return;
      }
      if (act === 'remove') {
        for (const v of selected) {
          await callBg(MESSAGE_ACTIONS.REMOVE_VIDEO_FROM_PLAYLIST, {
            playlistId: pl.id,
            videoId: v.videoId,
          });
          customPlView.selectedIds.delete(v.videoId);
        }
        showToast(pt('removeDone', { done: selected.length }), 'success');
        renderCustomPlaylistViewModal();
      } else if (act === 'play') {
        const ids = selected.map((v) => v.videoId).slice(0, 50);
        window.open(
          `https://www.youtube.com/watch_videos?video_ids=${encodeURIComponent(ids.join(','))}`,
          '_blank',
          'noopener'
        );
      } else if (act === 'copy') {
        openCopyMoveModal(selected, pl.id);
      } else if (act === 'watched') {
        const allW = selected.every((v) => Boolean(watchedMap[v.videoId]));
        const res = await callBg(MESSAGE_ACTIONS.BULK_MARK_WATCHED, {
          records: selected.map((v) => ({
            videoId: v.videoId,
            title: v.title,
            channelId: v.channelId,
            durationSec: v.durationSec,
          })),
          watched: !allW,
        });
        if (res?.ok) {
          showToast(
            `${selected.length} — ${!allW ? pt('watchedMarked') : pt('watchedUnmarked')}`,
            'success'
          );
          renderCustomPlaylistViewModal();
        }
      }
    });
  });

  // Panel Actions
  backdrop.querySelectorAll('[data-tp-cpl-action]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const act = btn.getAttribute('data-tp-cpl-action');
      if (act === 'close') {
        closeCustomPlaylistView();
      } else if (act === 'play-all') {
        const ids = (pl.videos || []).map((v) => v.videoId).slice(0, 50);
        if (ids.length === 0) return;
        window.open(
          `https://www.youtube.com/watch_videos?video_ids=${encodeURIComponent(ids.join(','))}`,
          '_blank',
          'noopener'
        );
      } else if (act === 'toggle-add-video') {
        customPlView.addingVideo = !customPlView.addingVideo;
        renderCustomPlaylistViewModal();
      } else if (act === 'confirm-add-video') {
        const rawUrl = backdrop.querySelector('[data-tp-cpl-add-url]')?.value?.trim() || '';
        const customTitle = backdrop.querySelector('[data-tp-cpl-add-title]')?.value?.trim() || '';
        const videoId = extractVideoIdFromHref(rawUrl);
        if (!videoId) {
          showToast(pt('invalidVideoUrl'), 'error');
          return;
        }
        const res = await callBg(MESSAGE_ACTIONS.ADD_VIDEO_TO_PLAYLIST, {
          playlistId: pl.id,
          video: {
            videoId,
            title: customTitle || `YouTube Video (${videoId})`,
            channelTitle: '',
            channelId: '',
            durationSec: 0,
            thumbnailUrl: `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`,
            addedAt: Date.now(),
          },
        });
        if (res?.ok) {
          showToast(pt('addedToPlaylist', { title: pl.title }), 'success');
          customPlView.addingVideo = false;
          renderCustomPlaylistViewModal();
        }
      } else if (act === 'start-edit') {
        customPlView.editingMeta = true;
        renderCustomPlaylistViewModal();
      } else if (act === 'cancel-edit') {
        customPlView.editingMeta = false;
        renderCustomPlaylistViewModal();
      } else if (act === 'save-edit') {
        const newTitle = backdrop.querySelector('[data-tp-cpl-edit-title]')?.value?.trim() || pl.title;
        const newDesc = backdrop.querySelector('[data-tp-cpl-edit-desc]')?.value?.trim() || '';
        const res = await callBg(MESSAGE_ACTIONS.UPSERT_PLAYLISTS, {
          playlists: [{ ...pl, title: newTitle, description: newDesc }],
        });
        if (res?.ok) {
          customPlView.editingMeta = false;
          showToast(t('toast.saved', getLang()), 'success');
          renderCustomPlaylistViewModal();
        }
      } else if (act === 'edit-thumb') {
        const url = window.prompt('URL da miniatura (https://...):', pl.customThumbnailUrl || getPlaylistThumb(pl));
        if (url && safeUrl(url, '')) {
          const res = await callBg(MESSAGE_ACTIONS.SET_PLAYLIST_THUMBNAIL, {
            playlistId: pl.id,
            thumbnailUrl: url.trim(),
          });
          if (res?.ok) {
            showToast(pt('thumbUpdated'), 'success');
            renderCustomPlaylistViewModal();
          }
        }
      } else if (act === 'share') {
        const ids = (pl.videos || []).map((v) => v.videoId).slice(0, 50);
        const shareLink =
          ids.length > 0
            ? `https://www.youtube.com/watch_videos?video_ids=${encodeURIComponent(ids.join(','))}`
            : pl.url || 'https://www.youtube.com/feed/playlists';
        await copyToClipboard(shareLink);
        showToast(pt('copiedLink'), 'success');
      } else if (act === 'customize') {
        openPlaylistCustomizeModal(pl.id);
      } else if (act === 'reverse') {
        const reversedIds = [...(pl.videos || [])].reverse().map((v) => v.videoId);
        await callBg(MESSAGE_ACTIONS.REORDER_PLAYLIST_VIDEOS, {
          playlistId: pl.id,
          orderedVideoIds: reversedIds,
        });
        customPlView.sortBy = 'original';
        renderCustomPlaylistViewModal();
      } else if (act === 'sort-dur') {
        customPlView.sortBy = customPlView.sortBy === 'duration_asc' ? 'duration_desc' : 'duration_asc';
        renderCustomPlaylistViewModal();
      } else if (act === 'remove-watched') {
        const watchedVids = (pl.videos || []).filter((v) => watchedMap[v.videoId]);
        if (watchedVids.length === 0) {
          showToast(pt('noWatchedToRemove'), 'info');
          return;
        }
        for (const v of watchedVids) {
          await callBg(MESSAGE_ACTIONS.REMOVE_VIDEO_FROM_PLAYLIST, {
            playlistId: pl.id,
            videoId: v.videoId,
          });
          customPlView.selectedIds.delete(v.videoId);
        }
        showToast(pt('removedWatchedCount', { count: watchedVids.length }), 'success');
        renderCustomPlaylistViewModal();
      } else if (act === 'copy-all') {
        const vids = pl.videos || [];
        if (vids.length === 0) return;
        openCopyMoveModal(vids, pl.id);
      } else if (act === 'toggle-hide-watched') {
        customPlView.hideWatched = !customPlView.hideWatched;
        renderCustomPlaylistViewModal();
      } else if (act === 'more-menu' && btn instanceof HTMLElement) {
        openCustomPlaylistMoreMenu(btn, pl);
      }
    });
  });
}

function openCustomPlaylistMoreMenu(anchorBtn, pl) {
  document.getElementById('tp-cpl-ctx-menu')?.remove();

  const menu = document.createElement('div');
  menu.id = 'tp-cpl-ctx-menu';
  menu.className = 'tp-cpl-ctx-menu';

  const rect = anchorBtn.getBoundingClientRect();
  menu.style.top = `${Math.min(window.innerHeight - 160, rect.bottom + 6)}px`;
  menu.style.left = `${Math.min(window.innerWidth - 220, Math.max(8, rect.left))}px`;

  menu.innerHTML = `
    <button type="button" class="tp-cpl-ctx-item" data-more="export-json">📤 ${esc(pt('exportJson'))}</button>
    <button type="button" class="tp-cpl-ctx-item" data-more="export-urls">🔗 ${esc(pt('exportUrls'))}</button>
    <div class="tp-cpl-ctx-sep"></div>
    <button type="button" class="tp-cpl-ctx-item tp-cpl-ctx-danger" data-more="delete">🗑 ${esc(pt('deletePlaylist'))}</button>
  `;

  const closeMenu = () => {
    menu.remove();
    document.removeEventListener('click', closeMenu);
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);

  menu.addEventListener('click', async (e) => {
    e.stopPropagation();
    const item = e.target instanceof Element ? e.target.closest('[data-more]') : null;
    if (!item) return;
    const act = item.getAttribute('data-more');
    closeMenu();

    if (act === 'export-json') {
      downloadTextFile(
        `${(pl.title || 'playlist').replace(/[^a-z0-9_-]+/gi, '_')}.json`,
        JSON.stringify(pl, null, 2),
        'application/json'
      );
      showToast(t('toast.exported', getLang()), 'success');
    } else if (act === 'export-urls') {
      const urls = (pl.videos || []).map((v) => `https://www.youtube.com/watch?v=${v.videoId}`).join('\n');
      downloadTextFile(`${(pl.title || 'playlist').replace(/[^a-z0-9_-]+/gi, '_')}_urls.txt`, urls);
      showToast(t('toast.exported', getLang()), 'success');
    } else if (act === 'delete') {
      if (window.confirm(pt('deletePlaylistConfirm', { title: pl.title }))) {
        const res = await callBg(MESSAGE_ACTIONS.REMOVE_PLAYLIST, { playlistId: pl.id });
        if (res?.ok) {
          showToast(pt('playlistDeleted'), 'info');
          closeCustomPlaylistView();
          refreshPlaylistsUI(getAppState());
        }
      }
    }
  });

  document.body.appendChild(menu);
}

/**
 * Open the 10-item ⋮ Context Menu for a video row inside Custom Playlist View.
 */
function openCustomPlaylistRowContextMenu(anchorBtn, pl, video) {
  document.getElementById('tp-cpl-ctx-menu')?.remove();

  const menu = document.createElement('div');
  menu.id = 'tp-cpl-ctx-menu';
  menu.className = 'tp-cpl-ctx-menu';

  const rect = anchorBtn.getBoundingClientRect();
  const menuHeight = 360;
  const top = rect.bottom + menuHeight > window.innerHeight ? Math.max(8, rect.top - menuHeight) : rect.bottom + 4;
  const left = Math.max(8, Math.min(window.innerWidth - 260, rect.right - 250));
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;

  menu.innerHTML = `
    <button type="button" class="tp-cpl-ctx-item" data-ctx="queue">≡▶ ${esc(pt('ctxAddQueue'))}</button>
    <button type="button" class="tp-cpl-ctx-item" data-ctx="wl">⏰ ${esc(pt('ctxWatchLater'))}</button>
    <button type="button" class="tp-cpl-ctx-item" data-ctx="save-pl">≡+ ${esc(pt('ctxSaveToPl'))}</button>
    <button type="button" class="tp-cpl-ctx-item tp-cpl-ctx-danger" data-ctx="remove">🗑 ${esc(pt('ctxRemoveFrom', { title: pl.title }))}</button>
    <div class="tp-cpl-ctx-sep"></div>
    <button type="button" class="tp-cpl-ctx-item" data-ctx="copy-url">⬇ ${esc(pt('ctxCopyUrl'))}</button>
    <button type="button" class="tp-cpl-ctx-item" data-ctx="share">↪ ${esc(pt('ctxShare'))}</button>
    <div class="tp-cpl-ctx-sep"></div>
    <button type="button" class="tp-cpl-ctx-item" data-ctx="move-top">⤒ ${esc(pt('ctxMoveTop'))}</button>
    <button type="button" class="tp-cpl-ctx-item" data-ctx="move-bottom">⤓ ${esc(pt('ctxMoveBottom'))}</button>
    <button type="button" class="tp-cpl-ctx-item" data-ctx="set-thumb">🖼 ${esc(pt('ctxSetThumb'))}</button>
    <button type="button" class="tp-cpl-ctx-item" data-ctx="notes">📝 ${esc(pt('ctxNotes'))}</button>
  `;

  const closeMenu = () => {
    menu.remove();
    document.removeEventListener('click', closeMenu);
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);

  menu.addEventListener('click', async (e) => {
    e.stopPropagation();
    const item = e.target instanceof Element ? e.target.closest('[data-ctx]') : null;
    if (!item) return;
    const act = item.getAttribute('data-ctx');
    closeMenu();

    const cleanUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(video.videoId)}`;
    const shareUrl = `https://youtu.be/${encodeURIComponent(video.videoId)}`;

    if (act === 'queue') {
      window.open(`https://www.youtube.com/watch_videos?video_ids=${encodeURIComponent(video.videoId)}`, '_blank', 'noopener');
    } else if (act === 'wl') {
      // Save to a dedicated PlayShelf Watch Later playlist or create it
      const state = getAppState();
      const wlId = 'ps_pl_watch_later';
      if (!state.playlists?.[wlId]) {
        await callBg(MESSAGE_ACTIONS.UPSERT_PLAYLISTS, {
          playlists: [
            {
              id: wlId,
              title: getLang() === 'en' ? `Watch Later (${BRAND_NAME})` : `Assistir mais tarde (${BRAND_NAME})`,
              url: `https://www.youtube.com/watch_videos?video_ids=${encodeURIComponent(video.videoId)}`,
              thumbnailUrl: video.thumbnailUrl || '',
              videoCount: 1,
              watchedCount: 0,
              groupIds: [],
              author: BRAND_NAME,
              isCustom: true,
              videos: [{ ...video, addedAt: Date.now() }],
            },
          ],
        });
      } else {
        await callBg(MESSAGE_ACTIONS.ADD_VIDEO_TO_PLAYLIST, {
          playlistId: wlId,
          video: { ...video, addedAt: Date.now() },
        });
      }
      showToast(pt('addedToPlaylist', { title: 'Assistir mais tarde' }), 'success');
    } else if (act === 'save-pl') {
      openQuickSaveToPlaylistModal(video);
    } else if (act === 'remove') {
      const res = await callBg(MESSAGE_ACTIONS.REMOVE_VIDEO_FROM_PLAYLIST, {
        playlistId: pl.id,
        videoId: video.videoId,
      });
      if (res?.ok) {
        customPlView.selectedIds.delete(video.videoId);
        showToast(pt('removedFromPlaylist', { title: pl.title }), 'info');
        renderCustomPlaylistViewModal();
      }
    } else if (act === 'copy-url') {
      await copyToClipboard(cleanUrl);
      showToast(pt('copiedLink'), 'success');
    } else if (act === 'share') {
      await copyToClipboard(shareUrl);
      showToast(pt('copiedLink'), 'success');
    } else if (act === 'move-top') {
      const res = await callBg(MESSAGE_ACTIONS.MOVE_VIDEO_TO_TOP, {
        playlistId: pl.id,
        videoId: video.videoId,
      });
      if (res?.ok) {
        customPlView.sortBy = 'original';
        showToast(pt('movedToTop'), 'success');
        renderCustomPlaylistViewModal();
      }
    } else if (act === 'move-bottom') {
      const res = await callBg(MESSAGE_ACTIONS.MOVE_VIDEO_TO_BOTTOM, {
        playlistId: pl.id,
        videoId: video.videoId,
      });
      if (res?.ok) {
        customPlView.sortBy = 'original';
        showToast(pt('movedToBottom'), 'success');
        renderCustomPlaylistViewModal();
      }
    } else if (act === 'set-thumb') {
      const thumb =
        safeUrl(video.thumbnailUrl, '') ||
        `https://i.ytimg.com/vi/${encodeURIComponent(video.videoId)}/hqdefault.jpg`;
      const res = await callBg(MESSAGE_ACTIONS.SET_PLAYLIST_THUMBNAIL, {
        playlistId: pl.id,
        thumbnailUrl: thumb,
      });
      if (res?.ok) {
        showToast(pt('thumbUpdated'), 'success');
        renderCustomPlaylistViewModal();
      }
    } else if (act === 'notes') {
      openVideoNotesModal(video.videoId, video.title || video.videoId);
    }
  });

  document.body.appendChild(menu);
}

/* ============================================================================
 * PLAYLIST LAYOUT CUSTOMIZATION MODAL (ICON, COLOR, CUSTOM IMAGE)
 * Works for ANY playlist (native YouTube & TubeNook). Layout-only inside TubeNook.
 * ========================================================================== */

/**
 * Open the TubeNook Layout Customization modal for any playlist (native or custom).
 * Saves `{ icon, color, customThumbnailUrl }` via `MESSAGE_ACTIONS.CUSTOMIZE_PLAYLIST`
 * or `MESSAGE_ACTIONS.UPSERT_PLAYLISTS`.
 * @param {string} playlistId
 * @param {{ id?: string, title?: string, url?: string, thumbnailUrl?: string, author?: string, videoCount?: number, isCustom?: boolean } | null} [fallbackMeta=null]
 */
export function openPlaylistCustomizeModal(playlistId, fallbackMeta = null) {
  if (!playlistId) return;
  closeOverlayModal('tp-pl-customize-modal');

  const state = getAppState();
  const existing = state.playlists?.[playlistId] || null;
  const lang = getLang();

  const resolvedTitle =
    existing?.title ||
    fallbackMeta?.title ||
    (activePlaylistId === playlistId ? scrapeCurrentPlaylistMeta(playlistId).title : '') ||
    playlistId;
  const resolvedUrl =
    existing?.url ||
    fallbackMeta?.url ||
    `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
  const resolvedFallbackThumb =
    safeUrl(fallbackMeta?.thumbnailUrl || existing?.thumbnailUrl || '', '');

  let selectedIcon = existing?.icon ? { ...existing.icon } : null;
  let selectedColor = existing?.color || '';
  let selectedCustomThumb = safeUrl(existing?.customThumbnailUrl || '', '');
  let iconQuery = '';
  let iconCategory = 'all';

  const backdrop = document.createElement('div');
  backdrop.id = 'tp-pl-customize-modal';
  backdrop.className = 'tp-pl-modal-backdrop tp-pl-modal-backdrop-top';

  const renderPreviewHtml = () => {
    const color = selectedColor || '#ef233c';
    const iconHtml = selectedIcon
      ? renderIconHtml(selectedIcon, 18)
      : '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M22 7H2v1h20V7zm-9 5H2v-1h11v1zm0 4H2v-1h11v1zm2 3v-8l7 4-7 4z"></path></svg>';
    const thumbPreview = selectedCustomThumb || resolvedFallbackThumb;
    return `
      <div class="tp-pl-cust-preview-row" style="border-left: 3px solid ${esc(color)};">
        ${
          thumbPreview
            ? `<img class="tp-pl-cust-preview-thumb" src="${esc(thumbPreview)}" alt="" />`
            : `<span class="tp-pl-cust-preview-ico" style="color:${esc(color)}">${iconHtml}</span>`
        }
        <span class="tp-pl-cust-preview-ico-inline" style="color:${esc(color)}">${iconHtml}</span>
        <span class="tp-pl-cust-preview-name">${esc(resolvedTitle)}</span>
        <span class="tp-pl-cust-preview-dot" style="background:${esc(color)}"></span>
      </div>
    `;
  };

  backdrop.innerHTML = `
    <div class="tp-pl-modal tp-pl-modal-md" role="dialog" aria-modal="true">
      <div class="tp-pl-modal-header">
        <div>
          <h3>🎨 ${esc(pt('customizeModalTitle'))}</h3>
          <div class="tp-pl-subtitle">${esc(resolvedTitle)}</div>
        </div>
        <button type="button" class="tp-pl-close-btn" data-tp-close>&times;</button>
      </div>
      <div class="tp-pl-modal-body">
        <p class="tp-pl-muted">${esc(pt('customizeLayoutHint'))}</p>

        <div class="tp-pl-form-row">
          <label class="tp-pl-label">${esc(pt('sidebarPreview'))}</label>
          <div data-tp-cust-preview>${renderPreviewHtml()}</div>
        </div>

        <div class="tp-pl-form-row">
          <div class="tp-pl-icon-header">
            <label class="tp-pl-label">${esc(t('group.colorLabel', lang))}</label>
            <input type="color" class="tp-pl-color-native" data-tp-cust-color-input value="${esc(selectedColor || DEFAULT_GROUP_COLORS[0])}" />
          </div>
          <div class="tp-pl-color-swatches" data-tp-cust-colors>
            ${DEFAULT_GROUP_COLORS.map(
              (c) =>
                `<button type="button" class="tp-pl-swatch ${selectedColor.toLowerCase() === c.toLowerCase() ? 'is-selected' : ''}" data-color="${esc(c)}" style="background:${esc(c)}" aria-label="${esc(c)}"></button>`
            ).join('')}
          </div>
        </div>

        <div class="tp-pl-form-row">
          <div class="tp-pl-icon-header">
            <label class="tp-pl-label">${esc(t('group.iconLabel', lang))}</label>
            <span class="tp-pl-icon-preview" data-tp-cust-icon-preview>${selectedIcon ? renderIconHtml(selectedIcon, 22) : '🎵'}</span>
          </div>
          <div class="tp-pl-icon-controls">
            <input type="text" class="tp-pl-input" data-tp-cust-icon-search placeholder="${esc(pt('iconSearchPlaceholder'))}" />
            <select class="tp-pl-select" data-tp-cust-icon-cat>
              ${ICON_CATEGORIES.map(
                (cat) =>
                  `<option value="${esc(cat.id)}">${esc(lang === 'en' ? cat.labelEn : cat.labelPt)}</option>`
              ).join('')}
            </select>
            <label class="tp-pl-btn tp-pl-btn-sm tp-pl-upload-label">
              ${esc(pt('uploadIcon'))}
              <input type="file" accept="image/*" data-tp-cust-icon-upload hidden />
            </label>
          </div>
          <div class="tp-pl-icon-grid" data-tp-cust-icon-grid></div>
        </div>

        <div class="tp-pl-form-row">
          <label class="tp-pl-label">${esc(pt('customThumbLabel'))}</label>
          <div class="tp-pl-cust-thumb-controls">
            <input type="url" class="tp-pl-input" data-tp-cust-thumb-url value="${esc(selectedCustomThumb.startsWith('data:') ? '' : selectedCustomThumb)}" placeholder="${esc(pt('customThumbPlaceholder'))}" />
            <label class="tp-pl-btn tp-pl-btn-sm tp-pl-upload-label">
              🖼 ${esc(pt('uploadCover'))}
              <input type="file" accept="image/*" data-tp-cust-thumb-upload hidden />
            </label>
            <button type="button" class="tp-pl-btn tp-pl-btn-sm tp-pl-btn-ghost" data-tp-cust-thumb-clear>${esc(pt('clearCover'))}</button>
          </div>
        </div>
      </div>
      <div class="tp-pl-modal-footer tp-pl-cust-footer">
        <button type="button" class="tp-pl-btn tp-pl-btn-ghost" data-tp-cust-reset>${esc(pt('resetAppearance'))}</button>
        <div class="tp-pl-cust-footer-right">
          <button type="button" class="tp-pl-btn tp-pl-btn-ghost" data-tp-close>${esc(t('common.cancel', lang))}</button>
          <button type="button" class="tp-pl-btn tp-pl-btn-accent" data-tp-cust-save>${esc(t('common.save', lang))}</button>
        </div>
      </div>
    </div>
  `;

  const updatePreview = () => {
    const wrap = backdrop.querySelector('[data-tp-cust-preview]');
    if (wrap) wrap.innerHTML = renderPreviewHtml();
    const iconPrev = backdrop.querySelector('[data-tp-cust-icon-preview]');
    if (iconPrev) iconPrev.innerHTML = selectedIcon ? renderIconHtml(selectedIcon, 22) : '🎵';
  };

  const renderIconGrid = () => {
    const grid = backdrop.querySelector('[data-tp-cust-icon-grid]');
    if (!grid) return;
    const results = searchIcons(iconQuery, iconCategory);
    grid.innerHTML = results
      .map((entry) => {
        const isSel = selectedIcon && selectedIcon.type === entry.type && selectedIcon.value === entry.value;
        const label = lang === 'en' ? entry.labelEn : entry.labelPt;
        return `<button type="button" class="tp-pl-icon-cell ${isSel ? 'is-selected' : ''}" data-icon-id="${esc(entry.id)}" title="${esc(label)}">
          ${renderIconHtml({ type: entry.type, value: entry.value }, 20)}
        </button>`;
      })
      .join('');

    grid.querySelectorAll('.tp-pl-icon-cell').forEach((cell) => {
      cell.addEventListener('click', () => {
        const id = cell.getAttribute('data-icon-id');
        const found = results.find((r) => r.id === id);
        if (!found) return;
        selectedIcon = { type: found.type, value: found.value };
        updatePreview();
        renderIconGrid();
      });
    });
  };

  renderIconGrid();

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || (e.target instanceof Element && e.target.closest('[data-tp-close]'))) {
      backdrop.remove();
    }
  });

  const colorNativeInput = backdrop.querySelector('[data-tp-cust-color-input]');
  backdrop.querySelectorAll('.tp-pl-swatch').forEach((sw) => {
    sw.addEventListener('click', () => {
      selectedColor = sw.getAttribute('data-color') || '';
      if (colorNativeInput instanceof HTMLInputElement && selectedColor) {
        colorNativeInput.value = selectedColor;
      }
      backdrop.querySelectorAll('.tp-pl-swatch').forEach((b) => b.classList.toggle('is-selected', b === sw));
      updatePreview();
    });
  });

  colorNativeInput?.addEventListener('input', (e) => {
    selectedColor = /** @type {HTMLInputElement} */ (e.target).value || '';
    backdrop.querySelectorAll('.tp-pl-swatch').forEach((b) =>
      b.classList.toggle('is-selected', (b.getAttribute('data-color') || '').toLowerCase() === selectedColor.toLowerCase())
    );
    updatePreview();
  });

  backdrop.querySelector('[data-tp-cust-icon-search]')?.addEventListener('input', (e) => {
    iconQuery = /** @type {HTMLInputElement} */ (e.target).value;
    renderIconGrid();
  });

  backdrop.querySelector('[data-tp-cust-icon-cat]')?.addEventListener('change', (e) => {
    iconCategory = /** @type {HTMLSelectElement} */ (e.target).value;
    renderIconGrid();
  });

  backdrop.querySelector('[data-tp-cust-icon-upload]')?.addEventListener('change', async (e) => {
    const file = /** @type {HTMLInputElement} */ (e.target).files?.[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImageToDataUrl(file, 64);
      selectedIcon = { type: 'custom', value: dataUrl };
      updatePreview();
    } catch (err) {
      showToast(err?.message || 'Image error', 'error');
    }
  });

  const thumbUrlInput = backdrop.querySelector('[data-tp-cust-thumb-url]');
  thumbUrlInput?.addEventListener('input', (e) => {
    const val = /** @type {HTMLInputElement} */ (e.target).value.trim();
    selectedCustomThumb = safeUrl(val, '');
    updatePreview();
  });

  backdrop.querySelector('[data-tp-cust-thumb-upload]')?.addEventListener('change', async (e) => {
    const file = /** @type {HTMLInputElement} */ (e.target).files?.[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImageToDataUrl(file, 320);
      selectedCustomThumb = dataUrl;
      if (thumbUrlInput instanceof HTMLInputElement) thumbUrlInput.value = '';
      updatePreview();
    } catch (err) {
      showToast(err?.message || 'Image error', 'error');
    }
  });

  backdrop.querySelector('[data-tp-cust-thumb-clear]')?.addEventListener('click', () => {
    selectedCustomThumb = '';
    if (thumbUrlInput instanceof HTMLInputElement) thumbUrlInput.value = '';
    updatePreview();
  });

  backdrop.querySelector('[data-tp-cust-reset]')?.addEventListener('click', () => {
    selectedIcon = null;
    selectedColor = '';
    selectedCustomThumb = '';
    if (thumbUrlInput instanceof HTMLInputElement) thumbUrlInput.value = '';
    backdrop.querySelectorAll('.tp-pl-swatch').forEach((b) => b.classList.remove('is-selected'));
    updatePreview();
    renderIconGrid();
  });

  backdrop.querySelector('[data-tp-cust-save]')?.addEventListener('click', async () => {
    let res;
    if (!existing) {
      res = await callBg(MESSAGE_ACTIONS.UPSERT_PLAYLISTS, {
        playlists: [
          {
            id: playlistId,
            title: resolvedTitle,
            url: resolvedUrl,
            thumbnailUrl: resolvedFallbackThumb,
            videoCount: fallbackMeta?.videoCount || 0,
            watchedCount: 0,
            groupIds: [],
            author: fallbackMeta?.author || '',
            isCustom: Boolean(fallbackMeta?.isCustom),
            icon: selectedIcon,
            color: selectedColor,
            customThumbnailUrl: selectedCustomThumb,
          },
        ],
      });
    } else if (MESSAGE_ACTIONS.CUSTOMIZE_PLAYLIST) {
      res = await callBg(MESSAGE_ACTIONS.CUSTOMIZE_PLAYLIST, {
        playlistId,
        icon: selectedIcon,
        color: selectedColor,
        customThumbnailUrl: selectedCustomThumb,
      });
    } else {
      res = await callBg(MESSAGE_ACTIONS.UPSERT_PLAYLISTS, {
        playlists: [
          {
            ...existing,
            icon: selectedIcon,
            color: selectedColor,
            customThumbnailUrl: selectedCustomThumb,
          },
        ],
      });
    }

    if (res?.ok) {
      showToast(pt('customizeSaved'), 'success');
      backdrop.remove();
      refreshPlaylistsUI(getAppState());
    }
  });

  document.body.appendChild(backdrop);
}

/* ============================================================================
 * PLAYLIST GROUP VIEW MODAL / DRAWER
 * ========================================================================== */

export function openPlaylistGroupView(groupId = null) {
  groupViewState.open = true;
  groupViewState.groupId = groupId || null;
  renderPlaylistGroupViewModal();
}

function renderPlaylistGroupViewModal() {
  if (!groupViewState.open) return;

  let backdrop = document.getElementById('tp-pl-groupview-modal');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'tp-pl-groupview-modal';
    backdrop.className = 'tp-pl-modal-backdrop tp-pl-drawer-backdrop';
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        groupViewState.open = false;
        backdrop.remove();
      }
    });
    document.body.appendChild(backdrop);
  }

  const state = getAppState();
  let playlists = Object.values(state.playlists || {});

  const q = normText(groupViewState.search).trim();
  if (q) {
    playlists = playlists.filter((pl) =>
      normText(`${pl.title} ${pl.author || ''}`).includes(q)
    );
  }

  const getPct = (pl) =>
    pl.videoCount > 0 ? Math.min(100, Math.round(((pl.watchedCount || 0) / pl.videoCount) * 100)) : 0;

  playlists.sort((a, b) => {
    switch (groupViewState.sortBy) {
      case 'count_desc':
        return (b.videoCount || 0) - (a.videoCount || 0) || a.title.localeCompare(b.title);
      case 'watched_desc':
        return getPct(b) - getPct(a) || a.title.localeCompare(b.title);
      case 'watched_asc':
        return getPct(a) - getPct(b) || a.title.localeCompare(b.title);
      case 'updated_desc':
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      case 'title_asc':
      default:
        return (a.title || '').localeCompare(b.title || '');
    }
  });

  backdrop.innerHTML = `
    <div class="tp-pl-drawer" role="dialog" aria-modal="true">
      <div class="tp-pl-drawer-header" style="--tp-group-accent:#ef233c">
        <div class="tp-pl-drawer-title-wrap">
          <div class="tp-pl-drawer-title-row">
            <span class="tp-pl-drawer-icon">🎵</span>
            <h2>${esc(pt('groupViewAll'))}</h2>
            <span class="tp-pl-badge">${playlists.length}</span>
          </div>
        </div>
        <div class="tp-pl-drawer-header-actions">
          <button type="button" class="tp-pl-btn tp-pl-btn-accent tp-pl-btn-sm" data-tp-gv-new-pl>
            ${esc(pt('newPlaylistBtn'))}
          </button>
          <button type="button" class="tp-pl-close-btn" data-tp-gv-close>&times;</button>
        </div>
      </div>

      <div class="tp-pl-drawer-controls">
        <input
          type="text"
          class="tp-pl-input tp-pl-gv-search"
          data-tp-gv-search
          placeholder="${esc(t('common.search', getLang()))}"
          value="${esc(groupViewState.search)}"
        />
        <select class="tp-pl-select" data-tp-gv-sort>
          <option value="title_asc" ${groupViewState.sortBy === 'title_asc' ? 'selected' : ''}>${esc(pt('sortPlTitle'))}</option>
          <option value="count_desc" ${groupViewState.sortBy === 'count_desc' ? 'selected' : ''}>${esc(pt('sortPlCount'))}</option>
          <option value="watched_desc" ${groupViewState.sortBy === 'watched_desc' ? 'selected' : ''}>${esc(pt('sortPlWatchedDesc'))}</option>
          <option value="watched_asc" ${groupViewState.sortBy === 'watched_asc' ? 'selected' : ''}>${esc(pt('sortPlWatchedAsc'))}</option>
          <option value="updated_desc" ${groupViewState.sortBy === 'updated_desc' ? 'selected' : ''}>${esc(pt('sortPlUpdated'))}</option>
        </select>
      </div>

      <div class="tp-pl-drawer-list">
        ${
          playlists.length === 0
            ? `<div class="tp-pl-empty-state">${esc(pt('noPlaylistsYet'))}</div>`
            : playlists
                .map((pl) => {
                  const pct = getPct(pl);
                  const plUrl = safeUrl(
                    pl.url,
                    `https://www.youtube.com/playlist?list=${encodeURIComponent(pl.id)}`
                  );
                  const thumb = getPlaylistThumb(pl);
                  const customAttr = pl.isCustom ? `data-tp-gv-open-custom="${esc(pl.id)}"` : '';
                  const accentColor = pl.color || '';

                  return `
                    <div class="tp-pl-gv-card" data-pl-id="${esc(pl.id)}" ${accentColor ? `style="border-left:3px solid ${esc(accentColor)};"` : ''}>
                      <a class="tp-pl-gv-thumb" href="${esc(plUrl)}" ${customAttr}>
                        ${
                          thumb
                            ? `<img src="${esc(thumb)}" alt="" loading="lazy" />`
                            : `<div class="tp-pl-gv-thumb-fallback">${pl.icon ? renderIconHtml(pl.icon, 28) : '🎵'}</div>`
                        }
                        <span class="tp-pl-gv-count">${esc(pt('videosCount', { count: pl.videoCount || 0 }))}</span>
                      </a>
                      <div class="tp-pl-gv-info">
                        <a class="tp-pl-gv-title" href="${esc(plUrl)}" ${customAttr}>${
                          pl.icon ? `<span style="color:${esc(accentColor || '#ef233c')};margin-right:4px;">${renderIconHtml(pl.icon, 14)}</span>` : ''
                        }${esc(pl.title)}</a>
                        ${pl.author ? `<div class="tp-pl-gv-author">${esc(pl.author)}</div>` : ''}
                        <div class="tp-pl-gv-progress-row">
                          <div class="tp-pl-progress-bar-track">
                            <div class="tp-pl-progress-bar-fill" style="width:${pct}%${accentColor ? `;background:${esc(accentColor)}` : ''}"></div>
                          </div>
                          <span class="tp-pl-gv-pct">${pl.watchedCount || 0}/${pl.videoCount || 0} (${pct}%)</span>
                        </div>
                        <div class="tp-pl-gv-actions">
                          <a class="tp-pl-btn tp-pl-btn-sm tp-pl-btn-accent" href="${esc(plUrl)}" ${customAttr}>${esc(pt('openPlaylist'))}</a>
                          <button type="button" class="tp-pl-btn tp-pl-btn-sm" data-tp-gv-customize="${esc(pl.id)}">🎨 ${esc(pt('customizePlaylist'))}</button>
                        </div>
                      </div>
                    </div>
                  `;
                })
                .join('')
        }
      </div>
    </div>
  `;

  backdrop.querySelector('[data-tp-gv-close]')?.addEventListener('click', () => {
    groupViewState.open = false;
    backdrop.remove();
  });

  backdrop.querySelector('[data-tp-gv-new-pl]')?.addEventListener('click', () => {
    openQuickCreateCustomPlaylistModal();
  });

  // Clicking custom playlists opens openCustomPlaylistView(pl.id)
  backdrop.querySelectorAll('[data-tp-gv-open-custom]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const pid = el.getAttribute('data-tp-gv-open-custom');
      if (pid) openCustomPlaylistView(pid);
    });
  });

  const searchEl = backdrop.querySelector('[data-tp-gv-search]');
  searchEl?.addEventListener('input', () => {
    groupViewState.search = searchEl.value;
    renderPlaylistGroupViewModal();
    const nextSearch = document.querySelector('#tp-pl-groupview-modal [data-tp-gv-search]');
    if (nextSearch instanceof HTMLInputElement) {
      nextSearch.focus();
      nextSearch.setSelectionRange(nextSearch.value.length, nextSearch.value.length);
    }
  });

  backdrop.querySelector('[data-tp-gv-sort]')?.addEventListener('change', (e) => {
    groupViewState.sortBy = /** @type {HTMLSelectElement} */ (e.target).value;
    renderPlaylistGroupViewModal();
  });

  backdrop.querySelectorAll('[data-tp-gv-customize]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pid = btn.getAttribute('data-tp-gv-customize');
      if (pid) openPlaylistCustomizeModal(pid);
    });
  });
}

function closeOverlayModal(id) {
  const existing = document.getElementById(id);
  if (existing) existing.remove();
}

/* ============================================================================
 * MUTATION OBSERVER & LIFECYCLE
 * ========================================================================== */

function clearNavRetryTimers() {
  for (const id of navRetryTimers) clearTimeout(id);
  navRetryTimers = [];
}

function scheduleNavRetries(delays = [250, 700, 1500, 2600]) {
  clearNavRetryTimers();
  for (const ms of delays) {
    navRetryTimers.push(
      setTimeout(() => {
        scheduleDomScan();
        scheduleVideoCardScan();
      }, ms)
    );
  }
}

function scheduleDomScan() {
  if (scanDebounceTimer) clearTimeout(scanDebounceTimer);
  scanDebounceTimer = setTimeout(() => {
    scheduleIdleTask(() => {
      if (currentPageCtx.type === 'playlist' && activePlaylistId) {
        ensurePlaylistToolbar();
        enhancePlaylistHeader();
        applyPlaylistFiltersAndSort();
      } else if (currentPageCtx.type === 'playlists') {
        enhancePlaylistCards();
      } else if (currentPageCtx.type === 'watch') {
        ensureWatchActionButtons();
      }
      enhanceVideoCardsQuickAdd();
    });
  }, 350);
}

/**
 * Attach targeted MutationObservers ONLY to `ytd-popup-container` (150ms debounce)
 * and `ytd-page-manager` (350ms debounce + requestIdleCallback).
 * Never observes `document.body`!
 */
function attachTargetedObservers() {
  if (observerRetryTimer) {
    clearTimeout(observerRetryTimer);
    observerRetryTimer = null;
  }

  // 1. Targeted observer on ytd-popup-container for Save-to-Playlist dialog (debounced 150ms)
  if (!popupObserver) {
    const popupRoot = document.querySelector('ytd-popup-container');
    if (popupRoot) {
      popupObserver = new MutationObserver(() => {
        scheduleSaveModalScan();
      });
      popupObserver.observe(popupRoot, { childList: true, subtree: true });
    }
  }

  // 2. Targeted observer on ytd-page-manager for playlist rows / watch quickbar / card `+` buttons (debounced 350ms + idle)
  if (!pageManagerObserver) {
    const pageRoot = document.querySelector('ytd-page-manager') || document.getElementById('page-manager');
    if (pageRoot) {
      pageManagerObserver = new MutationObserver(() => {
        if (
          currentPageCtx.type === 'playlist' ||
          currentPageCtx.type === 'playlists' ||
          currentPageCtx.type === 'watch'
        ) {
          scheduleDomScan();
        } else {
          scheduleVideoCardScan();
        }
      });
      pageManagerObserver.observe(pageRoot, { childList: true, subtree: true });
    }
  }

  // Bounded retry if YouTube hasn't mounted ytd-popup-container / ytd-page-manager yet
  if ((!popupObserver || !pageManagerObserver) && observerRetryCount < 8) {
    observerRetryCount++;
    observerRetryTimer = setTimeout(attachTargetedObservers, 500);
  }
}

export function initPlaylists({ getState, onStateChange }) {
  hooks = { getState, onStateChange };

  // Track hovered video card for Shift+W keyboard shortcut
  document.addEventListener(
    'mouseover',
    (e) => {
      if (!(e.target instanceof Element)) return;
      const card = e.target.closest(
        'ytd-playlist-video-renderer, ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, yt-lockup-view-model'
      );
      lastHoveredVideoEl = card instanceof HTMLElement ? card : null;
    },
    { passive: true }
  );

  // Single delegated click handler for all `.tp-card-quick-add-btn` buttons (zero per-card listeners)
  document.addEventListener(
    'click',
    (e) => {
      if (!(e.target instanceof Element)) return;
      const quickBtn = e.target.closest('.tp-card-quick-add-btn');
      if (quickBtn instanceof HTMLElement) {
        e.preventDefault();
        e.stopPropagation();
        const card = quickBtn.closest(VIDEO_CARD_SELECTOR);
        const fallbackId = quickBtn.dataset.tpVideoId || '';
        const info =
          (card ? extractVideoInfoFromCard(card) : null) ||
          (fallbackId
            ? {
                videoId: fallbackId,
                title: fallbackId,
                channelTitle: '',
                channelId: '',
                durationSec: 0,
                thumbnailUrl: `https://i.ytimg.com/vi/${encodeURIComponent(fallbackId)}/hqdefault.jpg`,
              }
            : null);
        if (info?.videoId) {
          openAnchoredPlaylistPopover(quickBtn, info);
        }
        return;
      }

      // Capture video context whenever user clicks a 3-dot menu button on any video card
      const menuTrigger = e.target.closest(
        'ytd-menu-renderer, button-view-model, [aria-label*="Action menu"], [aria-label*="Menu de ações"], [aria-label*="More actions"], [aria-label*="Mais ações"]'
      );
      if (!menuTrigger) return;
      const card = menuTrigger.closest(
        'ytd-playlist-video-renderer, ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, yt-lockup-view-model'
      );
      if (card) {
        const info = extractVideoInfoFromCard(card);
        if (info?.videoId) {
          lastMenuVideo = { ...info, capturedAt: Date.now() };
        }
      }
    },
    true
  );

  // Close open popovers/modals on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (activeAnchoredPopover || document.getElementById('tp-anchored-popover')) {
      closeAnchoredPopover();
      return;
    }
    const ctxMenu = document.getElementById('tp-cpl-ctx-menu');
    if (ctxMenu) {
      ctxMenu.remove();
      return;
    }
    const modals = [
      'tp-pl-notes-modal',
      'tp-pl-quicksave-modal',
      'tp-pl-quickcreate-modal',
      'tp-pl-customize-modal',
      'tp-pl-copymove-modal',
      'tp-pl-remove-modal',
      'tp-custom-pl-modal',
      'tp-pl-groupview-modal',
    ];
    for (const id of modals) {
      const el = document.getElementById(id);
      if (el) {
        if (id === 'tp-pl-groupview-modal') groupViewState.open = false;
        if (id === 'tp-custom-pl-modal') customPlView.open = false;
        el.remove();
        break;
      }
    }
  });

  attachTargetedObservers();
}

export function onPlaylistsNavigate(pageContext, state) {
  currentPageCtx = pageContext || getPageContext();
  closeAnchoredPopover();
  clearNavRetryTimers();
  attachTargetedObservers();

  if (currentPageCtx.type === 'playlists') {
    // Allow one fresh native playlist sync pass per /feed/playlists visit
    syncedNativeFeedIds.clear();
  }

  if (currentPageCtx.type === 'playlist' && currentPageCtx.playlistId) {
    const isNewPlaylist = activePlaylistId !== currentPageCtx.playlistId;
    activePlaylistId = currentPageCtx.playlistId;

    if (isNewPlaylist) {
      origIndexCounter = 0;
      lastSyncedProgressKey = '';
      plView.selectedIds.clear();
      plView.multiSelect = false;
      plView.search = '';
      plView.watchedFilter = 'all';
      plView.durationFilter = 'all';
      plView.customMinMin = '';
      plView.customMaxMin = '';
      plView.hideShorts = Boolean(state?.settings?.hideShortsGlobally);
      plView.sortBy = 'original';

      document.getElementById('tp-pl-toolbar')?.remove();
      document.querySelectorAll('.tp-pl-header-group-btn, .tp-pl-sidebar-stats').forEach((el) => el.remove());
    }

    document.getElementById('tp-watch-quickbar')?.remove();
    document.querySelectorAll('.tp-watch-actions-wrap').forEach((el) => el.remove());

    scheduleDomScan();
    scheduleNavRetries([350, 900, 1800]);
  } else {
    activePlaylistId = null;
    document.getElementById('tp-pl-toolbar')?.remove();
    document.querySelectorAll('.tp-pl-header-group-btn, .tp-pl-sidebar-stats').forEach((el) => el.remove());

    if (currentPageCtx.type === 'playlists' || currentPageCtx.type === 'watch') {
      scheduleDomScan();
      scheduleNavRetries([350, 900, 1800]);
    } else {
      document.getElementById('tp-watch-quickbar')?.remove();
      document.querySelectorAll('.tp-watch-actions-wrap').forEach((el) => el.remove());
      scheduleVideoCardScan();
      scheduleNavRetries([450, 1300]);
    }
  }
}

export function refreshPlaylistsUI(state) {
  const effectiveState = state || getAppState();
  if (currentPageCtx.type === 'playlist' && activePlaylistId) {
    ensurePlaylistToolbar();
    enhancePlaylistHeader();
    applyPlaylistFiltersAndSort();
  } else if (currentPageCtx.type === 'playlists') {
    enhancePlaylistCards();
  } else if (currentPageCtx.type === 'watch') {
    ensureWatchActionButtons();
  }
  // Cheaply sync existing quick-add button badges without full DOM card re-scan
  updateQuickAddButtonsState(effectiveState);

  // Skip re-rendering closed modals/popovers
  if (groupViewState.open) {
    renderPlaylistGroupViewModal();
  }
  if (customPlView.open) {
    renderCustomPlaylistViewModal();
  }
  if (document.querySelector('.tp-save-modal-block')) {
    scheduleSaveModalScan();
  }
}

/* ============================================================================
 * KEYBOARD SHORTCUTS
 * ========================================================================== */

function isEditableTarget(target) {
  if (!(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return Boolean(target.closest('[contenteditable="true"]'));
}

export function handlePlaylistShortcut(event, state) {
  const effectiveState = state || getAppState();
  if (effectiveState?.settings?.keyboardShortcuts === false) return false;
  if (!event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
  if (isEditableTarget(event.target)) return false;

  const key = (event.key || '').toLowerCase();

  if (key === 'w') {
    const ctx = getPageContext();
    let videoId = null;
    let title = '';
    let durationSec = 0;

    if (ctx.type === 'watch' && ctx.videoId && !lastHoveredVideoEl) {
      videoId = ctx.videoId;
      title =
        document.querySelector('ytd-watch-metadata h1')?.textContent?.trim() ||
        document.title.replace(/\s*-\s*YouTube\s*$/i, '').trim();
    } else if (lastHoveredVideoEl && document.contains(lastHoveredVideoEl)) {
      const info = extractVideoInfoFromCard(lastHoveredVideoEl);
      videoId = info?.videoId || null;
      title = info?.title || '';
      durationSec = info?.durationSec || 0;
    } else if (ctx.type === 'watch' && ctx.videoId) {
      videoId = ctx.videoId;
      title =
        document.querySelector('ytd-watch-metadata h1')?.textContent?.trim() ||
        document.title.replace(/\s*-\s*YouTube\s*$/i, '').trim();
    }

    if (videoId) {
      event.preventDefault();
      callBg(MESSAGE_ACTIONS.TOGGLE_WATCHED, {
        videoId,
        meta: { title, durationSec },
      }).then((res) => {
        if (res?.ok) {
          showToast(res.watched ? pt('watchedMarked') : pt('watchedUnmarked'), 'success');
          if (currentPageCtx.type === 'playlist') applyPlaylistFiltersAndSort();
          if (currentPageCtx.type === 'watch') ensureWatchActionButtons();
          if (customPlView.open) renderCustomPlaylistViewModal();
        }
      });
      return true;
    }
    return false;
  }

  if (key === 'f') {
    const searchInput =
      document.querySelector('#tp-custom-pl-modal [data-tp-cpl-search]') ||
      document.querySelector('.tp-pl-search-input') ||
      document.querySelector('#tp-pl-groupview-modal [data-tp-gv-search]') ||
      document.querySelector('input[data-tp-search]') ||
      document.querySelector('.tp-search-input');

    if (searchInput instanceof HTMLInputElement) {
      event.preventDefault();
      searchInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      searchInput.focus();
      searchInput.select();
      return true;
    }
    return false;
  }

  if (key === 's') {
    const ctx = getPageContext();
    if (ctx.type === 'playlist') {
      event.preventDefault();
      toggleMultiSelectMode();
      showToast(plView.multiSelect ? pt('multiSelectOn') : pt('multiSelectOff'), 'info');
      return true;
    }
    return false;
  }

  return false;
}
