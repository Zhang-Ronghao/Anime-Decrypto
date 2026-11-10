import assert from 'node:assert/strict';
import test from 'node:test';
import { GuessDrafts } from '../worker/guessDrafts';
import { RoomDurableObject, type Env } from '../worker/index';
import { guessDraftTask } from '../src/lib/guessDraftModel';
import { clearGuessDraft, loadGuessDraft, saveGuessDraft } from '../src/lib/guessDraftStorage';
import { guessDraftFixture } from './fixtures/guessDraftRoom';

function update(hub: GuessDrafts, current = guessDraftFixture(), userId = 'user-A-2', overrides = {}) {
  const task = guessDraftTask(current.room, current.players, current.submissions, 'A')!;
  return hub.update(current, userId, { taskKey: task.key, digits: ['2', '', '4'], updatedAt: Date.now(), ...overrides });
}

test('live suggestions include submitter and members, forbid knowledgeable encoder and opposing tasks', () => {
  const current = guessDraftFixture();
  const hub = new GuessDrafts(); hub.reconcile(current);
  assert.equal(update(hub, current), true);
  assert.equal(update(hub, current, 'user-A-3'), true);
  assert.equal(update(hub, current, 'user-A-1'), false);
  assert.equal(update(hub, current, 'user-B-2'), false);
  assert.equal(update(hub, current, 'user-spectator'), false);
  assert.equal(update(hub, current, 'user-A-2', { digits: ['5', '', '1'] }), false);
  assert.deepEqual(hub.event(current, 'user-B-2')!.teams.map((entry) => [entry.task.team, entry.choices.length]), [['B', 0]]);
  assert.equal(hub.event(current, 'user-A-2')!.teams[0].choices.length, 2);
  assert.equal(hub.event(current, 'user-spectator')!.teams.length, 2);
  assert.equal(hub.event(current, 'removed-player'), null);
});

test('interception allows all seated teammates, locks submitted answers and expires forced tasks', () => {
  const current = guessDraftFixture('intercept');
  const hub = new GuessDrafts(); hub.reconcile(current);
  for (let index = 1; index <= 7; index++) assert.equal(update(hub, current, `user-A-${index}`), true);
  current.submissions[1].intercept_guess = '2-3-4'; hub.reconcile(current);
  assert.equal(update(hub, current), false);
  assert.equal(hub.event(current, 'user-A-2')!.teams[0].choices.length, 0);
  current.submissions[1].intercept_guess = null;
  current.room.force_phase_timeout_enabled = true;
  current.room.phase_deadline_at = '2020-01-01T00:00:00Z'; hub.reconcile(current);
  assert.equal(update(hub, current), false);
});

test('replay is idempotent and older tabs cannot replace a newer selection or cleared choice', () => {
  const current = guessDraftFixture(); const hub = new GuessDrafts(); hub.reconcile(current);
  const timestamp = Date.now();
  assert.equal(update(hub, current, 'user-A-2', { updatedAt: timestamp }), true);
  assert.equal(update(hub, current, 'user-A-2', { updatedAt: timestamp }), false);
  assert.equal(update(hub, current, 'user-A-2', { updatedAt: timestamp + 1, digits: ['', '', ''] }), true);
  assert.equal(update(hub, current, 'user-A-2', { updatedAt: timestamp }), false);
  assert.deepEqual(hub.event(current, 'user-A-2')!.teams[0].choices[0].digits, ['', '', '']);
});

test('phase, round, restart, seat changes and membership removal invalidate stale suggestions', () => {
  for (const mutation of [
    (current: ReturnType<typeof guessDraftFixture>) => { current.room.phase = 'intercept'; },
    (current: ReturnType<typeof guessDraftFixture>) => { current.room.round_number++; },
    (current: ReturnType<typeof guessDraftFixture>) => { current.submissions[0].id = 'new-game-submission'; },
    (current: ReturnType<typeof guessDraftFixture>) => { current.players[1].role = 'encoder'; },
    (current: ReturnType<typeof guessDraftFixture>) => { current.players.splice(1, 1); },
  ]) {
    const current = guessDraftFixture(); const hub = new GuessDrafts(); hub.reconcile(current);
    const taskKey = guessDraftTask(current.room, current.players, current.submissions, 'A')!.key;
    update(hub, current); mutation(current); hub.reconcile(current);
    assert.equal(hub.update(current, 'user-A-2', { taskKey, digits: ['1', '2', '3'], updatedAt: Date.now() + 1 }), false);
    assert.equal(hub.event(current, 'user-A-1')!.teams.flatMap((entry) => entry.choices).length, 0);
  }
});

test('DO wake requests browser replay and the WebSocket path performs zero storage writes', async () => {
  const current = guessDraftFixture();
  const sockets = ['user-A-2', 'user-A-3', 'user-B-2'].map((userId) => ({
    sent: [] as string[],
    deserializeAttachment: () => ({ roomId: current.room.id, userId }),
    send(message: string) { this.sent.push(message); }, close() {},
  }));
  let writes = 0;
  const state = {
    storage: {
      get: async (key: string) => key === 'state' ? current : { lastActivityAt: '2026-11-10', expiresAt: '2030-01-01' },
      put: async () => { writes++; }, setAlarm: async () => { writes++; },
    },
    getWebSockets: () => sockets,
  };
  const env = { DB: { prepare: () => { throw new Error('Transient guesses must never access D1'); } } };
  const makeDO = () => new RoomDurableObject(state as unknown as DurableObjectState, env as unknown as Env);
  const first = makeDO();
  const task = guessDraftTask(current.room, current.players, current.submissions, 'A')!;
  const message = JSON.stringify({ type: 'guess_draft_update', taskKey: task.key, digits: ['2', '', '4'], updatedAt: Date.now() });
  await first.webSocketMessage(sockets[0] as unknown as WebSocket, message);
  assert.ok(sockets[1].sent.some((value) => JSON.parse(value).requestSync));
  assert.deepEqual(JSON.parse(sockets[1].sent.at(-1)!).teams[0].choices[0].digits, ['2', '', '4']);
  assert.equal(JSON.parse(sockets[2].sent.at(-1)!).teams[0].choices.length, 0);
  const recreated = makeDO(); // Same durable state and sockets, a fresh ordinary heap.
  await recreated.webSocketMessage(sockets[1] as unknown as WebSocket, JSON.stringify({ type: 'guess_draft_request' }));
  assert.equal(JSON.parse(sockets[0].sent.at(-1)!).requestSync, true);
  await recreated.webSocketMessage(sockets[0] as unknown as WebSocket, message);
  assert.deepEqual(JSON.parse(sockets[1].sent.at(-1)!).teams[0].choices[0].digits, ['2', '', '4']);
  assert.equal(writes, 0);
  assert.equal(current.room.revision, 1);
  assert.deepEqual(current.roundGuessFeedbackResponses, []);
  assert.equal(JSON.stringify(current).includes('taskKey'), false);
});

test('browser session restores only validated choices and can clear completed tasks', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const value = { taskKey: 'current-task', seatKey: 'A-2:A:decoder:2', playerId: 'A-2', digits: ['2', '', '4'] as [string, string, string], updatedAt: Date.now() };
  saveGuessDraft('room', value, storage);
  assert.deepEqual(loadGuessDraft('room', 'A-2', storage), value);
  assert.equal(loadGuessDraft('room', 'B-2', storage), null);
  clearGuessDraft('room', 'A-2', storage);
  assert.equal(loadGuessDraft('room', 'A-2', storage), null);
});
