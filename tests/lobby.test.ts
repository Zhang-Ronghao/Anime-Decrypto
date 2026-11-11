import assert from 'node:assert/strict';
import test from 'node:test';
import type { RoomSnapshot, Team } from '../src/types';
import { RoomDurableObject, type Env } from '../worker/index';

function lobbyHarness() {
  const stored = new Map<string, unknown>();
  const state = {
    storage: {
      get: async (key: string) => structuredClone(stored.get(key)),
      put: async (key: string, value: unknown) => { stored.set(key, structuredClone(value)); },
      setAlarm: async () => {},
    },
    getWebSockets: () => [],
  } as DurableObjectState;
  const statement = { bind: (..._values: unknown[]) => statement, first: async () => null, run: async () => ({}) };
  const env = { DB: { prepare: () => statement } } as Env;
  let object = new RoomDurableObject(state, env);
  const user = (index: number) => `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`;
  async function request(index: number, action?: object, status = 200) {
    const response = await object.fetch(new Request('https://test/room/lobby-test/action', {
      method: action ? 'POST' : 'GET',
      headers: { 'x-decrypto-session': user(index) },
      ...(action ? { body: JSON.stringify(action) } : {}),
    }));
    assert.equal(response.status, status, await response.clone().text());
    return response.json();
  }
  return {
    stored, request,
    reload: () => { object = new RoomDurableObject(state, env); },
    init: () => request(1, { type: 'initRoom', playerName: 'Host', desiredRoomCode: 'ABC123' }),
    join: async (index: number, team: Team | null = null) => {
      if (index !== 1) await request(index, { type: 'joinRoom', playerName: `Player ${index}` });
      if (team) await request(index, { type: 'updateSelfTeam', team });
    },
    snapshot: (index = 1) => request(index) as Promise<RoomSnapshot>,
  };
}

test('teams grow past the old seven-player capacity and repeated joins preserve rotation order', async () => {
  const h = lobbyHarness(); await h.init();
  for (let index = 1; index <= 9; index++) await h.join(index, 'A');
  let snapshot = await h.snapshot();
  assert.equal(snapshot.players.filter((p) => p.team === 'A').length, 9);
  assert.equal(snapshot.room.seat_count, 0);
  assert.ok(snapshot.players.every((p) => p.role === null));
  const firstSeat = snapshot.players.find((p) => p.is_host)!.team_seat;
  await h.request(1, { type: 'updateSelfTeam', team: 'A' });
  snapshot = await h.snapshot();
  assert.equal(snapshot.players.find((p) => p.is_host)!.team_seat, firstSeat);
  await h.request(2, { type: 'updateSelfTeam', team: 'B' });
  await h.request(3, { type: 'updateSelfTeam', team: null });
  await h.join(10, 'A');
  snapshot = await h.snapshot();
  const seats = snapshot.players.filter((p) => p.team === 'A').map((p) => p.team_seat);
  assert.equal(new Set(seats).size, seats.length);
  assert.equal(snapshot.players.find((p) => p.player_name === 'Player 10')!.team_seat, 10);
});

test('unequal teams can start, spectators are assigned atomically, and roles rotate after gaps', async () => {
  const h = lobbyHarness(); await h.init();
  await h.join(1, 'A'); await h.join(2, 'A'); await h.join(3, 'A');
  await h.join(4, 'B'); await h.join(5, 'B'); await h.join(6);
  await h.request(1, { type: 'updateSelfTeam', team: null });
  await h.join(7, 'A');
  await h.request(4, { type: 'startGame' }, 403);
  await h.request(1, { type: 'startGame' });
  let snapshot = await h.snapshot();
  assert.equal(snapshot.room.phase, 'word_assignment');
  assert.equal(snapshot.room.role_rotation_enabled, true);
  assert.equal(snapshot.players.find((p) => p.is_host)!.is_spectator, true);
  assert.equal(snapshot.players.find((p) => p.player_name === 'Player 6')!.is_spectator, true);
  for (const team of ['A', 'B']) {
    const members = snapshot.players.filter((p) => p.team === team);
    assert.equal(members.filter((p) => p.role === 'encoder').length, 1);
    assert.equal(members.filter((p) => p.role === 'decoder').length, 1);
  }
  assert.equal((await h.snapshot(2)).teamWords.length, 1);
  assert.equal((await h.snapshot(6)).teamWords.length, 2);
  const persisted = h.stored.get('state') as RoomSnapshot;
  persisted.room.phase = 'result';
  h.reload();
  const previousEncoder = snapshot.players.find((p) => p.team === 'A' && p.role === 'encoder')!.id;
  await h.request(1, { type: 'advanceRound' });
  snapshot = await h.snapshot();
  assert.notEqual(snapshot.players.find((p) => p.team === 'A' && p.role === 'encoder')!.id, previousEncoder);
  await h.request(1, { type: 'startGame' }, 409);
  await h.request(2, { type: 'updateSelfTeam', team: 'B' }, 409);
  await h.request(1, { type: 'clearAllSeats' }, 409);
});

test('failed start leaves unassigned players untouched and clear teams preserves spectators', async () => {
  const h = lobbyHarness(); await h.init();
  await h.join(2, 'A'); await h.join(3, 'B');
  await h.request(1, { type: 'startGame' }, 409);
  assert.equal((await h.snapshot()).players.find((p) => p.is_host)!.is_spectator, false);
  await h.join(4);
  await h.request(4, { type: 'updateSelfSpectator', enabled: true });
  await h.request(2, { type: 'clearAllSeats' }, 403);
  await h.request(1, { type: 'clearAllSeats' });
  const snapshot = await h.snapshot();
  assert.ok(snapshot.players.every((p) => p.team === null));
  assert.equal(snapshot.players.find((p) => p.player_name === 'Player 4')!.is_spectator, true);
});

test('old lobby snapshots and setting requests cannot restore fixed roles or player limits', async () => {
  const h = lobbyHarness(); await h.init(); await h.join(1, 'A');
  const persisted = h.stored.get('state') as RoomSnapshot;
  persisted.room.seat_count = 4; persisted.room.role_rotation_enabled = false;
  persisted.players[0].role = 'encoder';
  h.reload();
  const snapshot = await h.snapshot();
  assert.equal(snapshot.room.seat_count, 0);
  assert.equal(snapshot.room.role_rotation_enabled, true);
  assert.equal(snapshot.players[0].role, null);
  await h.request(1, { type: 'updateRoomLobbySettings', payload: {
    seatCount: 4, roleRotationEnabled: false,
    timers: { encryptMinutes: 3, decodeMinutes: 2, interceptMinutes: 1 },
    lifeModeEnabled: true, lifePoints: 3, miscommunicationLimit: 2,
    allowMidgameJoin: true, forcePhaseTimeoutEnabled: false, bangumiCharacterExtractEnabled: false,
  } });
  const updated = await h.snapshot();
  assert.equal(updated.room.role_rotation_enabled, true);
  assert.equal(updated.room.seat_count, 0);
  assert.equal(updated.room.encrypt_phase_minutes, 3);
});

test('random teams include seated and unassigned players, balance odd counts and preserve spectators', async () => {
  const h = lobbyHarness(); await h.init();
  await h.join(1, 'A'); await h.join(2, 'A'); await h.join(3, 'B');
  for (let index = 4; index <= 8; index++) await h.join(index);
  await h.request(8, { type: 'updateSelfSpectator', enabled: true });
  const before = await h.snapshot();
  const spectator = before.players.find((p) => p.is_spectator)!;

  await h.request(1, { type: 'randomizeTeams' });
  const after = await h.snapshot();
  assert.equal(after.room.phase, 'lobby');
  assert.deepEqual(after.players.find((p) => p.id === spectator.id), spectator);
  assert.equal(after.players.filter((p) => !p.is_spectator && p.team).length, 7);
  const sizes = (['A', 'B'] as const).map((team) => {
    const members = after.players.filter((p) => p.team === team);
    assert.deepEqual(members.map((p) => p.team_seat).sort((a, b) => a! - b!), members.map((_, i) => i + 1));
    assert.ok(members.every((p) => p.role === null));
    return members.length;
  });
  assert.deepEqual(sizes.sort(), [3, 4]);
  assert.deepEqual(after.players.map((p) => p.id).sort(), before.players.map((p) => p.id).sort());
  h.reload();
  assert.deepEqual((await h.snapshot()).players, after.players);

  await h.request(1, { type: 'startGame' });
  const playing = await h.snapshot();
  await h.request(1, { type: 'randomizeTeams' }, 409);
  assert.deepEqual((await h.snapshot()).players, playing.players);
});

test('spectating hosts can randomize even teams and transport retries do not reshuffle', async () => {
  const h = lobbyHarness(); await h.init();
  await h.request(1, { type: 'updateSelfSpectator', enabled: true });
  for (let index = 2; index <= 5; index++) await h.join(index);
  const before = await h.snapshot();
  const action = { type: 'randomizeTeams', clientActionId: 'random-team-retry-123' };
  await h.request(1, action);
  const after = await h.snapshot();
  assert.equal(after.players.filter((p) => p.team === 'A').length, 2);
  assert.equal(after.players.filter((p) => p.team === 'B').length, 2);
  assert.deepEqual(after.players.find((p) => p.is_host), before.players.find((p) => p.is_host));

  h.reload();
  await h.request(1, action);
  const retried = await h.snapshot();
  assert.equal(retried.room.revision, after.room.revision);
  assert.deepEqual(retried.players, after.players);
});

test('random teams reject non-hosts and fewer than two participants without changing membership', async () => {
  const h = lobbyHarness(); await h.init();
  let before = await h.snapshot();
  await h.request(1, { type: 'randomizeTeams' }, 409);
  assert.deepEqual((await h.snapshot()).players, before.players);
  await h.join(2, 'A');
  before = await h.snapshot();
  await h.request(2, { type: 'randomizeTeams' }, 403);
  await h.request(99, { type: 'randomizeTeams' }, 403);
  assert.deepEqual((await h.snapshot()).players, before.players);
  await h.request(1, { type: 'updateSelfSpectator', enabled: true });
  before = await h.snapshot();
  await h.request(1, { type: 'randomizeTeams' }, 409);
  assert.deepEqual((await h.snapshot()).players, before.players);
});
