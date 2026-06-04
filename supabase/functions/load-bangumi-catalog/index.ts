import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const USER_AGENT = 'Zhang-Ronghao/Anime-Decrypto (https://github.com/Zhang-Ronghao/Anime-Decrypto)';
const BANGUMI_API_BASE = 'https://api.bgm.tv/v0';
const PAGE_SIZE = 50;
const ALLOWED_COLLECTION_TYPES = [1, 2, 3, 4, 5] as const;

interface RequestBody {
  roomId?: string;
  inputs?: string[];
  collectionTypes?: number[];
}

interface BangumiSubject {
  id?: number;
  name?: string | null;
  name_cn?: string | null;
  type?: number;
}

interface BangumiCollectionItem {
  subject_id?: number;
  subject?: BangumiSubject | null;
}

interface BangumiCatalogEntry {
  subjectId: number;
  title: string;
}

interface BangumiCatalogSource {
  kind: 'user' | 'index';
  id: string;
  key: string;
  input: string;
}

function errorResponse(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function parseAuthorizationToken(request: Request): string | null {
  const authorization = request.headers.get('Authorization') ?? request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return null;
  }

  return authorization.slice('Bearer '.length).trim() || null;
}

function normalizeInput(value: string): BangumiCatalogSource | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d+$/.test(trimmed)) {
    return {
      kind: 'user',
      id: trimmed,
      key: `user:${trimmed}`,
      input: trimmed,
    };
  }

  if (/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    return {
      kind: 'user',
      id: trimmed,
      key: `user:${trimmed}`,
      input: trimmed,
    };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`无效的 Bangumi 用户输入：${trimmed}`);
  }

  if (!['bangumi.tv', 'bgm.tv', 'chii.in'].includes(url.hostname)) {
    throw new Error(`不支持的 Bangumi 链接：${trimmed}`);
  }

  const indexMatch = url.pathname.match(/^\/index\/(\d+)\/?$/);
  if (indexMatch) {
    const indexId = indexMatch[1];
    return {
      kind: 'index',
      id: indexId,
      key: `index:${indexId}`,
      input: `https://bangumi.tv/index/${indexId}`,
    };
  }

  const match = url.pathname.match(/^\/(?:anime\/list|user)\/([^/]+)(?:\/[^/]+)?\/?$/);
  if (!match) {
    throw new Error(`只支持 Bangumi 用户主页或动画收藏夹页面链接：${trimmed}`);
  }

  const userId = decodeURIComponent(match[1] ?? '').trim();
  if (!userId) {
    throw new Error(`无法识别 Bangumi 用户：${trimmed}`);
  }

  return {
    kind: 'user',
    id: userId,
    key: `user:${userId}`,
    input: userId,
  };
}

function normalizeCollectionTypes(values: number[] | undefined): number[] {
  const normalized = Array.from(
    new Set(
      (values ?? [])
        .filter((value): value is number => typeof value === 'number' && Number.isInteger(value))
        .filter((value) => ALLOWED_COLLECTION_TYPES.includes(value as (typeof ALLOWED_COLLECTION_TYPES)[number])),
    ),
  ).sort((left, right) => left - right);

  return normalized.length > 0 ? normalized : [2];
}

function normalizeInputs(values: string[]): BangumiCatalogSource[] {
  const normalized = values
    .map(normalizeInput)
    .filter((value): value is BangumiCatalogSource => Boolean(value));

  const unique = Array.from(new Map(normalized.map((source) => [source.key, source])).values());
  unique.sort((left, right) => left.input.localeCompare(right.input, 'zh-CN'));
  return unique;
}

async function fetchCollectionsForUserAndType(userId: string, collectionType: number): Promise<BangumiCollectionItem[]> {
  const items: BangumiCollectionItem[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url = new URL(`${BANGUMI_API_BASE}/users/${encodeURIComponent(userId)}/collections`);
    url.searchParams.set('subject_type', '2');
    url.searchParams.set('type', String(collectionType));
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('offset', String(offset));

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`找不到 Bangumi 用户：${userId}`);
      }

      throw new Error(`Bangumi API 请求失败：${userId} (${response.status})`);
    }

    const payload = await response.json();
    const pageItems = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.data)
        ? payload.data
        : [];

    items.push(...pageItems);

    if (pageItems.length < PAGE_SIZE) {
      break;
    }
  }

  return items;
}

async function fetchCollectionsForUser(userId: string, collectionTypes: number[]): Promise<BangumiCollectionItem[]> {
  const itemsByType = await Promise.all(
    collectionTypes.map((collectionType) => fetchCollectionsForUserAndType(userId, collectionType)),
  );

  return itemsByType.flat();
}

async function fetchSubjectsForIndex(indexId: string): Promise<BangumiSubject[]> {
  const subjects: BangumiSubject[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url = new URL(`${BANGUMI_API_BASE}/indices/${encodeURIComponent(indexId)}/subjects`);
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('offset', String(offset));

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`找不到 Bangumi 目录：${indexId}`);
      }

      throw new Error(`Bangumi 目录 API 请求失败：${indexId} (${response.status})`);
    }

    const payload = await response.json();
    const pageItems = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.data)
        ? payload.data
        : [];

    subjects.push(...pageItems);

    if (pageItems.length < PAGE_SIZE) {
      break;
    }
  }

  return subjects;
}

function subjectToCatalogEntry(subject: BangumiSubject | null | undefined): BangumiCatalogEntry | null {
  if (subject?.type !== undefined && subject.type !== 2) {
    return null;
  }

  const subjectId = subject?.id;
  if (typeof subjectId !== 'number' || !Number.isFinite(subjectId)) {
    return null;
  }

  const title = subject?.name_cn?.trim() || subject?.name?.trim() || '';
  if (!title) {
    return null;
  }

  return { subjectId, title };
}

function collectionItemToCatalogEntry(item: BangumiCollectionItem): BangumiCatalogEntry | null {
  return subjectToCatalogEntry(item.subject ?? null);
}

async function fetchCatalogForSource(
  source: BangumiCatalogSource,
  collectionTypes: number[],
): Promise<Map<number, BangumiCatalogEntry>> {
  const entries =
    source.kind === 'index'
      ? (await fetchSubjectsForIndex(source.id)).map(subjectToCatalogEntry)
      : (await fetchCollectionsForUser(source.id, collectionTypes)).map(collectionItemToCatalogEntry);
  const subjects = new Map<number, BangumiCatalogEntry>();

  for (const entry of entries) {
    if (!entry || subjects.has(entry.subjectId)) {
      continue;
    }

    subjects.set(entry.subjectId, entry);
  }

  return subjects;
}

function intersectCatalogs(collectionsByUser: Array<Map<number, BangumiCatalogEntry>>): BangumiCatalogEntry[] {
  if (collectionsByUser.length === 0) {
    return [];
  }

  const [first, ...rest] = collectionsByUser;
  const dedupedTitles = new Set<string>();
  const entries: BangumiCatalogEntry[] = [];

  for (const [subjectId, entry] of first.entries()) {
    if (!rest.every((collection) => collection.has(subjectId))) {
      continue;
    }

    if (dedupedTitles.has(entry.title)) {
      continue;
    }

    dedupedTitles.add(entry.title);
    entries.push(entry);
  }

  entries.sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'));
  return entries;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return errorResponse('Method not allowed.', 405);
  }

  const token = parseAuthorizationToken(request);
  if (!token) {
    return errorResponse('缺少登录信息。', 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return errorResponse('Supabase Edge Function 环境变量缺失。', 500);
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return errorResponse('请求体格式不正确。');
  }

  if (!body.roomId || !Array.isArray(body.inputs)) {
    return errorResponse('缺少 roomId 或 inputs。');
  }

  try {
    const normalizedSources = normalizeInputs(body.inputs);
    const normalizedInputs = normalizedSources.map((source) => source.input);
    const normalizedCollectionTypes = normalizeCollectionTypes(body.collectionTypes);
    if (normalizedInputs.length === 0) {
      return errorResponse('至少需要 1 个有效的 Bangumi 用户。');
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) {
      return errorResponse('登录状态无效，请刷新后重试。', 401);
    }

    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('id, host_user_id, phase')
      .eq('id', body.roomId)
      .single();

    if (roomError || !room) {
      return errorResponse('房间不存在。', 404);
    }

    if (room.host_user_id !== authData.user.id) {
      return errorResponse('只有房主可以载入 Bangumi 词库。', 403);
    }

    if (room.phase !== 'lobby') {
      return errorResponse('只有大厅阶段可以载入 Bangumi 词库。', 409);
    }

    const collectionsByUser: Array<Map<number, BangumiCatalogEntry>> = [];
    for (const source of normalizedSources) {
      collectionsByUser.push(await fetchCatalogForSource(source, normalizedCollectionTypes));
    }

    const entries = intersectCatalogs(collectionsByUser);
    if (entries.length < 8) {
      return errorResponse('交集动画词条少于 8 个，无法用于本局游戏。');
    }

    const updatedAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('rooms')
      .update({
        bangumi_catalog_inputs: normalizedInputs,
        bangumi_catalog_types: normalizedCollectionTypes,
        bangumi_catalog_entries: entries,
        bangumi_catalog_words: entries.map((entry) => entry.title),
        bangumi_catalog_updated_at: updatedAt,
      })
      .eq('id', body.roomId);

    if (updateError) {
      throw updateError;
    }

    return new Response(
      JSON.stringify({
        inputs: normalizedInputs,
        collectionTypes: normalizedCollectionTypes,
        wordCount: entries.length,
        updatedAt,
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : '载入 Bangumi 词库失败。';
    return errorResponse(message, 400);
  }
});
