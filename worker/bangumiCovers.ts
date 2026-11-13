const CACHE_PREFIX = 'subject-cover:v1:';
const COVER_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const MISSING_TTL_MS = 10 * 60 * 1000;
const USER_AGENT = 'Zhang-Ronghao/Anime-Decrypto (https://github.com/Zhang-Ronghao/Anime-Decrypto)';

export function parseCoverUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || !('images' in payload)) return null;
  const images = payload.images;
  if (!images || typeof images !== 'object') return null;
  const imageRecord = images as Record<string, unknown>;
  for (const size of ['common', 'small', 'medium'] as const) {
    const value = imageRecord[size];
    if (typeof value !== 'string') continue;
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && url.hostname === 'lain.bgm.tv' && !url.username && !url.password) return url.href;
    } catch { /* Ignore malformed or missing images. */ }
  }
  return null;
}

/** Persistent shared cache; statistics never come from this optional API call. */
export async function getBangumiCovers(
  db: D1Database, subjectIds: number[],
  { fetcher = fetch, now = Date.now() }: { fetcher?: typeof fetch; now?: number } = {},
): Promise<Record<number, string | null>> {
  const result: Record<number, string | null> = {};
  const pending = [...new Set(subjectIds)];
  async function loadNext(): Promise<void> {
    while (pending.length) {
      const subjectId = pending.shift()!;
      const key = `${CACHE_PREFIX}${subjectId}`;
      try {
        const cached = await db.prepare(
          'select payload_json from bangumi_source_cache where cache_key = ? and expires_at > ?',
        ).bind(key, new Date(now).toISOString()).first<{ payload_json: string }>();
        if (cached) {
          const payload = JSON.parse(cached.payload_json) as { coverUrl?: unknown };
          if (payload.coverUrl === null || typeof payload.coverUrl === 'string') {
            result[subjectId] = payload.coverUrl;
            continue;
          }
        }
      } catch (error) {
        console.warn('Bangumi cover cache read failed', subjectId, String(error));
      }

      let coverUrl: string | null = null;
      try {
        const response = await fetcher(`https://api.bgm.tv/v0/subjects/${subjectId}`, {
          headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(8000),
        });
        if (response.ok) coverUrl = parseCoverUrl(await response.json());
      } catch { /* Optional cover failures must not interrupt word selection. */ }
      result[subjectId] = coverUrl;
      try {
        await db.prepare(`insert into bangumi_source_cache (cache_key, payload_json, updated_at, expires_at)
          values (?, ?, ?, ?) on conflict(cache_key) do update set
          payload_json = excluded.payload_json, updated_at = excluded.updated_at, expires_at = excluded.expires_at`)
          .bind(key, JSON.stringify({ coverUrl }), new Date(now).toISOString(),
            new Date(now + (coverUrl ? COVER_TTL_MS : MISSING_TTL_MS)).toISOString()).run();
      } catch (error) {
        console.warn('Bangumi cover cache write failed', subjectId, String(error));
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, () => loadNext()));
  return result;
}
