import { createReadStream, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function toAnimeEntry(subject) {
  if (!subject || subject.type !== 2 || !Number.isSafeInteger(subject.id) || subject.id <= 0) return null;
  const title = (typeof subject.name_cn === 'string' && subject.name_cn.trim())
    || (typeof subject.name === 'string' && subject.name.trim()) || '';
  if (!title) return null;
  const year = typeof subject.date === 'string' ? Number(subject.date.match(/^(\d{4})/)?.[1]) : NaN;
  const favoriteCount = ['wish', 'done', 'doing', 'on_hold', 'dropped'].reduce((total, key) => {
    const count = subject.favorite?.[key];
    return total + (Number.isSafeInteger(count) && count >= 0 ? count : 0);
  }, 0);
  return {
    subjectId: subject.id, title, favoriteCount,
    year: Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null,
    score: typeof subject.score === 'number' && Number.isFinite(subject.score)
      && subject.score > 0 && subject.score <= 10 ? subject.score : null,
  };
}

export async function buildAnimeCatalog(sourcePath, outputPath, { sourceDate, generatedAt, minEntries = 10_000 } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate ?? '')) throw new Error('A valid source date is required');
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('A valid generation timestamp is required');
  const entries = [];
  const ids = new Set();
  let lines = 0;
  const reader = createInterface({ input: createReadStream(sourcePath), crlfDelay: Infinity });
  for await (const line of reader) {
    lines++;
    if (!line.trim()) continue;
    let subject;
    try { subject = JSON.parse(line); }
    catch { throw new Error(`Invalid JSON on archive line ${lines}`); }
    const entry = toAnimeEntry(subject);
    if (!entry) continue;
    if (ids.has(entry.subjectId)) throw new Error(`Duplicate anime ID: ${entry.subjectId}`);
    ids.add(entry.subjectId);
    entries.push(entry);
  }
  if (entries.length < minEntries) throw new Error(`Unexpected anime count: ${entries.length}, expected at least ${minEntries}`);
  if (entries.filter(entry => entry.score !== null).length < entries.length * 0.1) {
    throw new Error('Archive is missing anime scores');
  }
  entries.sort((a, b) => b.favoriteCount - a.favoriteCount || a.subjectId - b.subjectId);
  const output = `// @ts-nocheck
// Generated from the official Bangumi Archive (${sourceDate}). Do not edit by hand.
// Only anime and game-required fields are retained; the raw archive is not deployed.

export interface BangumiPopularAnimeEntry {
  subjectId: number;
  title: string;
  favoriteCount: number;
  year: number | null;
  score: number | null;
}

export const BANGUMI_POPULAR_ANIME_SOURCE_DATE = '${sourceDate}';
export const BANGUMI_POPULAR_ANIME_GENERATED_AT = '${generatedAt}';
export const BANGUMI_POPULAR_ANIME: BangumiPopularAnimeEntry[] = ${JSON.stringify(entries, null, 2)};
`;
  mkdirSync(dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.tmp`;
  writeFileSync(temporary, output, 'utf8');
  renameSync(temporary, outputPath);
  return { sourceDate, generatedAt, entryCount: entries.length, archiveLineCount: lines };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [source, output = 'worker/data/bangumi-popular-anime.ts', sourceDate, generatedAt] = process.argv.slice(2);
  if (!source) throw new Error('Usage: node scripts/build-bangumi-popular-anime.mjs <subject.jsonlines> [output.ts] <source-date> <generated-at>');
  console.log(JSON.stringify(await buildAnimeCatalog(resolve(source), resolve(output), { sourceDate, generatedAt })));
}
