/**
 * @fileoverview Searchable icon catalog (110+ categorized icons with PT-BR & EN keywords),
 * custom icon upload/resizer, and default group color palette.
 */

import { normalizeText } from './auto-tagger.js';

export const DEFAULT_GROUP_COLORS = Object.freeze([
  '#ef233c', '#e63946', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6', '#06b6d4',
  '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7',
  '#d946ef', '#ec4899', '#f43f5e', '#64748b', '#94a3b8',
]);

export const ICON_CATEGORIES = Object.freeze([
  { id: 'all', labelPt: 'Todos', labelEn: 'All' },
  { id: 'folders', labelPt: 'Pastas & UI', labelEn: 'Folders & UI' },
  { id: 'tech', labelPt: 'Tech & Dev', labelEn: 'Tech & Dev' },
  { id: 'gaming', labelPt: 'Jogos', labelEn: 'Gaming' },
  { id: 'music', labelPt: 'Música & Áudio', labelEn: 'Music & Audio' },
  { id: 'media', labelPt: 'Cinema & Mídia', labelEn: 'Cinema & Media' },
  { id: 'education', labelPt: 'Educação & Ciência', labelEn: 'Education & Science' },
  { id: 'finance', labelPt: 'Finanças & Negócios', labelEn: 'Finance & Business' },
  { id: 'lifestyle', labelPt: 'Esporte & Estilo', labelEn: 'Sports & Lifestyle' },
  { id: 'symbols', labelPt: 'Símbolos', labelEn: 'Symbols' },
]);

/**
 * @typedef {Object} IconCatalogEntry
 * @property {string} id
 * @property {'emoji' | 'svg'} type
 * @property {string} value
 * @property {string} labelPt
 * @property {string} labelEn
 * @property {string} category
 * @property {string[]} keywords
 */

/** @type {IconCatalogEntry[]} */
export const ICON_CATALOG = [
  // Folders & UI (including crisp inline SVGs)
  { id: 'svg-folder', type: 'svg', value: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg>', labelPt: 'Pasta SVG', labelEn: 'SVG Folder', category: 'folders', keywords: ['pasta', 'folder', 'grupo', 'group', 'colecao'] },
  { id: 'svg-play', type: 'svg', value: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>', labelPt: 'Play SVG', labelEn: 'SVG Play', category: 'folders', keywords: ['play', 'video', 'youtube', 'assistir'] },
  { id: 'svg-playlist', type: 'svg', value: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 6h14v2H3V6zm0 4h14v2H3v-2zm0 4h10v2H3v-2zm13 0v6l5-3-5-3z"/></svg>', labelPt: 'Playlist SVG', labelEn: 'SVG Playlist', category: 'folders', keywords: ['playlist', 'lista', 'fila', 'queue'] },
  { id: 'svg-star', type: 'svg', value: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>', labelPt: 'Estrela SVG', labelEn: 'SVG Star', category: 'folders', keywords: ['estrela', 'star', 'favorito', 'favorite', 'top'] },
  { id: 'svg-bolt', type: 'svg', value: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/></svg>', labelPt: 'Raio SVG', labelEn: 'SVG Bolt', category: 'folders', keywords: ['raio', 'bolt', 'rapido', 'fast', 'energia'] },
  { id: 'svg-heart', type: 'svg', value: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>', labelPt: 'Coração SVG', labelEn: 'SVG Heart', category: 'folders', keywords: ['coracao', 'heart', 'amar', 'love', 'favoritos'] },
  { id: 'svg-code', type: 'svg', value: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8.7 16.3L4.4 12l4.3-4.3-1.4-1.4L1.6 12l5.7 5.7 1.4-1.4zm6.6 0l4.3-4.3-4.3-4.3 1.4-1.4L22.4 12l-5.7 5.7-1.4-1.4z"/></svg>', labelPt: 'Código SVG', labelEn: 'SVG Code', category: 'tech', keywords: ['codigo', 'code', 'dev', 'programacao'] },
  { id: 'svg-music', type: 'svg', value: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>', labelPt: 'Música SVG', labelEn: 'SVG Music', category: 'music', keywords: ['musica', 'music', 'nota', 'audio'] },
  { id: 'emo-folder', type: 'emoji', value: '📁', labelPt: 'Pasta', labelEn: 'Folder', category: 'folders', keywords: ['pasta', 'folder', 'grupo', 'diretorio'] },
  { id: 'emo-folder-open', type: 'emoji', value: '📂', labelPt: 'Pasta Aberta', labelEn: 'Open Folder', category: 'folders', keywords: ['pasta', 'aberta', 'folder', 'open'] },
  { id: 'emo-card-index', type: 'emoji', value: '🗂️', labelPt: 'Arquivos', labelEn: 'Dividers', category: 'folders', keywords: ['arquivo', 'organizar', 'organize', 'tabs'] },
  { id: 'emo-bookmark', type: 'emoji', value: '🔖', labelPt: 'Marcador', labelEn: 'Bookmark', category: 'folders', keywords: ['marcador', 'bookmark', 'salvar', 'save'] },
  { id: 'emo-pin', type: 'emoji', value: '📌', labelPt: 'Fixado', labelEn: 'Pinned', category: 'folders', keywords: ['fixar', 'pin', 'importante'] },
  { id: 'emo-label', type: 'emoji', value: '🏷️', labelPt: 'Etiqueta', labelEn: 'Tag', category: 'folders', keywords: ['tag', 'etiqueta', 'label'] },
  { id: 'emo-inbox', type: 'emoji', value: '📥', labelPt: 'Caixa de Entrada', labelEn: 'Inbox', category: 'folders', keywords: ['inbox', 'entrada', 'novos', 'new'] },
  { id: 'emo-clock', type: 'emoji', value: '⏰', labelPt: 'Assistir Depois', labelEn: 'Watch Later', category: 'folders', keywords: ['relogio', 'tempo', 'clock', 'later', 'depois'] },
  { id: 'emo-archive', type: 'emoji', value: '📦', labelPt: 'Pacote', labelEn: 'Archive Box', category: 'folders', keywords: ['caixa', 'box', 'arquivo', 'archive'] },
  { id: 'emo-clipboard', type: 'emoji', value: '📋', labelPt: 'Lista', labelEn: 'Clipboard', category: 'folders', keywords: ['lista', 'clipboard', 'checklist'] },

  // Tech & Dev
  { id: 'emo-laptop', type: 'emoji', value: '💻', labelPt: 'Notebook', labelEn: 'Laptop', category: 'tech', keywords: ['tech', 'dev', 'computador', 'programacao', 'coding'] },
  { id: 'emo-desktop', type: 'emoji', value: '🖥️', labelPt: 'Desktop', labelEn: 'Desktop PC', category: 'tech', keywords: ['pc', 'desktop', 'monitor', 'setup', 'hardware'] },
  { id: 'emo-robot', type: 'emoji', value: '🤖', labelPt: 'IA & Robô', labelEn: 'AI & Robot', category: 'tech', keywords: ['ia', 'ai', 'robo', 'robot', 'machine learning', 'llm'] },
  { id: 'emo-brain', type: 'emoji', value: '🧠', labelPt: 'Cérebro / IA', labelEn: 'Brain / AI', category: 'tech', keywords: ['cerebro', 'brain', 'ia', 'ai', 'mente', 'mind'] },
  { id: 'emo-phone', type: 'emoji', value: '📱', labelPt: 'Smartphone', labelEn: 'Smartphone', category: 'tech', keywords: ['celular', 'mobile', 'phone', 'android', 'iphone'] },
  { id: 'emo-keyboard', type: 'emoji', value: '⌨️', labelPt: 'Teclado', labelEn: 'Keyboard', category: 'tech', keywords: ['teclado', 'keyboard', 'code', 'digitar'] },
  { id: 'emo-chip', type: 'emoji', value: '🔌', labelPt: 'Eletrônica', labelEn: 'Electronics', category: 'tech', keywords: ['eletronica', 'hardware', 'plug', 'energia'] },
  { id: 'emo-satellite', type: 'emoji', value: '📡', labelPt: 'Redes & Sinais', labelEn: 'Network', category: 'tech', keywords: ['rede', 'network', 'internet', 'sinal', 'rss'] },
  { id: 'emo-cloud', type: 'emoji', value: '☁️', labelPt: 'Nuvem', labelEn: 'Cloud', category: 'tech', keywords: ['cloud', 'nuvem', 'aws', 'devops', 'server'] },
  { id: 'emo-lock', type: 'emoji', value: '🔐', labelPt: 'Segurança', labelEn: 'Security', category: 'tech', keywords: ['seguranca', 'security', 'cyber', 'privacidade'] },
  { id: 'emo-gear', type: 'emoji', value: '⚙️', labelPt: 'Engenharia', labelEn: 'Engineering', category: 'tech', keywords: ['config', 'engenharia', 'engineering', 'gear', 'tools'] },
  { id: 'emo-wrench', type: 'emoji', value: '🔧', labelPt: 'Ferramentas', labelEn: 'Tools', category: 'tech', keywords: ['ferramenta', 'diy', 'maker', 'tools', 'fix'] },
  { id: 'emo-bug', type: 'emoji', value: '🐛', labelPt: 'Debug', labelEn: 'Debug', category: 'tech', keywords: ['bug', 'debug', 'qa', 'test', 'dev'] },
  { id: 'emo-rocket', type: 'emoji', value: '🚀', labelPt: 'Foguete / Startup', labelEn: 'Rocket / Launch', category: 'tech', keywords: ['foguete', 'rocket', 'startup', 'espaco', 'space'] },

  // Gaming
  { id: 'emo-gamepad', type: 'emoji', value: '🎮', labelPt: 'Controle', labelEn: 'Gamepad', category: 'gaming', keywords: ['game', 'gaming', 'jogos', 'controle', 'videogame'] },
  { id: 'emo-joystick', type: 'emoji', value: '🕹️', labelPt: 'Arcade', labelEn: 'Joystick', category: 'gaming', keywords: ['arcade', 'retro', 'joystick', 'jogos'] },
  { id: 'emo-dice', type: 'emoji', value: '🎲', labelPt: 'RPG & Tabuleiro', labelEn: 'Board & RPG', category: 'gaming', keywords: ['rpg', 'dado', 'dice', 'boardgame', 'mesa'] },
  { id: 'emo-chess', type: 'emoji', value: '♟️', labelPt: 'Xadrez & Estratégia', labelEn: 'Chess & Strategy', category: 'gaming', keywords: ['xadrez', 'chess', 'estrategia', 'strategy'] },
  { id: 'emo-sword', type: 'emoji', value: '⚔️', labelPt: 'Ação & Batalha', labelEn: 'Action & Battle', category: 'gaming', keywords: ['espada', 'sword', 'pvp', 'acao', 'rpg', 'mmo'] },
  { id: 'emo-shield', type: 'emoji', value: '🛡️', labelPt: 'Defesa / Guilda', labelEn: 'Shield / Guild', category: 'gaming', keywords: ['escudo', 'shield', 'guilda', 'defesa'] },
  { id: 'emo-trophy', type: 'emoji', value: '🏆', labelPt: 'Esports / Troféu', labelEn: 'Esports / Trophy', category: 'gaming', keywords: ['esports', 'trofeu', 'trophy', 'campeonato', 'rank'] },
  { id: 'emo-alien', type: 'emoji', value: '👾', labelPt: 'Pixel / Indie', labelEn: 'Pixel / Indie', category: 'gaming', keywords: ['indie', 'pixel', 'alien', 'retro', 'arcade'] },
  { id: 'emo-dragon', type: 'emoji', value: '🐉', labelPt: 'Fantasia', labelEn: 'Fantasy', category: 'gaming', keywords: ['dragao', 'dragon', 'fantasia', 'fantasy', 'rpg'] },
  { id: 'emo-crystal', type: 'emoji', value: '🔮', labelPt: 'Magia / Lore', labelEn: 'Magic / Lore', category: 'gaming', keywords: ['magia', 'lore', 'teoria', 'magic'] },

  // Music & Audio
  { id: 'emo-headphones', type: 'emoji', value: '🎧', labelPt: 'Fones / Lo-Fi', labelEn: 'Headphones / Lo-Fi', category: 'music', keywords: ['fone', 'headphones', 'lofi', 'audio', 'musica'] },
  { id: 'emo-notes', type: 'emoji', value: '🎵', labelPt: 'Nota Musical', labelEn: 'Music Note', category: 'music', keywords: ['musica', 'music', 'song', 'playlist'] },
  { id: 'emo-notes2', type: 'emoji', value: '🎶', labelPt: 'Melodia', labelEn: 'Melody', category: 'music', keywords: ['melodia', 'musica', 'hits', 'album'] },
  { id: 'emo-guitar', type: 'emoji', value: '🎸', labelPt: 'Rock & Guitarra', labelEn: 'Rock & Guitar', category: 'music', keywords: ['guitarra', 'guitar', 'rock', 'metal', 'violao'] },
  { id: 'emo-piano', type: 'emoji', value: '🎹', labelPt: 'Piano & Teclado', labelEn: 'Piano & Synth', category: 'music', keywords: ['piano', 'synth', 'teclado', 'producao', 'beats'] },
  { id: 'emo-drums', type: 'emoji', value: '🥁', labelPt: 'Bateria', labelEn: 'Drums', category: 'music', keywords: ['bateria', 'drums', 'ritmo', 'percussao'] },
  { id: 'emo-mic', type: 'emoji', value: '🎙️', labelPt: 'Podcast', labelEn: 'Podcast Mic', category: 'music', keywords: ['podcast', 'microfone', 'mic', 'entrevista', 'cortes'] },
  { id: 'emo-sing', type: 'emoji', value: '🎤', labelPt: 'Vocal & Shows', labelEn: 'Vocals & Live', category: 'music', keywords: ['show', 'karaoke', 'cantor', 'live', 'rap'] },
  { id: 'emo-radio', type: 'emoji', value: '📻', labelPt: 'Rádio & Retrô', labelEn: 'Radio & Retro', category: 'music', keywords: ['radio', 'retro', 'classicos', 'oldies'] },
  { id: 'emo-sax', type: 'emoji', value: '🎷', labelPt: 'Jazz & Blues', labelEn: 'Jazz & Blues', category: 'music', keywords: ['jazz', 'blues', 'sax', 'instrumental'] },
  { id: 'emo-violin', type: 'emoji', value: '🎻', labelPt: 'Clássica', labelEn: 'Classical', category: 'music', keywords: ['classica', 'classical', 'orquestra', 'violino'] },

  // Cinema & Media
  { id: 'emo-clapper', type: 'emoji', value: '🎬', labelPt: 'Cinema', labelEn: 'Cinema', category: 'media', keywords: ['cinema', 'filme', 'movie', 'direcao', 'review'] },
  { id: 'emo-tv', type: 'emoji', value: '📺', labelPt: 'TV & Séries', labelEn: 'TV & Series', category: 'media', keywords: ['tv', 'series', 'streaming', 'show'] },
  { id: 'emo-popcorn', type: 'emoji', value: '🍿', labelPt: 'Entretenimento', labelEn: 'Entertainment', category: 'media', keywords: ['pipoca', 'popcorn', 'entretenimento', 'filmes', 'react'] },
  { id: 'emo-camera', type: 'emoji', value: '📷', labelPt: 'Fotografia', labelEn: 'Photography', category: 'media', keywords: ['foto', 'camera', 'fotografia', 'photography'] },
  { id: 'emo-video', type: 'emoji', value: '📹', labelPt: 'Vlog & Vídeo', labelEn: 'Vlog & Video', category: 'media', keywords: ['vlog', 'video', 'filmagem', 'edicao'] },
  { id: 'emo-art', type: 'emoji', value: '🎨', labelPt: 'Arte & Design', labelEn: 'Art & Design', category: 'media', keywords: ['arte', 'art', 'design', 'ui', 'ux', 'desenho', 'ilustracao'] },
  { id: 'emo-theater', type: 'emoji', value: '🎭', labelPt: 'Comédia & Drama', labelEn: 'Comedy & Drama', category: 'media', keywords: ['comedia', 'humor', 'teatro', 'drama', 'standup'] },
  { id: 'emo-newspaper', type: 'emoji', value: '📰', labelPt: 'Notícias', labelEn: 'News', category: 'media', keywords: ['noticias', 'news', 'jornal', 'politica', 'atualidades'] },
  { id: 'emo-live', type: 'emoji', value: '🔴', labelPt: 'Ao Vivo', labelEn: 'Live Stream', category: 'media', keywords: ['live', 'ao vivo', 'stream', 'red'] },
  { id: 'emo-sparkles', type: 'emoji', value: '✨', labelPt: 'Anime & Destaques', labelEn: 'Anime & Highlights', category: 'media', keywords: ['anime', 'destaque', 'highlights', 'brilho', 'magia'] },

  // Education & Science
  { id: 'emo-books', type: 'emoji', value: '📚', labelPt: 'Estudos & Livros', labelEn: 'Study & Books', category: 'education', keywords: ['livro', 'estudo', 'study', 'educacao', 'curso', 'enem'] },
  { id: 'emo-grad', type: 'emoji', value: '🎓', labelPt: 'Cursos & Faculdade', labelEn: 'Courses & Academy', category: 'education', keywords: ['curso', 'faculdade', 'universidade', 'aula', 'academy'] },
  { id: 'emo-bulb', type: 'emoji', value: '💡', labelPt: 'Ideias & Dicas', labelEn: 'Ideas & Tips', category: 'education', keywords: ['ideia', 'dica', 'tip', 'tutorial', 'aprender'] },
  { id: 'emo-microscope', type: 'emoji', value: '🔬', labelPt: 'Ciência', labelEn: 'Science', category: 'education', keywords: ['ciencia', 'science', 'lab', 'pesquisa', 'biologia'] },
  { id: 'emo-telescope', type: 'emoji', value: '🔭', labelPt: 'Astronomia', labelEn: 'Astronomy', category: 'education', keywords: ['astronomia', 'espaco', 'space', 'universo', 'nasa'] },
  { id: 'emo-atom', type: 'emoji', value: '⚛️', labelPt: 'Física & Química', labelEn: 'Physics & React', category: 'education', keywords: ['fisica', 'quimica', 'atomo', 'physics', 'react'] },
  { id: 'emo-globe', type: 'emoji', value: '🌍', labelPt: 'Mundo & Idiomas', labelEn: 'World & Languages', category: 'education', keywords: ['mundo', 'idiomas', 'ingles', 'geografia', 'world', 'languages'] },
  { id: 'emo-dna', type: 'emoji', value: '🧬', labelPt: 'Biologia & Saúde', labelEn: 'Biology & Health', category: 'education', keywords: ['dna', 'biologia', 'medicina', 'saude'] },
  { id: 'emo-math', type: 'emoji', value: '📐', labelPt: 'Matemática', labelEn: 'Math & Architecture', category: 'education', keywords: ['matematica', 'math', 'arquitetura', 'engenharia'] },
  { id: 'emo-history', type: 'emoji', value: '🏛️', labelPt: 'História & Filosofia', labelEn: 'History & Philosophy', category: 'education', keywords: ['historia', 'history', 'filosofia', 'cultura'] },
  { id: 'emo-notebook', type: 'emoji', value: '📝', labelPt: 'Anotações', labelEn: 'Notes', category: 'education', keywords: ['notas', 'notes', 'resumo', 'escrita'] },

  // Finance & Business
  { id: 'emo-money', type: 'emoji', value: '💰', labelPt: 'Finanças', labelEn: 'Finance', category: 'finance', keywords: ['dinheiro', 'financas', 'finance', 'investimentos', 'money'] },
  { id: 'emo-chart-up', type: 'emoji', value: '📈', labelPt: 'Bolsa & Ações', labelEn: 'Stocks & Growth', category: 'finance', keywords: ['bolsa', 'acoes', 'stocks', 'trading', 'grafico', 'crescimento'] },
  { id: 'emo-bank', type: 'emoji', value: '🏦', labelPt: 'Economia', labelEn: 'Economy & Bank', category: 'finance', keywords: ['banco', 'economia', 'economy', 'macro'] },
  { id: 'emo-briefcase', type: 'emoji', value: '💼', labelPt: 'Negócios & Carreira', labelEn: 'Business & Career', category: 'finance', keywords: ['negocios', 'business', 'carreira', 'trabalho', 'work'] },
  { id: 'emo-coin', type: 'emoji', value: '🪙', labelPt: 'Cripto & Moedas', labelEn: 'Crypto & Coins', category: 'finance', keywords: ['cripto', 'crypto', 'bitcoin', 'moeda', 'coin'] },
  { id: 'emo-megaphone', type: 'emoji', value: '📣', labelPt: 'Marketing', labelEn: 'Marketing', category: 'finance', keywords: ['marketing', 'vendas', 'sales', 'anuncio'] },
  { id: 'emo-target', type: 'emoji', value: '🎯', labelPt: 'Produtividade & Metas', labelEn: 'Goals & Focus', category: 'finance', keywords: ['meta', 'foco', 'produtividade', 'goal', 'focus'] },
  { id: 'emo-diamond', type: 'emoji', value: '💎', labelPt: 'Premium / Top', labelEn: 'Premium / Gems', category: 'finance', keywords: ['diamante', 'diamond', 'top', 'joia', 'melhores'] },

  // Sports & Lifestyle
  { id: 'emo-soccer', type: 'emoji', value: '⚽', labelPt: 'Futebol', labelEn: 'Soccer / Football', category: 'lifestyle', keywords: ['futebol', 'soccer', 'football', 'esporte'] },
  { id: 'emo-basketball', type: 'emoji', value: '🏀', labelPt: 'Basquete', labelEn: 'Basketball', category: 'lifestyle', keywords: ['basquete', 'nba', 'basketball', 'esporte'] },
  { id: 'emo-dumbbell', type: 'emoji', value: '🏋️', labelPt: 'Fitness & Treino', labelEn: 'Fitness & Gym', category: 'lifestyle', keywords: ['fitness', 'academia', 'treino', 'gym', 'musculacao'] },
  { id: 'emo-runner', type: 'emoji', value: '🏃', labelPt: 'Corrida', labelEn: 'Running', category: 'lifestyle', keywords: ['corrida', 'running', 'cardio', 'saude'] },
  { id: 'emo-boxing', type: 'emoji', value: '🥊', labelPt: 'Lutas & MMA', labelEn: 'Boxing & MMA', category: 'lifestyle', keywords: ['luta', 'ufc', 'mma', 'boxe', 'boxing'] },
  { id: 'emo-car', type: 'emoji', value: '🏎️', labelPt: 'Carros & F1', labelEn: 'Cars & Racing', category: 'lifestyle', keywords: ['carro', 'car', 'f1', 'corrida', 'automotivo'] },
  { id: 'emo-moto', type: 'emoji', value: '🏍️', labelPt: 'Motos', labelEn: 'Motorcycles', category: 'lifestyle', keywords: ['moto', 'motorcycle', 'duas rodas'] },
  { id: 'emo-cooking', type: 'emoji', value: '🍳', labelPt: 'Culinária', labelEn: 'Cooking', category: 'lifestyle', keywords: ['culinaria', 'receita', 'cooking', 'cozinha', 'food'] },
  { id: 'emo-pizza', type: 'emoji', value: '🍕', labelPt: 'Comida & Gastronomia', labelEn: 'Food & Gastronomy', category: 'lifestyle', keywords: ['comida', 'food', 'pizza', 'restaurante'] },
  { id: 'emo-coffee', type: 'emoji', value: '☕', labelPt: 'Café & Chill', labelEn: 'Coffee & Chill', category: 'lifestyle', keywords: ['cafe', 'coffee', 'chill', 'relax', 'rotina'] },
  { id: 'emo-plane', type: 'emoji', value: '✈️', labelPt: 'Viagens', labelEn: 'Travel', category: 'lifestyle', keywords: ['viagem', 'travel', 'aviao', 'turismo', 'mundo'] },
  { id: 'emo-camp', type: 'emoji', value: '🏕️', labelPt: 'Aventura & Camping', labelEn: 'Adventure & Camp', category: 'lifestyle', keywords: ['camping', 'aventura', 'natureza', 'trilha'] },
  { id: 'emo-home', type: 'emoji', value: '🏠', labelPt: 'Casa & Decoração', labelEn: 'Home & Decor', category: 'lifestyle', keywords: ['casa', 'home', 'decoracao', 'diy'] },
  { id: 'emo-pet', type: 'emoji', value: '🐾', labelPt: 'Pets & Animais', labelEn: 'Pets & Animals', category: 'lifestyle', keywords: ['pet', 'cachorro', 'gato', 'animais', 'animals'] },
  { id: 'emo-plant', type: 'emoji', value: '🌿', labelPt: 'Natureza & Plantas', labelEn: 'Nature & Plants', category: 'lifestyle', keywords: ['natureza', 'planta', 'jardim', 'nature'] },

  // Symbols
  { id: 'emo-fire', type: 'emoji', value: '🔥', labelPt: 'Em Alta / Fogo', labelEn: 'Trending / Fire', category: 'symbols', keywords: ['fogo', 'fire', 'alta', 'trending', 'hot', 'top'] },
  { id: 'emo-star', type: 'emoji', value: '⭐', labelPt: 'Favoritos', labelEn: 'Favorites', category: 'symbols', keywords: ['estrela', 'star', 'favorito', 'favorite'] },
  { id: 'emo-heart', type: 'emoji', value: '❤️', labelPt: 'Amei', labelEn: 'Love', category: 'symbols', keywords: ['coracao', 'heart', 'love', 'amar'] },
  { id: 'emo-bolt', type: 'emoji', value: '⚡', labelPt: 'Rápido / Shorts', labelEn: 'Fast / Shorts', category: 'symbols', keywords: ['raio', 'shorts', 'rapido', 'energia', 'bolt'] },
  { id: 'emo-crown', type: 'emoji', value: '👑', labelPt: 'VIP / Melhores', labelEn: 'VIP / Best', category: 'symbols', keywords: ['coroa', 'crown', 'vip', 'rei', 'melhores'] },
  { id: 'emo-check', type: 'emoji', value: '✅', labelPt: 'Concluído', labelEn: 'Completed', category: 'symbols', keywords: ['check', 'ok', 'assistido', 'done', 'concluido'] },
  { id: 'emo-eye', type: 'emoji', value: '👀', labelPt: 'De Olho', labelEn: 'Watching', category: 'symbols', keywords: ['olho', 'eye', 'assistir', 'watch'] },
  { id: 'emo-bell', type: 'emoji', value: '🔔', labelPt: 'Notificações', labelEn: 'Alerts', category: 'symbols', keywords: ['sino', 'bell', 'alerta', 'novo'] },
  { id: 'emo-compass', type: 'emoji', value: '🧭', labelPt: 'Explorar', labelEn: 'Explore', category: 'symbols', keywords: ['bussola', 'compass', 'explorar', 'descobrir'] },
  { id: 'emo-rainbow', type: 'emoji', value: '🌈', labelPt: 'Variedades', labelEn: 'Variety', category: 'symbols', keywords: ['arco-iris', 'rainbow', 'variedades', 'cores'] },
  { id: 'emo-moon', type: 'emoji', value: '🌙', labelPt: 'Noturno / Dormir', labelEn: 'Night / Sleep', category: 'symbols', keywords: ['lua', 'noite', 'dormir', 'sleep', 'relax', 'asmr'] },
  { id: 'emo-sun', type: 'emoji', value: '☀️', labelPt: 'Manhã / Diário', labelEn: 'Morning / Daily', category: 'symbols', keywords: ['sol', 'manha', 'diario', 'daily', 'morning'] },
];

/**
 * Search the icon catalog by keyword (accent-insensitive PT-BR & EN) and optional category.
 * @param {string} [query='']
 * @param {string} [category='all']
 * @returns {IconCatalogEntry[]}
 */
export function searchIcons(query = '', category = 'all') {
  const q = normalizeText(query).trim();
  const cat = category && category !== 'all' ? category : null;

  return ICON_CATALOG.filter((item) => {
    if (cat && item.category !== cat) return false;
    if (!q) return true;
    const haystack = normalizeText(
      [item.labelPt, item.labelEn, item.category, ...item.keywords].join(' ')
    );
    return haystack.includes(q);
  });
}

/**
 * Get all icon categories.
 */
export function getIconCategories() {
  return ICON_CATEGORIES;
}

/**
 * Escape HTML special characters for safe rendering.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Sanitize an inline SVG string to prevent XSS (strips scripts, foreignObject, event handlers, javascript: URIs).
 * @param {string} rawSvg
 * @returns {string}
 */
function sanitizeSvg(rawSvg) {
  let svg = String(rawSvg || '').trim();
  if (!/^<svg[\s>]/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) {
    return '';
  }
  // Remove dangerous elements and their contents
  svg = svg.replace(/<(script|foreignObject|iframe|object|embed|style|link|meta)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  svg = svg.replace(/<(script|foreignObject|iframe|object|embed|style|link|meta|use)\b[^>]*\/?>/gi, '');
  // Remove inline event handlers (onload=, onclick=, onerror=, etc.)
  svg = svg.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // Remove javascript: or vbscript: or data: URLs in href/xlink:href/src attributes
  svg = svg.replace(/\s+(?:xlink:)?(?:href|src)\s*=\s*(?:"[^"]*(?:javascript|vbscript|data):[^"]*"|'[^']*(?:javascript|vbscript|data):[^']*'|[^\s>]*(?:javascript|vbscript|data):[^\s>]*)/gi, '');
  return svg;
}

/**
 * Render a GroupIcon ({ type: 'emoji' | 'svg' | 'custom', value }) into a safe HTML string.
 * @param {import('./types.js').GroupIcon | null | undefined} icon
 * @param {number} [size=18]
 * @returns {string}
 */
export function renderIconHtml(icon, size = 18) {
  const safeSize = Number.isFinite(Number(size))
    ? Math.max(8, Math.min(128, Math.round(Number(size))))
    : 18;

  if (!icon || !icon.value) {
    return `<span class="tp-icon tp-icon-emoji" style="font-size:${safeSize}px;line-height:1;">📁</span>`;
  }
  if (icon.type === 'custom') {
    const safeSrc = icon.value.startsWith('data:image/') ? escapeHtml(icon.value) : '';
    if (!safeSrc) {
      return `<span class="tp-icon tp-icon-emoji" style="font-size:${safeSize}px;line-height:1;">📁</span>`;
    }
    return `<img class="tp-icon tp-icon-custom" src="${safeSrc}" width="${safeSize}" height="${safeSize}" style="width:${safeSize}px;height:${safeSize}px;object-fit:cover;border-radius:4px;vertical-align:middle;" alt="" />`;
  }
  if (icon.type === 'svg' && icon.value.trim().startsWith('<svg')) {
    const cleanSvg = sanitizeSvg(icon.value);
    if (!cleanSvg) {
      return `<span class="tp-icon tp-icon-emoji" style="font-size:${safeSize}px;line-height:1;">📁</span>`;
    }
    return `<span class="tp-icon tp-icon-svg" style="display:inline-flex;width:${safeSize}px;height:${safeSize}px;align-items:center;justify-content:center;">${cleanSvg}</span>`;
  }
  return `<span class="tp-icon tp-icon-emoji" style="font-size:${safeSize}px;line-height:1;">${escapeHtml(icon.value)}</span>`;
}

/**
 * Browser helper: resize an uploaded image File/Blob to a square PNG data URL (default 64x64).
 * @param {Blob} file
 * @param {number} [maxSize=64]
 * @returns {Promise<string>}
 */
export async function resizeImageToDataUrl(file, maxSize = 64) {
  if (typeof document === 'undefined') {
    throw new Error('resizeImageToDataUrl requires a browser environment.');
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed to decode image file.'));
      el.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = maxSize;
    canvas.height = maxSize;
    const ctx = canvas.getContext('2d');
    const scale = Math.max(maxSize / img.width, maxSize / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (maxSize - w) / 2, (maxSize - h) / 2, w, h);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}
