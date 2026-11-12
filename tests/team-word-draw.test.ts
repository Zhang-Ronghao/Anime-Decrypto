import assert from 'node:assert/strict';
import test from 'node:test';
import type { RoomSnapshot, Team, TeamWordSlot } from '../src/types';
import { RoomDurableObject, type Env } from '../worker/index';

type StoredRoom = Pick<RoomSnapshot, 'room' | 'teamWords'> & {
  bangumiCatalogEntries: Array<{ subjectId: number; title: string }>;
  wordDrawHistory?: string[];
};

async function drawHarness(poolSize: number) {
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
  async function request(index: number, action?: object, status = 200) {
    const response = await object.fetch(new Request('https://test/room/draw-test/action', {
      method: action ? 'POST' : 'GET',
      headers: { 'x-decrypto-session': `11111111-1111-4111-8111-${String(index).padStart(12, '0')}` },
      ...(action ? { body: JSON.stringify(action) } : {}),
    }));
    assert.equal(response.status, status, await response.clone().text());
    const body = await response.json();
    return action && status === 200 ? body.data : body;
  }
  await request(1, { type: 'initRoom', playerName: 'Host', desiredRoomCode: 'ABC123' });
  for (const index of [1, 2, 3, 4]) {
    if (index !== 1) await request(index, { type: 'joinRoom', playerName: `Player ${index}` });
    await request(index, { type: 'updateSelfTeam', team: index <= 2 ? 'A' : 'B' });
  }
  await request(1, { type: 'startGame' });
  const current = () => stored.get('state') as StoredRoom;
  const pool = Array.from({ length: poolSize }, (_, index) => `动画 ${index + 1}`);
  current().bangumiCatalogEntries = pool.map((title, subjectId) => ({ subjectId, title }));
  const reload = () => { object = new RoomDurableObject(state, env); };
  reload();
  const user = (team: Team) => team === 'A' ? 1 : 3;
  return {
    pool, current, reload, request,
    draw: (team: Team) => request(user(team), { type: 'generateTeamWords', team }) as Promise<TeamWordSlot[]>,
    replace: async (team: Team, index: number) => {
      const slots = await request(user(team), { type: 'replaceTeamWordSlot', team, index }) as TeamWordSlot[];
      return slots[index];
    },
  };
}

test('both teams share no-replacement history across full draws and discarded individual words', async () => {
  const h = await drawHarness(24);
  const seen = new Set<string>();
  function remember(slots: TeamWordSlot[]) {
    for (const slot of slots) {
      assert.ok(!seen.has(slot.text), `Previously drawn word repeated: ${slot.text}`);
      seen.add(slot.text);
    }
  }
  remember(await h.draw('A'));
  remember(await h.draw('B'));
  remember([await h.replace('A', 0)]);
  h.reload();
  remember([await h.replace('B', 1)]);
  remember(await h.draw('A'));
  remember(await h.draw('B'));
  assert.equal(seen.size, 18);
  assert.deepEqual(new Set(h.current().wordDrawHistory), seen);

  const snapshot = await h.request(1) as RoomSnapshot;
  assert.equal('wordDrawHistory' in snapshot, false);
  assert.deepEqual(snapshot.teamWords.map((record) => record.team), ['A']);
});

test('exhaustion refills the pool, including discarded words, while keeping current team words blocked', async () => {
  const h = await drawHarness(10);
  await h.draw('A');
  await h.draw('B');
  const discardedA = h.current().teamWords[0].words[0];
  const discardedB = h.current().teamWords[1].words[0];
  await h.replace('A', 0);
  await h.replace('B', 0);
  assert.equal(h.current().wordDrawHistory!.length, 10);
  const occupied = new Set(h.current().teamWords.flatMap((record) => record.words));
  h.reload();
  const recycled = await h.replace('A', 1);
  assert.ok([discardedA, discardedB].includes(recycled.text));
  assert.ok(!occupied.has(recycled.text));
  assert.deepEqual(h.current().wordDrawHistory, [recycled.text]);
  h.reload();
  const next = await h.replace('B', 1);
  assert.notEqual(next.text, recycled.text);
  assert.equal(h.current().wordDrawHistory!.length, 2);
});

test('a four-word draw consumes the last unseen words before refilling and stays unique across the boundary', async () => {
  const h = await drawHarness(14);
  await h.draw('A');
  await h.draw('B');
  await h.replace('A', 0);
  await h.replace('B', 0);
  await h.replace('A', 1);
  await h.replace('B', 1);
  const previousHistory = new Set(h.current().wordDrawHistory);
  const lastUnseen = h.pool.filter((word) => !previousHistory.has(word));
  assert.equal(lastUnseen.length, 2);
  const occupied = new Set(h.current().teamWords.flatMap((record) => record.words));
  const texts = (await h.draw('A')).map((slot) => slot.text);
  assert.equal(new Set(texts).size, 4);
  assert.ok(lastUnseen.every((word) => texts.includes(word)));
  assert.ok(texts.every((word) => !occupied.has(word)));
  assert.equal(texts.filter((word) => previousHistory.has(word)).length, 2);
  assert.deepEqual(new Set(h.current().wordDrawHistory), new Set(texts.filter((word) => previousHistory.has(word))));
});

test('older snapshots merge both teams histories on the first draw', async () => {
  const h = await drawHarness(20);
  await h.draw('A');
  await h.draw('B');
  await h.replace('A', 0);
  await h.replace('B', 0);
  const previousHistory = new Set(h.current().teamWords.flatMap((record) => record.seen_words));
  delete h.current().wordDrawHistory;
  h.reload();
  const next = await h.replace('B', 1);
  assert.ok(!previousHistory.has(next.text));
  assert.deepEqual(new Set(h.current().wordDrawHistory), new Set([...previousHistory, next.text]));
});

test('a genuinely undersized pool fails without consuming history or replacing words', async () => {
  const h = await drawHarness(8);
  await h.draw('A');
  await h.draw('B');
  const before = structuredClone(h.current());
  await h.request(1, { type: 'replaceTeamWordSlot', team: 'A', index: 0 }, 409);
  assert.deepEqual(h.current().teamWords, before.teamWords);
  assert.deepEqual(h.current().wordDrawHistory, before.wordDrawHistory);
});

test('duplicate catalog titles cannot produce duplicate words or prevent exhaustion', async () => {
  const h = await drawHarness(10);
  h.current().bangumiCatalogEntries.push(...h.current().bangumiCatalogEntries);
  h.reload();
  await h.draw('A');
  await h.draw('B');
  await h.replace('A', 0);
  await h.replace('B', 0);
  assert.equal(new Set(h.current().wordDrawHistory).size, 10);
  await h.replace('A', 1);
  assert.equal(h.current().wordDrawHistory!.length, 1);
});

test('starting a new game clears the shared draw cycle', async () => {
  const h = await drawHarness(12);
  await h.draw('A');
  await h.draw('B');
  await h.request(1, { type: 'terminateGame' });
  assert.deepEqual(h.current().wordDrawHistory, []);
  for (const index of [1, 2, 3, 4]) {
    await h.request(index, { type: 'updateSelfTeam', team: index <= 2 ? 'A' : 'B' });
  }
  await h.request(1, { type: 'startGame' });
  assert.deepEqual(h.current().wordDrawHistory, []);
  assert.ok(h.current().teamWords.every((record) => record.seen_words.length === 0));
  await h.draw('B');
  assert.equal(h.current().wordDrawHistory!.length, 4);
});
