/**
 * @fileoverview TubeNook Options, Sync, Smart Rules, Channel Status Config & Backup page logic.
 */

import { BRAND_NAME, BUY_ME_A_COFFEE_URL, SUPPORTED_LANGUAGES } from '../shared/brand.js';
import {
  MESSAGE_ACTIONS,
  GROUP_KINDS,
  DEFAULT_SYNC_CONFIG,
  createId,
} from '../shared/types.js';
import { t } from '../shared/i18n.js';

/** @type {import('../shared/types.js').AppState | null} */
let state = null;
let pendingImportMerge = true;

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

function applyTheme(theme) {
  if (theme === 'dark' || theme === 'light') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

let bannerTimer = null;
function showBanner(message, type = 'success') {
  const el = document.getElementById('status-banner');
  if (!el) return;
  el.textContent = message;
  el.className = `opt-banner is-${type}`;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => {
    el.classList.add('is-hidden');
  }, 4500);
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function renderStatusPreview() {
  const preview = document.getElementById('status-preview');
  if (!preview) return;
  const lang = getLang();
  const activeDays = Math.max(1, Number(document.getElementById('opt-active-days').value) || 14);
  const slowDays = Math.max(activeDays + 1, Number(document.getElementById('opt-slow-days').value) || 60);
  const inactiveDays = Math.max(slowDays + 1, Number(document.getElementById('opt-inactive-days').value) || 180);

  const daysLabel = escapeHtml(t('options.days', lang));

  preview.innerHTML = `
    <div class="status-band">
      <span class="status-dot active"></span>
      <span><strong>${escapeHtml(t('channel.status.active', lang))}:</strong> 0 – ${activeDays} ${daysLabel}</span>
    </div>
    <div class="status-band">
      <span class="status-dot slow"></span>
      <span><strong>${escapeHtml(t('channel.status.slow', lang))}:</strong> ${activeDays + 1} – ${slowDays} ${daysLabel}</span>
    </div>
    <div class="status-band">
      <span class="status-dot inactive"></span>
      <span><strong>${escapeHtml(t('channel.status.inactive', lang))}:</strong> ${slowDays + 1} – ${inactiveDays} ${daysLabel}</span>
    </div>
    <div class="status-band">
      <span class="status-dot dead"></span>
      <span><strong>${escapeHtml(t('channel.status.dead', lang))}:</strong> &gt; ${inactiveDays} ${daysLabel}</span>
    </div>
  `;
}

const SHORTCUT_DESCRIPTIONS = {
  'pt-BR': [
    'Abrir / fechar Modo Deck no YouTube',
    'Abrir Gerenciador de Grupos e Canais',
    'Marcar / desmarcar vídeo atual ou sob o mouse como assistido',
    'Focar na busca da playlist ou feed',
    'Ativar / desativar seleção múltipla na playlist',
    'Fechar modal ou overlay do Deck',
  ],
  'pt-PT': [
    'Abrir / fechar Modo Deck no YouTube',
    'Abrir Gestor de Grupos e Canais',
    'Marcar / desmarcar vídeo atual ou sob o cursor como visto',
    'Focar na pesquisa da lista de reprodução ou feed',
    'Ativar / desativar seleção múltipla na lista de reprodução',
    'Fechar janela ou painel do Deck',
  ],
  en: [
    'Open / close Deck Mode on YouTube',
    'Open Groups & Channels Manager',
    'Toggle watched on current or hovered video',
    'Focus playlist or feed search input',
    'Toggle multi-select mode on playlist page',
    'Close open modal or Deck overlay',
  ],
  es: [
    'Abrir / cerrar Modo Deck en YouTube',
    'Abrir Gestor de Grupos y Canales',
    'Marcar / desmarcar vídeo actual o bajo el cursor como visto',
    'Enfocar búsqueda de la lista de reproducción o feed',
    'Activar / desactivar selección múltiple en la lista de reproducción',
    'Cerrar modal o superposición del Deck',
  ],
};

function renderShortcutsCheatSheet() {
  const container = document.getElementById('shortcut-list');
  if (!container) return;
  const lang = getLang();
  const descs = SHORTCUT_DESCRIPTIONS[lang] || SHORTCUT_DESCRIPTIONS.en;
  const keys = ['Shift + D', 'Shift + M', 'Shift + W', 'Shift + F', 'Shift + S', 'Esc'];
  const items = keys.map((key, idx) => ({ key, desc: descs[idx] }));

  container.innerHTML = items
    .map(
      (item) => `
      <div class="shortcut-row">
        <span>${escapeHtml(item.desc)}</span>
        <kbd class="shortcut-kbd">${escapeHtml(item.key)}</kbd>
      </div>
    `
    )
    .join('');
}

function formatDateTime(ts, lang) {
  if (!ts || !Number.isFinite(ts)) return t('popup.syncNever', lang);
  try {
    return new Date(ts).toLocaleString(getLocaleForLang(lang), {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  } catch {
    return new Date(ts).toISOString().slice(0, 16).replace('T', ' ');
  }
}

function getRedirectUriSafe() {
  try {
    if (typeof chrome !== 'undefined' && chrome.identity?.getRedirectURL) {
      return chrome.identity.getRedirectURL();
    }
  } catch {
    // ignore outside extension context
  }
  return 'https://<extension-id>.chromiumapp.org/';
}

function renderSyncSection() {
  if (!state) return;
  const lang = getLang();
  const sync = { ...DEFAULT_SYNC_CONFIG, ...(state.settings?.sync || {}) };
  const provider = sync.provider || 'none';

  const providerEl = document.getElementById('opt-sync-provider');
  if (providerEl) providerEl.value = provider;

  const autoEl = document.getElementById('opt-sync-auto');
  if (autoEl) autoEl.checked = Boolean(sync.autoSync);

  const clientIdEl = document.getElementById('opt-gdrive-client-id');
  if (clientIdEl && document.activeElement !== clientIdEl) {
    clientIdEl.value = sync.gdriveClientId || '';
  }

  const chromePanel = document.getElementById('panel-sync-chrome');
  const gdrivePanel = document.getElementById('panel-sync-gdrive');
  chromePanel?.classList.toggle('is-hidden', provider !== 'chrome');
  gdrivePanel?.classList.toggle('is-hidden', provider !== 'gdrive');

  const redirectNote = document.getElementById('gdrive-redirect-note');
  if (redirectNote) {
    const uri = getRedirectUriSafe();
    redirectNote.innerHTML = `${escapeHtml(t('sync.redirectHint', lang))} <code>${escapeHtml(uri)}</code>`;
  }

  const statusEl = document.getElementById('sync-last-status');
  if (statusEl) {
    const dateStr = formatDateTime(sync.lastSyncedAt, lang);
    const suffix =
      sync.lastSyncStatus && sync.lastSyncStatus !== 'ok'
        ? ` (${sync.lastSyncStatus})`
        : '';
    statusEl.textContent = `${t('sync.lastSynced', lang, { date: dateStr })}${suffix}`;
  }
}

function renderSmartRulesSection() {
  if (!state) return;
  const lang = getLang();
  const rules = Array.isArray(state.smartRules) ? state.smartRules : [];
  const groups = Object.values(state.groups || {}).filter(
    (g) => g.kind === GROUP_KINDS.SUBSCRIPTION
  );

  // Populate target group select
  const groupSelect = document.getElementById('rule-target-group');
  if (groupSelect) {
    const prevVal = groupSelect.value;
    groupSelect.innerHTML =
      groups.length === 0
        ? `<option value="">${escapeHtml(t('rules.noSubGroups', lang))}</option>`
        : groups
            .map(
              (g) =>
                `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`
            )
            .join('');
    if (prevVal && groups.some((g) => g.id === prevVal)) {
      groupSelect.value = prevVal;
    }
  }

  // Show/hide target group field depending on action
  const actionSelect = document.getElementById('rule-action-type');
  const groupWrap = document.getElementById('rule-target-group-wrap');
  if (actionSelect && groupWrap) {
    groupWrap.classList.toggle('is-hidden', actionSelect.value === 'hide_video');
  }

  // Render existing rules list
  const listEl = document.getElementById('smart-rules-list');
  if (!listEl) return;

  if (rules.length === 0) {
    listEl.innerHTML = `<div class="rules-empty">${escapeHtml(t('rules.empty', lang))}</div>`;
    return;
  }

  listEl.innerHTML = rules
    .map((rule) => {
      const matchLabel =
        rule.matchType === 'keyword'
          ? t('rules.keyword', lang)
          : 'Tag';
      const targetGroupName = rule.targetGroupId
        ? state.groups?.[rule.targetGroupId]?.name || rule.targetGroupId
        : '';
      const actionLabel =
        rule.actionType === 'hide_video'
          ? t('rules.hideVideo', lang)
          : `${t('rules.assignTo', lang)}: ${targetGroupName || '—'}`;

      return `
        <div class="rule-row ${rule.enabled ? '' : 'is-disabled'}" data-rule-id="${escapeHtml(rule.id)}">
          <div class="rule-row-main">
            <input type="checkbox" class="opt-switch" data-rule-toggle="${escapeHtml(rule.id)}" ${rule.enabled ? 'checked' : ''} aria-label="${escapeHtml(rule.name)}" />
            <div class="rule-row-info">
              <div class="rule-row-name">${escapeHtml(rule.name)}</div>
              <div class="rule-row-meta">
                <span class="rule-chip">${escapeHtml(matchLabel)}: ${escapeHtml(rule.pattern)}</span>
                <span>→</span>
                <span class="rule-chip">${escapeHtml(actionLabel)}</span>
              </div>
            </div>
          </div>
          <button type="button" class="opt-btn opt-btn-danger-outline opt-btn-sm" data-rule-delete="${escapeHtml(rule.id)}">
            ${escapeHtml(t('common.delete', lang))}
          </button>
        </div>
      `;
    })
    .join('');

  listEl.querySelectorAll('[data-rule-toggle]').forEach((cb) => {
    cb.addEventListener('change', async () => {
      const ruleId = cb.dataset.ruleToggle;
      const nextRules = (state.smartRules || []).map((r) =>
        r.id === ruleId ? { ...r, enabled: cb.checked } : r
      );
      await saveRules(nextRules);
    });
  });

  listEl.querySelectorAll('[data-rule-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ruleId = btn.dataset.ruleDelete;
      const nextRules = (state.smartRules || []).filter((r) => r.id !== ruleId);
      await saveRules(nextRules);
    });
  });
}

async function saveRules(rules) {
  const res = await sendBg(MESSAGE_ACTIONS.SAVE_SMART_RULES, { rules });
  if (res?.ok && res.state) {
    state = res.state;
    renderSmartRulesSection();
    showBanner(t('toast.saved', getLang()), 'success');
  } else {
    showBanner(t('toast.error', getLang(), { message: res?.error || 'Failed to save rules' }), 'error');
  }
}

function renderUI() {
  if (!state) return;
  const lang = getLang();
  document.documentElement.lang = lang;
  document.title = t('options.pageTitle', lang);
  applyTheme(state.settings?.theme || 'auto');

  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  setText('ui-page-title', t('options.pageTitle', lang));
  setText('ui-page-subtitle', t('app.tagline', lang));
  setText('lbl-stat-groups', t('popup.statsGroups', lang));
  setText('lbl-stat-channels', t('popup.statsChannels', lang));
  setText('lbl-stat-playlists', t('popup.statsPlaylists', lang));
  setText('lbl-stat-watched', t('popup.statsWatched', lang));

  setText('stat-groups', String(Object.keys(state.groups || {}).length));
  setText('stat-channels', String(Object.keys(state.channels || {}).length));
  setText('stat-playlists', String(Object.keys(state.playlists || {}).length));
  setText('stat-watched', String(Object.keys(state.watched || {}).length));

  setText('sec-general', t('options.secGeneral', lang));
  setText('lbl-language', t('options.language', lang));
  setText('lbl-theme', t('options.theme', lang));
  setText('opt-theme-auto', t('options.theme.auto', lang));
  setText('opt-theme-dark', t('options.theme.dark', lang));
  setText('opt-theme-light', t('options.theme.light', lang));

  setText('sec-status', t('options.statusThresholds', lang));
  setText('help-status', t('options.helpStatus', lang));
  setText('lbl-active-days', t('options.activeDays', lang));
  setText('lbl-slow-days', t('options.slowDays', lang));
  setText('lbl-inactive-days', t('options.inactiveDays', lang));
  setText('btn-save-status', t('common.save', lang));

  setText('sec-toggles', t('options.secToggles', lang));
  setText('lbl-focus-mode', t('focus.focusMode', lang));
  setText('desc-focus-mode', t('focus.focusModeDesc', lang));
  setText('lbl-hide-watched', t('options.hideWatchedGlobally', lang));
  setText('lbl-hide-shorts', t('options.hideShortsGlobally', lang));
  setText('lbl-show-badge', t('options.showWatchedBadge', lang));
  setText('lbl-show-progress', t('options.showProgressOnPlaylists', lang));
  setText('lbl-auto-tag', t('options.autoTaggingEnabled', lang));
  setText('lbl-shortcuts', t('options.keyboardShortcutsShort', lang));

  setText('sec-shortcuts', t('options.secShortcuts', lang));

  // Multi-Device Sync labels
  setText('sec-sync', t('sync.secTitle', lang));
  setText('help-sync', t('sync.help', lang));
  setText('lbl-sync-provider', t('sync.provider', lang));
  setText('opt-sync-none', t('sync.disabled', lang));
  setText('opt-sync-chrome', t('sync.chromeLabel', lang));
  setText('opt-sync-gdrive', 'Google Drive (AppData)');
  setText('lbl-sync-auto', t('sync.autoSync', lang));
  setText('help-sync-chrome', t('sync.helpChrome', lang));
  setText('btn-sync-chrome-push', `☁ ${t('sync.chromePush', lang)}`);
  setText('btn-sync-chrome-pull', `⬇ ${t('sync.chromePull', lang)}`);
  setText('lbl-gdrive-client-id', t('sync.gdriveClientId', lang));
  setText('btn-sync-gdrive-push', `☁ ${t('sync.gdrivePush', lang)}`);
  setText('btn-sync-gdrive-pull', `⬇ ${t('sync.gdrivePull', lang)}`);
  setText('btn-sync-gdrive-disconnect', t('sync.disconnect', lang));

  // Smart Rules labels
  setText('sec-rules', t('rules.secTitle', lang));
  setText('help-rules', t('rules.help', lang));
  setText('btn-apply-rules', `⚡ ${t('rules.applyRules', lang)}`);
  setText('lbl-rule-name', t('rules.ruleName', lang));
  setText('lbl-rule-match', t('rules.matchType', lang));
  setText('opt-rule-tag', 'Tag');
  setText('opt-rule-keyword', t('rules.keyword', lang));
  setText('lbl-rule-pattern', t('rules.pattern', lang));
  setText('lbl-rule-action', t('rules.action', lang));
  setText('opt-rule-assign', t('rules.assignGroup', lang));
  setText('opt-rule-hide', t('rules.hideVideo', lang));
  setText('lbl-rule-group', t('rules.targetGroup', lang));
  setText('btn-add-rule', `＋ ${t('rules.addRule', lang)}`);

  setText('sec-backup', t('options.tab.backup', lang));
  setText('help-backup', t('options.helpBackup', lang));
  setText('lbl-export-box', t('options.exportBox', lang));
  setText('lbl-import-box', t('options.importBox', lang));
  setText('lbl-danger-box', t('options.dangerBox', lang));
  setText('btn-export-json', `⬇ ${t('options.exportJson', lang)}`);
  setText('btn-export-csv', `⬇ ${t('options.exportCsv', lang)}`);
  setText('btn-import-merge', `⬆ ${t('options.importJsonMerge', lang)}`);
  setText('btn-import-replace', `⬆ ${t('options.importJsonReplace', lang)}`);
  setText('btn-clear-watched', `🧹 ${t('watched.clearAll', lang)}`);
  setText('btn-reset-all', `⚠️ ${t('options.resetAll', lang)}`);

  // Support card
  setText('sec-support', t('support.supportProject', lang));
  setText('desc-support', t('support.supportDesc', lang));
  const coffeeBtn = document.getElementById('btn-buy-coffee');
  if (coffeeBtn) {
    coffeeBtn.href = BUY_ME_A_COFFEE_URL;
    coffeeBtn.textContent = `☕ ${t('support.buyMeACoffee', lang)}`;
  }

  // Populate inputs from state
  document.getElementById('opt-language').value = lang;
  document.getElementById('opt-theme').value = state.settings?.theme || 'auto';
  document.getElementById('opt-active-days').value = String(state.settings?.statusConfig?.activeDays ?? 14);
  document.getElementById('opt-slow-days').value = String(state.settings?.statusConfig?.slowDays ?? 60);
  document.getElementById('opt-inactive-days').value = String(state.settings?.statusConfig?.inactiveDays ?? 180);

  document.getElementById('opt-focus-mode').checked = Boolean(state.settings?.focusMode);
  document.getElementById('opt-hide-watched').checked = Boolean(state.settings?.hideWatchedGlobally);
  document.getElementById('opt-hide-shorts').checked = Boolean(state.settings?.hideShortsGlobally);
  document.getElementById('opt-show-badge').checked = state.settings?.showWatchedBadge !== false;
  document.getElementById('opt-show-progress').checked = state.settings?.showProgressOnPlaylists !== false;
  document.getElementById('opt-auto-tag').checked = state.settings?.autoTaggingEnabled !== false;
  document.getElementById('opt-shortcuts').checked = state.settings?.keyboardShortcuts !== false;

  renderStatusPreview();
  renderShortcutsCheatSheet();
  renderSyncSection();
  renderSmartRulesSection();
}

async function saveSettingsPatch(patch, showFeedback = true) {
  const res = await sendBg(MESSAGE_ACTIONS.UPDATE_SETTINGS, { settings: patch });
  if (res?.ok && res.state) {
    state = res.state;
    renderUI();
    if (showFeedback) {
      showBanner(t('toast.saved', getLang()), 'success');
    }
  } else {
    showBanner(t('toast.error', getLang(), { message: res?.error || 'Unknown error' }), 'error');
  }
}

async function init() {
  const res = await sendBg(MESSAGE_ACTIONS.GET_STATE);
  if (res?.ok && res.state) {
    state = res.state;
  }
  renderUI();

  document.getElementById('opt-language')?.addEventListener('change', (e) => {
    saveSettingsPatch({ language: e.target.value });
  });

  document.getElementById('opt-theme')?.addEventListener('change', (e) => {
    saveSettingsPatch({ theme: e.target.value });
  });

  ['opt-active-days', 'opt-slow-days', 'opt-inactive-days'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', renderStatusPreview);
  });

  document.getElementById('btn-save-status')?.addEventListener('click', () => {
    const activeDays = Math.max(1, Number(document.getElementById('opt-active-days').value) || 14);
    const slowDays = Math.max(activeDays + 1, Number(document.getElementById('opt-slow-days').value) || 60);
    const inactiveDays = Math.max(slowDays + 1, Number(document.getElementById('opt-inactive-days').value) || 180);
    saveSettingsPatch({ statusConfig: { activeDays, slowDays, inactiveDays } });
  });

  document.getElementById('opt-focus-mode')?.addEventListener('change', (e) => {
    saveSettingsPatch({ focusMode: e.target.checked });
  });
  document.getElementById('opt-hide-watched')?.addEventListener('change', (e) => {
    saveSettingsPatch({ hideWatchedGlobally: e.target.checked });
  });
  document.getElementById('opt-hide-shorts')?.addEventListener('change', (e) => {
    saveSettingsPatch({ hideShortsGlobally: e.target.checked });
  });
  document.getElementById('opt-show-badge')?.addEventListener('change', (e) => {
    saveSettingsPatch({ showWatchedBadge: e.target.checked });
  });
  document.getElementById('opt-show-progress')?.addEventListener('change', (e) => {
    saveSettingsPatch({ showProgressOnPlaylists: e.target.checked });
  });
  document.getElementById('opt-auto-tag')?.addEventListener('change', (e) => {
    saveSettingsPatch({ autoTaggingEnabled: e.target.checked });
  });
  document.getElementById('opt-shortcuts')?.addEventListener('change', (e) => {
    saveSettingsPatch({ keyboardShortcuts: e.target.checked });
  });

  // Multi-Device Sync handlers
  const getCurrentSync = () => ({
    ...DEFAULT_SYNC_CONFIG,
    ...(state?.settings?.sync || {}),
  });

  document.getElementById('opt-sync-provider')?.addEventListener('change', (e) => {
    saveSettingsPatch({ sync: { ...getCurrentSync(), provider: e.target.value } });
  });

  document.getElementById('opt-sync-auto')?.addEventListener('change', (e) => {
    saveSettingsPatch({ sync: { ...getCurrentSync(), autoSync: e.target.checked } });
  });

  document.getElementById('opt-gdrive-client-id')?.addEventListener('change', (e) => {
    const val = String(e.target.value || '').trim();
    saveSettingsPatch({ sync: { ...getCurrentSync(), gdriveClientId: val } });
  });

  async function runSyncAction(btnId, action, payload = {}, successKey) {
    const btn = document.getElementById(btnId);
    if (btn) btn.disabled = true;
    try {
      const r = await sendBg(action, payload);
      if (r?.ok) {
        if (r.state) state = r.state;
        renderUI();
        showBanner(t(successKey, getLang()), 'success');
      } else {
        showBanner(t('toast.error', getLang(), { message: r?.error || 'Sync failed' }), 'error');
      }
    } catch (err) {
      showBanner(t('toast.error', getLang(), { message: err?.message || String(err) }), 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  document.getElementById('btn-sync-chrome-push')?.addEventListener('click', () => {
    runSyncAction(
      'btn-sync-chrome-push',
      MESSAGE_ACTIONS.SYNC_CHROME_PUSH,
      {},
      'sync.chromePushed'
    );
  });

  document.getElementById('btn-sync-chrome-pull')?.addEventListener('click', () => {
    runSyncAction(
      'btn-sync-chrome-pull',
      MESSAGE_ACTIONS.SYNC_CHROME_PULL,
      { merge: true },
      'sync.chromePulled'
    );
  });

  document.getElementById('btn-sync-gdrive-push')?.addEventListener('click', () => {
    const clientId = String(document.getElementById('opt-gdrive-client-id')?.value || '').trim();
    runSyncAction(
      'btn-sync-gdrive-push',
      MESSAGE_ACTIONS.SYNC_GDRIVE_PUSH,
      { clientId },
      'sync.gdrivePushed'
    );
  });

  document.getElementById('btn-sync-gdrive-pull')?.addEventListener('click', () => {
    const clientId = String(document.getElementById('opt-gdrive-client-id')?.value || '').trim();
    runSyncAction(
      'btn-sync-gdrive-pull',
      MESSAGE_ACTIONS.SYNC_GDRIVE_PULL,
      { clientId, merge: true },
      'sync.gdrivePulled'
    );
  });

  document.getElementById('btn-sync-gdrive-disconnect')?.addEventListener('click', () => {
    runSyncAction(
      'btn-sync-gdrive-disconnect',
      MESSAGE_ACTIONS.SYNC_GDRIVE_DISCONNECT,
      {},
      'sync.gdriveDisconnected'
    );
  });

  // Smart Rules handlers
  document.getElementById('rule-action-type')?.addEventListener('change', (e) => {
    document
      .getElementById('rule-target-group-wrap')
      ?.classList.toggle('is-hidden', e.target.value === 'hide_video');
  });

  document.getElementById('form-add-rule')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('rule-name');
    const matchTypeEl = document.getElementById('rule-match-type');
    const patternInput = document.getElementById('rule-pattern');
    const actionTypeEl = document.getElementById('rule-action-type');
    const groupSelect = document.getElementById('rule-target-group');

    const name = String(nameInput?.value || '').trim();
    const pattern = String(patternInput?.value || '').trim();
    const matchType = matchTypeEl?.value === 'keyword' ? 'keyword' : 'tag';
    const actionType = actionTypeEl?.value === 'hide_video' ? 'hide_video' : 'assign_group';
    const targetGroupId = actionType === 'assign_group' ? (groupSelect?.value || null) : null;

    if (!name || !pattern) return;
    if (actionType === 'assign_group' && !targetGroupId) {
      showBanner(t('rules.needGroup', getLang()), 'error');
      return;
    }

    const newRule = {
      id: createId('rule'),
      name,
      enabled: true,
      matchType,
      pattern,
      actionType,
      targetGroupId,
    };

    const nextRules = [...(state?.smartRules || []), newRule];
    await saveRules(nextRules);
    if (nameInput) nameInput.value = '';
    if (patternInput) patternInput.value = '';
  });

  document.getElementById('btn-apply-rules')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-apply-rules');
    if (btn) btn.disabled = true;
    try {
      const r = await sendBg(MESSAGE_ACTIONS.APPLY_SMART_RULES);
      if (r?.ok && r.state) {
        state = r.state;
        renderUI();
        showBanner(t('rules.applied', getLang()), 'success');
      } else {
        showBanner(t('toast.error', getLang(), { message: r?.error || 'Failed to apply rules' }), 'error');
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // Export Full JSON Backup
  document.getElementById('btn-export-json')?.addEventListener('click', async () => {
    const r = await sendBg(MESSAGE_ACTIONS.EXPORT_DATA);
    if (r?.ok && r.json) {
      const dateStr = new Date().toISOString().slice(0, 10);
      downloadFile(`tubenook-backup-${dateStr}.json`, r.json, 'application/json;charset=utf-8');
      showBanner(t('toast.exported', getLang()), 'success');
    } else {
      showBanner(t('toast.error', getLang(), { message: r?.error || 'Export failed' }), 'error');
    }
  });

  // Export Channels CSV
  document.getElementById('btn-export-csv')?.addEventListener('click', async () => {
    const r = await sendBg(MESSAGE_ACTIONS.EXPORT_CSV);
    if (r?.ok && typeof r.csv === 'string') {
      const dateStr = new Date().toISOString().slice(0, 10);
      downloadFile(`tubenook-channels-${dateStr}.csv`, r.csv, 'text/csv;charset=utf-8');
      showBanner(t('toast.exported', getLang()), 'success');
    } else {
      showBanner(t('toast.error', getLang(), { message: r?.error || 'CSV export failed' }), 'error');
    }
  });

  // Import JSON Backup
  const fileInput = document.getElementById('file-import-json');
  document.getElementById('btn-import-merge')?.addEventListener('click', () => {
    pendingImportMerge = true;
    fileInput?.click();
  });
  document.getElementById('btn-import-replace')?.addEventListener('click', () => {
    pendingImportMerge = false;
    fileInput?.click();
  });

  fileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const r = await sendBg(MESSAGE_ACTIONS.IMPORT_DATA, {
        json: text,
        merge: pendingImportMerge,
      });
      if (r?.ok && r.state) {
        state = r.state;
        renderUI();
        showBanner(t('toast.imported', getLang()), 'success');
      } else {
        showBanner(t('toast.error', getLang(), { message: r?.error || 'Invalid backup file' }), 'error');
      }
    } catch (err) {
      showBanner(t('toast.error', getLang(), { message: err?.message || String(err) }), 'error');
    } finally {
      fileInput.value = '';
    }
  });

  // Clear Watched History
  document.getElementById('btn-clear-watched')?.addEventListener('click', async () => {
    if (!window.confirm(t('watched.clearConfirm', getLang()))) return;
    const r = await sendBg(MESSAGE_ACTIONS.CLEAR_WATCHED);
    if (r?.ok && r.state) {
      state = r.state;
      renderUI();
      showBanner(t('toast.saved', getLang()), 'success');
    }
  });

  // Reset All Data
  document.getElementById('btn-reset-all')?.addEventListener('click', async () => {
    if (!window.confirm(t('options.resetConfirm', getLang()))) return;
    const r = await sendBg(MESSAGE_ACTIONS.RESET_STATE);
    if (r?.ok && r.state) {
      state = r.state;
      renderUI();
      showBanner(t('toast.saved', getLang()), 'success');
    }
  });
}

init().catch((err) => console.error(`[${BRAND_NAME} Options]`, err));
