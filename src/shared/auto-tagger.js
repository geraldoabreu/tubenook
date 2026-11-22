/**
 * @fileoverview Automatic channel tagging engine & flexible channel activity status calculator.
 */

import { CHANNEL_STATUSES, DEFAULT_STATUS_CONFIG } from './types.js';

/**
 * Normalize text for accent-insensitive, case-insensitive matching.
 * @param {string} text
 * @returns {string}
 */
export function normalizeText(text) {
  if (!text) return '';
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Topic classification rules (bilingual PT-BR + EN).
 * @type {Array<{ tag: string, keywords: string[] }>}
 */
export const TOPIC_RULES = [
  {
    tag: 'AI & Dev',
    keywords: [
      'coding', 'programming', 'developer', 'devops', 'software', 'javascript',
      'typescript', 'python', 'rust', 'golang', 'react', 'nextjs', 'nodejs',
      'programacao', 'desenvolvedor', 'codigo', 'algoritmo', 'inteligencia artificial',
      'machine learning', 'deep learning', 'llm', 'openai', 'chatgpt', 'claude',
      'gemini', 'github', 'linux', 'docker', 'kubernetes', 'frontend', 'backend',
      'fullstack', 'webdev', 'fireship', 'rocketseat', 'filipe deschamps',
      'codigo fonte', 'curso em video', 'fabio akita', 'guanabara', 'ia ',
    ],
  },
  {
    tag: 'Tech',
    keywords: [
      'tech', 'tecnologia', 'hardware', 'smartphone', 'iphone', 'android',
      'samsung', 'apple', 'review', 'unboxing', 'gadget', 'notebook', 'laptop',
      'gpu', 'nvidia', 'amd', 'intel', 'pc build', 'setup', 'teclado', 'monitor',
      'mkbhd', 'linus', 'canaltech', 'tecmundo', 'adrenaline', 'coisa de nerd',
      'diolinux', 'mw informatica', 'loop infinito', 'be tech', 'escolhasegura',
    ],
  },
  {
    tag: 'Gaming',
    keywords: [
      'gaming', 'gamer', 'gameplay', 'games', 'jogos', 'playstation', 'xbox',
      'nintendo', 'steam', 'esports', 'speedrun', 'minecraft', 'fortnite',
      'valorant', 'league of legends', 'csgo', 'cs2', 'gta', 'zelda', 'rpg',
      'fps', 'mmorpg', 'twitch', 'alanzoka', 'brksedu', 'funkyblackcat',
      'zangado', 'nautilus', 'ign', 'gamespot', 'dunkey', 'cellbit', 'jazzghost',
    ],
  },
  {
    tag: 'Music',
    keywords: [
      'music', 'musica', 'official video', 'vevo', 'records', 'beats', 'lofi',
      'lo-fi', 'guitar', 'guitarra', 'piano', 'bateria', 'drums', 'hip hop',
      'rap', 'rock', 'metal', 'jazz', 'eletronica', 'dj', 'remix', 'cover',
      'cifra', 'violao', 'producao musical', 'ableton', 'fl studio', 'soundtrack',
      'orchestra', 'spotify', 'trap', 'sertanejo', 'mpb', 'bossa', 'acoustic',
    ],
  },
  {
    tag: 'Education',
    keywords: [
      'education', 'educacao', 'aula', 'aulas', 'curso', 'tutorial', 'enem',
      'vestibular', 'matematica', 'math', 'fisica', 'physics', 'quimica',
      'chemistry', 'historia', 'history', 'geografia', 'biologia', 'ingles',
      'english', 'idiomas', 'languages', 'study', 'estudo', 'concurso',
      'khan academy', 'ted-ed', 'crashcourse', 'veritasium', '3blue1brown',
      'descomplica', 'me salva', 'proenem', 'professor', 'universidade', 'mit',
    ],
  },
  {
    tag: 'Science',
    keywords: [
      'science', 'ciencia', 'astronomia', 'astronomy', 'espaco', 'space', 'nasa',
      'spacex', 'universo', 'universe', 'quantum', 'quantica', 'neurociencia',
      'neuroscience', 'biologia', 'evolucao', 'kurzgesagt', 'minutephysics',
      'ciencia todo dia', 'space today', 'sergio sacani', 'schwarza', 'atila',
      'nerdologia', 'ponto em comum', 'manual do mundo', 'mark rober', 'smartereveryday',
    ],
  },
  {
    tag: 'Finance',
    keywords: [
      'finance', 'financas', 'investimentos', 'investing', 'bolsa', 'acoes',
      'stocks', 'crypto', 'cripto', 'bitcoin', 'economia', 'economy', 'dinheiro',
      'money', 'renda fixa', 'fii', 'dividendos', 'trading', 'empreendedorismo',
      'business', 'negocios', 'marketing', 'primo rico', 'me poupe', 'nathalia arcuri',
      'bruno perini', 'economista sincero', 'graham stephan', 'andrei jikh', 'patrimonio',
    ],
  },
  {
    tag: 'News',
    keywords: [
      'news', 'noticias', 'jornal', 'jornalismo', 'cnn', 'bbc', 'globo', 'g1',
      'uol', 'folha', 'estadao', 'jovem pan', 'band', 'sbt', 'record', 'reuters',
      'bloomberg', 'cnbc', 'politica', 'politics', 'atualidades', 'reportagem',
      'breaking', 'imprensa', 'diario', 'meteoro', 'galas feios', 'mynews',
    ],
  },
  {
    tag: 'Podcasts',
    keywords: [
      'podcast', 'cortes', 'clips', 'entrevista', 'interview', 'bate-papo',
      'flow', 'podpah', 'inteligencia ltda', 'venus', 'a deriva', 'joe rogan',
      'lex fridman', 'huberman', 'diary of a ceo', 'talk show', 'mesacast',
      'ciencia sem fim', 'desce a letra', 'jovem nerd', 'nerdcast',
    ],
  },
  {
    tag: 'Design',
    keywords: [
      'design', 'ui', 'ux', 'figma', 'photoshop', 'illustrator', 'after effects',
      'premiere', 'blender', '3d', 'motion', 'animacao', 'animation', 'ilustracao',
      'illustration', 'desenho', 'drawing', 'art', 'arte', 'fotografia',
      'photography', 'edicao', 'video editing', 'davinci', 'arquitetura', 'branding',
    ],
  },
  {
    tag: 'Cinema & TV',
    keywords: [
      'cinema', 'filmes', 'movies', 'series', 'netflix', 'hbo', 'disney',
      'anime', 'manga', 'marvel', 'dc', 'star wars', 'trailer', 'critica',
      'resenha', 'omelete', 'ei nerd', 'pipocando', 'refugio cult', 'gaveta',
      'quadrinhos', 'comics', 'otaku', 'crunchyroll', 'cinefilo', 'review filme',
    ],
  },
  {
    tag: 'Fitness',
    keywords: [
      'fitness', 'treino', 'workout', 'academia', 'gym', 'musculacao', 'crossfit',
      'calistenia', 'calisthenics', 'corrida', 'running', 'saude', 'health',
      'nutricao', 'nutrition', 'dieta', 'diet', 'yoga', 'pilates', 'bodybuilding',
      'maromba', 'renato cariani', 'paulo muzy', 'leandro twin', 'athlean-x', 'jeff nippard',
    ],
  },
  {
    tag: 'Cooking',
    keywords: [
      'cooking', 'culinaria', 'receita', 'receitas', 'recipe', 'recipes', 'chef',
      'cozinha', 'kitchen', 'churrasco', 'bbq', 'gastronomia', 'comida', 'food',
      'baking', 'confeitaria', 'paola carosella', 'mohamad hindi', 'panelinha',
      'rita lobo', 'masterchef', 'babish', 'joshua weissman', 'gordon ramsay',
    ],
  },
  {
    tag: 'Sports',
    keywords: [
      'sports', 'esporte', 'esportes', 'futebol', 'football', 'soccer', 'nba',
      'basketball', 'basquete', 'f1', 'formula 1', 'ufc', 'mma', 'tenis', 'tennis',
      'volei', 'olympics', 'espn', 'caze', 'cazetv', 'ge ', 'tnt sports', 'desimpedidos',
      'campeonato', 'brasileirao', 'champions', 'nfl', 'skate', 'surf',
    ],
  },
  {
    tag: 'Cars & Moto',
    keywords: [
      'carros', 'cars', 'automotivo', 'automotive', 'moto', 'motos', 'motorcycle',
      'acelerados', 'quatrorodas', 'carro chefe', 'flatout', 'carwow', 'donut',
      'top gear', 'mecanica', 'oficina', 'motor', 'tuning', 'eletrico', 'tesla',
    ],
  },
  {
    tag: 'Travel',
    keywords: [
      'travel', 'viagem', 'viagens', 'turismo', 'mochilao', 'backpacker',
      'nomade', 'nomad', 'aventura', 'adventure', 'camping', 'motorhome',
      'mundo sem fim', 'carioca no mundo', 'estevao pelo mundo', 'destinos',
    ],
  },
  {
    tag: 'Vlogs',
    keywords: [
      'vlog', 'vlogs', 'daily', 'rotina', 'lifestyle', 'dia a dia', 'diario',
      'familia', 'family', 'casa', 'home', 'minimalismo', 'produtividade',
      'productivity', 'ali abdaal', 'matt d avella', 'casey neistat',
    ],
  },
  {
    tag: 'Entertainment',
    keywords: [
      'comedy', 'comedia', 'humor', 'standup', 'stand-up', 'react', 'reagindo',
      'entretenimento', 'entertainment', 'parodia', 'esquete', 'porta dos fundos',
      'whindersson', 'felipe neto', 'mrbeast', 'sidemen', 'casimiro', 'orochinho',
      't3ddy', 'luba', 'meme', 'memes', 'curiosidades',
    ],
  },
];

/**
 * Escape special regex characters in a keyword.
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compute automatic tags for a channel based on its title, handle, URL, and optional extra text.
 * @param {{ title?: string, handle?: string, url?: string }} channel
 * @param {string} [extraText='']
 * @returns {string[]}
 */
export function computeAutoTags(channel, extraText = '') {
  const haystack = normalizeText(
    [channel?.title || '', channel?.handle || '', channel?.url || '', extraText].join(' ')
  );
  if (!haystack.trim()) return [];

  const matched = [];
  for (const rule of TOPIC_RULES) {
    let hit = false;
    for (const rawKw of rule.keywords) {
      const kw = normalizeText(rawKw).trim();
      if (!kw) continue;
      if (kw.length <= 3) {
        // Short keywords (e.g., "ia", "ui", "ux", "f1", "g1", "3d") require token boundaries
        const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegex(kw)}(?:$|[^a-z0-9])`);
        if (re.test(haystack)) {
          hit = true;
          break;
        }
      } else if (haystack.includes(kw)) {
        hit = true;
        break;
      }
    }
    if (hit) matched.push(rule.tag);
  }

  return matched;
}

/**
 * Apply auto-tagging to a map or array of channels. Returns a new Record<string, Channel>.
 * @param {Record<string, import('./types.js').Channel>} channels
 * @returns {Record<string, import('./types.js').Channel>}
 */
export function tagAllChannels(channels) {
  /** @type {Record<string, import('./types.js').Channel>} */
  const next = {};
  for (const [id, ch] of Object.entries(channels || {})) {
    next[id] = {
      ...ch,
      autoTags: computeAutoTags(ch),
    };
  }
  return next;
}

/**
 * Get combined normalized tags for a channel (manual + auto).
 * @param {import('./types.js').Channel} channel
 * @returns {Set<string>}
 */
function getChannelTagSet(channel) {
  const set = new Set();
  for (const t of channel.tags || []) set.add(normalizeText(t));
  for (const t of channel.autoTags || []) set.add(normalizeText(t));
  return set;
}

/**
 * Filter channels by unlimited tags using AND (`includeAll`), OR (`includeAny`), and NOT (`exclude`).
 * @param {import('./types.js').Channel[]} channels
 * @param {{ includeAll?: string[], includeAny?: string[], exclude?: string[] }} [query]
 * @returns {import('./types.js').Channel[]}
 */
export function filterChannelsByTags(channels, query = {}) {
  const includeAll = (query.includeAll || []).map(normalizeText).filter(Boolean);
  const includeAny = (query.includeAny || []).map(normalizeText).filter(Boolean);
  const exclude = (query.exclude || []).map(normalizeText).filter(Boolean);

  if (includeAll.length === 0 && includeAny.length === 0 && exclude.length === 0) {
    return [...channels];
  }

  return channels.filter((ch) => {
    const tagSet = getChannelTagSet(ch);
    if (includeAll.length > 0 && !includeAll.every((t) => tagSet.has(t))) {
      return false;
    }
    if (includeAny.length > 0 && !includeAny.some((t) => tagSet.has(t))) {
      return false;
    }
    if (exclude.length > 0 && exclude.some((t) => tagSet.has(t))) {
      return false;
    }
    return true;
  });
}

/**
 * Compute flexible channel activity status from `lastVideoAt` and configurable day thresholds.
 * @param {number | null | undefined} lastVideoAt - Epoch ms of most recent video
 * @param {import('./types.js').ChannelStatusConfig} [config]
 * @param {number} [now=Date.now()]
 * @returns {import('./types.js').ChannelStatus}
 */
export function computeChannelStatus(lastVideoAt, config = DEFAULT_STATUS_CONFIG, now = Date.now()) {
  if (!lastVideoAt || !Number.isFinite(lastVideoAt)) {
    return CHANNEL_STATUSES.INACTIVE;
  }

  const activeDays = Number.isFinite(config?.activeDays) ? config.activeDays : DEFAULT_STATUS_CONFIG.activeDays;
  const slowDays = Number.isFinite(config?.slowDays) ? config.slowDays : DEFAULT_STATUS_CONFIG.slowDays;
  const inactiveDays = Number.isFinite(config?.inactiveDays) ? config.inactiveDays : DEFAULT_STATUS_CONFIG.inactiveDays;

  const diffDays = Math.max(0, (now - lastVideoAt) / (1000 * 60 * 60 * 24));

  if (diffDays <= activeDays) return CHANNEL_STATUSES.ACTIVE;
  if (diffDays <= slowDays) return CHANNEL_STATUSES.SLOW;
  if (diffDays <= inactiveDays) return CHANNEL_STATUSES.INACTIVE;
  return CHANNEL_STATUSES.DEAD;
}

/**
 * Recalculate `status` for all channels using the given status configuration.
 * @param {Record<string, import('./types.js').Channel>} channels
 * @param {import('./types.js').ChannelStatusConfig} [config]
 * @param {number} [now=Date.now()]
 * @returns {Record<string, import('./types.js').Channel>}
 */
export function refreshChannelStatuses(channels, config = DEFAULT_STATUS_CONFIG, now = Date.now()) {
  /** @type {Record<string, import('./types.js').Channel>} */
  const next = {};
  for (const [id, ch] of Object.entries(channels || {})) {
    next[id] = {
      ...ch,
      status: computeChannelStatus(ch.lastVideoAt, config, now),
    };
  }
  return next;
}

/**
 * Aggregate all unique tags (both manual and auto) across channels with usage counts.
 * @param {Record<string, import('./types.js').Channel> | import('./types.js').Channel[]} channels
 * @returns {Array<{ tag: string, count: number, isAuto: boolean }>}
 */
export function getAllUniqueTags(channels) {
  const list = Array.isArray(channels) ? channels : Object.values(channels || {});
  /** @type {Map<string, { tag: string, count: number, isAuto: boolean }>} */
  const map = new Map();

  for (const ch of list) {
    const seenForChannel = new Set();
    for (const tag of ch.tags || []) {
      const key = normalizeText(tag);
      if (!key || seenForChannel.has(key)) continue;
      seenForChannel.add(key);
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
        existing.isAuto = false;
      } else {
        map.set(key, { tag, count: 1, isAuto: false });
      }
    }
    for (const tag of ch.autoTags || []) {
      const key = normalizeText(tag);
      if (!key || seenForChannel.has(key)) continue;
      seenForChannel.add(key);
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(key, { tag, count: 1, isAuto: true });
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
