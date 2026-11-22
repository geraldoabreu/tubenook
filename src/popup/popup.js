/**
 * @fileoverview TubeNook Extension Popup logic.
 */

import { BRAND_NAME, BUY_ME_A_COFFEE_URL, SUPPORTED_LANGUAGES } from '../shared/brand.js';
import { MESSAGE_ACTIONS, GROUP_KINDS } from '../shared/types.js';
import { renderIconHtml } from '../shared/icons.js';
import { t } from '../shared/i18n.js';

/** @type {import('../shared/types.js').AppState | null} */
let state = null;

function sendBg(action, payload = {}) {
  return chrome.runtime.sendMessage({ action, ...payload });
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function applyTheme(theme) {
  if (theme === 'dark' || theme === 'light') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

function getLang() {
  const lang = state?.settings?.language;
  return SUPPORTED_LANGUAGES.includes(lang) ? lang : 'pt-BR';
}

function getLocaleForLang(lang) {
  switch (lang) {
    case 'pt-PT':
      return 'pt-PT';
    case 'es':
      return 'es-ES';
    case 'en':
      return 'en-US';
    case 'pt-BR':
    default:
      return 'pt-BR';
  }
}

function formatSyncTime(ts, lang) {
  if (!ts || !Number.isFinite(ts)) return t('popup.syncNever', lang);
  try {
    return new Date(ts).toLocaleString(getLocaleForLang(lang), {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return new Date(ts).toISOString().slice(0, 16).replace('T', ' ');
  }
}

function renderSyncPill() {
  const pill = document.getElementById('sync-status-pill');
  const textEl = document.getElementById('sync-status-text');
  if (!pill || !textEl) return;

  const sync = state?.settings?.sync;
  const provider = sync?.provider || 'none';
  if (provider !== 'chrome' && provider !== 'gdrive') {
    pill.classList.add('is-hidden');
    return;
  }

  const lang = getLang();
  const providerLabel = provider === 'gdrive' ? 'Google Drive' : 'Chrome Sync';
  const lastStr = sync.lastSyncedAt
    ? formatSyncTime(sync.lastSyncedAt, lang)
    : t('popup.syncConfigured', lang);

  textEl.textContent = `${providerLabel} • ${lastStr}`;
  pill.classList.remove('is-hidden');
}

function renderTexts() {
  const lang = getLang();
  document.documentElement.lang = lang;
  document.title = BRAND_NAME;

  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  setText('ui-brand-name', BRAND_NAME);
  setText('ui-tagline', t('app.tagline', lang));
  setText('lbl-groups', t('popup.statsGroups', lang));
  setText('lbl-channels', t('popup.statsChannels', lang));
  setText('lbl-courses', t('courses.courses', lang));
  setText('lbl-watched', t('popup.statsWatched', lang));

  const searchInput = document.getElementById('quick-search');
  if (searchInput) searchInput.placeholder = t('popup.quickSearch', lang);

  setText('lbl-quick-toggles', t('popup.quickToggles', lang));
  setText('lbl-focus-mode', t('focus.focusMode', lang));
  setText('lbl-hide-watched', t('options.hideWatchedGlobally', lang));
  setText('lbl-hide-shorts', t('options.hideShortsGlobally', lang));
  setText('lbl-auto-tag', t('options.autoTaggingEnabled', lang));
  setText('lbl-shortcuts', t('popup.shortcutsShort', lang));

  setText('lbl-open-manager', t('popup.openManager', lang));
  setText('lbl-open-courses', t('courses.courses', lang));
  setText('lbl-open-insights', t('insights.insights', lang));
  setText('lbl-open-deck', t('popup.openDeck', lang));
  setText('lbl-open-options', t('popup.openOptionsShort', lang));

  const supportLink = document.getElementById('link-support-project');
  if (supportLink) {
    supportLink.href = BUY_ME_A_COFFEE_URL;
    supportLink.textContent = `☕ ${t('support.footerLink', lang)}`;
  }

  const langSelect = document.getElementById('popup-language');
  if (langSelect) {
    langSelect.value = lang;
  }

  renderSyncPill();
}

function renderStatsAndToggles() {
  if (!state) return;
  applyTheme(state.settings?.theme || 'auto');

  const groupsCount = Object.keys(state.groups || {}).length;
  const channelsCount = Object.keys(state.channels || {}).length;
  const coursesCount = Object.keys(state.courses || {}).length;
  const watchedCount = Object.keys(state.watched || {}).length;

  document.getElementById('stat-groups').textContent = String(groupsCount);
  document.getElementById('stat-channels').textContent = String(channelsCount);
  document.getElementById('stat-courses').textContent = String(coursesCount);
  document.getElementById('stat-watched').textContent = String(watchedCount);

  document.getElementById('toggle-focus-mode').checked = Boolean(state.settings?.focusMode);
  document.getElementById('toggle-hide-watched').checked = Boolean(state.settings?.hideWatchedGlobally);
  document.getElementById('toggle-hide-shorts').checked = Boolean(state.settings?.hideShortsGlobally);
  document.getElementById('toggle-auto-tag').checked = state.settings?.autoTaggingEnabled !== false;
  document.getElementById('toggle-shortcuts').checked = state.settings?.keyboardShortcuts !== false;

  renderSyncPill();
}

async function openOrMessageYouTube(action, payload = {}, fallbackHash = '') {
  const tabs = await chrome.tabs.query({ url: '*://*.youtube.com/*' });
  if (tabs.length > 0 && tabs[0].id !== undefined) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    if (tabs[0].windowId !== undefined) {
      await chrome.windows.update(tabs[0].windowId, { focused: true }).catch(() => {});
    }
    chrome.tabs.sendMessage(tabs[0].id, { action, ...payload }).catch(() => {});
  } else {
    const url = `https://www.youtube.com/${fallbackHash}`;
    await chrome.tabs.create({ url });
  }
  window.close();
}

function renderSearchResults(query) {
  const container = document.getElementById('search-results');
  if (!container || !state) return;
  const q = String(query || '').trim().toLowerCase();
  if (!q) {
    container.classList.add('is-hidden');
    container.innerHTML = '';
    return;
  }

  const lang = getLang();
  const matches = [];

  for (const g of Object.values(state.groups || {})) {
    if ((g.name || '').toLowerCase().includes(q)) {
      matches.push({
        type: g.kind === GROUP_KINDS.PLAYLIST ? 'pl-group' : 'sub-group',
        id: g.id,
        name: g.name,
        iconHtml: renderIconHtml(g.icon, 15),
        kindLabel:
          g.kind === GROUP_KINDS.PLAYLIST
            ? t('popup.playlistLabel', lang)
            : t('popup.groupLabel', lang),
      });
    }
  }

  for (const ch of Object.values(state.channels || {})) {
    const hay = `${ch.title || ''} ${ch.handle || ''} ${(ch.tags || []).join(' ')} ${(ch.autoTags || []).join(' ')}`.toLowerCase();
    if (hay.includes(q)) {
      matches.push({
        type: 'channel',
        id: ch.id,
        name: ch.title || ch.id,
        url: ch.url || `https://www.youtube.com/channel/${encodeURIComponent(ch.id)}`,
        iconHtml: '<span class="tp-icon">📺</span>',
        kindLabel: t('popup.channelLabel', lang),
      });
    }
  }

  container.classList.remove('is-hidden');

  if (matches.length === 0) {
    container.innerHTML = `<div class="search-empty">${escapeHtml(t('common.empty', lang))}</div>`;
    return;
  }

  const top = matches.slice(0, 12);
  container.innerHTML = top
    .map(
      (item, idx) => `
      <button type="button" class="search-item" data-match-idx="${idx}">
        <span class="search-item-main">
          ${item.iconHtml}
          <span class="search-item-name">${escapeHtml(item.name)}</span>
        </span>
        <span class="search-item-kind">${escapeHtml(item.kindLabel)}</span>
      </button>
    `
    )
    .join('');

  container.querySelectorAll('[data-match-idx]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const item = top[Number(btn.dataset.matchIdx)];
      if (!item) return;
      if (item.type === 'sub-group') {
        await openOrMessageYouTube(
          MESSAGE_ACTIONS.OPEN_GROUP_IN_YOUTUBE,
          { groupId: item.id },
          `#tubenook-group-${encodeURIComponent(item.id)}`
        );
      } else if (item.type === 'pl-group') {
        await openOrMessageYouTube('OPEN_PLAYLIST_GROUP', { groupId: item.id }, '#tubenook-manager');
      } else if (item.type === 'channel' && item.url) {
        await chrome.tabs.create({ url: item.url });
        window.close();
      }
    });
  });
}

async function updateSetting(patch) {
  const res = await sendBg(MESSAGE_ACTIONS.UPDATE_SETTINGS, { settings: patch });
  if (res?.ok && res.state) {
    state = res.state;
    renderTexts();
    renderStatsAndToggles();
    const q = document.getElementById('quick-search')?.value;
    if (q) renderSearchResults(q);
  }
}

async function init() {
  const res = await sendBg(MESSAGE_ACTIONS.GET_STATE);
  if (res?.ok && res.state) {
    state = res.state;
  }

  renderTexts();
  renderStatsAndToggles();

  document.getElementById('popup-language')?.addEventListener('change', (e) => {
    updateSetting({ language: e.target.value });
  });

  document.getElementById('quick-search')?.addEventListener('input', (e) => {
    renderSearchResults(e.target.value);
  });

  document.getElementById('toggle-focus-mode')?.addEventListener('change', (e) => {
    updateSetting({ focusMode: e.target.checked });
  });
  document.getElementById('toggle-hide-watched')?.addEventListener('change', (e) => {
    updateSetting({ hideWatchedGlobally: e.target.checked });
  });
  document.getElementById('toggle-hide-shorts')?.addEventListener('change', (e) => {
    updateSetting({ hideShortsGlobally: e.target.checked });
  });
  document.getElementById('toggle-auto-tag')?.addEventListener('change', (e) => {
    updateSetting({ autoTaggingEnabled: e.target.checked });
  });
  document.getElementById('toggle-shortcuts')?.addEventListener('change', (e) => {
    updateSetting({ keyboardShortcuts: e.target.checked });
  });

  document.getElementById('btn-open-manager')?.addEventListener('click', () => {
    openOrMessageYouTube('OPEN_MANAGER', { tab: 'groups' }, '#tubenook-manager');
  });

  document.getElementById('btn-open-courses')?.addEventListener('click', () => {
    openOrMessageYouTube('OPEN_COURSES', {}, '#tubenook-courses');
  });

  document.getElementById('btn-open-insights')?.addEventListener('click', () => {
    openOrMessageYouTube('OPEN_INSIGHTS', {}, '#tubenook-insights');
  });

  document.getElementById('btn-open-deck')?.addEventListener('click', () => {
    openOrMessageYouTube(MESSAGE_ACTIONS.OPEN_DECK, {}, '#tubenook-deck');
  });

  document.getElementById('btn-open-options')?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });
}

init().catch((err) => console.error(`[${BRAND_NAME} Popup]`, err));
