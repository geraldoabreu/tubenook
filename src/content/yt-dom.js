/**
 * @fileoverview YouTube DOM utilities, scraping helpers, navigation observer,
 * background messaging bridge, and toast notifications for PlayShelf.
 */

/**
 * Escape HTML special characters for safe template rendering.
 * @param {any} value
 * @returns {string}
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Send a message to the MV3 background service worker and await the response.
 * Spreads object payloads at top-level (for service-worker.js compatibility) while
 * also preserving `payload`.
 * @param {string} action
 * @param {Record<string, any>} [payload]
 * @returns {Promise<any>}
 */
export function sendBg(action, payload) {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      resolve({ ok: false, error: 'Extension runtime unavailable.' });
      return;
    }

    const message =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? { action, ...payload, payload }
        : payload !== undefined
          ? { action, payload }
          : { action };

    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response ?? { ok: false, error: 'Empty response from background.' });
      });
    } catch (err) {
      resolve({ ok: false, error: err?.message || String(err) });
    }
  });
}

/**
 * Try to extract a UC... channel ID from the current page DOM, channel meta/links,
 * and `ytInitialData`/page scripts safely on SPA transitions.
 * @returns {string | null}
 */
export function detectChannelIdFromDom() {
  if (typeof document === 'undefined') return null;

  const pathname = typeof window !== 'undefined' ? window.location?.pathname || '' : '';
  const searchParams =
    typeof window !== 'undefined' ? new URLSearchParams(window.location?.search || '') : null;
  const currentVideoId = searchParams?.get('v') || '';
  const handleMatch = pathname.match(/^\/(@[^/?#]+)/);
  const currentHandle = handleMatch ? decodeURIComponent(handleMatch[1]) : '';
  const isWatchPage = pathname === '/watch' || pathname.startsWith('/shorts/');
  const isChannelPage =
    pathname.startsWith('/@') || pathname.startsWith('/c/') || pathname.startsWith('/user/');

  // 1. Live DOM links that update immediately on YouTube SPA transitions
  if (isWatchPage) {
    const watchOwnerSelectors = [
      'ytd-watch-metadata ytd-video-owner-renderer a[href*="/channel/UC"]',
      'ytd-video-owner-renderer a[href*="/channel/UC"]',
      '#owner a[href*="/channel/UC"]',
      'ytd-reel-video-renderer[is-active] a[href*="/channel/UC"]',
    ];
    for (const sel of watchOwnerSelectors) {
      const href = document.querySelector(sel)?.getAttribute('href') || '';
      const m = href.match(/\/channel\/(UC[\w-]{10,})/);
      if (m) return m[1];
    }
  }

  if (isChannelPage) {
    const channelDomSelectors = [
      'ytd-browse[page-subtype="channels"]:not([hidden]) #channel-header a[href*="/channel/UC"]',
      'ytd-browse[page-subtype="channels"]:not([hidden]) yt-page-header-renderer a[href*="/channel/UC"]',
      'ytd-c4-tabbed-header-renderer a[href*="/channel/UC"]',
      '#channel-header a[href*="/channel/UC"]',
    ];
    for (const sel of channelDomSelectors) {
      const href = document.querySelector(sel)?.getAttribute('href') || '';
      const m = href.match(/\/channel\/(UC[\w-]{10,})/);
      if (m) return m[1];
    }
  }

  // 2. Check window.ytInitialData safely (when accessible)
  try {
    const ytData = /** @type {any} */ (typeof window !== 'undefined' ? window.ytInitialData : null);
    if (ytData && typeof ytData === 'object') {
      const extId =
        ytData?.metadata?.channelMetadataRenderer?.externalId ||
        ytData?.header?.c4TabbedHeaderRenderer?.channelId ||
        '';
      if (typeof extId === 'string' && /^UC[\w-]{10,}$/.test(extId)) {
        const vanity = String(ytData?.metadata?.channelMetadataRenderer?.vanityChannelUrl || '');
        if (!currentHandle || !vanity || vanity.toLowerCase().includes(currentHandle.toLowerCase())) {
          return extId;
        }
      }
      const canonicalFromData = String(ytData?.microformat?.microformatDataRenderer?.urlCanonical || '');
      const dataCanonMatch = canonicalFromData.match(/\/channel\/(UC[\w-]{10,})/);
      if (dataCanonMatch) return dataCanonMatch[1];
    }
  } catch {
    // Ignore cross-context access errors
  }

  // 3. Channel meta tags and canonical/RSS links
  const metaChannelId =
    document.querySelector('meta[itemprop="channelId"]')?.getAttribute('content') ||
    document.querySelector('meta[itemprop="identifier"]')?.getAttribute('content') ||
    '';
  if (/^UC[\w-]{10,}$/.test(metaChannelId)) return metaChannelId;

  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href') || '';
  const canonicalMatch = canonical.match(/\/channel\/(UC[\w-]{10,})/);
  if (canonicalMatch) return canonicalMatch[1];

  const rssLink =
    document.querySelector('link[rel="alternate"][type="application/rss+xml"]')?.getAttribute('href') ||
    '';
  const rssMatch = rssLink.match(/channel_id=(UC[\w-]{10,})/);
  if (rssMatch) return rssMatch[1];

  const ownerLink =
    document.querySelector('ytd-video-owner-renderer a[href*="/channel/UC"]')?.getAttribute('href') ||
    '';
  const ownerMatch = ownerLink.match(/\/channel\/(UC[\w-]{10,})/);
  if (ownerMatch) return ownerMatch[1];

  // 4. Inline ytInitialData page scripts (guarded against stale SPA script payloads)
  try {
    const scripts = document.querySelectorAll('script:not([src])');
    const handleNeedle = currentHandle ? currentHandle.toLowerCase() : '';
    for (const script of scripts) {
      const text = script.textContent || '';
      if (!text || (!text.includes('ytInitialData') && !text.includes('externalId') && !text.includes('channelId'))) {
        continue;
      }
      if (handleNeedle && !text.toLowerCase().includes(handleNeedle)) {
        continue;
      }
      if (isWatchPage && currentVideoId && !text.includes(currentVideoId)) {
        continue;
      }
      const m =
        text.match(/"externalId"\s*:\s*"(UC[\w-]{10,})"/) ||
        text.match(/"channelId"\s*:\s*"(UC[\w-]{10,})"/) ||
        text.match(/channel_id=(UC[\w-]{10,})/);
      if (m) return m[1];
    }
  } catch {
    // Ignore script parsing errors
  }

  return null;
}

/**
 * Inspect the current YouTube URL and DOM to determine page context.
 * @returns {{ type: 'home'|'subscriptions'|'channel'|'playlist'|'watch'|'playlists'|'other', channelId: string | null, channelHandle: string | null, playlistId: string | null, videoId: string | null }}
 */
export function getPageContext() {
  if (typeof window === 'undefined' || !window.location) {
    return {
      type: 'other',
      channelId: null,
      channelHandle: null,
      playlistId: null,
      videoId: null,
    };
  }

  const url = new URL(window.location.href);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const params = url.searchParams;

  let type = 'other';
  let channelId = null;
  let channelHandle = null;
  let playlistId = params.get('list') || null;
  let videoId = params.get('v') || null;

  if (path === '/' || path === '/home') {
    type = 'home';
  } else if (path === '/feed/subscriptions') {
    type = 'subscriptions';
  } else if (path === '/feed/playlists') {
    type = 'playlists';
  } else if (path === '/playlist') {
    type = 'playlist';
  } else if (path === '/watch') {
    type = 'watch';
    channelId = detectChannelIdFromDom();
  } else if (path.startsWith('/shorts/')) {
    type = 'watch';
    const m = path.match(/^\/shorts\/([^/?#]+)/);
    if (m) videoId = m[1];
  } else if (path.startsWith('/channel/')) {
    type = 'channel';
    const m = path.match(/^\/channel\/([^/?#]+)/);
    if (m) channelId = m[1];
  } else if (path.startsWith('/@')) {
    type = 'channel';
    const m = path.match(/^\/(@[^/?#]+)/);
    if (m) channelHandle = decodeURIComponent(m[1]);
    channelId = detectChannelIdFromDom();
  } else if (path.startsWith('/c/') || path.startsWith('/user/')) {
    type = 'channel';
    const m = path.match(/^\/(?:c|user)\/([^/?#]+)/);
    if (m) channelHandle = decodeURIComponent(m[1]);
    channelId = detectChannelIdFromDom();
  }

  return { type, channelId, channelHandle, playlistId, videoId };
}

/**
 * Determine if YouTube is currently rendered in dark theme.
 * @returns {boolean}
 */
export function isDarkTheme() {
  if (typeof document === 'undefined') return true;
  const root = document.documentElement;
  if (root.hasAttribute('dark')) return true;
  const themeAttr = root.getAttribute('theme');
  if (themeAttr === 'dark') return true;
  if (themeAttr === 'light') return false;

  try {
    const target = document.querySelector('ytd-app') || document.body;
    if (target) {
      const bg = getComputedStyle(target).backgroundColor;
      const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (m) {
        const lum = 0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3]);
        return lum < 128;
      }
    }
  } catch {
    // fallback
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? true;
}

/**
 * Parse YouTube duration text into seconds.
 * Handles `H:MM:SS`, `MM:SS`, `M:SS`, and `SHORTS`.
 * @param {string} text
 * @returns {number}
 */
export function parseDurationToSeconds(text) {
  if (!text || typeof text !== 'string') return 0;
  const cleaned = text.trim().toUpperCase();
  if (!cleaned) return 0;
  if (cleaned === 'SHORTS' || cleaned === 'SHORT') return 60;
  if (cleaned === 'LIVE' || cleaned === 'AO VIVO' || cleaned === 'ESTREIA' || cleaned === 'PREMIERE') {
    return 0;
  }

  const timeMatch = cleaned.match(/(\d+(?::\d{1,2}){1,2})/);
  if (!timeMatch) return 0;

  const parts = timeMatch[1].split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return 0;

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

/**
 * Parse YouTube views text into a numeric count.
 * Handles EN & PT-BR suffixes: K, M, B, mil, mi, bi, thousand, million, billion.
 * @param {string} text
 * @returns {number}
 */
export function parseViewsCount(text) {
  if (!text || typeof text !== 'string') return 0;
  const raw = text.trim().toLowerCase().replace(/\u00a0/g, ' ');
  if (!raw || raw.includes('no views') || raw.includes('nenhuma visualiza')) return 0;

  // Match number + optional EN/PT multiplier suffix
  const suffixMatch = raw.match(
    /(\d+(?:[.,]\d+)?)\s*(k|m|b|milh(?:ões|oes)|mil|mi|bilh(?:ões|oes)|bi|thousand|million|billion)\b/i
  );
  if (suffixMatch) {
    const num = parseFloat(suffixMatch[1].replace(',', '.'));
    if (Number.isNaN(num)) return 0;
    const unit = suffixMatch[2].toLowerCase();
    if (unit === 'k' || unit === 'mil' || unit === 'thousand') return Math.round(num * 1_000);
    if (unit === 'm' || unit === 'mi' || unit.startsWith('milh') || unit === 'million') {
      return Math.round(num * 1_000_000);
    }
    if (unit === 'b' || unit === 'bi' || unit.startsWith('bilh') || unit === 'billion') {
      return Math.round(num * 1_000_000_000);
    }
  }

  // Plain number with thousand separators (e.g., "1.234 visualizações" or "1,234 views")
  const plainMatch = raw.match(/(\d[\d.,\s]*)/);
  if (plainMatch) {
    const digits = plainMatch[1].replace(/[^\d]/g, '');
    if (digits) return parseInt(digits, 10) || 0;
  }

  return 0;
}

/**
 * Extract video ID from a YouTube watch or shorts URL.
 * @param {string} href
 * @returns {string | null}
 */
export function extractVideoIdFromUrl(href) {
  if (!href) return null;
  try {
    const url = new URL(href, 'https://www.youtube.com');
    if (url.pathname === '/watch') {
      return url.searchParams.get('v') || null;
    }
    const shortsMatch = url.pathname.match(/^\/shorts\/([^/?#]+)/);
    if (shortsMatch) return shortsMatch[1];
    const embedMatch = url.pathname.match(/^\/embed\/([^/?#]+)/);
    if (embedMatch) return embedMatch[1];
  } catch {
    const m = href.match(/[?&]v=([^&#]+)/) || href.match(/\/shorts\/([^/?#]+)/);
    if (m) return m[1];
  }
  return null;
}

/**
 * Scrape video card elements inside `root` into structured metadata objects.
 * @param {Document | Element} [root=document]
 * @returns {Array<{ el: Element, videoId: string, title: string, channelTitle: string, channelId: string, durationSec: number, views: number, isShort: boolean, isLive: boolean, publishedText: string }>}
 */
export function scrapeVideoCards(root = document) {
  if (!root || typeof root.querySelectorAll !== 'function') return [];

  const selector = [
    'ytd-rich-item-renderer',
    'ytd-grid-video-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-playlist-video-renderer',
    'yt-lockup-view-model',
  ].join(', ');

  const candidates = Array.from(root.querySelectorAll(selector));
  const results = [];
  const seenElements = new Set();

  for (const el of candidates) {
    // Avoid double-scraping nested lockups inside a rich-item-renderer
    if (
      el.tagName.toLowerCase() === 'yt-lockup-view-model' &&
      el.closest('ytd-rich-item-renderer')
    ) {
      continue;
    }
    if (seenElements.has(el)) continue;

    const link =
      el.querySelector('a#video-title-link[href]') ||
      el.querySelector('a#video-title[href]') ||
      el.querySelector('a#thumbnail[href]') ||
      el.querySelector('a[href*="/watch?v="]') ||
      el.querySelector('a[href*="/shorts/"]');

    if (!link) continue;
    const href = link.getAttribute('href') || '';
    const videoId = extractVideoIdFromUrl(href);
    if (!videoId) continue;

    seenElements.add(el);

    const titleEl =
      el.querySelector('#video-title') ||
      el.querySelector('a#video-title-link') ||
      el.querySelector('h3 a') ||
      el.querySelector('.yt-lockup-metadata-view-model__title');
    const title = (titleEl?.getAttribute('title') || titleEl?.textContent || '').trim();

    const channelLink =
      el.querySelector('ytd-channel-name a[href]') ||
      el.querySelector('#channel-name a[href]') ||
      el.querySelector('a[href^="/@"]') ||
      el.querySelector('a[href^="/channel/"]');
    const channelTitle = (
      channelLink?.textContent ||
      el.querySelector('ytd-channel-name #text')?.textContent ||
      el.querySelector('#channel-name')?.textContent ||
      ''
    ).trim();

    let channelId = '';
    const chHref = channelLink?.getAttribute('href') || '';
    const ucMatch = chHref.match(/\/channel\/(UC[\w-]+)/);
    const handleMatch = chHref.match(/\/(@[^/?#]+)/);
    if (ucMatch) channelId = ucMatch[1];
    else if (handleMatch) channelId = decodeURIComponent(handleMatch[1]);

    const durationEl =
      el.querySelector('ytd-thumbnail-overlay-time-status-renderer #text') ||
      el.querySelector('badge-shape .badge-shape-wiz__text') ||
      el.querySelector('.yt-badge-shape__text');
    const durationText = (durationEl?.textContent || '').trim();
    const isShort =
      href.includes('/shorts/') ||
      durationText.toUpperCase() === 'SHORTS' ||
      Boolean(el.querySelector('ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"]'));

    const isLive =
      Boolean(
        el.querySelector(
          '.badge-style-type-live-now-alternate, .badge-style-type-live-now, [overlay-style="LIVE"]'
        )
      ) || /^(live|ao vivo)$/i.test(durationText);

    const durationSec = isShort ? 60 : isLive ? 0 : parseDurationToSeconds(durationText);

    const metaSpans = Array.from(
      el.querySelectorAll(
        '#metadata-line span.inline-metadata-item, #metadata-line span, .yt-content-metadata-view-model__metadata-text'
      )
    )
      .map((s) => (s.textContent || '').trim())
      .filter(Boolean);

    let views = 0;
    let publishedText = '';
    for (const txt of metaSpans) {
      if (/(views?|visualiza|assistindo|watching)/i.test(txt)) {
        if (!views) views = parseViewsCount(txt);
      } else if (/(ago|há|streamed|transmitido|month|year|day|hour|min|week|dia|semana|mês|mes|ano|hora)/i.test(txt)) {
        if (!publishedText) publishedText = txt;
      }
    }
    if (!views && metaSpans.length >= 1) {
      views = parseViewsCount(metaSpans[0]);
    }
    if (!publishedText && metaSpans.length >= 2) {
      publishedText = metaSpans[1];
    }

    results.push({
      el,
      videoId,
      title,
      channelTitle,
      channelId,
      durationSec,
      views,
      isShort,
      isLive,
      publishedText,
    });
  }

  return results;
}

/**
 * Normalize a channel link href into `{ id, handle, url }`.
 * @param {string} href
 * @returns {{ id: string, handle: string, url: string } | null}
 */
function parseChannelHref(href) {
  if (!href) return null;
  let path = href;
  try {
    path = new URL(href, 'https://www.youtube.com').pathname;
  } catch {
    // keep raw
  }

  const ucMatch = path.match(/^\/channel\/(UC[\w-]+)/);
  if (ucMatch) {
    return {
      id: ucMatch[1],
      handle: '',
      url: `https://www.youtube.com/channel/${ucMatch[1]}`,
    };
  }

  const handleMatch = path.match(/^\/(@[^/?#]+)/);
  if (handleMatch) {
    const handle = decodeURIComponent(handleMatch[1]);
    return {
      id: handle,
      handle,
      url: `https://www.youtube.com/${handle}`,
    };
  }

  const customMatch = path.match(/^\/(?:c|user)\/([^/?#]+)/);
  if (customMatch) {
    const slug = decodeURIComponent(customMatch[1]);
    return {
      id: slug,
      handle: slug,
      url: `https://www.youtube.com${path}`,
    };
  }

  return null;
}

/**
 * Scrape subscribed channels from YouTube's left sidebar (and `/feed/channels` if open).
 * @returns {Array<{ id: string, handle: string, title: string, avatarUrl: string, url: string }>}
 */
export function scrapeSidebarSubscriptions() {
  if (typeof document === 'undefined') return [];

  /** @type {Map<string, { id: string, handle: string, title: string, avatarUrl: string, url: string }>} */
  const map = new Map();

  // 1. Scrape guide sidebar entries
  const guideLinks = document.querySelectorAll(
    'ytd-guide-renderer ytd-guide-entry-renderer a#endpoint[href]'
  );
  for (const a of guideLinks) {
    const href = a.getAttribute('href') || '';
    const parsed = parseChannelHref(href);
    if (!parsed) continue;

    const title = (
      a.querySelector('yt-formatted-string.title')?.textContent ||
      a.getAttribute('title') ||
      a.textContent ||
      ''
    ).trim();
    if (!title) continue;

    const img = a.querySelector('img');
    const avatarUrl = img?.getAttribute('src') || '';

    if (!map.has(parsed.id)) {
      map.set(parsed.id, {
        id: parsed.id,
        handle: parsed.handle,
        title,
        avatarUrl,
        url: parsed.url,
      });
    }
  }

  // 2. Also scrape /feed/channels list if the user is on that page
  const channelRenderers = document.querySelectorAll('ytd-channel-renderer');
  for (const renderer of channelRenderers) {
    const link =
      renderer.querySelector('a#main-link[href]') ||
      renderer.querySelector('a.channel-link[href]');
    const parsed = parseChannelHref(link?.getAttribute('href') || '');
    if (!parsed) continue;

    const title = (
      renderer.querySelector('#channel-title #text')?.textContent ||
      renderer.querySelector('#text.ytd-channel-name')?.textContent ||
      ''
    ).trim();
    const avatarUrl = renderer.querySelector('#avatar img')?.getAttribute('src') || '';

    if (!map.has(parsed.id)) {
      map.set(parsed.id, {
        id: parsed.id,
        handle: parsed.handle,
        title: title || parsed.id,
        avatarUrl,
        url: parsed.url,
      });
    }
  }

  return Array.from(map.values());
}

/**
 * Scrape playlists from YouTube's left sidebar (and `/feed/playlists` if open).
 * @returns {Array<{ id: string, title: string, url: string }>}
 */
export function scrapeSidebarPlaylists() {
  if (typeof document === 'undefined') return [];

  /** @type {Map<string, { id: string, title: string, url: string }>} */
  const map = new Map();

  const links = document.querySelectorAll(
    'ytd-guide-renderer a#endpoint[href*="/playlist?list="], ytd-grid-playlist-renderer a[href*="/playlist?list="], yt-lockup-view-model a[href*="/playlist?list="]'
  );

  for (const a of links) {
    if (a.closest('#tp-sidebar-section')) continue;
    const href = a.getAttribute('href') || '';
    try {
      const url = new URL(href, 'https://www.youtube.com');
      const id = url.searchParams.get('list');
      if (!id || map.has(id)) continue;

      const title = (
        a.querySelector('yt-formatted-string.title')?.textContent ||
        a.getAttribute('title') ||
        a.textContent ||
        ''
      ).trim();

      if (!title) continue;

      map.set(id, {
        id,
        title,
        url: `https://www.youtube.com/playlist?list=${encodeURIComponent(id)}`,
      });
    } catch {
      // ignore invalid URL
    }
  }

  return Array.from(map.values());
}

/**
 * Subscribe to YouTube SPA navigation events (`yt-navigate-finish`, `popstate`, and URL polling fallback).
 * @param {(ctx: ReturnType<typeof getPageContext>) => void} callback
 * @returns {() => void} Unsubscribe function
 */
export function onYouTubeNavigate(callback) {
  if (typeof window === 'undefined' || typeof callback !== 'function') {
    return () => {};
  }

  let lastHref = window.location.href;
  let timer = null;

  const notify = (force = false) => {
    const currentHref = window.location.href;
    if (!force && currentHref === lastHref) return;
    lastHref = currentHref;
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        callback(getPageContext());
      } catch (err) {
        console.warn('[TubeNook] Navigation callback error:', err);
      }
    }, 120);
  };

  const onNavFinish = () => notify(true);
  const onPopState = () => notify(true);

  window.addEventListener('yt-navigate-finish', onNavFinish);
  window.addEventListener('popstate', onPopState);
  const intervalId = setInterval(() => notify(false), 800);

  return () => {
    clearTimeout(timer);
    clearInterval(intervalId);
    window.removeEventListener('yt-navigate-finish', onNavFinish);
    window.removeEventListener('popstate', onPopState);
  };
}

/**
 * Show a transient toast notification in the bottom-right corner.
 * @param {string} message
 * @param {'info' | 'success' | 'error' | 'warning'} [type='info']
 */
export function showToast(message, type = 'info') {
  if (typeof document === 'undefined' || !document.body) return;

  let container = document.getElementById('tp-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'tp-toast-container';
    container.className = 'tp-toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `tp-toast tp-toast-${type}`;
  toast.setAttribute('role', 'status');
  toast.textContent = String(message || '');
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('tp-toast-visible');
  });

  setTimeout(() => {
    toast.classList.remove('tp-toast-visible');
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

/**
 * Scrape metadata for the currently playing video on `/watch` or `/shorts/`.
 * Returns `null` if not currently on a watch or shorts page.
 * @returns {{ videoId: string, title: string, channelTitle: string, channelId: string, durationSec: number, thumbnailUrl: string } | null}
 */
export function getCurrentWatchVideoInfo() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null;

  const ctx = getPageContext();
  if (ctx.type !== 'watch' || !ctx.videoId) return null;

  const videoId = ctx.videoId;
  const isShorts = (window.location?.pathname || '').startsWith('/shorts/');

  const titleEl = isShorts
    ? document.querySelector('ytd-reel-video-renderer[is-active] h2 yt-formatted-string') ||
      document.querySelector('ytd-reel-video-renderer[is-active] h2') ||
      document.querySelector('reel-player-header-renderer h2')
    : document.querySelector('ytd-watch-metadata h1 yt-formatted-string') ||
      document.querySelector('ytd-watch-metadata h1') ||
      document.querySelector('h1.ytd-watch-metadata');

  const title = (
    titleEl?.textContent ||
    document.querySelector('meta[name="title"]')?.getAttribute('content') ||
    document.title.replace(/\s*-\s*YouTube$/, '') ||
    ''
  ).trim();

  const channelLink = isShorts
    ? document.querySelector('ytd-reel-video-renderer[is-active] ytd-channel-name a[href]') ||
      document.querySelector('ytd-reel-video-renderer[is-active] a[href^="/@"]') ||
      document.querySelector('ytd-reel-video-renderer[is-active] a[href^="/channel/"]')
    : document.querySelector('ytd-watch-metadata ytd-video-owner-renderer ytd-channel-name a[href]') ||
      document.querySelector('ytd-video-owner-renderer ytd-channel-name a[href]') ||
      document.querySelector('#owner #channel-name a[href]');

  const channelTitle = (
    channelLink?.textContent ||
    document.querySelector('ytd-watch-metadata ytd-video-owner-renderer ytd-channel-name #text')?.textContent ||
    document.querySelector('link[itemprop="name"]')?.getAttribute('content') ||
    ''
  ).trim();

  let channelId = '';
  const chHref = channelLink?.getAttribute('href') || '';
  const ucMatch = chHref.match(/\/channel\/(UC[\w-]+)/);
  const handleMatch = chHref.match(/\/(@[^/?#]+)/);
  if (ucMatch) channelId = ucMatch[1];
  else if (handleMatch) channelId = decodeURIComponent(handleMatch[1]);
  else channelId = ctx.channelId || detectChannelIdFromDom() || '';

  let durationSec = 0;
  const videoEl = /** @type {HTMLVideoElement | null} */ (
    document.querySelector('video.html5-main-video')
  );
  if (videoEl && Number.isFinite(videoEl.duration) && videoEl.duration > 0) {
    durationSec = Math.round(videoEl.duration);
  } else {
    const durText = document.querySelector('.ytp-time-duration')?.textContent || '';
    durationSec = parseDurationToSeconds(durText) || (isShorts ? 60 : 0);
  }

  const thumbnailUrl = `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;

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
 * Seek YouTube's main HTML5 video player to `seconds` and resume playback if paused.
 * @param {number} seconds
 * @returns {boolean}
 */
export function seekVideoPlayer(seconds) {
  if (typeof document === 'undefined') return false;
  const target = Number(seconds);
  if (!Number.isFinite(target) || target < 0) return false;

  const video = /** @type {HTMLVideoElement | null} */ (
    document.querySelector('video.html5-main-video')
  );
  if (!video) return false;

  const clamped =
    Number.isFinite(video.duration) && video.duration > 0
      ? Math.min(target, video.duration)
      : target;

  video.currentTime = clamped;
  if (video.paused) {
    try {
      const p = video.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      // Ignore autoplay restriction errors
    }
  }
  return true;
}

/**
 * Toggle PlayShelf Focus Mode CSS class on `document.documentElement`.
 * @param {boolean} enabled
 */
export function toggleFocusModeCss(enabled) {
  if (typeof document === 'undefined' || !document.documentElement) return;
  document.documentElement.classList.toggle('tp-focus-mode', Boolean(enabled));
}

/**
 * Create a debounced wrapper around `fn` that delays invocation until `wait` ms
 * have elapsed since the last call.
 * @template {(...args: any[]) => any} T
 * @param {T} fn
 * @param {number} [wait=250]
 * @returns {((...args: Parameters<T>) => void) & { cancel: () => void }}
 */
export function debounce(fn, wait = 250) {
  let timer = null;
  const debounced = (...args) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
  debounced.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return debounced;
}

/**
 * Schedule `fn` during browser idle time using `requestIdleCallback`,
 * falling back to `setTimeout` when unavailable.
 * @param {() => void} fn
 * @param {number} [timeout=500]
 * @returns {number}
 */
export function scheduleIdle(fn, timeout = 500) {
  if (typeof requestIdleCallback === 'function') {
    return requestIdleCallback(() => fn(), { timeout });
  }
  return setTimeout(fn, 16);
}
