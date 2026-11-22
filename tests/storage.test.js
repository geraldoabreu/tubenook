import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  GROUP_KINDS,
  DECK_SOURCE_TYPES,
  SORT_OPTIONS,
} from '../src/shared/types.js';
import {
  createMemoryBackend,
  setStorageBackend,
  loadState,
  resetState,
  updateSettings,
  getDescendants,
  getAncestors,
  getGroupDepth,
  wouldCreateCycle,
  getGroupTree,
  createGroup,
  updateGroup,
  moveGroup,
  deleteGroup,
  upsertChannels,
  upsertChannel,
  removeChannel,
  assignChannelToGroups,
  addChannelToGroup,
  removeChannelFromGroup,
  bulkAssignChannelsToGroup,
  setChannelTags,
  getChannelsByGroup,
  exportChannelsCsv,
  upsertPlaylists,
  upsertPlaylist,
  removePlaylist,
  assignPlaylistToGroups,
  updatePlaylistProgress,
  getPlaylistProgressPercent,
  getPlaylistsByGroup,
  addVideoToPlaylist,
  removeVideoFromPlaylist,
  reorderPlaylistVideos,
  moveVideoToTop,
  moveVideoToBottom,
  setPlaylistThumbnail,
  markVideoWatched,
  unmarkVideoWatched,
  toggleVideoWatched,
  bulkMarkWatched,
  isVideoWatched,
  clearWatchedHistory,
  createDeckColumn,
  updateDeckColumn,
  deleteDeckColumn,
  saveDeckColumns,
  reorderDeckColumns,
  upsertVideoNote,
  deleteVideoNote,
  saveSmartRules,
  applySmartRulesToChannels,
  createCourse,
  updateCourse,
  deleteCourse,
  addLessonToCourse,
  removeLessonFromCourse,
  toggleLessonComplete,
  applyCourseSequence,
  exportStateJson,
  validateImportData,
  importStateJson,
} from '../src/shared/storage.js';

describe('storage.js — Nested Groups, Channels, Playlists, Watched, Deck, Import/Export', () => {
  beforeEach(() => {
    setStorageBackend(createMemoryBackend());
  });

  describe('Nested Groups (3+ levels deep) & Cycle Prevention', () => {
    it('creates 4-level deep nested groups and computes depth, ancestors, descendants, and tree', async () => {
      const { group: root } = await createGroup({ name: 'Tech', kind: GROUP_KINDS.SUBSCRIPTION });
      const { group: lvl1 } = await createGroup({ name: 'Dev', parentId: root.id, kind: GROUP_KINDS.SUBSCRIPTION });
      const { group: lvl2 } = await createGroup({ name: 'Frontend', parentId: lvl1.id, kind: GROUP_KINDS.SUBSCRIPTION });
      const { group: lvl3 } = await createGroup({ name: 'React', parentId: lvl2.id, kind: GROUP_KINDS.SUBSCRIPTION });
      const { group: plRoot } = await createGroup({ name: 'Music Playlists', kind: GROUP_KINDS.PLAYLIST });

      const state = await loadState();
      assert.equal(getGroupDepth(state.groups, root.id), 0);
      assert.equal(getGroupDepth(state.groups, lvl1.id), 1);
      assert.equal(getGroupDepth(state.groups, lvl2.id), 2);
      assert.equal(getGroupDepth(state.groups, lvl3.id), 3);

      assert.deepEqual(getAncestors(state.groups, lvl3.id), [lvl2.id, lvl1.id, root.id]);
      assert.deepEqual(getAncestors(state.groups, root.id), []);

      const desc = getDescendants(state.groups, root.id);
      assert.equal(desc.length, 3);
      assert.ok(desc.includes(lvl1.id));
      assert.ok(desc.includes(lvl2.id));
      assert.ok(desc.includes(lvl3.id));

      const subTree = getGroupTree(state.groups, GROUP_KINDS.SUBSCRIPTION);
      assert.equal(subTree.length, 1);
      assert.equal(subTree[0].id, root.id);
      assert.equal(subTree[0].children[0].id, lvl1.id);
      assert.equal(subTree[0].children[0].children[0].id, lvl2.id);
      assert.equal(subTree[0].children[0].children[0].children[0].id, lvl3.id);

      const plTree = getGroupTree(state.groups, GROUP_KINDS.PLAYLIST);
      assert.equal(plTree.length, 1);
      assert.equal(plTree[0].id, plRoot.id);
    });

    it('detects cycles via wouldCreateCycle and blocks cyclic moveGroup/updateGroup', async () => {
      const { group: a } = await createGroup({ name: 'A' });
      const { group: b } = await createGroup({ name: 'B', parentId: a.id });
      const { group: c } = await createGroup({ name: 'C', parentId: b.id });
      const { group: d } = await createGroup({ name: 'D' });

      const state = await loadState();
      assert.equal(wouldCreateCycle(state.groups, a.id, a.id), true);
      assert.equal(wouldCreateCycle(state.groups, a.id, b.id), true);
      assert.equal(wouldCreateCycle(state.groups, a.id, c.id), true);
      assert.equal(wouldCreateCycle(state.groups, a.id, d.id), false);
      assert.equal(wouldCreateCycle(state.groups, a.id, null), false);

      await assert.rejects(() => moveGroup(a.id, c.id), /cycle|descendants|itself/i);
      await assert.rejects(() => moveGroup(a.id, a.id), /cycle|descendants|itself/i);
      await assert.rejects(() => updateGroup(a.id, { parentId: b.id }), /cycle|descendants|itself/i);
    });

    it('moves and reorders groups cleanly and prevents cross-kind parenting', async () => {
      const { group: g1 } = await createGroup({ name: 'First' });
      const { group: g2 } = await createGroup({ name: 'Second' });
      const { group: g3 } = await createGroup({ name: 'Third' });
      const { group: pl } = await createGroup({ name: 'Playlist Group', kind: GROUP_KINDS.PLAYLIST });

      await assert.rejects(() => moveGroup(g1.id, pl.id), /same kind/i);

      // Move g3 to index 0 at root
      const state = await moveGroup(g3.id, null, 0);
      const tree = getGroupTree(state.groups, GROUP_KINDS.SUBSCRIPTION);
      assert.deepEqual(
        tree.map((n) => n.id),
        [g3.id, g1.id, g2.id]
      );

      // Move g2 under g3
      const state2 = await moveGroup(g2.id, g3.id, 0);
      assert.equal(state2.groups[g2.id].parentId, g3.id);
    });

    it('deleteGroup with reparent mode moves direct children up and cleans references', async () => {
      const { group: root } = await createGroup({ name: 'Root' });
      const { group: mid } = await createGroup({ name: 'Mid', parentId: root.id });
      const { group: leaf } = await createGroup({ name: 'Leaf', parentId: mid.id });

      await upsertChannel({ id: 'UC_1', title: 'Ch 1' });
      await assignChannelToGroups('UC_1', [mid.id, leaf.id]);
      await createDeckColumn({ title: 'Mid Col', sourceType: DECK_SOURCE_TYPES.GROUP, sourceId: mid.id });

      const next = await deleteGroup(mid.id, { mode: 'reparent' });
      assert.equal(next.groups[mid.id], undefined);
      assert.equal(next.groups[leaf.id].parentId, root.id);
      assert.deepEqual(next.channels['UC_1'].groupIds, [leaf.id]);
      assert.equal(next.deckColumns.some((c) => c.sourceId === mid.id), false);
    });

    it('deleteGroup with cascade mode removes all descendants and cleans references', async () => {
      const { group: root } = await createGroup({ name: 'Root' });
      const { group: child } = await createGroup({ name: 'Child', parentId: root.id });
      const { group: grand } = await createGroup({ name: 'Grand', parentId: child.id });

      await upsertChannel({ id: 'UC_2', title: 'Ch 2' });
      await assignChannelToGroups('UC_2', [root.id, grand.id]);

      const next = await deleteGroup(root.id, { mode: 'cascade' });
      assert.equal(next.groups[root.id], undefined);
      assert.equal(next.groups[child.id], undefined);
      assert.equal(next.groups[grand.id], undefined);
      assert.deepEqual(next.channels['UC_2'].groupIds, []);
    });
  });

  describe('Multi-Group Channel Assignment & CSV Export', () => {
    it('supports multi-group assignment, bulk assign, tags, and descendant lookup', async () => {
      const { group: gParent } = await createGroup({ name: 'Dev' });
      const { group: gChild } = await createGroup({ name: 'Rust', parentId: gParent.id });
      const { group: gOther } = await createGroup({ name: 'Podcasts' });
      const { group: gPlaylist } = await createGroup({ name: 'PL', kind: GROUP_KINDS.PLAYLIST });

      await upsertChannels([
        { id: 'UC_A', title: 'Rust Coding', handle: '@rustcoding', lastVideoAt: Date.now() },
        { id: 'UC_B', title: 'Tech Podcast', handle: '@techpod', lastVideoAt: Date.now() },
      ]);

      // Multi-group assignment filters out non-subscription groups
      let state = await assignChannelToGroups('UC_A', [gChild.id, gOther.id, gPlaylist.id, 'nonexistent']);
      assert.deepEqual(state.channels['UC_A'].groupIds.sort(), [gChild.id, gOther.id].sort());

      state = await addChannelToGroup('UC_B', gParent.id);
      assert.deepEqual(state.channels['UC_B'].groupIds, [gParent.id]);

      // getChannelsByGroup with vs without descendants
      const withDesc = getChannelsByGroup(state, gParent.id, { includeDescendants: true });
      assert.equal(withDesc.length, 2);
      const directOnly = getChannelsByGroup(state, gParent.id, { includeDescendants: false });
      assert.equal(directOnly.length, 1);
      assert.equal(directOnly[0].id, 'UC_B');

      // Remove from one group
      state = await removeChannelFromGroup('UC_A', gOther.id);
      assert.deepEqual(state.channels['UC_A'].groupIds, [gChild.id]);

      // Bulk assign add & remove
      state = await bulkAssignChannelsToGroup(['UC_A', 'UC_B'], gOther.id, 'add');
      assert.ok(state.channels['UC_A'].groupIds.includes(gOther.id));
      assert.ok(state.channels['UC_B'].groupIds.includes(gOther.id));

      state = await bulkAssignChannelsToGroup(['UC_A', 'UC_B'], gOther.id, 'remove');
      assert.ok(!state.channels['UC_A'].groupIds.includes(gOther.id));
      assert.ok(!state.channels['UC_B'].groupIds.includes(gOther.id));

      // Manual tags deduplication
      state = await setChannelTags('UC_A', ['  systems ', 'systems', '', 'favorite']);
      assert.deepEqual(state.channels['UC_A'].tags, ['systems', 'favorite']);

      // Remove channel
      state = await removeChannel('UC_B');
      assert.equal(state.channels['UC_B'], undefined);
    });

    it('exports channels as valid RFC 4180 CSV with escaped quotes and commas', async () => {
      const { group: g1 } = await createGroup({ name: 'Tech, AI' });
      const ts = Date.UTC(2026, 0, 15, 12, 0, 0);
      await upsertChannel({
        id: 'UC_CSV',
        title: 'Channel "Alpha", Dev',
        handle: '@alpha',
        url: 'https://www.youtube.com/channel/UC_CSV',
        tags: ['tag1', 'tag2'],
        lastVideoAt: ts,
      });
      const state = await assignChannelToGroups('UC_CSV', [g1.id]);
      const csv = exportChannelsCsv(state.channels, state.groups);
      const lines = csv.split('\n');
      assert.equal(lines.length, 2);
      assert.ok(lines[0].startsWith('Channel ID,Title,Handle,URL,Groups,Tags,Auto Tags,Status,Last Video At'));
      assert.ok(lines[1].includes('"Channel ""Alpha"", Dev"'));
      assert.ok(lines[1].includes('"Tech, AI"'));
      assert.ok(lines[1].includes('tag1; tag2'));
      assert.ok(lines[1].includes('2026-01-15T12:00:00.000Z'));
    });
  });

  describe('Multi-Group Playlist Assignment & Progress %', () => {
    it('assigns playlists to multiple playlist groups and calculates progress %', async () => {
      const { group: pg1 } = await createGroup({ name: 'Courses', kind: GROUP_KINDS.PLAYLIST });
      const { group: pg2 } = await createGroup({ name: 'JS', parentId: pg1.id, kind: GROUP_KINDS.PLAYLIST });
      const { group: subGrp } = await createGroup({ name: 'SubGrp', kind: GROUP_KINDS.SUBSCRIPTION });

      await upsertPlaylists([
        { id: 'PL_1', title: 'JS Full Course', videoCount: 20, watchedCount: 5 },
        { id: 'PL_2', title: 'Empty PL', videoCount: 0, watchedCount: 0 },
      ]);

      let state = await assignPlaylistToGroups('PL_1', [pg1.id, pg2.id, subGrp.id]);
      assert.deepEqual(state.playlists['PL_1'].groupIds.sort(), [pg1.id, pg2.id].sort());

      assert.equal(getPlaylistProgressPercent(state.playlists['PL_1']), 25);
      assert.equal(getPlaylistProgressPercent(state.playlists['PL_2']), 0);
      assert.equal(getPlaylistProgressPercent({ videoCount: 10, watchedCount: 15 }), 100);
      assert.equal(getPlaylistProgressPercent({ videoCount: 10, watchedCount: -3 }), 0);

      state = await updatePlaylistProgress('PL_1', 15, 20);
      assert.equal(getPlaylistProgressPercent(state.playlists['PL_1']), 75);

      // Clamps watchedCount to videoCount
      state = await updatePlaylistProgress('PL_1', 999);
      assert.equal(state.playlists['PL_1'].watchedCount, 20);
      assert.equal(getPlaylistProgressPercent(state.playlists['PL_1']), 100);

      const byGroup = getPlaylistsByGroup(state, pg1.id, { includeDescendants: true });
      assert.equal(byGroup.length, 1);
      assert.equal(byGroup[0].id, 'PL_1');

      state = await removePlaylist('PL_2');
      assert.equal(state.playlists['PL_2'], undefined);
    });
  });

  describe('Unlimited Mark-as-Watched Operations', () => {
    it('supports mark, unmark, toggle, bulk (500+ videos), and clear', async () => {
      let state = await markVideoWatched('vid_1', { title: 'Video 1', channelId: 'UC_1', durationSec: 320 });
      assert.equal(isVideoWatched(state, 'vid_1'), true);
      assert.equal(state.watched['vid_1'].title, 'Video 1');

      state = await unmarkVideoWatched('vid_1');
      assert.equal(isVideoWatched(state, 'vid_1'), false);

      const t1 = await toggleVideoWatched('vid_2', { title: 'Video 2' });
      assert.equal(t1.watched, true);
      assert.equal(isVideoWatched(t1.state, 'vid_2'), true);

      const t2 = await toggleVideoWatched('vid_2');
      assert.equal(t2.watched, false);
      assert.equal(isVideoWatched(t2.state, 'vid_2'), false);

      // Unlimited bulk mark (600 videos)
      const batch = Array.from({ length: 600 }, (_, i) => ({
        videoId: `vid_bulk_${i}`,
        title: `Bulk ${i}`,
      }));
      state = await bulkMarkWatched(batch, true);
      assert.equal(Object.keys(state.watched).length, 600);
      assert.equal(isVideoWatched(state, 'vid_bulk_599'), true);

      // Bulk unmark subset
      state = await bulkMarkWatched(batch.slice(0, 100), false);
      assert.equal(Object.keys(state.watched).length, 500);
      assert.equal(isVideoWatched(state, 'vid_bulk_0'), false);
      assert.equal(isVideoWatched(state, 'vid_bulk_100'), true);

      // Clear all
      state = await clearWatchedHistory();
      assert.equal(Object.keys(state.watched).length, 0);
    });
  });

  describe('Deck Columns CRUD & Reorder', () => {
    it('creates, updates, reorders, replaces, and deletes deck columns', async () => {
      const initial = await loadState();
      assert.equal(initial.deckColumns.length, 2);

      const { column: col } = await createDeckColumn({
        title: 'AI Group',
        sourceType: DECK_SOURCE_TYPES.GROUP,
        sourceId: 'grp_1',
        sortBy: SORT_OPTIONS.VIEWS_DESC,
        width: 1000, // should clamp to 720
      });
      assert.equal(col.width, 720);

      let state = await updateDeckColumn(col.id, {
        title: 'AI & Dev',
        filters: { hideWatched: true },
      });
      const updated = state.deckColumns.find((c) => c.id === col.id);
      assert.equal(updated.title, 'AI & Dev');
      assert.equal(updated.filters.hideWatched, true);
      assert.equal(updated.filters.hideShorts, false);

      // Reorder: put new column first, omit one to verify it is appended
      state = await reorderDeckColumns([col.id, 'col_wl_default']);
      assert.deepEqual(
        state.deckColumns.map((c) => c.id),
        [col.id, 'col_wl_default', 'col_subs_default']
      );

      state = await deleteDeckColumn(col.id);
      assert.equal(state.deckColumns.some((c) => c.id === col.id), false);

      state = await saveDeckColumns([{ id: 'custom_1', title: 'Only', sourceType: 'subscriptions', sourceId: null, sortBy: 'date_desc', filters: {}, width: 360 }]);
      assert.equal(state.deckColumns.length, 1);
      assert.equal(state.deckColumns[0].id, 'custom_1');
    });
  });

  describe('JSON Export & Import Validation', () => {
    it('exports and imports state in replace and merge modes', async () => {
      const { group: g1 } = await createGroup({ name: 'Group One' });
      await upsertChannel({ id: 'UC_EXP', title: 'Exported Channel' });
      await markVideoWatched('vid_exp', { title: 'Watched Exp' });
      const exported = exportStateJson(await loadState());

      const parsed = JSON.parse(exported);
      assert.equal(parsed.app, 'TubeNook');
      assert.equal(validateImportData(parsed).valid, true);

      // Reset and replace-import
      await resetState();
      let state = await loadState();
      assert.equal(Object.keys(state.groups).length, 0);

      state = await importStateJson(exported, { merge: false });
      assert.ok(state.groups[g1.id]);
      assert.ok(state.channels['UC_EXP']);
      assert.ok(state.watched['vid_exp']);

      // Add a local group and merge-import another backup
      const { group: gLocal } = await createGroup({ name: 'Local Group' });
      const incomingBackup = JSON.stringify({
        data: {
          groups: { grp_inc: { id: 'grp_inc', name: 'Incoming', parentId: null, kind: 'subscription', icon: { type: 'emoji', value: '📁' }, color: '#ef233c', order: 0, collapsed: false, createdAt: 1 } },
          channels: {},
          playlists: {},
          watched: { vid_inc: { videoId: 'vid_inc', watchedAt: 1 } },
        },
      });
      state = await importStateJson(incomingBackup, { merge: true });
      assert.ok(state.groups[gLocal.id]);
      assert.ok(state.groups['grp_inc']);
      assert.ok(state.watched['vid_exp']);
      assert.ok(state.watched['vid_inc']);
    });

    it('rejects malformed or invalid JSON payloads', async () => {
      assert.equal(validateImportData(null).valid, false);
      assert.equal(validateImportData('string').valid, false);
      assert.equal(validateImportData({ foo: 'bar' }).valid, false);

      await assert.rejects(() => importStateJson('{ bad json'), /Malformed JSON/i);
      await assert.rejects(() => importStateJson(JSON.stringify({ hello: 'world' })), /missing TubeNook/i);
    });

    it('recomputes channel statuses when statusConfig changes in updateSettings', async () => {
      const daysAgo20 = Date.now() - 20 * 24 * 60 * 60 * 1000;
      await upsertChannel({ id: 'UC_STAT', title: 'Status Test', lastVideoAt: daysAgo20 });
      let state = await loadState();
      assert.equal(state.channels['UC_STAT'].status, 'slow'); // default activeDays=14

      state = await updateSettings({ statusConfig: { activeDays: 30, slowDays: 60, inactiveDays: 180 } });
      assert.equal(state.channels['UC_STAT'].status, 'active');
    });
  });

  describe('Custom Playlists (Add, Dedup, Remove, Reorder, Move Top/Bottom, Thumbnail)', () => {
    it('manages custom playlist videos, deduplicates, computes watch_videos URL, and sets thumbnail', async () => {
      await upsertPlaylist({
        id: 'pl_custom_1',
        title: 'Study Queue',
        isCustom: true,
        videos: [],
      });

      let state = await addVideoToPlaylist('pl_custom_1', {
        videoId: 'vidA',
        title: 'Intro to JS',
        channelTitle: 'Code Channel',
        durationSec: 600,
      });
      state = await addVideoToPlaylist('pl_custom_1', {
        videoId: 'vidB',
        title: 'Async Patterns',
        channelTitle: 'Code Channel',
        durationSec: 900,
      });
      state = await addVideoToPlaylist('pl_custom_1', {
        videoId: 'vidC',
        title: 'Testing in Node',
        channelTitle: 'Code Channel',
        durationSec: 450,
      });

      // Duplicate videoId updates in place without increasing videoCount
      state = await addVideoToPlaylist('pl_custom_1', {
        videoId: 'vidB',
        title: 'Async Patterns (Updated)',
        channelTitle: 'Code Channel',
        durationSec: 950,
      });

      let pl = state.playlists['pl_custom_1'];
      assert.equal(pl.videoCount, 3);
      assert.deepEqual(
        pl.videos.map((v) => v.videoId),
        ['vidA', 'vidB', 'vidC']
      );
      assert.equal(pl.videos[1].title, 'Async Patterns (Updated)');
      assert.equal(pl.url, 'https://www.youtube.com/watch_videos?video_ids=vidA,vidB,vidC');

      // Reorder
      state = await reorderPlaylistVideos('pl_custom_1', ['vidC', 'vidA', 'vidB']);
      pl = state.playlists['pl_custom_1'];
      assert.deepEqual(
        pl.videos.map((v) => v.videoId),
        ['vidC', 'vidA', 'vidB']
      );
      assert.equal(pl.url, 'https://www.youtube.com/watch_videos?video_ids=vidC,vidA,vidB');

      // Move to top
      state = await moveVideoToTop('pl_custom_1', 'vidB');
      assert.deepEqual(
        state.playlists['pl_custom_1'].videos.map((v) => v.videoId),
        ['vidB', 'vidC', 'vidA']
      );

      // Move to bottom
      state = await moveVideoToBottom('pl_custom_1', 'vidB');
      assert.deepEqual(
        state.playlists['pl_custom_1'].videos.map((v) => v.videoId),
        ['vidC', 'vidA', 'vidB']
      );

      // Set custom thumbnail
      state = await setPlaylistThumbnail('pl_custom_1', 'https://example.com/custom-thumb.jpg');
      assert.equal(state.playlists['pl_custom_1'].customThumbnailUrl, 'https://example.com/custom-thumb.jpg');
      assert.equal(state.playlists['pl_custom_1'].thumbnailUrl, 'https://example.com/custom-thumb.jpg');

      // Remove video updates count & URL
      state = await removeVideoFromPlaylist('pl_custom_1', 'vidA');
      pl = state.playlists['pl_custom_1'];
      assert.equal(pl.videoCount, 2);
      assert.deepEqual(
        pl.videos.map((v) => v.videoId),
        ['vidC', 'vidB']
      );
      assert.equal(pl.url, 'https://www.youtube.com/watch_videos?video_ids=vidC,vidB');
    });
  });

  describe('Channel Deduplication (@handle + UC... merge)', () => {
    it('merges @handle and UC... records into one canonical UC... record preserving groupIds and tags', async () => {
      const { group: g1 } = await createGroup({ name: 'Tech' });
      const { group: g2 } = await createGroup({ name: 'Favorites' });

      // First upsert with @handle
      await upsertChannel({
        id: '@Fireship',
        handle: '@Fireship',
        title: 'Fireship',
        groupIds: [g1.id],
        tags: ['coding'],
      });

      // Second upsert with UC... ID and same handle (case-insensitive)
      let state = await upsertChannel({
        id: 'UCsBjURrPoezykLs9EqgamOA',
        handle: '@fireship',
        title: 'Fireship Official',
        groupIds: [g2.id],
        tags: ['shorts'],
      });

      assert.equal(Object.keys(state.channels).length, 1);
      assert.equal(state.channels['@Fireship'], undefined);
      const merged = state.channels['UCsBjURrPoezykLs9EqgamOA'];
      assert.ok(merged);
      assert.equal(merged.id, 'UCsBjURrPoezykLs9EqgamOA');
      assert.equal(merged.ucId, 'UCsBjURrPoezykLs9EqgamOA');
      assert.deepEqual(merged.groupIds.sort(), [g1.id, g2.id].sort());
      assert.deepEqual(merged.tags.sort(), ['coding', 'shorts'].sort());

      // Upserting @handle again later keeps canonical UC... record and merges metadata
      state = await upsertChannel({
        id: '@fireship',
        handle: '@fireship',
        tags: ['dev'],
      });
      assert.equal(Object.keys(state.channels).length, 1);
      assert.ok(state.channels['UCsBjURrPoezykLs9EqgamOA']);
      assert.deepEqual(
        state.channels['UCsBjURrPoezykLs9EqgamOA'].tags.sort(),
        ['coding', 'dev', 'shorts']
      );
    });
  });

  describe('Video Notes & Smart Rules', () => {
    it('upserts, updates, sorts by timestamp, and deletes video notes', async () => {
      const notes1 = await upsertVideoNote('vid_note_1', {
        timestampSec: 120,
        text: 'Key takeaway at 2:00',
      });
      assert.equal(notes1.length, 1);
      const firstId = notes1[0].id;

      const notes2 = await upsertVideoNote('vid_note_1', {
        timestampSec: 30,
        text: 'Intro note at 0:30',
      });
      assert.equal(notes2.length, 2);
      assert.equal(notes2[0].timestampSec, 30);
      assert.equal(notes2[1].timestampSec, 120);

      // Update existing note
      const notes3 = await upsertVideoNote('vid_note_1', {
        id: firstId,
        timestampSec: 125,
        text: 'Updated takeaway',
      });
      assert.equal(notes3.length, 2);
      assert.equal(notes3[1].text, 'Updated takeaway');

      // Delete one note
      let state = await deleteVideoNote('vid_note_1', firstId);
      assert.equal(state.videoNotes['vid_note_1'].length, 1);

      // Delete remaining note removes videoId key cleanly
      const remainingId = state.videoNotes['vid_note_1'][0].id;
      state = await deleteVideoNote('vid_note_1', remainingId);
      assert.equal(state.videoNotes['vid_note_1'], undefined);
    });

    it('saves smart rules and applies enabled assign_group rules to matching channels', async () => {
      const { group: gAi } = await createGroup({ name: 'AI' });
      const { group: gMusic } = await createGroup({ name: 'Music' });

      await upsertChannels([
        { id: 'UC_AI_1', title: 'Deep Learning Lab', handle: '@dllab', tags: ['ai', 'ml'] },
        { id: 'UC_MUS_1', title: 'LoFi Beats Radio', handle: '@lofibeats', tags: ['chill'] },
        { id: 'UC_OTHER', title: 'Cooking Daily', handle: '@cooking' },
      ]);

      let state = await saveSmartRules([
        {
          id: 'r_tag',
          name: 'Tag AI -> AI Group',
          enabled: true,
          matchType: 'tag',
          pattern: 'ai',
          actionType: 'assign_group',
          targetGroupId: gAi.id,
        },
        {
          id: 'r_kw',
          name: 'Keyword LoFi -> Music Group',
          enabled: true,
          matchType: 'keyword',
          pattern: 'lofi',
          actionType: 'assign_group',
          targetGroupId: gMusic.id,
        },
        {
          id: 'r_disabled',
          name: 'Disabled rule',
          enabled: false,
          matchType: 'keyword',
          pattern: 'cooking',
          actionType: 'assign_group',
          targetGroupId: gMusic.id,
        },
      ]);

      assert.equal(state.smartRules.length, 3);
      applySmartRulesToChannels(state);

      assert.deepEqual(state.channels['UC_AI_1'].groupIds, [gAi.id]);
      assert.deepEqual(state.channels['UC_MUS_1'].groupIds, [gMusic.id]);
      assert.deepEqual(state.channels['UC_OTHER'].groupIds, []);
    });
  });
});
