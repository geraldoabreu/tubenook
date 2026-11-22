/**
 * @fileoverview Multi-Device Sync adapter for TubeNook (Chrome Sync chunked storage + Google Drive appDataFolder).
 */

import { DRIVE_BACKUP_FILENAME } from './brand.js';
import { t } from './i18n.js';

const SYNC_META_KEY = 'ps_sync_meta';
const SYNC_CHUNK_PREFIX = 'ps_sync_';
const CHROME_SYNC_MAX_TOTAL_BYTES = 95 * 1024; // 95 KB safety ceiling below Chrome's 100 KB QUOTA_BYTES
const DRIVE_FILES_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

const utf8Encoder = new TextEncoder();

/**
 * Measure UTF-8 byte length of a string.
 * @param {string} str
 * @returns {number}
 */
function utf8ByteLength(str) {
  return utf8Encoder.encode(str).byteLength;
}

/**
 * Split a string into UTF-8 byte-bounded chunks without breaking multi-byte code points.
 * @param {string} str
 * @param {number} [maxBytes=7000]
 * @returns {string[]}
 */
export function chunkString(str, maxBytes = 7000) {
  if (typeof str !== 'string' || str.length === 0) return [];
  const limit = Math.max(4, Math.floor(maxBytes));
  const chunks = [];
  let current = '';
  let currentBytes = 0;

  for (const ch of str) {
    const chBytes = utf8ByteLength(ch);
    if (currentBytes + chBytes > limit && current.length > 0) {
      chunks.push(current);
      current = ch;
      currentBytes = chBytes;
    } else {
      current += ch;
      currentBytes += chBytes;
    }
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

/**
 * Reassemble an array of string chunks back into the original string.
 * @param {string[]} chunks
 * @returns {string}
 */
export function unchunkStrings(chunks) {
  if (!Array.isArray(chunks)) return '';
  return chunks.join('');
}

/**
 * Resolve the Chrome storage.sync area (or a test-supplied mock).
 * @param {any} syncArea
 */
function resolveSyncArea(syncArea) {
  const area = syncArea || (typeof chrome !== 'undefined' ? chrome.storage?.sync : null);
  if (!area) {
    throw new Error('chrome.storage.sync is not available in this environment.');
  }
  return area;
}

/**
 * Push serialized AppState to chrome.storage.sync using chunked keys (`ps_sync_meta` + `ps_sync_0..N`).
 * Enforces a 95 KB safety quota check.
 * @param {any} state
 * @param {any} [syncArea]
 * @returns {Promise<{ ok: true, chunks: number, bytes: number, syncedAt: number }>}
 */
export async function pushToChromeSync(state, syncArea) {
  const area = resolveSyncArea(syncArea);
  const serialized = JSON.stringify(state);
  const bytes = utf8ByteLength(serialized);

  if (bytes > CHROME_SYNC_MAX_TOTAL_BYTES) {
    const kb = (bytes / 1024).toFixed(1);
    throw new Error(
      `State size (${kb} KB) exceeds Chrome Sync's 95 KB safe limit. Please use Google Drive Sync for large libraries.`
    );
  }

  const chunks = chunkString(serialized, 7000);
  const existingMetaRes = await area.get(SYNC_META_KEY);
  const prevCount = existingMetaRes?.[SYNC_META_KEY]?.count || 0;

  const syncedAt = Date.now();
  /** @type {Record<string, any>} */
  const payload = {
    [SYNC_META_KEY]: {
      version: 1,
      count: chunks.length,
      bytes,
      updatedAt: syncedAt,
    },
  };
  for (let i = 0; i < chunks.length; i++) {
    payload[`${SYNC_CHUNK_PREFIX}${i}`] = chunks[i];
  }

  await area.set(payload);

  // Remove any leftover stale chunks from a previous larger push
  if (prevCount > chunks.length) {
    const staleKeys = [];
    for (let i = chunks.length; i < prevCount; i++) {
      staleKeys.push(`${SYNC_CHUNK_PREFIX}${i}`);
    }
    if (staleKeys.length > 0 && typeof area.remove === 'function') {
      await area.remove(staleKeys);
    }
  }

  return { ok: true, chunks: chunks.length, bytes, syncedAt };
}

/**
 * Pull and reassemble AppState from chrome.storage.sync.
 * @param {any} [syncArea]
 * @returns {Promise<any | null>}
 */
export async function pullFromChromeSync(syncArea) {
  const area = resolveSyncArea(syncArea);
  const metaRes = await area.get(SYNC_META_KEY);
  const meta = metaRes?.[SYNC_META_KEY];
  if (!meta || typeof meta.count !== 'number' || meta.count <= 0) {
    return null;
  }

  const keys = Array.from({ length: meta.count }, (_, i) => `${SYNC_CHUNK_PREFIX}${i}`);
  const chunkRes = await area.get(keys);
  const chunks = [];
  for (const key of keys) {
    if (typeof chunkRes?.[key] !== 'string') {
      throw new Error(`Missing sync chunk "${key}" in chrome.storage.sync.`);
    }
    chunks.push(chunkRes[key]);
  }

  const joined = unchunkStrings(chunks);
  return JSON.parse(joined);
}

/**
 * Extract `#access_token=` (or query fallback) from a Google OAuth redirect URL.
 * @param {string} responseUrl
 * @returns {{ token: string | null, error: string | null }}
 */
function parseOAuthRedirectUrl(responseUrl) {
  try {
    const parsed = new URL(responseUrl);
    const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
    const token = hashParams.get('access_token') || parsed.searchParams.get('access_token');
    const error = hashParams.get('error') || parsed.searchParams.get('error');
    return { token, error };
  } catch {
    const hashPart = String(responseUrl || '').split('#')[1] || '';
    const params = new URLSearchParams(hashPart);
    return {
      token: params.get('access_token'),
      error: params.get('error'),
    };
  }
}

/**
 * Obtain a Google Drive OAuth2 access token using chrome.identity.
 * Uses `launchWebAuthFlow` (implicit flow) when `clientId` is provided,
 * otherwise falls back to `chrome.identity.getAuthToken` and returns a clear localized error
 * if `getAuthToken` is not configured in the manifest.
 * @param {string} [clientId]
 * @param {boolean} [interactive=true]
 * @param {'pt-BR' | 'pt-PT' | 'en' | 'es'} [lang='pt-BR']
 * @returns {Promise<string>}
 */
export async function getGoogleDriveToken(clientId, interactive = true, lang = 'pt-BR') {
  if (typeof chrome === 'undefined' || !chrome.identity) {
    throw new Error('chrome.identity API is not available.');
  }

  const trimmedId = typeof clientId === 'string' ? clientId.trim() : '';
  if (trimmedId) {
    const redirectUri = chrome.identity.getRedirectURL();
    const authUrl =
      'https://accounts.google.com/o/oauth2/v2/auth' +
      `?client_id=${encodeURIComponent(trimmedId)}` +
      '&response_type=token' +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(DRIVE_SCOPE)}`;

    const responseUrl = await chrome.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: Boolean(interactive),
    });
    if (!responseUrl) {
      throw new Error('Google Drive authentication was cancelled.');
    }
    const { token, error } = parseOAuthRedirectUrl(responseUrl);
    if (!token) {
      const err = error || 'Missing access_token in OAuth response.';
      throw new Error(`Google Drive OAuth failed: ${err}`);
    }
    return token;
  }

  // Fallback to chrome.identity.getAuthToken if configured in manifest.json
  if (typeof chrome.identity.getAuthToken !== 'function') {
    throw new Error(t('sync.gdriveClientIdRequired', lang));
  }
  try {
    const result = await chrome.identity.getAuthToken({ interactive: Boolean(interactive) });
    const token = typeof result === 'string' ? result : result?.token;
    if (!token) {
      throw new Error(t('sync.gdriveClientIdRequired', lang));
    }
    return token;
  } catch {
    throw new Error(t('sync.gdriveClientIdRequired', lang));
  }
}

/**
 * Find the existing TubeNook sync file in Google Drive's appDataFolder.
 * @param {string} token
 * @returns {Promise<{ id: string, name: string, modifiedTime?: string } | null>}
 */
async function findDriveSyncFile(token) {
  const query = `name='${DRIVE_BACKUP_FILENAME}' and trashed=false`;
  const url = `${DRIVE_FILES_API}?spaces=appDataFolder&q=${encodeURIComponent(query)}&fields=files(id,name,modifiedTime)`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Google Drive search failed (${res.status}): ${detail || res.statusText}`);
  }
  const data = await res.json();
  return Array.isArray(data?.files) && data.files.length > 0 ? data.files[0] : null;
}

/**
 * Push AppState JSON to Google Drive's hidden appDataFolder (`tubenook-sync.json`).
 * Updates existing file via PATCH or creates a new file via POST multipart upload.
 * @param {any} state
 * @param {string} token
 * @returns {Promise<{ ok: true, fileId: string, syncedAt: number }>}
 */
export async function pushToGoogleDrive(state, token) {
  if (!token) throw new Error('Google Drive access token is required.');
  const jsonBody = JSON.stringify(state);
  const existing = await findDriveSyncFile(token);

  let res;
  if (existing?.id) {
    res = await fetch(`${DRIVE_UPLOAD_API}/${encodeURIComponent(existing.id)}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: jsonBody,
    });
  } else {
    const boundary = `tubenook_boundary_${Date.now().toString(36)}`;
    const metadata = JSON.stringify({
      name: DRIVE_BACKUP_FILENAME,
      parents: ['appDataFolder'],
      mimeType: 'application/json',
    });
    const multipartBody =
      `--${boundary}\r\n` +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      `${metadata}\r\n` +
      `--${boundary}\r\n` +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      `${jsonBody}\r\n` +
      `--${boundary}--`;

    res = await fetch(`${DRIVE_UPLOAD_API}?uploadType=multipart`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Google Drive upload failed (${res.status}): ${detail || res.statusText}`);
  }

  const uploaded = await res.json().catch(() => ({}));
  return {
    ok: true,
    fileId: uploaded?.id || existing?.id || '',
    syncedAt: Date.now(),
  };
}

/**
 * Pull and parse `tubenook-sync.json` from Google Drive's appDataFolder.
 * @param {string} token
 * @returns {Promise<any | null>}
 */
export async function pullFromGoogleDrive(token) {
  if (!token) throw new Error('Google Drive access token is required.');
  const existing = await findDriveSyncFile(token);
  if (!existing?.id) return null;

  const res = await fetch(`${DRIVE_FILES_API}/${encodeURIComponent(existing.id)}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Google Drive download failed (${res.status}): ${detail || res.statusText}`);
  }
  return res.json();
}

/**
 * Revoke and remove a cached Google Drive OAuth token.
 * @param {string} [token]
 * @returns {Promise<{ ok: true }>}
 */
export async function disconnectGoogleDrive(token) {
  if (token) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
        method: 'POST',
      });
    } catch {
      // Ignore network errors during revoke
    }
    if (typeof chrome !== 'undefined' && chrome.identity?.removeCachedAuthToken) {
      try {
        await chrome.identity.removeCachedAuthToken({ token });
      } catch {
        // Ignore cache removal errors
      }
    }
  }
  return { ok: true };
}
