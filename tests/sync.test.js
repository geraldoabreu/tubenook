import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  chunkString,
  unchunkStrings,
  pushToChromeSync,
  pullFromChromeSync,
  pushToGoogleDrive,
  pullFromGoogleDrive,
} from '../src/shared/sync.js';
import {
  createMemoryBackend,
  setStorageBackend,
  upsertChannel,
  loadState,
  importStateJson,
} from '../src/shared/storage.js';
import { resolveChannelUcId } from '../src/background/service-worker.js';

/**
 * Create an in-memory mock compatible with chrome.storage.sync (get/set/remove).
 */
function createMockSyncArea() {
  const store = new Map();
  return {
    _store: store,
    async get(keys) {
      if (typeof keys === 'string') {
        return store.has(keys) ? { [keys]: structuredClone(store.get(keys)) } : {};
      }
      if (Array.isArray(keys)) {
        const out = {};
        for (const k of keys) {
          if (store.has(k)) out[k] = structuredClone(store.get(k));
        }
        return out;
      }
      const all = {};
      for (const [k, v] of store.entries()) {
        all[k] = structuredClone(v);
      }
      return all;
    },
    async set(obj) {
      for (const [k, v] of Object.entries(obj || {})) {
        store.set(k, structuredClone(v));
      }
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) {
        store.delete(k);
      }
    },
  };
}

describe('sync.js — Chrome Sync Chunking, Google Drive Sync & UCID Resolution', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setStorageBackend(createMemoryBackend());
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('chunkString & unchunkStrings', () => {
    it('round-trips UTF-8 Portuguese text and emojis without exceeding maxBytes per chunk', () => {
      const sample =
        'Inscrições, playlists personalizadas, vídeos assistidos, anotações rápidas — ação, coração, programação, café ☕🎬📁🔥! '.repeat(
          25
        );
      const maxBytes = 128;
      const chunks = chunkString(sample, maxBytes);
      assert.ok(chunks.length > 10, 'Expected multiple chunks');

      const encoder = new TextEncoder();
      for (const chunk of chunks) {
        assert.ok(
          encoder.encode(chunk).byteLength <= maxBytes,
          `Chunk exceeded ${maxBytes} UTF-8 bytes`
        );
      }

      const restored = unchunkStrings(chunks);
      assert.equal(restored, sample);
    });

    it('handles empty string and non-array inputs gracefully', () => {
      assert.deepEqual(chunkString(''), []);
      assert.equal(unchunkStrings([]), '');
      assert.equal(unchunkStrings(null), '');
    });
  });

  describe('pushToChromeSync & pullFromChromeSync', () => {
    it('pushes, pulls, and cleans up stale chunks when state shrinks', async () => {
      const syncArea = createMockSyncArea();

      // Empty sync area returns null
      assert.equal(await pullFromChromeSync(syncArea), null);

      // Push multi-chunk state
      const bigPayload = {
        groups: { g1: { id: 'g1', name: 'Educação & Programação 🇧🇷' } },
        notes: 'Conteúdo longo com acentuação: çãõéíóú '.repeat(450),
      };
      const pushRes = await pushToChromeSync(bigPayload, syncArea);
      assert.equal(pushRes.ok, true);
      assert.ok(pushRes.chunks >= 2, 'Expected multiple chunks for large payload');
      assert.ok(pushRes.bytes > 7000);

      const pulled = await pullFromChromeSync(syncArea);
      assert.deepEqual(pulled, bigPayload);

      // Push a much smaller state and verify stale chunks are removed
      const smallPayload = { groups: { g2: { id: 'g2', name: 'Small' } } };
      const smallRes = await pushToChromeSync(smallPayload, syncArea);
      assert.equal(smallRes.chunks, 1);
      assert.equal(syncArea._store.has('ps_sync_0'), true);
      assert.equal(syncArea._store.has('ps_sync_1'), false);

      const pulledSmall = await pullFromChromeSync(syncArea);
      assert.deepEqual(pulledSmall, smallPayload);
    });

    it('rejects payloads exceeding the 95 KB Chrome Sync quota guard', async () => {
      const syncArea = createMockSyncArea();
      const hugeState = {
        blob: 'a'.repeat(96 * 1024),
      };
      await assert.rejects(
        () => pushToChromeSync(hugeState, syncArea),
        /exceeds Chrome Sync's 95 KB/i
      );
    });
  });

  describe('pushToGoogleDrive & pullFromGoogleDrive', () => {
    it('creates a new file via POST multipart upload when no existing backup is found', async () => {
      const calls = [];
      globalThis.fetch = async (url, init = {}) => {
        calls.push({ url: String(url), init });
        if (String(url).includes('/drive/v3/files?spaces=appDataFolder')) {
          return {
            ok: true,
            status: 200,
            async json() {
              return { files: [] };
            },
          };
        }
        if (String(url).includes('/upload/drive/v3/files?uploadType=multipart')) {
          return {
            ok: true,
            status: 200,
            async json() {
              return { id: 'drv_file_new_123' };
            },
          };
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      };

      const state = { groups: { g1: { name: 'Tech' } }, channels: {} };
      const res = await pushToGoogleDrive(state, 'mock_token_1');
      assert.equal(res.ok, true);
      assert.equal(res.fileId, 'drv_file_new_123');
      assert.equal(calls.length, 2);
      assert.equal(calls[1].init.method, 'POST');
      assert.match(calls[1].init.headers['Content-Type'], /^multipart\/related; boundary=/);
      assert.ok(String(calls[1].init.body).includes('tubenook-sync.json'));
      assert.ok(String(calls[1].init.body).includes('"appDataFolder"'));
      assert.ok(String(calls[1].init.body).includes('"Tech"'));
    });

    it('updates an existing file via PATCH when a backup already exists in appDataFolder', async () => {
      const calls = [];
      globalThis.fetch = async (url, init = {}) => {
        calls.push({ url: String(url), init });
        if (String(url).includes('/drive/v3/files?spaces=appDataFolder')) {
          return {
            ok: true,
            status: 200,
            async json() {
              return { files: [{ id: 'drv_existing_99', name: 'tubenook-sync.json' }] };
            },
          };
        }
        if (String(url).includes('/upload/drive/v3/files/drv_existing_99?uploadType=media')) {
          return {
            ok: true,
            status: 200,
            async json() {
              return { id: 'drv_existing_99' };
            },
          };
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      };

      const state = { groups: { g2: { name: 'Music' } } };
      const res = await pushToGoogleDrive(state, 'mock_token_2');
      assert.equal(res.ok, true);
      assert.equal(res.fileId, 'drv_existing_99');
      assert.equal(calls.length, 2);
      assert.equal(calls[1].init.method, 'PATCH');
      assert.equal(JSON.parse(calls[1].init.body).groups.g2.name, 'Music');
    });

    it('pulls and parses JSON backup from Google Drive, or returns null when absent', async () => {
      const remoteData = { groups: { g3: { name: 'Saved on Drive' } }, watched: { v1: { videoId: 'v1' } } };
      let hasFile = true;

      globalThis.fetch = async (url) => {
        if (String(url).includes('/drive/v3/files?spaces=appDataFolder')) {
          return {
            ok: true,
            status: 200,
            async json() {
              return { files: hasFile ? [{ id: 'drv_pull_7', name: 'tubenook-sync.json' }] : [] };
            },
          };
        }
        if (String(url).includes('/drive/v3/files/drv_pull_7?alt=media')) {
          return {
            ok: true,
            status: 200,
            async json() {
              return remoteData;
            },
          };
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      };

      const pulled = await pullFromGoogleDrive('mock_token_3');
      assert.deepEqual(pulled, remoteData);

      hasFile = false;
      const missing = await pullFromGoogleDrive('mock_token_3');
      assert.equal(missing, null);
    });

    it('round-trips settings (language, focusMode, statusConfig) through Google Drive, Chrome Sync, and importStateJson', async () => {
      const richState = {
        schemaVersion: 3,
        groups: { g_sync: { id: 'g_sync', name: 'Synced Group', kind: 'subscription' } },
        channels: {},
        playlists: {},
        watched: {},
        settings: {
          language: 'es',
          focusMode: true,
          statusConfig: {
            activeDays: 14,
            inactiveDays: 120,
            newUploadsDays: 5,
          },
          sync: {
            provider: 'gdrive',
            autoSync: true,
            gdriveClientId: 'remote-client-id.apps.googleusercontent.com',
          },
        },
      };

      // 1. Round-trip through Chrome Sync + importStateJson
      const syncArea = createMockSyncArea();
      const csPush = await pushToChromeSync(richState, syncArea);
      assert.equal(csPush.ok, true);

      const csPulled = await pullFromChromeSync(syncArea);
      assert.equal(csPulled.settings.language, 'es');
      assert.equal(csPulled.settings.focusMode, true);
      assert.deepEqual(csPulled.settings.statusConfig, richState.settings.statusConfig);

      const importedFromChromeSync = await importStateJson(JSON.stringify(csPulled), { merge: true });
      assert.equal(importedFromChromeSync.settings.language, 'es');
      assert.equal(importedFromChromeSync.settings.focusMode, true);
      assert.equal(importedFromChromeSync.settings.statusConfig.activeDays, 14);
      assert.equal(importedFromChromeSync.settings.statusConfig.inactiveDays, 120);
      assert.equal(importedFromChromeSync.settings.statusConfig.newUploadsDays, 5);

      // 2. Round-trip through Google Drive + importStateJson
      let uploadedJson = null;
      globalThis.fetch = async (url, init = {}) => {
        const u = String(url);
        if (u.includes('/drive/v3/files?spaces=appDataFolder')) {
          return {
            ok: true,
            status: 200,
            async json() {
              return { files: uploadedJson ? [{ id: 'drv_settings_1', name: 'tubenook-sync.json' }] : [] };
            },
          };
        }
        if (u.includes('/upload/drive/v3/files?uploadType=multipart')) {
          const bodyStr = String(init.body);
          const parts = bodyStr.split('\r\n\r\n');
          // Last part before closing boundary holds the JSON payload
          const rawPart = parts[parts.length - 1];
          uploadedJson = rawPart.split('\r\n--')[0].trim();
          return {
            ok: true,
            status: 200,
            async json() {
              return { id: 'drv_settings_1' };
            },
          };
        }
        if (u.includes('/drive/v3/files/drv_settings_1?alt=media')) {
          return {
            ok: true,
            status: 200,
            async json() {
              return JSON.parse(uploadedJson);
            },
          };
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      };

      const driveState = {
        ...richState,
        settings: {
          ...richState.settings,
          language: 'pt-PT',
          focusMode: true,
          statusConfig: {
            activeDays: 21,
            inactiveDays: 180,
            newUploadsDays: 3,
          },
        },
      };

      const drvPush = await pushToGoogleDrive(driveState, 'mock_token_settings');
      assert.equal(drvPush.ok, true);
      assert.ok(uploadedJson, 'Expected multipart upload to contain serialized state');

      const drvPulled = await pullFromGoogleDrive('mock_token_settings');
      assert.equal(drvPulled.settings.language, 'pt-PT');
      assert.equal(drvPulled.settings.focusMode, true);
      assert.deepEqual(drvPulled.settings.statusConfig, driveState.settings.statusConfig);

      const importedFromDrive = await importStateJson(JSON.stringify(drvPulled), { merge: true });
      assert.equal(importedFromDrive.settings.language, 'pt-PT');
      assert.equal(importedFromDrive.settings.focusMode, true);
      assert.equal(importedFromDrive.settings.statusConfig.activeDays, 21);
      assert.equal(importedFromDrive.settings.statusConfig.inactiveDays, 180);
      assert.equal(importedFromDrive.settings.statusConfig.newUploadsDays, 3);
    });
  });

  describe('resolveChannelUcId (service-worker.js)', () => {
    it('extracts externalId from YouTube handle HTML, persists ucId to storage, and caches result', async () => {
      let fetchCalls = 0;
      const expectedUc = 'UC1234567890ABCDEFGHIJKL';

      globalThis.fetch = async (url) => {
        fetchCalls++;
        assert.equal(String(url), 'https://www.youtube.com/@PlayShelfTestHandle1');
        return {
          ok: true,
          status: 200,
          async text() {
            return `<html><script>var ytInitialData = {"metadata":{"channelMetadataRenderer":{"externalId":"${expectedUc}"}}};</script></html>`;
          },
        };
      };

      await upsertChannel({
        id: '@PlayShelfTestHandle1',
        handle: '@PlayShelfTestHandle1',
        title: 'Test Handle 1',
      });

      const resolved1 = await resolveChannelUcId({
        id: '@PlayShelfTestHandle1',
        handle: '@PlayShelfTestHandle1',
      });
      assert.equal(resolved1, expectedUc);
      assert.equal(fetchCalls, 1);

      // Verify ucId persisted into storage state
      const state = await loadState();
      assert.equal(state.channels['@PlayShelfTestHandle1'].ucId, expectedUc);

      // Second call hits in-memory cache without another fetch
      const resolved2 = await resolveChannelUcId({
        id: '@PlayShelfTestHandle1',
        handle: '@PlayShelfTestHandle1',
      });
      assert.equal(resolved2, expectedUc);
      assert.equal(fetchCalls, 1);
    });

    it('extracts channelId from HTML when externalId is absent and returns UC id directly when already present', async () => {
      const expectedUc = 'UCZYXWVUTSRQPONMLKJIHGFE';

      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        async text() {
          return `<html><body>{"channelId":"${expectedUc}"}</body></html>`;
        },
      });

      const direct = await resolveChannelUcId({ id: 'UC_ALREADY_CANONICAL_12345' });
      assert.equal(direct, 'UC_ALREADY_CANONICAL_12345');

      const fromHtml = await resolveChannelUcId({
        id: '@PlayShelfTestHandle2',
        handle: '@PlayShelfTestHandle2',
      });
      assert.equal(fromHtml, expectedUc);
    });
  });
});
