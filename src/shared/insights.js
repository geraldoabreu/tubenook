/**
 * @fileoverview Library Insights & Analytics engine for TubeNook.
 * Computes pure statistics across groups, channels, playlists, courses, watched videos, and notes.
 */

import { GROUP_KINDS } from './types.js';
import { getCourseProgress } from './courses.js';

/**
 * Compute comprehensive library insights from AppState.
 * @param {import('./types.js').AppState} state
 * @returns {{
 *   totals: { groups: number, subscriptionGroups: number, playlistGroups: number, channels: number, playlists: number, courses: number, watchedVideos: number, videoNotes: number },
 *   channelHealth: { active: number, slow: number, inactive: number, dead: number },
 *   playlistsSummary: { totalVideos: number, watchedVideos: number, totalDurationSec: number, remainingDurationSec: number, topPlaylists: Array<{ id: string, title: string, videoCount: number, watchedCount: number, percent: number, isCustom: boolean }> },
 *   coursesSummary: { totalCourses: number, totalLessons: number, completedLessons: number, avgProgressPercent: number },
 *   topGroups: Array<{ id: string, name: string, color: string, icon: any, channelCount: number }>
 * }}
 */
export function computeInsights(state) {
  const safe = state && typeof state === 'object' ? state : {};
  const groupsList = Object.values(safe.groups || {});
  const channelsList = Object.values(safe.channels || {});
  const playlistsList = Object.values(safe.playlists || {});
  const coursesList = Object.values(safe.courses || {});
  const watchedMap = safe.watched && typeof safe.watched === 'object' ? safe.watched : {};
  const videoNotesMap = safe.videoNotes && typeof safe.videoNotes === 'object' ? safe.videoNotes : {};

  const subscriptionGroups = groupsList.filter((g) => g.kind === GROUP_KINDS.SUBSCRIPTION);
  const playlistGroups = groupsList.filter((g) => g.kind === GROUP_KINDS.PLAYLIST);

  let videoNotesCount = 0;
  for (const list of Object.values(videoNotesMap)) {
    if (Array.isArray(list)) videoNotesCount += list.length;
  }

  const totals = {
    groups: groupsList.length,
    subscriptionGroups: subscriptionGroups.length,
    playlistGroups: playlistGroups.length,
    channels: channelsList.length,
    playlists: playlistsList.length,
    courses: coursesList.length,
    watchedVideos: Object.keys(watchedMap).length,
    videoNotes: videoNotesCount,
  };

  // Channel health breakdown
  const channelHealth = { active: 0, slow: 0, inactive: 0, dead: 0 };
  for (const ch of channelsList) {
    const status = ch?.status;
    if (status === 'active') channelHealth.active++;
    else if (status === 'slow') channelHealth.slow++;
    else if (status === 'dead') channelHealth.dead++;
    else channelHealth.inactive++;
  }

  // Playlists summary
  let plTotalVideos = 0;
  let plWatchedVideos = 0;
  let plTotalDurationSec = 0;
  let plRemainingDurationSec = 0;

  const rankedPlaylists = playlistsList.map((pl) => {
    const videos = Array.isArray(pl.videos) ? pl.videos : [];
    const videoCount = Number.isFinite(pl.videoCount) ? pl.videoCount : videos.length;
    let watchedCount = Number.isFinite(pl.watchedCount) ? pl.watchedCount : 0;

    if (videos.length > 0) {
      let computedWatched = 0;
      for (const v of videos) {
        const dur = Number.isFinite(v.durationSec) && v.durationSec > 0 ? v.durationSec : 0;
        plTotalDurationSec += dur;
        if (watchedMap[v.videoId]) {
          computedWatched++;
        } else {
          plRemainingDurationSec += dur;
        }
      }
      watchedCount = Math.max(watchedCount, computedWatched);
    }

    plTotalVideos += videoCount;
    plWatchedVideos += Math.min(videoCount, watchedCount);
    const percent = videoCount > 0 ? Math.round((Math.min(videoCount, watchedCount) / videoCount) * 100) : 0;

    return {
      id: pl.id,
      title: pl.title || pl.id,
      videoCount,
      watchedCount: Math.min(videoCount, watchedCount),
      percent,
      isCustom: Boolean(pl.isCustom),
    };
  });

  rankedPlaylists.sort((a, b) => b.videoCount - a.videoCount || a.title.localeCompare(b.title));

  const playlistsSummary = {
    totalVideos: plTotalVideos,
    watchedVideos: plWatchedVideos,
    totalDurationSec: plTotalDurationSec,
    remainingDurationSec: plRemainingDurationSec,
    topPlaylists: rankedPlaylists.slice(0, 10),
  };

  // Courses summary
  let totalLessons = 0;
  let completedLessons = 0;
  let progressSum = 0;

  for (const course of coursesList) {
    const prog = getCourseProgress(course);
    totalLessons += prog.totalCount;
    completedLessons += prog.completedCount;
    progressSum += prog.percent;
  }

  const coursesSummary = {
    totalCourses: coursesList.length,
    totalLessons,
    completedLessons,
    avgProgressPercent: coursesList.length > 0 ? Math.round(progressSum / coursesList.length) : 0,
  };

  // Top subscription groups by channel count
  /** @type {Map<string, number>} */
  const groupChannelCounts = new Map();
  for (const ch of channelsList) {
    for (const gid of ch.groupIds || []) {
      groupChannelCounts.set(gid, (groupChannelCounts.get(gid) || 0) + 1);
    }
  }

  const topGroups = subscriptionGroups
    .map((g) => ({
      id: g.id,
      name: g.name,
      color: g.color,
      icon: g.icon,
      channelCount: groupChannelCounts.get(g.id) || 0,
    }))
    .sort((a, b) => b.channelCount - a.channelCount || a.name.localeCompare(b.name))
    .slice(0, 10);

  return {
    totals,
    channelHealth,
    playlistsSummary,
    coursesSummary,
    topGroups,
  };
}
