import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CHANNEL_STATUSES, DEFAULT_STATUS_CONFIG } from '../src/shared/types.js';
import {
  normalizeText,
  computeAutoTags,
  tagAllChannels,
  filterChannelsByTags,
  computeChannelStatus,
  refreshChannelStatuses,
  getAllUniqueTags,
} from '../src/shared/auto-tagger.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('auto-tagger.js — Bilingual Auto-Tagging, Tag Filtering, Channel Status', () => {
  describe('normalizeText', () => {
    it('removes diacritics and lowercases text', () => {
      assert.equal(normalizeText('Programação & Inteligência Artificial'), 'programacao & inteligencia artificial');
      assert.equal(normalizeText('Finanças — Ações'), 'financas — acoes');
      assert.equal(normalizeText(''), '');
      assert.equal(normalizeText(null), '');
    });
  });

  describe('computeAutoTags (PT-BR & EN)', () => {
    it('tags PT-BR channels accurately across categories', () => {
      assert.ok(computeAutoTags({ title: 'Curso de Programação e Código Fonte' }).includes('AI & Dev'));
      assert.ok(computeAutoTags({ title: 'Receitas de Culinária e Churrasco' }).includes('Cooking'));
      assert.ok(computeAutoTags({ title: 'Finanças Pessoais e Investimentos na Bolsa' }).includes('Finance'));
      assert.ok(computeAutoTags({ title: 'Notícias e Jornalismo do Dia' }).includes('News'));
      assert.ok(computeAutoTags({ title: 'Futebol e Esportes Brasileirão' }).includes('Sports'));
      assert.ok(computeAutoTags({ title: 'Ciência Todo Dia — Astronomia e Espaço' }).includes('Science'));
      assert.ok(computeAutoTags({ title: 'Treino de Musculação na Academia' }).includes('Fitness'));
      assert.ok(computeAutoTags({ title: 'Cortes do Podcast Entrevista' }).includes('Podcasts'));
    });

    it('tags EN channels accurately across categories', () => {
      assert.ok(computeAutoTags({ title: 'Python & Machine Learning Coding' }).includes('AI & Dev'));
      assert.ok(computeAutoTags({ title: 'Smartphone Hardware Tech Review' }).includes('Tech'));
      assert.ok(computeAutoTags({ title: 'RPG Gameplay & Speedrun Gaming' }).includes('Gaming'));
      assert.ok(computeAutoTags({ title: 'Lo-Fi Guitar Music Beats' }).includes('Music'));
      assert.ok(computeAutoTags({ title: 'UI & UX Figma Design Tutorials' }).includes('Design'));
      assert.ok(computeAutoTags({ title: 'Backpacker Travel & Adventure' }).includes('Travel'));
    });

    it('respects token boundaries for short keywords (<=3 chars)', () => {
      // "ia" should match standalone "IA" but not inside "piano" or "historia"
      const pianoTags = computeAutoTags({ title: 'Piano Classical Sessions' });
      assert.ok(pianoTags.includes('Music'));
      assert.ok(!pianoTags.includes('AI & Dev'));

      const iaTags = computeAutoTags({ title: 'Canal de IA na Prática' });
      assert.ok(iaTags.includes('AI & Dev'));

      // "ui"/"ux" should not match "fruit"
      const fruitTags = computeAutoTags({ title: 'Fresh Fruit Market' });
      assert.ok(!fruitTags.includes('Design'));
    });

    it('supports extraText and multi-category tagging', () => {
      const tags = computeAutoTags(
        { title: 'Fireship', handle: '@fireship' },
        'podcast tech hardware review'
      );
      assert.ok(tags.includes('AI & Dev'));
      assert.ok(tags.includes('Tech'));
      assert.ok(tags.includes('Podcasts'));
    });

    it('tagAllChannels and getAllUniqueTags aggregate manual and auto tags', () => {
      const channels = {
        c1: { id: 'c1', title: 'Python Coding', tags: ['Favorite', 'AI & Dev'], autoTags: [] },
        c2: { id: 'c2', title: 'Rust Programming', tags: ['Favorite'], autoTags: [] },
      };
      const tagged = tagAllChannels(channels);
      assert.ok(tagged.c1.autoTags.includes('AI & Dev'));
      assert.ok(tagged.c2.autoTags.includes('AI & Dev'));

      const unique = getAllUniqueTags(tagged);
      const fav = unique.find((u) => u.tag === 'Favorite');
      const aiDev = unique.find((u) => u.tag === 'AI & Dev');
      assert.equal(fav.count, 2);
      assert.equal(fav.isAuto, false);
      // c1 has AI & Dev as manual tag, c2 as auto tag -> count 2, isAuto false
      assert.equal(aiDev.count, 2);
      assert.equal(aiDev.isAuto, false);
    });
  });

  describe('filterChannelsByTags (includeAll, includeAny, exclude)', () => {
    const sampleChannels = [
      { id: '1', title: 'A', tags: ['Dev', 'PT-BR'], autoTags: ['AI & Dev', 'Tech'] },
      { id: '2', title: 'B', tags: ['Dev', 'EN'], autoTags: ['AI & Dev'] },
      { id: '3', title: 'C', tags: ['PT-BR'], autoTags: ['Gaming', 'Entertainment'] },
      { id: '4', title: 'D', tags: ['EN', 'Favoritos'], autoTags: ['Music', 'Tech'] },
    ];

    it('returns all channels when query is empty', () => {
      assert.equal(filterChannelsByTags(sampleChannels, {}).length, 4);
    });

    it('filters with includeAll (AND) across unlimited tags', () => {
      const res = filterChannelsByTags(sampleChannels, {
        includeAll: ['dev', 'ai & dev', 'pt-br'],
      });
      assert.deepEqual(res.map((c) => c.id), ['1']);
    });

    it('filters with includeAny (OR)', () => {
      const res = filterChannelsByTags(sampleChannels, {
        includeAny: ['Gaming', 'Music'],
      });
      assert.deepEqual(res.map((c) => c.id), ['3', '4']);
    });

    it('filters with exclude (NOT)', () => {
      const res = filterChannelsByTags(sampleChannels, {
        exclude: ['Gaming', 'Music'],
      });
      assert.deepEqual(res.map((c) => c.id), ['1', '2']);
    });

    it('combines includeAll + includeAny + exclude together', () => {
      const res = filterChannelsByTags(sampleChannels, {
        includeAll: ['Tech'],
        includeAny: ['PT-BR', 'EN'],
        exclude: ['Music'],
      });
      assert.deepEqual(res.map((c) => c.id), ['1']);
    });
  });

  describe('computeChannelStatus & refreshChannelStatuses', () => {
    const now = Date.UTC(2026, 5, 1, 0, 0, 0);

    it('computes active, slow, inactive, dead with default config (14, 60, 180)', () => {
      assert.equal(computeChannelStatus(now, DEFAULT_STATUS_CONFIG, now), CHANNEL_STATUSES.ACTIVE);
      assert.equal(computeChannelStatus(now - 14 * DAY_MS, DEFAULT_STATUS_CONFIG, now), CHANNEL_STATUSES.ACTIVE);
      assert.equal(computeChannelStatus(now - 15 * DAY_MS, DEFAULT_STATUS_CONFIG, now), CHANNEL_STATUSES.SLOW);
      assert.equal(computeChannelStatus(now - 60 * DAY_MS, DEFAULT_STATUS_CONFIG, now), CHANNEL_STATUSES.SLOW);
      assert.equal(computeChannelStatus(now - 61 * DAY_MS, DEFAULT_STATUS_CONFIG, now), CHANNEL_STATUSES.INACTIVE);
      assert.equal(computeChannelStatus(now - 180 * DAY_MS, DEFAULT_STATUS_CONFIG, now), CHANNEL_STATUSES.INACTIVE);
      assert.equal(computeChannelStatus(now - 181 * DAY_MS, DEFAULT_STATUS_CONFIG, now), CHANNEL_STATUSES.DEAD);
      assert.equal(computeChannelStatus(null, DEFAULT_STATUS_CONFIG, now), CHANNEL_STATUSES.INACTIVE);
      assert.equal(computeChannelStatus(undefined, DEFAULT_STATUS_CONFIG, now), CHANNEL_STATUSES.INACTIVE);
    });

    it('respects custom ChannelStatusConfig thresholds', () => {
      const custom = { activeDays: 7, slowDays: 30, inactiveDays: 90 };
      assert.equal(computeChannelStatus(now - 7 * DAY_MS, custom, now), CHANNEL_STATUSES.ACTIVE);
      assert.equal(computeChannelStatus(now - 8 * DAY_MS, custom, now), CHANNEL_STATUSES.SLOW);
      assert.equal(computeChannelStatus(now - 31 * DAY_MS, custom, now), CHANNEL_STATUSES.INACTIVE);
      assert.equal(computeChannelStatus(now - 91 * DAY_MS, custom, now), CHANNEL_STATUSES.DEAD);
    });

    it('refreshChannelStatuses updates all channels in a map', () => {
      const custom = { activeDays: 5, slowDays: 20, inactiveDays: 50 };
      const map = {
        a: { id: 'a', lastVideoAt: now - 2 * DAY_MS, status: 'dead' },
        b: { id: 'b', lastVideoAt: now - 10 * DAY_MS, status: 'dead' },
        c: { id: 'c', lastVideoAt: now - 60 * DAY_MS, status: 'active' },
      };
      const refreshed = refreshChannelStatuses(map, custom, now);
      assert.equal(refreshed.a.status, CHANNEL_STATUSES.ACTIVE);
      assert.equal(refreshed.b.status, CHANNEL_STATUSES.SLOW);
      assert.equal(refreshed.c.status, CHANNEL_STATUSES.DEAD);
    });
  });
});
