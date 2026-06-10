import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type {
  RoomRecord,
  RoomJoinStatus,
  PlayerRecord,
  RoomSnapshot,
  RoundGuessFeedbackResponseRecord,
  RoundCodeRecord,
  RoundSubmissionRecord,
  Team,
  TeamWordFeedbackRequestRecord,
  TeamWordFeedbackResponseRecord,
  TeamWordSlot,
  TeamWordsRecord,
} from '../types';

function assertSupabase() {
  if (!supabase) {
    throw new Error('Supabase 未配置。');
  }

  return supabase;
}

function expectSingle<T>(value: T | T[] | null): T {
  if (!value) {
    throw new Error('未返回预期数据。');
  }

  return Array.isArray(value) ? value[0] : value;
}

function normalizeRoomResult(data: unknown): { room_id: string; room_code: string } {
  const value = expectSingle<Record<string, unknown> | null>(data as Record<string, unknown> | Record<string, unknown>[] | null);
  if (!value) {
    throw new Error('房间 RPC 未返回数据。');
  }

  const roomId =
    typeof value.room_id === 'string'
      ? value.room_id
      : typeof value.created_room_id === 'string'
        ? value.created_room_id
        : typeof value.joined_room_id === 'string'
          ? value.joined_room_id
          : null;

  const roomCode =
    typeof value.room_code === 'string'
      ? value.room_code
      : typeof value.created_room_code === 'string'
        ? value.created_room_code
        : typeof value.joined_room_code === 'string'
          ? value.joined_room_code
          : null;

  if (!roomId || !roomCode) {
    throw new Error('房间 RPC 返回格式不正确。');
  }

  return { room_id: roomId, room_code: roomCode };
}

function isTeamWordSlot(value: unknown): value is TeamWordSlot {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.text === 'string' &&
    (typeof record.subjectId === 'number' || record.subjectId === null) &&
    (typeof record.sourceTitle === 'string' || record.sourceTitle === null) &&
    (typeof record.showSourceTitle === 'boolean' || typeof record.showSourceTitle === 'undefined') &&
    Array.isArray(record.characterOptions) &&
    record.characterOptions.every((item) => typeof item === 'string')
  );
}

function parseTeamWordSlots(data: unknown): TeamWordSlot[] {
  if (!Array.isArray(data) || !data.every(isTeamWordSlot)) {
    throw new Error('队伍词槽数据格式不正确。');
  }

  return data;
}

function compactSelectColumns(columns: string): string {
  return columns.replace(/\s+/g, '');
}

const ROOM_SNAPSHOT_COLUMNS = compactSelectColumns(`
  id,
  room_code,
  host_user_id,
  status,
  phase,
  round_number,
  max_rounds,
  seat_count,
  role_rotation_enabled,
  encrypt_phase_minutes,
  decode_phase_minutes,
  intercept_phase_minutes,
  miscommunication_limit,
  life_mode_enabled,
  life_points,
  allow_midgame_join,
  bangumi_character_extract_enabled,
  phase_started_at,
  phase_deadline_at,
  winner,
  score_team_a_intercepts,
  score_team_b_intercepts,
  score_team_a_miscomms,
  score_team_b_miscomms,
  team_a_words_confirmed,
  team_b_words_confirmed,
  bangumi_catalog_inputs,
  bangumi_catalog_types,
  bangumi_catalog_word_count,
  bangumi_catalog_updated_at,
  bangumi_popular_catalog_limit,
  bangumi_popular_year_min,
  bangumi_popular_year_max,
  created_at,
  updated_at
`);

const PLAYER_SNAPSHOT_COLUMNS = compactSelectColumns(`
  id,
  room_id,
  auth_user_id,
  player_name,
  team,
  role,
  team_seat,
  is_spectator,
  is_host,
  connected,
  joined_at
`);

const TEAM_WORDS_SNAPSHOT_COLUMNS = compactSelectColumns(`
  id,
  room_id,
  team,
  words,
  seen_words,
  word_slots,
  confirmed,
  created_at
`);

const ROUND_CODES_SNAPSHOT_COLUMNS = compactSelectColumns(`
  id,
  room_id,
  team,
  round_number,
  encoder_player_id,
  code,
  created_at
`);

const ROUND_SUBMISSIONS_SNAPSHOT_COLUMNS = compactSelectColumns(`
  id,
  room_id,
  team,
  round_number,
  clues,
  intercept_guess,
  own_guess,
  revealed_code,
  intercept_correct,
  own_correct,
  resolved_at,
  created_at,
  updated_at
`);

const TEAM_WORD_FEEDBACK_REQUESTS_SNAPSHOT_COLUMNS = compactSelectColumns(`
  id,
  room_id,
  team,
  request_number,
  requested_by_player_id,
  words,
  word_slots,
  created_at
`);

const TEAM_WORD_FEEDBACK_RESPONSES_SNAPSHOT_COLUMNS = compactSelectColumns(`
  id,
  request_id,
  room_id,
  team,
  player_id,
  slot_index,
  accepted,
  created_at,
  updated_at
`);

const ROUND_GUESS_FEEDBACK_RESPONSES_SNAPSHOT_COLUMNS = compactSelectColumns(`
  id,
  room_id,
  round_number,
  phase,
  team,
  target_team,
  player_id,
  clue_index,
  guess_digit,
  created_at,
  updated_at
`);

const DEFAULT_ROUND_HISTORY_ROW_LIMIT = 16;

function normalizeTeamWordsRecords(records: TeamWordsRecord[]): TeamWordsRecord[] {
  return records.map((entry) => ({
    ...entry,
    word_slots: Array.isArray(entry.word_slots) ? entry.word_slots.filter(isTeamWordSlot) : [],
  }));
}

function normalizeFeedbackRequestRecords(records: TeamWordFeedbackRequestRecord[]): TeamWordFeedbackRequestRecord[] {
  return records.map((entry) => ({
    ...entry,
    word_slots: Array.isArray(entry.word_slots) ? entry.word_slots.filter(isTeamWordSlot) : [],
  }));
}

export async function createRoom(playerName: string, desiredRoomCode?: string) {
  const client = assertSupabase();
  const { data, error } = await client.rpc('create_room', {
    p_player_name: playerName.trim(),
    p_room_code: desiredRoomCode?.trim().toUpperCase() || null,
  });

  if (error) {
    throw error;
  }

  return normalizeRoomResult(data);
}

export async function joinRoom(roomCode: string, playerName: string) {
  const client = assertSupabase();
  const { data, error } = await client.rpc('join_room', {
    p_room_code: roomCode.trim().toUpperCase(),
    p_player_name: playerName.trim(),
  });

  if (error) {
    throw error;
  }

  return normalizeRoomResult(data);
}

export async function getRoomJoinStatus(roomCode: string): Promise<RoomJoinStatus> {
  const client = assertSupabase();
  const { data, error } = await client.rpc('get_room_join_status', {
    p_room_code: roomCode.trim().toUpperCase(),
  });

  if (error) {
    throw error;
  }

  return expectSingle(data as RoomJoinStatus | RoomJoinStatus[] | null);
}

export async function joinMidgameRoom(roomCode: string, playerName: string, team: Team) {
  const client = assertSupabase();
  const { data, error } = await client.rpc('join_midgame_room', {
    p_room_code: roomCode.trim().toUpperCase(),
    p_player_name: playerName.trim(),
    p_team: team,
  });

  if (error) {
    throw error;
  }

  return normalizeRoomResult(data);
}

export async function joinAsSpectator(roomCode: string, playerName: string) {
  const client = assertSupabase();
  const { data, error } = await client.rpc('join_as_spectator', {
    p_room_code: roomCode.trim().toUpperCase(),
    p_player_name: playerName.trim(),
  });

  if (error) {
    throw error;
  }

  return normalizeRoomResult(data);
}

export async function cleanupExpiredRooms() {
  const client = assertSupabase();
  const { error } = await client.rpc('cleanup_expired_rooms');

  if (error) {
    throw error;
  }
}

export async function leaveRoom(roomId: string) {
  const client = assertSupabase();
  const { error } = await client.rpc('leave_room', {
    p_room_id: roomId,
  });

  if (error) {
    throw error;
  }
}

export async function transferHost(roomId: string, playerId: string) {
  const client = assertSupabase();
  const { error } = await client.rpc('transfer_host', {
    p_room_id: roomId,
    p_target_player_id: playerId,
  });

  if (error) {
    throw error;
  }
}

export async function disbandRoom(roomId: string) {
  const client = assertSupabase();
  const { error } = await client.rpc('disband_room', {
    p_room_id: roomId,
  });

  if (error) {
    throw error;
  }
}

export async function kickPlayer(roomId: string, playerId: string) {
  const client = assertSupabase();
  const { error } = await client.rpc('kick_player', {
    p_room_id: roomId,
    p_player_id: playerId,
  });

  if (error) {
    throw error;
  }
}

export async function updateRoomLobbySettings(
  roomId: string,
  seatCount: number,
  roleRotationEnabled: boolean,
  timers: { encryptMinutes: number; decodeMinutes: number; interceptMinutes: number },
  miscommunicationLimit: number,
  lifeModeEnabled: boolean,
  lifePoints: number,
  allowMidgameJoin: boolean,
  bangumiCharacterExtractEnabled: boolean,
) {
  const client = assertSupabase();
  const { error } = await client.rpc('update_room_lobby_settings', {
    p_room_id: roomId,
    p_seat_count: seatCount,
    p_role_rotation_enabled: roleRotationEnabled,
    p_encrypt_phase_minutes: timers.encryptMinutes,
    p_decode_phase_minutes: timers.decodeMinutes,
    p_intercept_phase_minutes: timers.interceptMinutes,
    p_miscommunication_limit: miscommunicationLimit,
    p_life_mode_enabled: lifeModeEnabled,
    p_life_points: lifePoints,
    p_allow_midgame_join: allowMidgameJoin,
    p_bangumi_character_extract_enabled: bangumiCharacterExtractEnabled,
  });

  if (error) {
    throw error;
  }
}

export async function updateSelfSeat(roomId: string, team: Team | null, teamSeat: number | null) {
  const client = assertSupabase();
  const { error } = await client.rpc('update_self_seat', {
    p_room_id: roomId,
    p_team: team,
    p_team_seat: teamSeat,
  });

  if (error) {
    throw error;
  }
}

export async function updateSelfSpectator(roomId: string, enabled: boolean) {
  const client = assertSupabase();
  const { error } = await client.rpc('update_self_spectator', {
    p_room_id: roomId,
    p_enabled: enabled,
  });

  if (error) {
    throw error;
  }
}

export async function clearAllSeats(roomId: string) {
  const client = assertSupabase();
  const { error } = await client.rpc('clear_all_seats', {
    p_room_id: roomId,
  });

  if (error) {
    throw error;
  }
}

export async function startGame(roomId: string) {
  const client = assertSupabase();
  const { error } = await client.rpc('start_game', {
    p_room_id: roomId,
  });

  if (error) {
    throw error;
  }
}

export async function generateTeamWords(roomId: string, team: Team) {
  const client = assertSupabase();
  const { data, error } = await client.rpc('generate_team_words', {
    p_room_id: roomId,
    p_team: team,
  });

  if (error) {
    throw error;
  }

  return parseTeamWordSlots(data);
}

export async function replaceTeamWordSlot(roomId: string, team: Team, index: number) {
  const client = assertSupabase();
  const { data, error } = await client.rpc('replace_team_word_slot', {
    p_room_id: roomId,
    p_team: team,
    p_index: index,
  });

  if (error) {
    throw error;
  }

  return parseTeamWordSlots(data);
}

export async function loadBangumiCatalog(
  roomId: string,
  inputs: string[],
  collectionTypes: number[],
  options: { popularLimit?: number | null; popularYearMin?: number | null; popularYearMax?: number | null } = {},
) {
  const client = assertSupabase();
  const { data, error } = await client.functions.invoke('load-bangumi-catalog', {
    body: {
      roomId,
      inputs,
      collectionTypes,
      popularLimit: options.popularLimit ?? null,
      popularYearMin: options.popularYearMin ?? null,
      popularYearMax: options.popularYearMax ?? null,
    },
  });

  if (error) {
    const context = (error as { context?: Response }).context;
    if (context instanceof Response) {
      try {
        const payload = (await context.json()) as { error?: unknown } | null;
        if (payload && typeof payload.error === 'string' && payload.error.trim()) {
          throw new Error(payload.error);
        }
      } catch {
        // Ignore JSON parsing errors and fall back to the function error below.
      }
    }

    throw error;
  }

  const value = data as
    | {
        inputs?: string[];
        collectionTypes?: number[];
        wordCount?: number;
        updatedAt?: string;
        popularLimit?: number | null;
        popularYearMin?: number | null;
        popularYearMax?: number | null;
        popularSourceDate?: string | null;
      }
    | null;

  if (
    !value ||
    !Array.isArray(value.inputs) ||
    !Array.isArray(value.collectionTypes) ||
    typeof value.wordCount !== 'number' ||
    typeof value.updatedAt !== 'string'
  ) {
    throw new Error('Bangumi 词库加载结果格式不正确。');
  }

  return {
    inputs: value.inputs,
    collectionTypes: value.collectionTypes,
    wordCount: value.wordCount,
    updatedAt: value.updatedAt,
    popularLimit: typeof value.popularLimit === 'number' ? value.popularLimit : null,
    popularYearMin: typeof value.popularYearMin === 'number' ? value.popularYearMin : null,
    popularYearMax: typeof value.popularYearMax === 'number' ? value.popularYearMax : null,
    popularSourceDate: typeof value.popularSourceDate === 'string' ? value.popularSourceDate : null,
  };
}

export async function saveTeamWords(roomId: string, team: Team, words: string[]) {
  const client = assertSupabase();
  const { error } = await client.rpc('save_team_words', {
    p_room_id: roomId,
    p_team: team,
    p_words: words,
  });

  if (error) {
    throw error;
  }
}

export async function confirmTeamWords(roomId: string, team: Team, words: string[], slots: TeamWordSlot[]) {
  const client = assertSupabase();
  const { error } = await client.rpc('confirm_team_words', {
    p_room_id: roomId,
    p_team: team,
    p_words: words,
    p_slots: slots,
  });

  if (error) {
    throw error;
  }
}

export async function requestTeamWordFeedback(roomId: string, team: Team, words: string[], slots: TeamWordSlot[]) {
  const client = assertSupabase();
  const { error } = await client.rpc('request_team_word_feedback', {
    p_room_id: roomId,
    p_team: team,
    p_words: words,
    p_slots: slots,
  });

  if (error) {
    throw error;
  }
}

export async function submitTeamWordFeedback(requestId: string, slotIndex: number, accepted: boolean) {
  const client = assertSupabase();
  const { error } = await client.rpc('submit_team_word_feedback', {
    p_request_id: requestId,
    p_slot_index: slotIndex,
    p_accepted: accepted,
  });

  if (error) {
    throw error;
  }
}

export async function submitTeamWordFeedbackBatch(requestId: string, feedback: boolean[]) {
  const client = assertSupabase();
  const { error } = await client.rpc('submit_team_word_feedback_batch', {
    p_request_id: requestId,
    p_feedback: feedback,
  });

  if (error) {
    throw error;
  }
}

export async function extractBangumiCharacters(roomId: string, team: Team) {
  const client = assertSupabase();
  const { data, error } = await client.functions.invoke('extract-bangumi-characters', {
    body: {
      roomId,
      team,
    },
  });

  if (error) {
    const context = (error as { context?: Response }).context;
    if (context instanceof Response) {
      try {
        const payload = (await context.json()) as { error?: unknown } | null;
        if (payload && typeof payload.error === 'string' && payload.error.trim()) {
          throw new Error(payload.error);
        }
      } catch {
        // Ignore JSON parsing errors and fall back to the function error below.
      }
    }

    throw error;
  }

  const value = data as
    | {
        slots?: unknown;
        failedTitles?: unknown;
      }
    | null;

  if (!value) {
    throw new Error('角色提取结果格式不正确。');
  }

  const slots = parseTeamWordSlots(value.slots);
  const failedTitles = Array.isArray(value.failedTitles)
    ? value.failedTitles.filter((item): item is string => typeof item === 'string')
    : [];

  return { slots, failedTitles };
}

export async function submitClues(roomId: string, team: Team, clues: string[]) {
  const client = assertSupabase();
  const { error } = await client.rpc('submit_clues', {
    p_room_id: roomId,
    p_team: team,
    p_clues: clues.map((item) => item.trim()),
  });

  if (error) {
    throw error;
  }
}

export async function submitInterceptGuess(roomId: string, targetTeam: Team, guess: string) {
  const client = assertSupabase();
  const { error } = await client.rpc('submit_intercept_guess', {
    p_room_id: roomId,
    p_target_team: targetTeam,
    p_guess: guess,
  });

  if (error) {
    throw error;
  }
}

export async function skipFirstIntercept(roomId: string) {
  const client = assertSupabase();
  const { error } = await client.rpc('skip_first_intercept', {
    p_room_id: roomId,
  });

  if (error) {
    throw error;
  }
}

export async function submitOwnGuess(roomId: string, team: Team, guess: string) {
  const client = assertSupabase();
  const { error } = await client.rpc('submit_own_guess', {
    p_room_id: roomId,
    p_team: team,
    p_guess: guess,
  });

  if (error) {
    throw error;
  }
}

export async function submitRoundGuessFeedbackBatch(
  roomId: string,
  phase: 'decode' | 'intercept',
  team: Team,
  guessDigits: string[],
) {
  const client = assertSupabase();
  const { error } = await client.rpc('submit_round_guess_feedback_batch', {
    p_room_id: roomId,
    p_phase: phase,
    p_team: team,
    p_guess_digits: guessDigits,
  });

  if (error) {
    throw error;
  }
}

export async function advanceRound(roomId: string) {
  const client = assertSupabase();
  const { error } = await client.rpc('advance_round', {
    p_room_id: roomId,
  });

  if (error) {
    throw error;
  }
}

export async function restartRoom(roomId: string) {
  const client = assertSupabase();
  const { error } = await client.rpc('restart_room', {
    p_room_id: roomId,
  });

  if (error) {
    throw error;
  }
}

export async function terminateGame(roomId: string) {
  const client = assertSupabase();
  const { error } = await client.rpc('terminate_game', {
    p_room_id: roomId,
  });

  if (error) {
    throw error;
  }
}

export async function fetchRoomSnapshot(
  roomId: string,
  options: { fullRoundHistory?: boolean } = {},
): Promise<RoomSnapshot> {
  const [
    room,
    players,
    teamWords,
    roundCodes,
    submissions,
    teamWordFeedbackRequests,
    teamWordFeedbackResponses,
    roundGuessFeedbackResponses,
  ] = await Promise.all([
    fetchRoomCore(roomId),
    fetchRoomPlayers(roomId),
    fetchTeamWords(roomId),
    fetchRoundCodes(roomId),
    fetchRoundSubmissions(roomId, { full: options.fullRoundHistory }),
    fetchTeamWordFeedbackRequests(roomId),
    fetchTeamWordFeedbackResponses(roomId),
    fetchRoundGuessFeedbackResponses(roomId),
  ]);

  return {
    room,
    players,
    teamWords,
    teamWordFeedbackRequests,
    teamWordFeedbackResponses,
    roundGuessFeedbackResponses,
    roundCodes,
    submissions,
  };
}

export async function fetchRoomCore(roomId: string): Promise<RoomRecord> {
  const client = assertSupabase();
  const { data, error } = await client.from('rooms').select(ROOM_SNAPSHOT_COLUMNS).eq('id', roomId).single();

  if (error) {
    throw error;
  }

  return data as unknown as RoomRecord;
}

export async function fetchRoomPlayers(roomId: string): Promise<PlayerRecord[]> {
  const client = assertSupabase();
  const { data, error } = await client
    .from('room_players')
    .select(PLAYER_SNAPSHOT_COLUMNS)
    .eq('room_id', roomId)
    .order('team', { ascending: true })
    .order('team_seat', { ascending: true, nullsFirst: false })
    .order('joined_at', { ascending: true });

  if (error) {
    throw error;
  }

  return ((data ?? []) as unknown) as PlayerRecord[];
}

export async function fetchTeamWords(roomId: string): Promise<TeamWordsRecord[]> {
  const client = assertSupabase();
  const { data, error } = await client
    .from('team_words')
    .select(TEAM_WORDS_SNAPSHOT_COLUMNS)
    .eq('room_id', roomId)
    .order('team', { ascending: true });

  if (error) {
    throw error;
  }

  return normalizeTeamWordsRecords(((data ?? []) as unknown) as TeamWordsRecord[]);
}

export async function fetchRoundCodes(roomId: string): Promise<RoundCodeRecord[]> {
  const client = assertSupabase();
  const { data, error } = await client
    .from('round_codes')
    .select(ROUND_CODES_SNAPSHOT_COLUMNS)
    .eq('room_id', roomId)
    .order('round_number', { ascending: true });

  if (error) {
    throw error;
  }

  return ((data ?? []) as unknown) as RoundCodeRecord[];
}

export async function fetchRoundSubmissions(
  roomId: string,
  options: { full?: boolean } = {},
): Promise<RoundSubmissionRecord[]> {
  const client = assertSupabase();
  let query = client
    .from('round_submissions')
    .select(ROUND_SUBMISSIONS_SNAPSHOT_COLUMNS)
    .eq('room_id', roomId)
    .order('round_number', { ascending: false })
    .order('team', { ascending: true });

  if (!options.full) {
    query = query.limit(DEFAULT_ROUND_HISTORY_ROW_LIMIT);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (((data ?? []) as unknown) as RoundSubmissionRecord[]).sort((a, b) => {
    if (a.round_number !== b.round_number) {
      return b.round_number - a.round_number;
    }

    return a.team.localeCompare(b.team);
  });
}

export async function fetchTeamWordFeedbackRequests(roomId: string): Promise<TeamWordFeedbackRequestRecord[]> {
  const client = assertSupabase();
  const { data, error } = await client
    .from('team_word_feedback_requests')
    .select(TEAM_WORD_FEEDBACK_REQUESTS_SNAPSHOT_COLUMNS)
    .eq('room_id', roomId)
    .order('request_number', { ascending: false });

  if (error) {
    throw error;
  }

  return normalizeFeedbackRequestRecords(((data ?? []) as unknown) as TeamWordFeedbackRequestRecord[]);
}

export async function fetchTeamWordFeedbackResponses(roomId: string): Promise<TeamWordFeedbackResponseRecord[]> {
  const client = assertSupabase();
  const { data, error } = await client
    .from('team_word_feedback_responses')
    .select(TEAM_WORD_FEEDBACK_RESPONSES_SNAPSHOT_COLUMNS)
    .eq('room_id', roomId)
    .order('slot_index', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  return ((data ?? []) as unknown) as TeamWordFeedbackResponseRecord[];
}

export async function fetchRoundGuessFeedbackResponses(roomId: string): Promise<RoundGuessFeedbackResponseRecord[]> {
  const client = assertSupabase();
  const { data, error } = await client
    .from('round_guess_feedback_responses')
    .select(ROUND_GUESS_FEEDBACK_RESPONSES_SNAPSHOT_COLUMNS)
    .eq('room_id', roomId)
    .order('round_number', { ascending: false })
    .order('phase', { ascending: true })
    .order('team', { ascending: true })
    .order('clue_index', { ascending: true })
    .order('updated_at', { ascending: true });

  if (error) {
    throw error;
  }

  return ((data ?? []) as unknown) as RoundGuessFeedbackResponseRecord[];
}

export async function fetchBangumiCatalogWords(roomId: string): Promise<string[]> {
  const client = assertSupabase();
  const { data, error } = await client
    .from('room_bangumi_catalog_entries')
    .select('title')
    .eq('room_id', roomId)
    .order('title', { ascending: true });

  if (error) {
    throw error;
  }

  return (((data ?? []) as unknown) as Array<{ title?: unknown }>)
    .map((entry) => (typeof entry.title === 'string' ? entry.title : ''))
    .filter((title) => title.length > 0);
}

export type RoomSubscriptionStatus = 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR';
export type RoomSubscriptionTable =
  | 'rooms'
  | 'room_players'
  | 'team_words'
  | 'round_codes'
  | 'round_submissions'
  | 'team_word_feedback_requests'
  | 'team_word_feedback_responses'
  | 'round_guess_feedback_responses';
export type SelfNotificationKind = 'kicked';

export function subscribeToRoom(
  roomId: string,
  onChange: (table: RoomSubscriptionTable) => void,
  onStatus?: (status: RoomSubscriptionStatus, error?: Error) => void,
): RealtimeChannel {
  const client = assertSupabase();
  const channel = client
    .channel(`room-${roomId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
      () => onChange('rooms'),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${roomId}` },
      () => onChange('room_players'),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'team_words', filter: `room_id=eq.${roomId}` },
      () => onChange('team_words'),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'round_codes', filter: `room_id=eq.${roomId}` },
      () => onChange('round_codes'),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'round_submissions', filter: `room_id=eq.${roomId}` },
      () => onChange('round_submissions'),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'team_word_feedback_requests', filter: `room_id=eq.${roomId}` },
      () => onChange('team_word_feedback_requests'),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'team_word_feedback_responses', filter: `room_id=eq.${roomId}` },
      () => onChange('team_word_feedback_responses'),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'round_guess_feedback_responses', filter: `room_id=eq.${roomId}` },
      () => onChange('round_guess_feedback_responses'),
    )
    .subscribe((status, error) => {
      onStatus?.(status as RoomSubscriptionStatus, error);
    });

  return channel;
}

export function subscribeToSelfNotifications(
  authUserId: string,
  onNotification: (notification: { roomId: string | null; kind: SelfNotificationKind }) => void,
  onStatus?: (status: RoomSubscriptionStatus, error?: Error) => void,
): RealtimeChannel {
  const client = assertSupabase();
  const channel = client
    .channel(`self-notifications-${authUserId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'player_notifications',
        filter: `auth_user_id=eq.${authUserId}`,
      },
      (payload) => {
        const next = payload.new as { room_id?: string | null; kind?: SelfNotificationKind } | null;
        if (!next || next.kind !== 'kicked') {
          return;
        }

        onNotification({
          roomId: typeof next.room_id === 'string' ? next.room_id : null,
          kind: next.kind,
        });
      },
    )
    .subscribe((status, error) => {
      onStatus?.(status as RoomSubscriptionStatus, error);
    });

  return channel;
}
