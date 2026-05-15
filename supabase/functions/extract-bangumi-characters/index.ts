import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const USER_AGENT = 'Zhang-Ronghao/Anime-Decrypto (https://github.com/Zhang-Ronghao/Anime-Decrypto)';
const LEGACY_BANGUMI_API_BASE = 'https://api.bgm.tv';

type Team = 'A' | 'B';

interface RequestBody {
  roomId?: string;
  team?: Team;
}

interface TeamWordSlot {
  text: string;
  subjectId: number | null;
  sourceTitle: string | null;
  showSourceTitle: boolean;
  characterOptions: string[];
}

interface BangumiCharacter {
  name?: string | null;
  name_cn?: string | null;
  info?: {
    name_cn?: string | null;
  } | null;
}

interface BangumiSubjectPayload {
  crt?: BangumiCharacter[] | null;
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

function normalizeSlot(value: unknown): TeamWordSlot {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    text: typeof record.text === 'string' ? record.text.trim() : '',
    subjectId: typeof record.subjectId === 'number' && Number.isFinite(record.subjectId) ? record.subjectId : null,
    sourceTitle: typeof record.sourceTitle === 'string' && record.sourceTitle.trim() ? record.sourceTitle.trim() : null,
    showSourceTitle: record.showSourceTitle === true,
    characterOptions: Array.isArray(record.characterOptions)
      ? Array.from(new Set(record.characterOptions.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)))
      : [],
  };
}

function slotsToWords(slots: TeamWordSlot[]): string[] {
  return slots.map((slot) => slot.text.trim());
}

async function fetchCharacterNames(subjectId: number): Promise<string[]> {
  const url = `${LEGACY_BANGUMI_API_BASE}/subject/${subjectId}?responseGroup=large`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Bangumi 角色接口请求失败：${subjectId} (${response.status})`);
  }

  const payload = (await response.json()) as BangumiSubjectPayload;
  const names = new Set<string>();
  const result: string[] = [];

  for (const item of payload.crt ?? []) {
    const name = item.name_cn?.trim() || item.info?.name_cn?.trim() || item.name?.trim() || '';
    if (!name || names.has(name)) {
      continue;
    }

    names.add(name);
    result.push(name);
  }

  return result;
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

  if (!body.roomId || (body.team !== 'A' && body.team !== 'B')) {
    return errorResponse('缺少 roomId 或 team。');
  }

  try {
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
      .select('id, phase')
      .eq('id', body.roomId)
      .single();

    if (roomError || !room) {
      return errorResponse('房间不存在。', 404);
    }

    if (room.phase !== 'word_assignment') {
      return errorResponse('当前不是词语分配阶段。', 409);
    }

    const { data: player, error: playerError } = await supabase
      .from('room_players')
      .select('id, team, role')
      .eq('room_id', body.roomId)
      .eq('auth_user_id', authData.user.id)
      .single();

    if (playerError || !player) {
      return errorResponse('你不在该房间中。', 403);
    }

    if (player.team !== body.team || player.role !== 'encoder') {
      return errorResponse('只有本队加密/拦截者可以提取角色。', 403);
    }

    const { data: teamWords, error: teamWordsError } = await supabase
      .from('team_words')
      .select('id, words, word_slots, confirmed')
      .eq('room_id', body.roomId)
      .eq('team', body.team)
      .single();

    if (teamWordsError || !teamWords) {
      return errorResponse('队伍词语不存在。', 404);
    }

    if (teamWords.confirmed) {
      return errorResponse('本队词语已确认，不能再修改。', 409);
    }

    const slots =
      Array.isArray(teamWords.word_slots) && teamWords.word_slots.length === 4
        ? teamWords.word_slots.map((slot) => normalizeSlot(slot))
        : Array.isArray(teamWords.words) && teamWords.words.length === 4
          ? teamWords.words.map((word: string) => ({
              text: String(word ?? '').trim(),
              subjectId: null,
              sourceTitle: null,
              showSourceTitle: false,
              characterOptions: [],
            }))
          : [];

    if (slots.length !== 4) {
      return errorResponse('当前队伍词槽数据不完整。', 409);
    }

    const nextSlots: TeamWordSlot[] = [];
    const failedTitles: string[] = [];

    for (const slot of slots) {
      if (slot.subjectId === null || !slot.sourceTitle) {
        nextSlots.push({
          ...slot,
          showSourceTitle: false,
          characterOptions: [],
        });
        failedTitles.push(slot.text || '未命名词条');
        continue;
      }

      try {
        const characterOptions = await fetchCharacterNames(slot.subjectId);
        if (characterOptions.length === 0) {
          nextSlots.push({
            ...slot,
            text: slot.sourceTitle,
            showSourceTitle: false,
            characterOptions: [],
          });
          failedTitles.push(slot.sourceTitle);
          continue;
        }

        nextSlots.push({
          ...slot,
          text: characterOptions[0],
          showSourceTitle: true,
          characterOptions,
        });
      } catch {
        nextSlots.push({
          ...slot,
          text: slot.sourceTitle,
          showSourceTitle: false,
          characterOptions: [],
        });
        failedTitles.push(slot.sourceTitle);
      }
    }

    const { error: updateError } = await supabase
      .from('team_words')
      .update({
        word_slots: nextSlots,
        words: slotsToWords(nextSlots),
      })
      .eq('id', teamWords.id);

    if (updateError) {
      throw updateError;
    }

    return new Response(
      JSON.stringify({
        slots: nextSlots,
        failedTitles,
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : '提取角色失败。';
    return errorResponse(message, 400);
  }
});
