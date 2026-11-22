import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  ICON_CATALOG,
  getIconCategories,
  searchIcons,
  renderIconHtml,
} from '../src/shared/icons.js';
import { TRANSLATIONS, t } from '../src/shared/i18n.js';
import { parseYouTubeAtomFeed, handleMessage } from '../src/background/service-worker.js';
import { createMemoryBackend, setStorageBackend } from '../src/shared/storage.js';
import { MESSAGE_ACTIONS } from '../src/shared/types.js';

describe('icons.js — Search & XSS Safety', () => {
  it('has 90+ categorized icons and supports PT-BR & EN keyword search', () => {
    assert.ok(ICON_CATALOG.length >= 90, `Expected >= 90 icons, got ${ICON_CATALOG.length}`);
    assert.ok(getIconCategories().length >= 8);

    // PT-BR queries (with accents)
    assert.ok(searchIcons('programação').length > 0);
    assert.ok(searchIcons('música').length > 0);
    assert.ok(searchIcons('finanças').length > 0);
    assert.ok(searchIcons('culinária').length > 0);

    // EN queries
    assert.ok(searchIcons('coding').length > 0);
    assert.ok(searchIcons('music').length > 0);
    assert.ok(searchIcons('finance').length > 0);
    assert.ok(searchIcons('cooking').length > 0);

    // Category filter
    const gamingIcons = searchIcons('', 'gaming');
    assert.ok(gamingIcons.length > 0);
    assert.ok(gamingIcons.every((i) => i.category === 'gaming'));

    // Combined query + category
    const techRobot = searchIcons('robot', 'tech');
    assert.ok(techRobot.some((i) => i.id === 'emo-robot'));
    assert.equal(searchIcons('robot', 'gaming').length, 0);
  });

  it('renders valid emoji, SVG, custom data:image URLs, and fallbacks safely', () => {
    const fallback = renderIconHtml(null, 20);
    assert.ok(fallback.includes('📁'));

    const emoji = renderIconHtml({ type: 'emoji', value: '🚀' }, 18);
    assert.ok(emoji.includes('🚀'));

    const svgEntry = ICON_CATALOG.find((i) => i.type === 'svg');
    const svgHtml = renderIconHtml({ type: 'svg', value: svgEntry.value }, 18);
    assert.ok(svgHtml.includes('<svg'));

    const custom = renderIconHtml({ type: 'custom', value: 'data:image/png;base64,iVBORw0KGgo=' }, 24);
    assert.ok(custom.includes('<img'));
    assert.ok(custom.includes('data:image/png;base64,iVBORw0KGgo='));
  });

  it('prevents XSS in renderIconHtml across emoji, custom, and svg icon types', () => {
    // Emoji XSS payload must be escaped
    const emojiXss = renderIconHtml({ type: 'emoji', value: '<img src=x onerror=alert(1)>' });
    assert.ok(!emojiXss.includes('<img'), 'Emoji HTML injection was not escaped');
    assert.ok(emojiXss.includes('&lt;img'));

    // Custom javascript: URL must be rejected
    const jsUrl = renderIconHtml({ type: 'custom', value: 'javascript:alert(1)' });
    assert.ok(!jsUrl.includes('javascript:'), 'javascript: URL was not blocked');
    assert.ok(jsUrl.includes('📁'));

    // Custom attribute breakout must be escaped
    const attrBreakout = renderIconHtml({ type: 'custom', value: 'data:image/png;base64,abc" onerror="alert(1)' });
    assert.ok(!attrBreakout.includes('" onerror="'), 'Attribute breakout was not escaped');

    // SVG XSS payload must NOT allow <script> or event handlers (onload/onerror/etc.)
    const svgScript = renderIconHtml({
      type: 'svg',
      value: '<svg onload="alert(1)"><script>alert(1)</script><path d="M0 0"/></svg>',
    });
    assert.ok(!/<script/i.test(svgScript), 'SVG <script> tag was not sanitized/blocked');
    assert.ok(!/\bonload\s*=/i.test(svgScript), 'SVG onload event handler was not sanitized/blocked');
  });
});

describe('i18n.js — Completeness & Interpolation (4 Locales)', () => {
  const LOCALES = ['pt-BR', 'pt-PT', 'en', 'es'];

  it('has identical key sets across pt-BR, pt-PT, en, and es with no empty strings', () => {
    for (const locale of LOCALES) {
      assert.ok(TRANSLATIONS[locale], `Missing locale dictionary: ${locale}`);
    }

    const baseKeys = Object.keys(TRANSLATIONS['pt-BR']).sort();
    assert.ok(baseKeys.length > 0, 'Expected non-empty translation dictionary');

    for (const locale of LOCALES) {
      const localeKeys = Object.keys(TRANSLATIONS[locale]).sort();
      const missingInLocale = baseKeys.filter((k) => !(k in TRANSLATIONS[locale]));
      const extraInLocale = localeKeys.filter((k) => !(k in TRANSLATIONS['pt-BR']));

      assert.deepEqual(
        missingInLocale,
        [],
        `Keys missing in ${locale}: ${missingInLocale.join(', ')}`
      );
      assert.deepEqual(
        extraInLocale,
        [],
        `Extra keys in ${locale} not in pt-BR: ${extraInLocale.join(', ')}`
      );

      for (const k of baseKeys) {
        assert.equal(typeof TRANSLATIONS[locale][k], 'string', `Non-string ${locale} translation for ${k}`);
        assert.ok(
          TRANSLATIONS[locale][k].trim().length > 0,
          `Empty ${locale} translation for ${k}`
        );
      }
    }
  });

  it('interpolates parameters across all 4 locales and falls back gracefully', () => {
    assert.equal(t('group.channelsCount', 'en', { count: 12 }), '12 channels');
    assert.equal(t('group.channelsCount', 'pt-BR', { count: 12 }), '12 canais');
    assert.equal(t('group.channelsCount', 'pt-PT', { count: 12 }), '12 canais');
    assert.equal(t('group.channelsCount', 'es', { count: 12 }), '12 canales');
    assert.equal(t('group.deleteConfirm', 'en', { name: 'Tech' }), 'Delete group "Tech"?');
    assert.equal(t('non.existent.key', 'en'), 'non.existent.key');
  });
});

describe('service-worker.js — parseYouTubeAtomFeed & handleMessage', () => {
  const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <yt:channelId>UC_FEED_123</yt:channelId>
  <title>Feed Channel Name</title>
  <entry>
    <yt:videoId>vid_abc123</yt:videoId>
    <yt:channelId>UC_FEED_123</yt:channelId>
    <title>Building &amp; Testing &quot;Extensions&quot; in 2026</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=vid_abc123"/>
    <author>
      <name>Dev Channel</name>
    </author>
    <published>2026-05-10T15:30:00+00:00</published>
    <media:group>
      <media:thumbnail url="https://i1.ytimg.com/vi/vid_abc123/hqdefault.jpg" width="480" height="360"/>
      <media:community>
        <media:statistics views="42500"/>
      </media:community>
    </media:group>
  </entry>
  <entry>
    <yt:videoId>vid_short1</yt:videoId>
    <title>Quick Tip #Shorts</title>
    <link rel="alternate" href="https://www.youtube.com/shorts/vid_short1"/>
    <updated>2026-05-11T10:00:00+00:00</updated>
  </entry>
</feed>`;

  it('parses YouTube Atom XML entries, decodes entities, and detects Shorts', () => {
    const entries = parseYouTubeAtomFeed(sampleXml);
    assert.equal(entries.length, 2);

    const first = entries[0];
    assert.equal(first.videoId, 'vid_abc123');
    assert.equal(first.channelId, 'UC_FEED_123');
    assert.equal(first.channelTitle, 'Dev Channel');
    assert.equal(first.title, 'Building & Testing "Extensions" in 2026');
    assert.equal(first.url, 'https://www.youtube.com/watch?v=vid_abc123');
    assert.equal(first.thumbnailUrl, 'https://i1.ytimg.com/vi/vid_abc123/hqdefault.jpg');
    assert.equal(first.views, 42500);
    assert.equal(first.publishedAt, Date.parse('2026-05-10T15:30:00+00:00'));
    assert.equal(first.isShort, false);

    const second = entries[1];
    assert.equal(second.videoId, 'vid_short1');
    assert.equal(second.channelId, 'UC_FEED_123'); // fallback to feed-level channelId
    assert.equal(second.channelTitle, 'Feed Channel Name'); // fallback to feed-level title
    assert.equal(second.thumbnailUrl, 'https://i.ytimg.com/vi/vid_short1/hqdefault.jpg');
    assert.equal(second.views, 0);
    assert.equal(second.isShort, true);
  });

  it('returns empty array on empty or invalid XML', () => {
    assert.deepEqual(parseYouTubeAtomFeed(''), []);
    assert.deepEqual(parseYouTubeAtomFeed(null), []);
    assert.deepEqual(parseYouTubeAtomFeed('<feed><entry><title>No videoId</title></entry></feed>'), []);
  });

  describe('handleMessage integration', () => {
    beforeEach(() => {
      setStorageBackend(createMemoryBackend());
    });

    it('handles GET_STATE, CREATE_GROUP, EXPORT_DATA, and unknown actions', async () => {
      const res1 = await handleMessage({ action: MESSAGE_ACTIONS.GET_STATE });
      assert.equal(res1.ok, true);
      assert.ok(res1.state);

      const res2 = await handleMessage({
        action: MESSAGE_ACTIONS.CREATE_GROUP,
        group: { name: 'SW Group', kind: 'subscription' },
      });
      assert.equal(res2.ok, true);
      assert.equal(res2.group.name, 'SW Group');

      const res3 = await handleMessage({ action: MESSAGE_ACTIONS.EXPORT_DATA });
      assert.equal(res3.ok, true);
      assert.ok(res3.json.includes('SW Group'));

      const bad = await handleMessage({ action: 'UNKNOWN_ACTION' });
      assert.equal(bad.ok, false);
      assert.ok(bad.error);
    });
  });
});
