import assert from 'node:assert/strict';
import test from 'node:test';
import type { RoomSnapshot } from '../src/types';
import { RoomDurableObject, type Env } from '../worker/index';
import { selectCandidateIndices } from '../worker/teamWordSelection';
import { BANGUMI_POPULAR_ANIME } from '../worker/data/bangumi-popular-anime';

test('keeps every lower-tier word before filling from the boundary tier', () => {
  const picked = selectCandidateIndices(8, [[3, 4, 5, 6, 7], [7]]);
  assert.ok([0, 1, 2].every(i => picked.includes(i)));
  assert.ok(!picked.includes(7));
  assert.equal(picked.length, 4);
});

test('balances individual unfamiliar counts within the same exclusion tier', () => {
  for (let run = 0; run < 30; run++) {
    const exclusions = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
    const picked = selectCandidateIndices(10, exclusions);
    assert.ok(picked.includes(0));
    assert.deepEqual(exclusions.map(vote => picked.filter(i => vote.includes(i)).length), [1, 1, 1]);
  }
});

test('tier priority takes precedence over a more balanced higher-tier combination', () => {
  const exclusions = [[2, 3, 4, 5, 6], [5, 6], [5, 6]];
  const picked = selectCandidateIndices(7, exclusions);
  assert.ok(picked.includes(0) && picked.includes(1));
  assert.ok(!picked.includes(5) && !picked.includes(6));
});

test('unanimous exclusions and a player knowing none never prevent four words', () => {
  const all = Array.from({ length: 12 }, (_, i) => i);
  for (const votes of [[all, all], [all, [0, 1, 2]]]) {
    const picked = selectCandidateIndices(12, votes);
    assert.equal(new Set(picked).size, 4);
  }
});

test('equal combinations are random and unavailable opponent words are excluded', () => {
  const outcomes = new Set(Array.from({ length: 40 }, () => selectCandidateIndices(12, []).sort((a, b) => a - b).join(',')));
  assert.ok(outcomes.size > 1);
  assert.deepEqual(selectCandidateIndices(8, [[4, 5, 6, 7]], [4, 5, 6, 7]).sort(), [4, 5, 6, 7]);
});

const settings = {
  timers: { encryptMinutes: 2, decodeMinutes: 2, interceptMinutes: 2 },
  forcePhaseTimeoutEnabled: false, lifeModeEnabled: true, lifePoints: 3,
  miscommunicationLimit: 2, allowMidgameJoin: true, bangumiCharacterExtractEnabled: false,
};

async function harness(poolSize = 40, legacySwitch?: boolean) {
  const stored = new Map<string, unknown>();
  const state = {
    storage: {
      get: async (key: string) => structuredClone(stored.get(key)),
      put: async (key: string, value: unknown) => { stored.set(key, structuredClone(value)); },
      setAlarm: async () => {},
    }, getWebSockets: () => [],
  } as DurableObjectState;
  const statement = { bind: (..._values: unknown[]) => statement, first: async () => null, run: async () => ({}) };
  const env = { DB: { prepare: () => statement } } as Env;
  let object = new RoomDurableObject(state, env);
  async function request(index: number, action?: object, status = 200): Promise<any> {
    const response = await object.fetch(new Request('https://test/room/selection-test/action', {
      method: action ? 'POST' : 'GET',
      headers: { 'x-decrypto-session': `11111111-1111-4111-8111-${String(index).padStart(12, '0')}` },
      ...(action ? { body: JSON.stringify(action) } : {}),
    }));
    assert.equal(response.status, status, await response.clone().text());
    const body = await response.json();
    return action ? body.data : body;
  }
  const snapshot = (index = 1) => request(index) as Promise<RoomSnapshot>;
  await request(1, { type: 'initRoom', playerName: 'Host', desiredRoomCode: 'ABC123' });
  for (const index of [1, 2, 3, 4, 5]) {
    if (index !== 1) await request(index, { type: 'joinRoom', playerName: `Player ${index}` });
    if (index !== 5) await request(index, { type: 'updateSelfTeam', team: index < 3 ? 'A' : 'B' });
  }
  await request(1, { type: 'updateRoomLobbySettings', payload: settings });
  const persisted = stored.get('state') as { room: object; bangumiCatalogEntries: Array<{ subjectId: number; title: string }> };
  if (legacySwitch !== undefined) Object.assign(persisted.room, { candidate_selection_enabled: legacySwitch });
  persisted.bangumiCatalogEntries = Array.from({ length: poolSize }, (_, i) => ({ subjectId: i + 1, title: `作品 ${i + 1}` }));
  const reload = () => { object = new RoomDurableObject(state, env); };
  reload();
  await request(1, { type: 'startGame' });
  const submit = async (index: number, excludedIndices: number[] | null, clientActionId?: string, status = 200) => {
    const selectionId = (await snapshot(index)).teamWordSelection!.id;
    return request(index, { type: 'submitTeamWordSelection', selectionId, excludedIndices, clientActionId }, status);
  };
  return { stored, request, snapshot, submit, reload };
}

test('new rooms and old lobbies always screen words without a settings switch', async () => {
  for (const legacySwitch of [undefined, false, true]) {
    const h = await harness(40, legacySwitch);
    const snapshot = await h.snapshot();
    assert.equal('candidate_selection_enabled' in snapshot.room, false);
    assert.equal(snapshot.teamWordSelection!.candidates.length, 12);
    assert.equal(snapshot.teamWordSelection!.completed, false);
    assert.ok(snapshot.teamWords[0].words.every(word => !word));
    await h.request(1, { type: 'generateTeamWords', team: 'A' }, 409);
  }
});

test('candidate statistics come from the offline catalog without an upstream request', async t => {
  const upstream = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No upstream request expected'); });
  const h = await harness();
  const state = h.stored.get('state') as { teamWordSelections: Array<{ team: string; candidates: Array<{ subjectId: number }> }> };
  const entry = BANGUMI_POPULAR_ANIME.find(entry => entry.subjectId === 485)!;
  state.teamWordSelections.find(selection => selection.team === 'A')!.candidates[0].subjectId = entry.subjectId;
  h.reload();
  const candidate = (await h.snapshot()).teamWordSelection!.candidates[0];
  assert.deepEqual(candidate.statistics, { year: entry.year, score: entry.score, collectionCount: entry.favoriteCount });
  assert.equal(upstream.mock.callCount(), 0);
  assert.equal((await h.snapshot(5)).teamWordSelection, null);
});

test('already-running legacy assignments keep their words instead of reopening screening', async () => {
  const h = await harness();
  const persisted = h.stored.get('state') as RoomSnapshot & { teamWordSelections?: unknown[] };
  delete persisted.teamWordSelections;
  Object.assign(persisted.room, { candidate_selection_enabled: false });
  const words = ['既有词一', '既有词二', '既有词三', '既有词四'];
  persisted.teamWords[0].words = words;
  persisted.teamWords[0].word_slots = words.map(text => ({ text }));
  h.reload();
  const snapshot = await h.snapshot();
  assert.equal(snapshot.teamWordSelection, null);
  assert.deepEqual(snapshot.teamWords[0].words, words);
  assert.equal('candidate_selection_enabled' in snapshot.room, false);
  await h.request(1, { type: 'confirmTeamWords', team: 'A', words, slots: [] });
  assert.equal((await h.snapshot()).room.team_a_words_confirmed, true);
});

test('private pools, own exclusions and progress survive reload without leaking teammate votes', async () => {
  const h = await harness();
  const before = await h.snapshot();
  assert.equal(before.teamWordSelection!.candidates.length, 12);
  assert.notDeepEqual((await h.snapshot(3)).teamWordSelection!.candidates, before.teamWordSelection!.candidates);
  assert.equal((await h.snapshot(5)).teamWordSelection, null);
  assert.ok((await h.snapshot(5)).teamWords.every(record => record.seen_words.length === 0));
  await h.submit(1, [0, 2]);
  h.reload();
  const own = (await h.snapshot()).teamWordSelection!;
  assert.deepEqual(own.own_excluded_indices, [0, 2]);
  assert.equal(own.submitted_player_ids.length, 1);
  assert.deepEqual(own.candidates, before.teamWordSelection!.candidates);
  const peer = (await h.snapshot(2)).teamWordSelection!;
  assert.equal(peer.own_excluded_indices, null);
  assert.deepEqual(peer.unfamiliar_by_word, {});
  assert.ok(!JSON.stringify(peer).includes('exclusions'));
});

test('all members including encoder must submit; teams complete independently and retries never redraw', async () => {
  const h = await harness();
  await h.submit(1, [0]);
  assert.equal((await h.snapshot()).teamWordSelection!.completed, false);
  await h.submit(1, null, undefined, 409);
  await h.submit(1, [1], undefined, 409);
  const locked = (await h.snapshot()).teamWordSelection!;
  assert.equal(locked.submitted_player_ids.length, 1);
  assert.deepEqual(locked.own_excluded_indices, [0]);
  const selectionId = (await h.snapshot(2)).teamWordSelection!.id;
  const action = { type: 'submitTeamWordSelection', selectionId, excludedIndices: [], clientActionId: 'selection-submit-retry-123' };
  await h.request(2, action);
  const completed = await h.snapshot();
  assert.equal(completed.teamWordSelection!.completed, true);
  assert.equal(completed.teamWords[0].words.filter(Boolean).length, 4);
  assert.equal((await h.snapshot(3)).teamWordSelection!.completed, false);
  h.reload();
  await h.request(2, action);
  assert.deepEqual((await h.snapshot()).teamWords, completed.teamWords);
  await h.submit(1, null, undefined, 409);
  await h.request(1, { type: 'generateTeamWords', team: 'A' }, 409);
  const words = await h.request(1, { type: 'replaceTeamWordSlot', team: 'A', index: 0 });
  assert.equal(words.length, 4);
  assert.notEqual(words[0].text, completed.teamWords[0].words[0]);
});

test('pending selection rejects bypasses, opponents, spectators and invalid exclusions', async () => {
  const h = await harness();
  const selectionId = (await h.snapshot()).teamWordSelection!.id;
  for (const index of [3, 5]) await h.request(index, { type: 'submitTeamWordSelection', selectionId, excludedIndices: [] }, 403);
  for (const value of [[-1], [12], [0, 0], [1.5], 'invalid', null]) {
    await h.request(1, { type: 'submitTeamWordSelection', selectionId, excludedIndices: value }, 400);
  }
  for (const action of [
    { type: 'generateTeamWords', team: 'A' },
    { type: 'replaceTeamWordSlot', team: 'A', index: 0 },
    { type: 'confirmTeamWords', team: 'A', words: ['一', '二', '三', '四'], slots: [] },
    { type: 'requestTeamWordFeedback', team: 'A', words: ['一', '二', '三', '四'], slots: [] },
    { type: 'saveTeamWords', team: 'A', words: ['一', '二', '三', '四'] },
  ]) await h.request(1, action, 409);
});

test('even a tiny catalog and unanimous exclusion still yield four distinct words per team', async () => {
  const h = await harness(8);
  const all = Array.from({ length: 8 }, (_, i) => i);
  for (const index of [1, 2, 3, 4]) await h.submit(index, all);
  const a = (await h.snapshot()).teamWords[0];
  const b = (await h.snapshot(3)).teamWords[0];
  assert.equal(new Set([...a.words, ...b.words]).size, 8);
  assert.ok(Object.values((await h.snapshot()).teamWordSelection!.unfamiliar_by_word).every(count => count === 2));
  await h.request(1, { type: 'confirmTeamWords', team: 'A', words: a.words, slots: a.word_slots });
  await h.request(3, { type: 'confirmTeamWords', team: 'B', words: b.words, slots: b.word_slots });
  assert.equal((await h.snapshot()).room.phase, 'encrypt');
  await h.request(1, { type: 'terminateGame' });
  assert.equal((await h.snapshot()).teamWordSelection, null);
});

test('team membership changes update the pending set without discarding submitted choices', async () => {
  const h = await harness();
  await h.request(6, { type: 'joinMidgameRoom', playerName: 'New player', team: 'A' });
  await h.submit(1, []);
  await h.submit(2, []);
  assert.equal((await h.snapshot()).teamWordSelection!.completed, false);
  const newcomer = (await h.snapshot(6)).players.find(player => player.player_name === 'New player')!;
  await h.request(1, { type: 'kickPlayer', playerId: newcomer.id });
  assert.equal((await h.snapshot()).teamWordSelection!.completed, true);
});

test('concurrent final submissions complete both teams once with no shared final words', async () => {
  const h = await harness();
  await h.submit(1, []);
  await h.submit(3, []);
  const aId = (await h.snapshot(2)).teamWordSelection!.id;
  const bId = (await h.snapshot(4)).teamWordSelection!.id;
  await Promise.all([
    h.request(2, { type: 'submitTeamWordSelection', selectionId: aId, excludedIndices: [] }),
    h.request(4, { type: 'submitTeamWordSelection', selectionId: bId, excludedIndices: [] }),
  ]);
  const a = await h.snapshot();
  const b = await h.snapshot(3);
  assert.ok(a.teamWordSelection!.completed && b.teamWordSelection!.completed);
  assert.equal(new Set([...a.teamWords[0].words, ...b.teamWords[0].words]).size, 8);
  h.reload();
  assert.deepEqual((await h.snapshot()).teamWords, a.teamWords);
  assert.deepEqual((await h.snapshot(3)).teamWords, b.teamWords);
});

test('legacy setting requests cannot disable screening and restarting creates fresh selections', async () => {
  const h = await harness();
  const previousId = (await h.snapshot()).teamWordSelection!.id;
  await h.request(1, { type: 'terminateGame' });
  await h.request(2, { type: 'updateRoomLobbySettings', payload: { ...settings, candidateSelectionEnabled: false } }, 403);
  await h.request(1, { type: 'updateRoomLobbySettings', payload: settings });
  h.reload();
  assert.equal('candidate_selection_enabled' in (await h.snapshot()).room, false);
  await h.request(1, { type: 'updateRoomLobbySettings', payload: { ...settings, candidateSelectionEnabled: false } });
  for (const index of [1, 2, 3, 4]) {
    await h.request(index, { type: 'updateSelfTeam', team: index < 3 ? 'A' : 'B' });
  }
  await h.request(1, { type: 'startGame' });
  const selection = (await h.snapshot()).teamWordSelection!;
  assert.notEqual(selection.id, previousId);
  assert.equal(selection.candidates.length, 12);
  assert.equal(selection.completed, false);
  assert.deepEqual(selection.submitted_player_ids, []);
});
