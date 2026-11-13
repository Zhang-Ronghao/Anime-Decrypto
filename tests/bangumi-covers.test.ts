import assert from 'node:assert/strict';
import test from 'node:test';
import { getBangumiCovers, parseCoverUrl } from '../worker/bangumiCovers';
import worker, { type Env } from '../worker/index';

function cacheDatabase() {
  const rows = new Map<string, { payload_json: string; expires_at: string }>();
  const db = { prepare: () => ({
    bind(...args: string[]) {
      return {
        async first() {
          const row = rows.get(args[0]);
          return row && row.expires_at > args[1] ? row : null;
        },
        async run() {
          rows.set(args[0], { payload_json: args[1], expires_at: args[3] });
          return { success: true };
        },
      };
    },
  }) } as unknown as D1Database;
  return { db, rows };
}

test('cover URLs only accept the official HTTPS image host', () => {
  assert.equal(parseCoverUrl({ images: { common: 'https://lain.bgm.tv/r/400/pic/cover/l/test.jpg' } }), 'https://lain.bgm.tv/r/400/pic/cover/l/test.jpg');
  for (const url of ['javascript:alert(1)', 'https://evil.example/cover.jpg', 'https://lain.bgm.tv.evil.example/a.jpg']) {
    assert.equal(parseCoverUrl({ images: { common: url } }), null);
  }
  assert.equal(parseCoverUrl(null), null);
});

test('a later request reuses D1 covers across callers without querying Bangumi again', async () => {
  const { db, rows } = cacheDatabase();
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return Response.json({ images: { common: 'https://lain.bgm.tv/cover.jpg' } });
  }) as typeof fetch;
  const now = Date.parse('2026-11-13T00:00:00Z');
  const first = await getBangumiCovers(db, [485, 485], { fetcher, now });
  const second = await getBangumiCovers(db, [485], { fetcher, now: now + 24 * 60 * 60 * 1000 });
  assert.deepEqual(first, { 485: 'https://lain.bgm.tv/cover.jpg' });
  assert.deepEqual(second, first);
  assert.equal(calls, 1);
  assert.equal(rows.size, 1);
});

test('API failures stay optional and are briefly cached before a later retry', async () => {
  const { db } = cacheDatabase();
  let calls = 0;
  const fetcher = (async () => { calls++; throw new Error('network unavailable'); }) as typeof fetch;
  const now = Date.now();
  assert.deepEqual(await getBangumiCovers(db, [1], { fetcher, now }), { 1: null });
  assert.deepEqual(await getBangumiCovers(db, [1], { fetcher, now: now + 1000 }), { 1: null });
  assert.equal(calls, 1);
  await getBangumiCovers(db, [1], { fetcher, now: now + 11 * 60 * 1000 });
  assert.equal(calls, 2);
});

test('batch endpoint requires a session, validates IDs and returns cached covers', async () => {
  const { db, rows } = cacheDatabase();
  rows.set('subject-cover:v1:485', { payload_json: JSON.stringify({ coverUrl: 'https://lain.bgm.tv/test.jpg' }), expires_at: '2099-01-01T00:00:00Z' });
  const env = { DB: db } as Env;
  const send = (subjectIds: unknown, session = true) => worker.fetch(new Request('https://test/api/bangumi/covers', {
    method: 'POST', headers: session ? { 'x-decrypto-session': '11111111-1111-4111-8111-111111111111' } : {},
    body: JSON.stringify({ subjectIds }),
  }), env);
  assert.equal((await send([485], false)).status, 401);
  for (const ids of [[-1], ['485'], [1.5], Array(17).fill(485), null]) {
    assert.equal((await send(ids)).status, 400);
  }
  const response = await send([485]);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { covers: { 485: 'https://lain.bgm.tv/test.jpg' } });
});
