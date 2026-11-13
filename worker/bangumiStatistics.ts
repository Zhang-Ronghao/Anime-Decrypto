import type { BangumiAnimeStatistics } from '../src/types';
import { BANGUMI_POPULAR_ANIME } from './data/bangumi-popular-anime';

// Immutable offline reference data, shared by room instances without API calls.
const statisticsById = new Map<number, BangumiAnimeStatistics>(BANGUMI_POPULAR_ANIME.map(entry => [entry.subjectId, {
  year: entry.year, score: entry.score ?? null, collectionCount: entry.favoriteCount,
}]));

export function animeStatistics(subjectId: number | null): BangumiAnimeStatistics | null {
  return subjectId === null ? null : statisticsById.get(subjectId) ?? null;
}
