import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectLessonOrderMeta,
  suggestCourseSequence,
  getCourseProgress,
} from '../src/shared/courses.js';
import { computeInsights } from '../src/shared/insights.js';
import {
  createMemoryBackend,
  setStorageBackend,
  createGroup,
  upsertChannels,
  upsertPlaylists,
  markVideoWatched,
  upsertVideoNote,
  createCourse,
  updateCourse,
  addLessonToCourse,
  removeLessonFromCourse,
  toggleLessonComplete,
  applyCourseSequence,
  deleteCourse,
  loadState,
} from '../src/shared/storage.js';
import { GROUP_KINDS } from '../src/shared/types.js';

describe('courses.js — Auto-Sequencer & Progress Computation', () => {
  it('detectLessonOrderMeta detects PT-BR and EN lesson numbers, module numbers, and learning stages', () => {
    const intro = detectLessonOrderMeta('Aula 1 - Introdução e Instalação do Ambiente');
    assert.equal(intro.lessonNumber, 1);
    assert.equal(intro.stage, 'intro');

    const basics = detectLessonOrderMeta('02 - Fundamentos de JavaScript para Iniciantes');
    assert.equal(basics.lessonNumber, 2);
    assert.equal(basics.stage, 'basics');

    const core = detectLessonOrderMeta('Módulo 3 - Ep. 7 Hooks e Estado');
    assert.equal(core.moduleNumber, 3);
    assert.equal(core.lessonNumber, 7);
    assert.equal(core.stage, 'core');

    const advanced = detectLessonOrderMeta('Lesson 10: Advanced Architecture & Performance');
    assert.equal(advanced.lessonNumber, 10);
    assert.equal(advanced.stage, 'advanced');

    const project = detectLessonOrderMeta('#12 Projeto Prático: Construindo um Clone Completo');
    assert.equal(project.lessonNumber, 12);
    assert.equal(project.stage, 'project');
  });

  it('suggestCourseSequence organizes unsorted videos into logical modules and lesson order', () => {
    const messyLessons = [
      { id: 'l_proj', videoId: 'v_proj', title: 'Projeto Prático Final - App Completo', durationSec: 1800 },
      { id: 'l_core2', videoId: 'v_core2', title: 'Aula 4 - Gerenciamento de Estado', durationSec: 900 },
      { id: 'l_adv', videoId: 'v_adv', title: 'Otimização e Arquitetura Avançada', durationSec: 1200 },
      { id: 'l_intro', videoId: 'v_intro', title: 'Bem-vindo! Introdução ao Curso', durationSec: 300 },
      { id: 'l_basics', videoId: 'v_basics', title: 'Aula 2 - Fundamentos e Conceitos', durationSec: 600 },
      { id: 'l_core1', videoId: 'v_core1', title: 'Aula 3 - Componentes Reutilizáveis', durationSec: 800 },
    ];

    const result = suggestCourseSequence(messyLessons);
    assert.equal(result.modules.length, 4);
    assert.deepEqual(
      result.modules.map((m) => m.title),
      ['Introdução', 'Fundamentos', 'Aulas Principais', 'Avançado & Projetos']
    );
    assert.deepEqual(
      result.lessons.map((l) => l.videoId),
      ['v_intro', 'v_basics', 'v_core1', 'v_core2', 'v_adv', 'v_proj']
    );
    assert.ok(result.summary.includes('6 lessons'));
    assert.ok(result.summary.includes('4 modules'));
  });

  it('getCourseProgress calculates completedCount, percent, remainingDurationSec, and nextLessonId', () => {
    const course = {
      id: 'crs_1',
      modules: [
        { id: 'm1', title: 'Intro', order: 0 },
        { id: 'm2', title: 'Core', order: 1 },
      ],
      lessons: [
        { id: 'les_2', videoId: 'v2', moduleId: 'm2', order: 1, durationSec: 600, completed: false },
        { id: 'les_1', videoId: 'v1', moduleId: 'm1', order: 0, durationSec: 300, completed: true },
        { id: 'les_3', videoId: 'v3', moduleId: 'm2', order: 2, durationSec: 900, completed: false },
      ],
    };

    const prog = getCourseProgress(course);
    assert.equal(prog.completedCount, 1);
    assert.equal(prog.totalCount, 3);
    assert.equal(prog.percent, 33);
    assert.equal(prog.totalDurationSec, 1800);
    assert.equal(prog.remainingDurationSec, 1500);
    assert.equal(prog.nextLessonId, 'les_2');
  });

  it('supports full Course CRUD & auto-sequencing in storage.js', async () => {
    setStorageBackend(createMemoryBackend());
    const { course } = await createCourse({
      title: 'React Mastery',
      description: 'Complete YouTube course',
      lessons: [
        { videoId: 'vid_p', title: 'Projeto Prático Final', durationSec: 1200 },
        { videoId: 'vid_i', title: 'Introdução e Setup', durationSec: 300 },
      ],
    });

    assert.equal(course.lessons.length, 2);
    await addLessonToCourse(course.id, { videoId: 'vid_b', title: 'Fundamentos do JSX', durationSec: 500 });
    await updateCourse(course.id, { title: 'React Mastery 2026' });

    const { course: sequenced } = await applyCourseSequence(course.id);
    assert.deepEqual(
      sequenced.lessons.map((l) => l.videoId),
      ['vid_i', 'vid_b', 'vid_p']
    );

    const { completed } = await toggleLessonComplete(course.id, 'vid_i');
    assert.equal(completed, true);

    await removeLessonFromCourse(course.id, 'vid_p');
    let state = await loadState();
    assert.equal(state.courses[course.id].title, 'React Mastery 2026');
    assert.equal(state.courses[course.id].lessons.length, 2);

    state = await deleteCourse(course.id);
    assert.equal(state.courses[course.id], undefined);
  });
});

describe('insights.js — Library Analytics Engine', () => {
  beforeEach(() => {
    setStorageBackend(createMemoryBackend());
  });

  it('computes totals, channelHealth, playlistsSummary, coursesSummary, and topGroups accurately', async () => {
    const { group: gDev } = await createGroup({ name: 'Dev', kind: GROUP_KINDS.SUBSCRIPTION });
    const { group: gMusic } = await createGroup({ name: 'Music', kind: GROUP_KINDS.SUBSCRIPTION });
    await createGroup({ name: 'Study PLs', kind: GROUP_KINDS.PLAYLIST });

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    await upsertChannels([
      { id: 'UC_1', title: 'Dev 1', groupIds: [gDev.id], lastVideoAt: now - 2 * day },
      { id: 'UC_2', title: 'Dev 2', groupIds: [gDev.id], lastVideoAt: now - 30 * day },
      { id: 'UC_3', title: 'Music 1', groupIds: [gMusic.id], lastVideoAt: now - 100 * day },
      { id: 'UC_4', title: 'Old Channel', groupIds: [], lastVideoAt: now - 300 * day },
    ]);

    await upsertPlaylists([
      {
        id: 'pl_1',
        title: 'Custom Study',
        isCustom: true,
        videos: [
          { videoId: 'v1', title: 'V1', durationSec: 600 },
          { videoId: 'v2', title: 'V2', durationSec: 400 },
        ],
      },
    ]);

    await markVideoWatched('v1', { title: 'V1', durationSec: 600 });
    await upsertVideoNote('v1', { timestampSec: 45, text: 'Important point' });

    const { course } = await createCourse({
      title: 'Node Course',
      lessons: [
        { videoId: 'c1', title: 'Intro', durationSec: 300, completed: true },
        { videoId: 'c2', title: 'Core', durationSec: 600, completed: false },
      ],
    });
    assert.ok(course.id);

    const state = await loadState();
    const insights = computeInsights(state);

    assert.equal(insights.totals.groups, 3);
    assert.equal(insights.totals.subscriptionGroups, 2);
    assert.equal(insights.totals.playlistGroups, 1);
    assert.equal(insights.totals.channels, 4);
    assert.equal(insights.totals.playlists, 1);
    assert.equal(insights.totals.courses, 1);
    assert.equal(insights.totals.watchedVideos, 1);
    assert.equal(insights.totals.videoNotes, 1);

    assert.deepEqual(insights.channelHealth, {
      active: 1,
      slow: 1,
      inactive: 1,
      dead: 1,
    });

    assert.equal(insights.playlistsSummary.totalVideos, 2);
    assert.equal(insights.playlistsSummary.watchedVideos, 1);
    assert.equal(insights.playlistsSummary.totalDurationSec, 1000);
    assert.equal(insights.playlistsSummary.remainingDurationSec, 400);

    assert.equal(insights.coursesSummary.totalCourses, 1);
    assert.equal(insights.coursesSummary.totalLessons, 2);
    assert.equal(insights.coursesSummary.completedLessons, 1);
    assert.equal(insights.coursesSummary.avgProgressPercent, 50);

    assert.equal(insights.topGroups[0].name, 'Dev');
    assert.equal(insights.topGroups[0].channelCount, 2);
  });
});
