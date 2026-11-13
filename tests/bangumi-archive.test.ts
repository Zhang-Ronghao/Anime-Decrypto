import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAnimeCatalog, toAnimeEntry } from '../scripts/build-bangumi-popular-anime.mjs';

test('archive retains only anime and required fields, with all five collection statuses', () => {
  assert.deepEqual(toAnimeEntry({ id: 485, type: 2, name: 'Japanese', name_cn: ' 中文名 ', date: '2006-04-02',
    score: 8.2, favorite: { wish: 6380, done: 31519, doing: 1382, on_hold: 1306, dropped: 369 },
    summary: 'Not retained', tags: ['not retained'],
  }), { subjectId: 485, title: '中文名', year: 2006, score: 8.2, favoriteCount: 40956 });
  assert.equal(toAnimeEntry({ id: 1, type: 1, name: 'A book' }), null);
  assert.equal(toAnimeEntry({ id: 1, type: 2, name: '' }), null);
  assert.equal(toAnimeEntry({ id: 2, type: 2, name: 'Unrated', score: 0 }).score, null);
});

test('generator sorts by popularity, is deterministic and preserves output on invalid archives', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'anime-catalog-test-'));
  const source = join(directory, 'subject.jsonlines');
  const output = join(directory, 'catalog.ts');
  const options = { sourceDate: '2026-11-10', generatedAt: '2026-11-10T21:04:06Z', minEntries: 2 };
  const subjects = [
    { id: 20, type: 2, name: 'Less popular', score: 7, favorite: { done: 10 } },
    { id: 30, type: 1, name: 'Excluded book' },
    { id: 10, type: 2, name: 'Popular', score: 8, favorite: { done: 100 } },
  ];
  try {
    await writeFile(source, subjects.map(value => JSON.stringify(value)).join('\n'));
    assert.equal((await buildAnimeCatalog(source, output, options)).entryCount, 2);
    const first = await readFile(output, 'utf8');
    assert.ok(first.indexOf('"title": "Popular"') < first.indexOf('"title": "Less popular"'));
    assert.ok(!first.includes('Excluded book'));
    await buildAnimeCatalog(source, output, options);
    assert.equal(await readFile(output, 'utf8'), first);
    for (const contents of ['invalid JSON', JSON.stringify(subjects[0]), [subjects[0], subjects[0]].map(value => JSON.stringify(value)).join('\n')]) {
      await writeFile(source, contents);
      await assert.rejects(buildAnimeCatalog(source, output, options));
      assert.equal(await readFile(output, 'utf8'), first);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
