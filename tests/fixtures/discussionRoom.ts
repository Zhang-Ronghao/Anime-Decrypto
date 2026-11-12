import type { RoomSnapshot, Team } from '../../src/types';
import { guessDraftFixture } from './guessDraftRoom';
import { RoomDurableObject, type Env } from '../../worker/index';

export function discussionRoomFixture(round = 2) {
  const current = guessDraftFixture();
  const timestamp = new Date().toISOString();
  Object.assign(current.room, {
    discussion_mode: 'sequential', discussion_phase_minutes: 2, discussion_team: null,
    round_number: round, phase: 'encrypt', phase_started_at: timestamp,
    phase_deadline_at: new Date(Date.now() + 120_000).toISOString(),
    score_team_a_miscomms: 0, life_mode_enabled: true,
  });
  current.players.forEach((p, index) => { p.auth_user_id = `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`; });
  current.room.host_user_id = current.players[0].auth_user_id;
  current.submissions.forEach(s => Object.assign(s, { round_number: round, clues: null }));
  current.roundCodes = (['A','B'] as Team[]).map(team => ({
    id: `code-${team}`, room_id: current.room.id, team, round_number: round,
    encoder_player_id: `${team}-1`, code: team === 'A' ? '2-3-4' : '1-2-3', created_at: timestamp,
  }));
  return current;
}

/** Exercises real DO HTTP actions and snapshot filtering with in-process storage. */
export function discussionHarness(initial = discussionRoomFixture()) {
  const stored = new Map<string, unknown>([
    ['state', structuredClone(initial)],
    ['meta', { lastActivityAt: new Date().toISOString(), expiresAt: '2030-01-01T00:00:00.000Z', d1PersistPending: false }],
  ]);
  const state = {
    storage: {
      get: async (key: string) => structuredClone(stored.get(key)),
      put: async (key: string, value: unknown) => { stored.set(key, structuredClone(value)); },
      setAlarm: async () => {}, deleteAlarm: async () => {},
      list: async () => new Map(), delete: async () => true,
    },
    getWebSockets: () => [],
  } as unknown as DurableObjectState;
  const statement = { bind: (..._values: unknown[]) => statement, first: async () => null, run: async () => ({}) };
  const env = { DB: { prepare: () => statement } } as unknown as Env;
  let object = new RoomDurableObject(state, env);
  async function request(playerId: string, action?: object, status = 200) {
    const user = initial.players.find(p => p.id === playerId)!;
    const response = await object.fetch(new Request(`https://test/room/${initial.room.id}/${action ? 'action' : 'snapshot'}`, {
      method: action ? 'POST' : 'GET', headers: { 'x-decrypto-session': user.auth_user_id },
      ...(action ? { body: JSON.stringify(action) } : {}),
    }));
    assertStatus(response.status, status, await response.clone().text());
    return response.json();
  }
  return {
    stored, request,
    snapshot: (playerId = 'A-2') => request(playerId) as Promise<RoomSnapshot>,
    reload: () => { object = new RoomDurableObject(state, env); },
    alarm: () => object.alarm(),
    current: () => stored.get('state') as ReturnType<typeof discussionRoomFixture>,
    start: async () => {
      await request('A-1', { type: 'submitClues', team: 'A', clues: ['琴弦', '极光', '玻璃'] });
      await request('B-1', { type: 'submitClues', team: 'B', clues: ['森林', '少年', '月光'] });
    },
  };
}

function assertStatus(actual: number, expected: number, body: string) {
  if (actual !== expected) throw new Error(`Expected HTTP ${expected}, got ${actual}: ${body}`);
}
