/**
 * @fileoverview Courses auto-sequencer and progress computation engine for TubeNook.
 * Organizes YouTube videos into structured course modules & lessons with PT-BR and EN heuristics.
 */

const STAGE_RANK = Object.freeze({
  intro: 0,
  basics: 1,
  core: 2,
  advanced: 3,
  project: 4,
});

const STAGE_BUCKETS = Object.freeze([
  { id: 'mod_intro', title: 'Introdução', stages: ['intro'] },
  { id: 'mod_basics', title: 'Fundamentos', stages: ['basics'] },
  { id: 'mod_core', title: 'Aulas Principais', stages: ['core'] },
  { id: 'mod_adv_proj', title: 'Avançado & Projetos', stages: ['advanced', 'project'] },
]);

const INTRO_PATTERNS = [
  /\b(introdu[cç][aã]o|intro|bem[- ]?vindo|welcome|overview|vis[aã]o geral|apresenta[cç][aã]o|instala[cç][aã]o|setup|getting started|come[cç]ando|o que [eé]|what is|roadmap|guia inicial|boas[- ]?vindas|configura[cç][aã]o inicial)\b/i,
];

const BASICS_PATTERNS = [
  /\b(b[aá]sico|fundamentos|basics|fundamentals|beginner|iniciante|primeiros passos|first steps|essencial|essentials|sintaxe|syntax|conceitos|concepts|vari[aá]veis|variables|tipos de dados|data types|zero to|do zero|for beginners|para iniciantes)\b/i,
];

const PROJECT_PATTERNS = [
  /\b(projeto|project|pr[aá]tic[oa]|hands[- ]?on|build a|construindo|criando um|clone|app completo|full app|desafio|challenge|exerc[ií]cio|exercise|case study|portf[oó]lio|portfolio|deploy|produ[cç][aã]o|production|real[- ]?world)\b/i,
];

const ADVANCED_PATTERNS = [
  /\b(avan[cç]ado|advanced|expert|deep dive|arquitetura|architecture|performance|otimiza[cç][aã]o|optimization|patterns|padr[oõ]es|internals|scaling|escalando|masterclass|pro tips|segredos|testing|testes|seguran[cç]a|security|microservices|microsservi[cç]os)\b/i,
];

/**
 * Detect explicit lesson number, module number, and learning stage from a video title.
 * Supports both PT-BR and EN naming conventions.
 * @param {string} title
 * @returns {{ lessonNumber: number | null, moduleNumber: number | null, stage: 'intro' | 'basics' | 'core' | 'advanced' | 'project', stageRank: number }}
 */
export function detectLessonOrderMeta(title) {
  const text = String(title || '').trim();

  // Detect explicit module number (e.g. "Módulo 2", "Module 1", "Section 3")
  let moduleNumber = null;
  const modMatch = text.match(/\b(?:m[oó]dulo|module|section|se[cç][aã]o)\s*#?\s*(\d{1,3})\b/i);
  if (modMatch) {
    moduleNumber = parseInt(modMatch[1], 10);
  }

  // Detect explicit lesson number
  let lessonNumber = null;
  const explicitPatterns = [
    /\b(?:aula|lesson|ep\.?|epis[oó]dio|episode|part(?:e)?|cap[ií]tulo|chapter|class|lec(?:ture)?|step|passo|dia|day|v[ií]deo|video)\s*#?\s*(\d{1,4})\b/i,
    /#(\d{1,4})\b/,
    /^\s*(\d{1,3})\s*[-–—.):/]/,
    /\(\s*(\d{1,3})\s*\/\s*\d+\s*\)/,
    /\[\s*(\d{1,3})\s*\]/,
  ];

  for (const re of explicitPatterns) {
    const m = text.match(re);
    if (m && m[1]) {
      const parsed = parseInt(m[1], 10);
      if (Number.isFinite(parsed)) {
        lessonNumber = parsed;
        break;
      }
    }
  }

  // Detect learning stage (check intro -> basics -> project -> advanced -> core)
  /** @type {'intro' | 'basics' | 'core' | 'advanced' | 'project'} */
  let stage = 'core';
  if (INTRO_PATTERNS.some((re) => re.test(text))) {
    stage = 'intro';
  } else if (BASICS_PATTERNS.some((re) => re.test(text))) {
    stage = 'basics';
  } else if (PROJECT_PATTERNS.some((re) => re.test(text))) {
    stage = 'project';
  } else if (ADVANCED_PATTERNS.some((re) => re.test(text))) {
    stage = 'advanced';
  }

  return {
    lessonNumber,
    moduleNumber,
    stage,
    stageRank: STAGE_RANK[stage],
  };
}

/**
 * Automatically organize a flat list of lessons into logical modules and ordered lessons.
 * Sorts by detected module/lesson number, learning stage (Introdução -> Fundamentos -> Aulas Principais -> Avançado & Projetos), and duration.
 * @param {Array<Partial<import('./types.js').CourseLesson>>} lessons
 * @returns {{ modules: import('./types.js').CourseModule[], lessons: Array<any>, summary: string }}
 */
export function suggestCourseSequence(lessons) {
  const input = Array.isArray(lessons) ? lessons : [];
  if (input.length === 0) {
    return {
      modules: [],
      lessons: [],
      summary: 'Nenhuma aula para organizar.',
    };
  }

  const annotated = input.map((lesson, originalIndex) => ({
    lesson,
    originalIndex,
    meta: detectLessonOrderMeta(lesson?.title || ''),
  }));

  // Group into stage buckets
  /** @type {Map<string, typeof annotated>} */
  const bucketMap = new Map();
  for (const b of STAGE_BUCKETS) {
    bucketMap.set(b.id, []);
  }

  for (const item of annotated) {
    const bucket =
      STAGE_BUCKETS.find((b) => b.stages.includes(item.meta.stage)) || STAGE_BUCKETS[2];
    bucketMap.get(bucket.id).push(item);
  }

  /** @type {import('./types.js').CourseModule[]} */
  const modules = [];
  /** @type {any[]} */
  const orderedLessons = [];
  let moduleOrder = 0;
  let globalLessonOrder = 0;

  for (const bucket of STAGE_BUCKETS) {
    const items = bucketMap.get(bucket.id) || [];
    if (items.length === 0) continue;

    items.sort((a, b) => {
      // 1. Explicit moduleNumber if both present
      const aMod = a.meta.moduleNumber;
      const bMod = b.meta.moduleNumber;
      if (aMod !== null && bMod !== null && aMod !== bMod) return aMod - bMod;

      // 2. Explicit lessonNumber (numbered lessons sorted numerically; numbered before unnumbered)
      const aNum = a.meta.lessonNumber;
      const bNum = b.meta.lessonNumber;
      if (aNum !== null && bNum !== null && aNum !== bNum) return aNum - bNum;
      if (aNum !== null && bNum === null) return -1;
      if (aNum === null && bNum !== null) return 1;

      // 3. Stage rank (e.g. advanced before project inside Avançado & Projetos)
      if (a.meta.stageRank !== b.meta.stageRank) return a.meta.stageRank - b.meta.stageRank;

      // 4. Duration ascending (shorter conceptual lessons first when unnumbered)
      const aDur = Number.isFinite(a.lesson?.durationSec) ? a.lesson.durationSec : 0;
      const bDur = Number.isFinite(b.lesson?.durationSec) ? b.lesson.durationSec : 0;
      if (aDur > 0 && bDur > 0 && aDur !== bDur) return aDur - bDur;

      // 5. Preserve original relative order
      return a.originalIndex - b.originalIndex;
    });

    const mod = {
      id: bucket.id,
      title: bucket.title,
      order: moduleOrder++,
    };
    modules.push(mod);

    for (const item of items) {
      orderedLessons.push({
        ...item.lesson,
        moduleId: mod.id,
        order: globalLessonOrder++,
      });
    }
  }

  const numberedCount = annotated.filter((a) => a.meta.lessonNumber !== null).length;
  const summary =
    `Organized ${orderedLessons.length} lessons into ${modules.length} module${modules.length === 1 ? '' : 's'}` +
    (numberedCount > 0 ? ` (${numberedCount} numbered)` : '') +
    '.';

  return {
    modules,
    lessons: orderedLessons,
    summary,
  };
}

/**
 * Compute completion progress, durations, and next uncompleted lesson for a course.
 * @param {import('./types.js').Course | null | undefined} course
 * @returns {{ completedCount: number, totalCount: number, percent: number, totalDurationSec: number, remainingDurationSec: number, nextLessonId: string | null }}
 */
export function getCourseProgress(course) {
  const lessons = Array.isArray(course?.lessons) ? course.lessons : [];
  const totalCount = lessons.length;
  if (totalCount === 0) {
    return {
      completedCount: 0,
      totalCount: 0,
      percent: 0,
      totalDurationSec: 0,
      remainingDurationSec: 0,
      nextLessonId: null,
    };
  }

  const moduleOrderMap = new Map(
    (Array.isArray(course?.modules) ? course.modules : []).map((m, idx) => [
      m.id,
      Number.isFinite(m.order) ? m.order : idx,
    ])
  );

  const sorted = [...lessons].sort((a, b) => {
    const aMod = a.moduleId && moduleOrderMap.has(a.moduleId) ? moduleOrderMap.get(a.moduleId) : 9999;
    const bMod = b.moduleId && moduleOrderMap.has(b.moduleId) ? moduleOrderMap.get(b.moduleId) : 9999;
    if (aMod !== bMod) return aMod - bMod;
    return (a.order ?? 0) - (b.order ?? 0);
  });

  let completedCount = 0;
  let totalDurationSec = 0;
  let remainingDurationSec = 0;
  let nextLessonId = null;

  for (const lesson of sorted) {
    const dur = Number.isFinite(lesson.durationSec) && lesson.durationSec > 0 ? lesson.durationSec : 0;
    totalDurationSec += dur;
    if (lesson.completed) {
      completedCount++;
    } else {
      remainingDurationSec += dur;
      if (nextLessonId === null) {
        nextLessonId = lesson.id || lesson.videoId || null;
      }
    }
  }

  return {
    completedCount,
    totalCount,
    percent: Math.round((completedCount / totalCount) * 100),
    totalDurationSec,
    remainingDurationSec,
    nextLessonId,
  };
}
