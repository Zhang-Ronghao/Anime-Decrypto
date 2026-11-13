import assert from 'node:assert/strict';
import test from 'node:test';
import type { RoomRecord, RoomSnapshot } from '../src/types';
import { RoomDurableObject, type Env } from '../worker/index';
import { BANGUMI_POPULAR_ANIME } from '../worker/data/bangumi-popular-anime';
import { DEFAULT_BANGUMI_POPULAR_CATALOG } from '../src/config/bangumi';

type StoredRoom = { room: RoomRecord; bangumiCatalogEntries: Array<{ subjectId: number; title: string }> };

function roomHarness() {
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
  return {
    stored,
    reload: () => { object = new RoomDurableObject(state, env); },
    async request(action?: object, target = '') {
      const response = await object.fetch(new Request(`https://test/room/catalog-test/${target}`, {
        method: action ? 'POST' : 'GET',
        headers: { 'x-decrypto-session': '11111111-1111-4111-8111-111111111111' },
        ...(action ? { body: JSON.stringify(action) } : {}),
      }));
      assert.equal(response.status, 200, await response.clone().text());
      return response.json();
    },
  };
}

test('new rooms persist a usable default catalog before any catalog action', async () => {
  const harness = roomHarness();
  await harness.request({ type: 'initRoom', playerName: 'Host', desiredRoomCode: 'ABC123' });
  const state = harness.stored.get('state') as StoredRoom;
  assert.equal(state.room.bangumi_popular_catalog_limit, 1000);
  assert.equal(state.room.bangumi_popular_year_min, 2005);
  assert.equal(state.room.bangumi_popular_year_max, DEFAULT_BANGUMI_POPULAR_CATALOG.yearMax);
  assert.equal(state.room.bangumi_catalog_word_count, 1000);
  const expected = BANGUMI_POPULAR_ANIME
    .filter((entry) => entry.year !== null && entry.year >= 2005 && entry.year <= DEFAULT_BANGUMI_POPULAR_CATALOG.yearMax)
    .slice(0, 1000).map(({ subjectId, title }) => ({ subjectId, title }));
  assert.deepEqual(state.bangumiCatalogEntries, expected);
  harness.reload();
  const snapshot = await harness.request() as RoomSnapshot;
  assert.equal(snapshot.room.bangumi_catalog_word_count, 1000);
  const page = await harness.request(undefined, 'catalog') as { total: number; words: string[] };
  assert.equal(page.total, 1000);
  assert.ok(page.words.length > 0);
});

test('unconfigured old lobbies receive defaults while configured catalogs survive reload', async () => {
  const harness = roomHarness();
  await harness.request({ type: 'initRoom', playerName: 'Host', desiredRoomCode: 'ABC123' });
  const state = harness.stored.get('state') as StoredRoom;
  Object.assign(state.room, {
    bangumi_catalog_word_count: 0, bangumi_catalog_updated_at: null,
    bangumi_popular_catalog_limit: null, bangumi_popular_year_min: null, bangumi_popular_year_max: null,
  });
  state.bangumiCatalogEntries = [];
  harness.reload();
  const snapshot = await harness.request() as RoomSnapshot;
  assert.equal(snapshot.room.bangumi_catalog_word_count, 1000);

  await harness.request({ type: 'loadBangumiCatalog', payload: {
    inputs: [], collectionTypes: [2], mergeMode: 'intersection',
    popularLimit: 100, popularYearMin: 1990, popularYearMax: 2000,
  } });
  harness.reload();
  const configured = await harness.request() as RoomSnapshot;
  assert.equal(configured.room.bangumi_popular_catalog_limit, 100);
  assert.equal(configured.room.bangumi_popular_year_min, 1990);
  assert.equal(configured.room.bangumi_popular_year_max, 2000);
});

test('popular catalog limits are capped at 3000', async () => {
  const harness = roomHarness();
  await harness.request({ type: 'initRoom', playerName: 'Host', desiredRoomCode: 'ABC123' });
  await harness.request({ type: 'loadBangumiCatalog', payload: {
    inputs: [], collectionTypes: [2], mergeMode: 'intersection',
    popularLimit: 5000, popularYearMin: 2005, popularYearMax: 2026,
  } });
  const state = harness.stored.get('state') as StoredRoom;
  assert.equal(state.room.bangumi_popular_catalog_limit, 3000);
  assert.ok(state.room.bangumi_catalog_word_count > 2000);
  assert.ok(state.room.bangumi_catalog_word_count <= 3000);
});
