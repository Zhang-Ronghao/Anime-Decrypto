import { createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';

const SOURCE_PATH =
  process.argv[2] ?? 'C:\\Users\\Hu_care\\Downloads\\dump-2026-05-19.210434Z\\subject.jsonlines';
const OUTPUT_PATH =
  process.argv[3] ?? 'supabase/functions/load-bangumi-catalog/bangumi-popular-anime.ts';
const LIMIT = 2000;

function favoriteCount(favorite) {
  if (!favorite || typeof favorite !== 'object') {
    return 0;
  }

  return ['wish', 'done', 'doing', 'on_hold', 'dropped'].reduce((total, key) => {
    const value = favorite[key];
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);
}

function toEntry(subject) {
  if (!subject || subject.type !== 2 || !Number.isInteger(subject.id)) {
    return null;
  }

  const title =
    typeof subject.name_cn === 'string' && subject.name_cn.trim()
      ? subject.name_cn.trim()
      : typeof subject.name === 'string' && subject.name.trim()
        ? subject.name.trim()
        : '';
  if (!title) {
    return null;
  }

  return {
    subjectId: subject.id,
    title,
    favoriteCount: favoriteCount(subject.favorite),
  };
}

const sourcePath = resolve(SOURCE_PATH);
const outputPath = resolve(OUTPUT_PATH);
const entries = [];
let lineCount = 0;
let animeCount = 0;

const reader = createInterface({
  input: createReadStream(sourcePath, { encoding: 'utf8' }),
  crlfDelay: Infinity,
});

for await (const line of reader) {
  lineCount += 1;
  if (!line.trim()) {
    continue;
  }

  let subject;
  try {
    subject = JSON.parse(line);
  } catch (error) {
    throw new Error(`Failed to parse JSON on line ${lineCount}: ${error.message}`);
  }

  const entry = toEntry(subject);
  if (!entry) {
    continue;
  }

  animeCount += 1;
  entries.push(entry);
}

entries.sort((left, right) => {
  if (right.favoriteCount !== left.favoriteCount) {
    return right.favoriteCount - left.favoriteCount;
  }

  return left.subjectId - right.subjectId;
});

const topEntries = entries.slice(0, LIMIT);
const generatedAt = new Date().toISOString();
const output = `// Generated from Bangumi archive subject.jsonlines dump-2026-05-19.210434Z.
// Source file is not committed because it is too large for the app repository.

export interface BangumiPopularAnimeEntry {
  subjectId: number;
  title: string;
  favoriteCount: number;
}

export const BANGUMI_POPULAR_ANIME_SOURCE_DATE = '2026-05-19';
export const BANGUMI_POPULAR_ANIME_GENERATED_AT = '${generatedAt}';
export const BANGUMI_POPULAR_ANIME: BangumiPopularAnimeEntry[] = ${JSON.stringify(topEntries, null, 2)};
`;

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, output, 'utf8');

console.log(
  JSON.stringify(
    {
      sourcePath,
      outputPath,
      lineCount,
      animeCount,
      written: topEntries.length,
      maxFavoriteCount: topEntries[0]?.favoriteCount ?? 0,
      minFavoriteCount: topEntries.at(-1)?.favoriteCount ?? 0,
    },
    null,
    2,
  ),
);
