import type {
  BangumiCatalogMergeMode,
  PlayerRecord,
  Role,
  RoomJoinStatus,
  RoomPhase,
  RoomRecord,
  RoomSnapshot,
  RoomStatus,
  RoundCodeRecord,
  RoundGuessFeedbackPhase,
  RoundGuessFeedbackResponseRecord,
  RoundSubmissionRecord,
  Team,
  TeamWordFeedbackRequestRecord,
  TeamWordFeedbackResponseRecord,
  TeamWordsRecord,
  TeamWordSlot,
} from '../src/types';
import {
  BANGUMI_POPULAR_ANIME,
  BANGUMI_POPULAR_ANIME_SOURCE_DATE,
} from '../supabase/functions/load-bangumi-catalog/bangumi-popular-anime';

export interface Env {
  DB: D1Database;
  ROOM_OBJECTS: DurableObjectNamespace;
  ALLOWED_ORIGIN?: string;
}

interface RoomState {
  room: RoomRecord;
  players: PlayerRecord[];
  teamWords: TeamWordsRecord[];
  teamWordFeedbackRequests: TeamWordFeedbackRequestRecord[];
  teamWordFeedbackResponses: TeamWordFeedbackResponseRecord[];
  roundGuessFeedbackResponses: RoundGuessFeedbackResponseRecord[];
  roundCodes: RoundCodeRecord[];
  submissions: RoundSubmissionRecord[];
  bangumiCatalogEntries: Array<{ subjectId: number; title: string }>;
}

type Action =
  | { type: 'initRoom'; playerName: string; desiredRoomCode?: string | null }
  | { type: 'joinRoom'; playerName: string }
  | { type: 'joinMidgameRoom'; playerName: string; team: Team }
  | { type: 'joinAsSpectator'; playerName: string }
  | { type: 'cleanupExpiredRooms' }
  | { type: 'leaveRoom' }
  | { type: 'transferHost'; playerId: string }
  | { type: 'disbandRoom' }
  | { type: 'kickPlayer'; playerId: string }
  | { type: 'updateRoomLobbySettings'; payload: LobbySettingsPayload }
  | { type: 'updateSelfSeat'; team: Team | null; teamSeat: number | null }
  | { type: 'updateSelfSpectator'; enabled: boolean }
  | { type: 'clearAllSeats' }
  | { type: 'startGame' }
  | { type: 'generateTeamWords'; team: Team }
  | { type: 'replaceTeamWordSlot'; team: Team; index: number }
  | { type: 'loadBangumiCatalog'; payload: LoadBangumiCatalogPayload }
  | { type: 'saveTeamWords'; team: Team; words: string[] }
  | { type: 'confirmTeamWords'; team: Team; words: string[]; slots: TeamWordSlot[] }
  | { type: 'requestTeamWordFeedback'; team: Team; words: string[]; slots: TeamWordSlot[] }
  | { type: 'submitTeamWordFeedbackBatch'; requestId: string; feedback: boolean[] }
  | { type: 'extractBangumiCharacters'; team: Team }
  | { type: 'submitClues'; team: Team; clues: string[] }
  | { type: 'submitOwnGuess'; team: Team; guess: string }
  | { type: 'submitInterceptGuess'; targetTeam: Team; guess: string }
  | { type: 'skipFirstIntercept' }
  | { type: 'submitRoundGuessFeedbackBatch'; phase: RoundGuessFeedbackPhase; team: Team; guessDigits: string[] }
  | { type: 'advanceRound' }
  | { type: 'restartRoom' }
  | { type: 'terminateGame' };

interface LobbySettingsPayload {
  seatCount: number;
  roleRotationEnabled: boolean;
  timers: { encryptMinutes: number; decodeMinutes: number; interceptMinutes: number };
  miscommunicationLimit: number;
  lifeModeEnabled: boolean;
  lifePoints: number;
  allowMidgameJoin: boolean;
  bangumiCharacterExtractEnabled: boolean;
}

interface LoadBangumiCatalogPayload {
  inputs: string[];
  collectionTypes: number[];
  mergeMode: BangumiCatalogMergeMode;
  popularLimit: number | null;
  popularYearMin: number | null;
  popularYearMax: number | null;
}

const SESSION_COOKIE = 'decrypto_session';
const ROOM_TABLES = [
  'rooms',
  'room_players',
  'team_words',
  'round_codes',
  'round_submissions',
  'team_word_feedback_requests',
  'team_word_feedback_responses',
  'round_guess_feedback_responses',
] as const;
type RoomTable = (typeof ROOM_TABLES)[number];

const DEFAULT_WORD_POOL = [
  '星轨',
  '镜海',
  '风铃',
  '夜航',
  '引擎',
  '玻璃',
  '钟楼',
  '轨道',
  '雪山',
  '珊瑚',
  '剧场',
  '旋涡',
  '琥珀',
  '纸鹤',
  '深林',
  '灯塔',
  '琴弦',
  '沙丘',
  '火种',
  '雾港',
  '雷达',
  '庭院',
  '齿轮',
  '潮汐',
  '画框',
  '信号',
  '余烬',
  '浮桥',
  '剪影',
  '棱镜',
  '回声',
  '焰火',
  '龙卷',
  '白塔',
  '萤火',
  '琴键',
  '铁锚',
  '雪萤',
  '飞鱼',
  '指针',
  '蜂巢',
  '棋盘',
  '墨迹',
  '航线',
  '雨林',
  '极光',
  '山脉',
  '陨石',
];

const CHARACTER_FALLBACKS = ['主角', '队长', '侦探', '魔法师', '转学生', '前辈', '机器人', '公主'];
const USER_AGENT = 'Zhang-Ronghao/Anime-Decrypto (https://github.com/Zhang-Ronghao/Anime-Decrypto)';
const BANGUMI_API_BASE = 'https://api.bgm.tv/v0';
const BANGUMI_LEGACY_API_BASE = 'https://api.bgm.tv';
const BANGUMI_PAGE_SIZE = 50;

interface BangumiCatalogSource {
  kind: 'user' | 'index';
  id: string;
  key: string;
  input: string;
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

function json(data: unknown, init: ResponseInit = {}, request?: Request, env?: Env): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...corsHeaders(request, env),
      ...init.headers,
    },
  });
}

function corsHeaders(request?: Request, env?: Env): HeadersInit {
  if (!request) {
    return {};
  }

  const origin = request.headers.get('origin');
  const allowed = env?.ALLOWED_ORIGIN;
  const allowOrigin = origin && (!allowed || allowed === '*' || allowed.split(',').map((item) => item.trim()).includes(origin))
    ? origin
    : allowed && allowed !== '*'
      ? allowed.split(',')[0]?.trim()
      : origin ?? '*';

  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}

function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get('cookie') ?? '';
  const prefix = `${name}=`;
  for (const part of cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }

  return null;
}

function sessionFromRequest(request: Request): string | null {
  const fromHeader = request.headers.get('x-decrypto-session');
  if (fromHeader && isUuidLike(fromHeader)) {
    return fromHeader;
  }

  const fromQuery = new URL(request.url).searchParams.get('session');
  if (fromQuery && isUuidLike(fromQuery)) {
    return fromQuery;
  }

  const fromCookie = readCookie(request, SESSION_COOKIE);
  return fromCookie && isUuidLike(fromCookie) ? fromCookie : null;
}

function sessionCookie(request: Request, userId: string): string {
  const secure = new URL(request.url).protocol === 'https:';
  const sameSite = secure ? 'SameSite=None; Secure' : 'SameSite=Lax';
  return `${SESSION_COOKIE}=${encodeURIComponent(userId)}; Path=/; Max-Age=31536000; HttpOnly; ${sameSite}`;
}

function requireSession(request: Request): string {
  const userId = sessionFromRequest(request);
  if (!userId) {
    throw new HttpError(401, '匿名会话不存在，请刷新页面重试。');
  }

  return userId;
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function id(): string {
  return crypto.randomUUID();
}

function otherTeam(team: Team): Team {
  return team === 'A' ? 'B' : 'A';
}

function teamCapacity(seatCount: number): number {
  return Math.floor(seatCount / 2);
}

function roleForSeat(teamSeat: number | null): Role | null {
  if (teamSeat === null) {
    return null;
  }

  if (teamSeat === 1) {
    return 'encoder';
  }

  if (teamSeat === 2) {
    return 'decoder';
  }

  return 'member';
}

function normalizeRoomCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function generateRoomCode(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map((value) => (value % 36).toString(36).toUpperCase())
    .join('');
}

function validateRoomCode(value: string): string {
  const code = normalizeRoomCode(value);
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    throw new HttpError(400, '房间码需要是 6 位字母或数字。');
  }

  return code;
}

function phaseDeadline(room: RoomRecord, phase: RoomPhase, startedAt = nowIso()): string | null {
  const minutes =
    phase === 'encrypt'
      ? room.encrypt_phase_minutes
      : phase === 'decode'
        ? room.decode_phase_minutes
        : phase === 'intercept'
          ? room.intercept_phase_minutes
          : null;

  return minutes === null ? null : new Date(Date.parse(startedAt) + minutes * 60_000).toISOString();
}

function emptySlot(): TeamWordSlot {
  return {
    text: '',
    subjectId: null,
    sourceTitle: null,
    showSourceTitle: false,
    characterOptions: [],
  };
}

function normalizeSlot(slot: Partial<TeamWordSlot> | null | undefined, requireText = false): TeamWordSlot {
  const text = String(slot?.text ?? '').trim();
  if (requireText && !text) {
    throw new HttpError(400, '需要填写 4 个词语。');
  }

  return {
    text,
    subjectId: typeof slot?.subjectId === 'number' && Number.isFinite(slot.subjectId) ? slot.subjectId : null,
    sourceTitle: typeof slot?.sourceTitle === 'string' && slot.sourceTitle.trim() ? slot.sourceTitle.trim() : null,
    showSourceTitle: Boolean(slot?.showSourceTitle && slot?.sourceTitle),
    characterOptions: Array.isArray(slot?.characterOptions)
      ? Array.from(new Set(slot.characterOptions.map((item) => item.trim()).filter(Boolean))).slice(0, 12)
      : [],
  };
}

function normalizeWords(words: string[], requireComplete = false): string[] {
  const next = words.slice(0, 4).map((word) => String(word ?? '').trim());
  while (next.length < 4) {
    next.push('');
  }

  if (requireComplete && next.some((word) => !word)) {
    throw new HttpError(400, '需要填写 4 个词语。');
  }

  if (requireComplete && new Set(next).size !== next.length) {
    throw new HttpError(400, '同队词语不能重复。');
  }

  return next;
}

function slotsFromWords(words: string[]): TeamWordSlot[] {
  return normalizeWords(words).map((word) => ({ ...emptySlot(), text: word }));
}

function shuffle<T>(values: T[]): T[] {
  const next = [...values];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.getRandomValues(new Uint32Array(1))[0] % (index + 1);
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }

  return next;
}

function codeText(): string {
  return shuffle(['1', '2', '3', '4']).slice(0, 3).join('-');
}

function assertGuess(value: string, label: string): string {
  if (!/^[1-4]-[1-4]-[1-4]$/.test(value)) {
    throw new HttpError(400, `${label}密码格式应为 1-2-3。`);
  }

  return value;
}

function createRoomState(roomId: string, roomCode: string, hostUserId: string, playerName: string): RoomState {
  const timestamp = nowIso();
  const room: RoomRecord = {
    id: roomId,
    room_code: roomCode,
    host_user_id: hostUserId,
    status: 'lobby',
    phase: 'lobby',
    round_number: 0,
    max_rounds: 8,
    seat_count: 4,
    role_rotation_enabled: true,
    encrypt_phase_minutes: 2,
    decode_phase_minutes: 2,
    intercept_phase_minutes: 2,
    miscommunication_limit: 2,
    life_mode_enabled: false,
    life_points: 3,
    allow_midgame_join: true,
    bangumi_character_extract_enabled: false,
    phase_started_at: timestamp,
    phase_deadline_at: null,
    winner: null,
    score_team_a_intercepts: 0,
    score_team_b_intercepts: 0,
    score_team_a_miscomms: 0,
    score_team_b_miscomms: 0,
    team_a_words_confirmed: false,
    team_b_words_confirmed: false,
    bangumi_catalog_inputs: [],
    bangumi_catalog_types: [2],
    bangumi_catalog_merge_mode: 'intersection',
    bangumi_catalog_word_count: 0,
    bangumi_catalog_updated_at: null,
    bangumi_popular_catalog_limit: null,
    bangumi_popular_year_min: null,
    bangumi_popular_year_max: null,
    created_at: timestamp,
    updated_at: timestamp,
  };

  return {
    room,
    players: [
      {
        id: id(),
        room_id: roomId,
        auth_user_id: hostUserId,
        player_name: playerName.trim(),
        team: null,
        role: null,
        team_seat: null,
        is_spectator: false,
        is_host: true,
        connected: true,
        joined_at: timestamp,
      },
    ],
    teamWords: [],
    teamWordFeedbackRequests: [],
    teamWordFeedbackResponses: [],
    roundGuessFeedbackResponses: [],
    roundCodes: [],
    submissions: [],
    bangumiCatalogEntries: [],
  };
}

function createSubmission(roomId: string, team: Team, roundNumber: number): RoundSubmissionRecord {
  const timestamp = nowIso();
  return {
    id: id(),
    room_id: roomId,
    team,
    round_number: roundNumber,
    clues: null,
    intercept_guess: null,
    own_guess: null,
    revealed_code: null,
    intercept_correct: null,
    own_correct: null,
    resolved_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function createTeamWords(roomId: string, team: Team): TeamWordsRecord {
  return {
    id: id(),
    room_id: roomId,
    team,
    words: ['', '', '', ''],
    seen_words: [],
    word_slots: Array.from({ length: 4 }, () => emptySlot()),
    confirmed: false,
    created_at: nowIso(),
  };
}

function createRoundCode(roomId: string, team: Team, roundNumber: number, encoderId: string): RoundCodeRecord {
  return {
    id: id(),
    room_id: roomId,
    team,
    round_number: roundNumber,
    encoder_player_id: encoderId,
    code: codeText(),
    created_at: nowIso(),
  };
}

function publicSnapshot(state: RoomState, userId: string, fullRoundHistory = false): RoomSnapshot {
  const self = state.players.find((player) => player.auth_user_id === userId) ?? null;
  if (!self) {
    throw new HttpError(403, '你不在该房间中。');
  }

  const visibleSubmissions = state.submissions
    .map((submission) => filterSubmission(submission, self, state.room.phase))
    .sort((left, right) => right.round_number - left.round_number || left.team.localeCompare(right.team));

  return {
    room: state.room,
    players: [...state.players].sort(sortPlayers),
    teamWords: state.teamWords.filter((record) => canSeeTeamWords(record.team, self)),
    teamWordFeedbackRequests: state.teamWordFeedbackRequests.filter((record) => self.team === record.team),
    teamWordFeedbackResponses: state.teamWordFeedbackResponses.filter((record) => self.team === record.team),
    roundGuessFeedbackResponses: state.roundGuessFeedbackResponses.filter((record) => self.team === record.team),
    roundCodes: state.roundCodes.filter((record) => record.encoder_player_id === self.id),
    submissions: fullRoundHistory ? visibleSubmissions : visibleSubmissions.slice(0, 16),
  };
}

function canSeeTeamWords(team: Team, self: PlayerRecord): boolean {
  return !self.is_spectator && self.team === team;
}

function filterSubmission(
  submission: RoundSubmissionRecord,
  self: PlayerRecord,
  phase: RoomPhase,
): RoundSubmissionRecord {
  const resolved = Boolean(submission.resolved_at) || phase === 'result' || phase === 'finished';
  const sameTeam = self.team === submission.team;
  const interceptorTeam = self.team === otherTeam(submission.team);
  return {
    ...submission,
    own_guess: sameTeam || resolved ? submission.own_guess : null,
    intercept_guess: interceptorTeam || resolved ? submission.intercept_guess : null,
    revealed_code: resolved ? submission.revealed_code : null,
    own_correct: resolved ? submission.own_correct : null,
    intercept_correct: resolved ? submission.intercept_correct : null,
  };
}

function sortPlayers(left: PlayerRecord, right: PlayerRecord): number {
  const teamOrder = (left.team ?? 'Z').localeCompare(right.team ?? 'Z');
  if (teamOrder !== 0) {
    return teamOrder;
  }

  return (left.team_seat ?? 999) - (right.team_seat ?? 999) || left.joined_at.localeCompare(right.joined_at);
}

function joinStatus(state: RoomState, userId: string): RoomJoinStatus {
  return {
    room_id: state.room.id,
    room_code: state.room.room_code,
    status: state.room.status,
    phase: state.room.phase,
    seat_count: state.room.seat_count,
    allow_midgame_join: state.room.allow_midgame_join,
    team_capacity: teamCapacity(state.room.seat_count),
    team_a_count: state.players.filter((player) => player.team === 'A' && !player.is_spectator).length,
    team_b_count: state.players.filter((player) => player.team === 'B' && !player.is_spectator).length,
    is_member: state.players.some((player) => player.auth_user_id === userId),
  };
}

function requireSelf(state: RoomState, userId: string): PlayerRecord {
  const self = state.players.find((player) => player.auth_user_id === userId);
  if (!self) {
    throw new HttpError(403, '你不在该房间中。');
  }

  return self;
}

function requireHost(state: RoomState, userId: string): PlayerRecord {
  const self = requireSelf(state, userId);
  if (!self.is_host) {
    throw new HttpError(403, '只有房主可以执行该操作。');
  }

  return self;
}

function touch(state: RoomState): void {
  state.room.updated_at = nowIso();
}

function upsertPlayer(state: RoomState, userId: string, playerName: string): PlayerRecord {
  const existing = state.players.find((player) => player.auth_user_id === userId);
  if (existing) {
    existing.player_name = playerName.trim();
    existing.connected = true;
    return existing;
  }

  const player: PlayerRecord = {
    id: id(),
    room_id: state.room.id,
    auth_user_id: userId,
    player_name: playerName.trim(),
    team: null,
    role: null,
    team_seat: null,
    is_spectator: false,
    is_host: false,
    connected: true,
    joined_at: nowIso(),
  };
  state.players.push(player);
  return player;
}

function assertPlayerName(playerName: string): string {
  const name = playerName.trim();
  if (!name) {
    throw new HttpError(400, '先输入你的昵称。');
  }

  return name.slice(0, 24);
}

function validateTeam(team: Team): Team {
  if (team !== 'A' && team !== 'B') {
    throw new HttpError(400, '队伍无效。');
  }

  return team;
}

function validateSeat(state: RoomState, team: Team, teamSeat: number): void {
  if (!Number.isInteger(teamSeat) || teamSeat < 1 || teamSeat > teamCapacity(state.room.seat_count)) {
    throw new HttpError(400, '座位无效。');
  }

  if (state.players.some((player) => player.team === team && player.team_seat === teamSeat)) {
    throw new HttpError(409, '这个座位已经有人了。');
  }
}

function assignRoles(state: RoomState, roundNumber = Math.max(1, state.room.round_number)): void {
  for (const player of state.players) {
    if (!player.team || !player.team_seat || player.is_spectator) {
      player.role = null;
    }
  }

  for (const team of ['A', 'B'] as Team[]) {
    const players = state.players
      .filter((player) => player.team === team && player.team_seat && !player.is_spectator)
      .sort((left, right) => (left.team_seat ?? 0) - (right.team_seat ?? 0));

    const count = players.length;
    if (count === 0) {
      continue;
    }

    const encoderSeat = state.room.role_rotation_enabled ? ((Math.max(roundNumber, 1) - 1) % count) + 1 : 1;
    const decoderSeat = count >= 2 ? (encoderSeat % count) + 1 : null;
    for (const player of players) {
      player.role = player.team_seat === encoderSeat ? 'encoder' : player.team_seat === decoderSeat ? 'decoder' : 'member';
    }
  }
}

function compressTeamSeats(state: RoomState): void {
  for (const team of ['A', 'B'] as Team[]) {
    state.players
      .filter((player) => player.team === team && player.team_seat !== null && !player.is_spectator)
      .sort((left, right) => (left.team_seat ?? 0) - (right.team_seat ?? 0) || left.joined_at.localeCompare(right.joined_at))
      .forEach((player, index) => {
        player.team_seat = index + 1;
      });
  }
}

function encoderFor(state: RoomState, team: Team): PlayerRecord {
  const player = state.players.find((entry) => entry.team === team && entry.role === 'encoder' && !entry.is_spectator);
  if (!player) {
    throw new HttpError(409, `${team} 队缺少加密/拦截者。`);
  }

  return player;
}

function submissionFor(state: RoomState, team: Team, roundNumber = state.room.round_number): RoundSubmissionRecord {
  const submission = state.submissions.find((entry) => entry.team === team && entry.round_number === roundNumber);
  if (!submission) {
    throw new HttpError(409, '当前回合状态不存在。');
  }

  return submission;
}

function codeFor(state: RoomState, team: Team, roundNumber = state.room.round_number): string {
  const code = state.roundCodes.find((entry) => entry.team === team && entry.round_number === roundNumber)?.code;
  if (!code) {
    throw new HttpError(409, '当前回合密码不存在。');
  }

  return code;
}

function teamWordRecord(state: RoomState, team: Team): TeamWordsRecord {
  const record = state.teamWords.find((entry) => entry.team === team);
  if (!record) {
    throw new HttpError(409, '队伍词语尚未初始化。');
  }

  return record;
}

function resolveRound(state: RoomState, skipIntercept = false): void {
  const aCode = codeFor(state, 'A');
  const bCode = codeFor(state, 'B');
  const aSubmission = submissionFor(state, 'A');
  const bSubmission = submissionFor(state, 'B');
  const aOwnCorrect = aSubmission.own_guess === aCode;
  const bOwnCorrect = bSubmission.own_guess === bCode;
  const aInterceptCorrect = !skipIntercept && aSubmission.intercept_guess === aCode;
  const bInterceptCorrect = !skipIntercept && bSubmission.intercept_guess === bCode;
  const timestamp = nowIso();

  Object.assign(aSubmission, {
    revealed_code: aCode,
    intercept_correct: aInterceptCorrect,
    own_correct: aOwnCorrect,
    resolved_at: timestamp,
    updated_at: timestamp,
  });
  Object.assign(bSubmission, {
    revealed_code: bCode,
    intercept_correct: bInterceptCorrect,
    own_correct: bOwnCorrect,
    resolved_at: timestamp,
    updated_at: timestamp,
  });

  const nextAIntercepts = state.room.score_team_a_intercepts + (bInterceptCorrect ? 1 : 0);
  const nextBIntercepts = state.room.score_team_b_intercepts + (aInterceptCorrect ? 1 : 0);
  const nextAMiscomms = state.room.score_team_a_miscomms + (aOwnCorrect ? 0 : 1);
  const nextBMiscomms = state.room.score_team_b_miscomms + (bOwnCorrect ? 0 : 1);

  state.room.score_team_a_intercepts = nextAIntercepts;
  state.room.score_team_b_intercepts = nextBIntercepts;
  state.room.score_team_a_miscomms = nextAMiscomms;
  state.room.score_team_b_miscomms = nextBMiscomms;

  const winner = determineWinner(state.room);
  state.room.phase = winner.gameFinished ? 'finished' : 'result';
  state.room.status = winner.gameFinished ? 'finished' : 'active';
  state.room.winner = winner.team;
  state.room.phase_started_at = timestamp;
  state.room.phase_deadline_at = null;
}

function determineWinner(room: RoomRecord): { gameFinished: boolean; team: Team | null } {
  if (room.life_mode_enabled) {
    const aLife = room.life_points - room.score_team_a_miscomms - room.score_team_b_intercepts;
    const bLife = room.life_points - room.score_team_b_miscomms - room.score_team_a_intercepts;
    if (aLife > 0 && bLife > 0) {
      return { gameFinished: false, team: null };
    }

    if (aLife <= 0 && bLife <= 0) {
      return { gameFinished: true, team: aLife > bLife ? 'A' : bLife > aLife ? 'B' : null };
    }

    return { gameFinished: true, team: aLife <= 0 ? 'B' : 'A' };
  }

  const aWin = room.score_team_a_intercepts >= 2 || room.score_team_b_miscomms >= room.miscommunication_limit;
  const bWin = room.score_team_b_intercepts >= 2 || room.score_team_a_miscomms >= room.miscommunication_limit;
  if (!aWin && !bWin) {
    return { gameFinished: false, team: null };
  }

  if (aWin && bWin) {
    const aScore = room.score_team_a_intercepts - room.score_team_a_miscomms;
    const bScore = room.score_team_b_intercepts - room.score_team_b_miscomms;
    return { gameFinished: true, team: aScore > bScore ? 'A' : bScore > aScore ? 'B' : null };
  }

  return { gameFinished: true, team: aWin ? 'A' : 'B' };
}

function drawTeamSlots(state: RoomState, team: Team): TeamWordSlot[] {
  const ownRecord = teamWordRecord(state, team);
  const blocked = new Set([
    ...teamWordRecord(state, otherTeam(team)).words.filter(Boolean),
    ...ownRecord.seen_words.filter(Boolean),
  ]);
  const catalogPool = state.bangumiCatalogEntries.map((entry) => entry.title);
  const sourcePool = catalogPool.length > 0 ? catalogPool : DEFAULT_WORD_POOL;
  const picked = shuffle(sourcePool.filter((word) => !blocked.has(word))).slice(0, 4);
  if (picked.length < 4) {
    throw new HttpError(409, '可用词语不足，请手动填写或重新载入词库。');
  }

  const slots = picked.map((word) => {
    const entry = state.bangumiCatalogEntries.find((item) => item.title === word);
    return {
      text: word,
      subjectId: entry?.subjectId ?? null,
      sourceTitle: entry?.title ?? null,
      showSourceTitle: false,
      characterOptions: [],
    };
  });
  ownRecord.words = picked;
  ownRecord.word_slots = slots;
  ownRecord.seen_words = Array.from(new Set([...ownRecord.seen_words, ...picked]));
  return slots;
}

async function extractCharactersFromSlots(record: TeamWordsRecord): Promise<{ slots: TeamWordSlot[]; failedTitles: string[] }> {
  const failedTitles: string[] = [];
  const slots: TeamWordSlot[] = [];

  for (const [index, slot] of record.word_slots.entries()) {
    const normalized = normalizeSlot(slot);
    if (normalized.subjectId === null || normalized.subjectId < 0 || !normalized.sourceTitle) {
      const title = normalized.sourceTitle || normalized.text;
      const options = title ? CHARACTER_FALLBACKS.map((suffix) => `${title}${suffix}`).slice(0, 6) : [];
      if (options.length === 0) {
        failedTitles.push(normalized.text || `词语 ${index + 1}`);
        slots.push(normalized);
        continue;
      }

      slots.push({
        ...normalized,
        text: options[0],
        sourceTitle: title,
        showSourceTitle: true,
        characterOptions: options,
      });
      continue;
    }

    let options: string[] = [];
    try {
      options = await fetchCharacterNames(normalized.subjectId);
    } catch {
      options = [];
    }

    if (options.length === 0) {
      failedTitles.push(normalized.sourceTitle);
      slots.push({
        ...normalized,
        text: normalized.sourceTitle,
        showSourceTitle: false,
        characterOptions: [],
      });
      continue;
    }

    slots.push({
      ...normalized,
      text: options[0],
      showSourceTitle: true,
      characterOptions: options,
    });
  }

  record.words = slots.map((slot) => slot.text);
  record.word_slots = slots;
  return { slots, failedTitles };
}

async function persistState(env: Env, state: RoomState): Promise<void> {
  await env.DB.prepare(
    `insert into rooms (id, room_code, state_json, created_at, updated_at)
     values (?, ?, ?, ?, ?)
     on conflict(id) do update set
       room_code = excluded.room_code,
       state_json = excluded.state_json,
       updated_at = excluded.updated_at`,
  )
    .bind(state.room.id, state.room.room_code, JSON.stringify(state), state.room.created_at, state.room.updated_at)
    .run();
}

async function deleteState(env: Env, roomId: string): Promise<void> {
  await env.DB.prepare('delete from rooms where id = ?').bind(roomId).run();
}

async function loadStateById(env: Env, roomId: string): Promise<RoomState | null> {
  const row = await env.DB.prepare('select state_json from rooms where id = ?').bind(roomId).first<{ state_json: string }>();
  return row ? (JSON.parse(row.state_json) as RoomState) : null;
}

async function roomIdByCode(env: Env, roomCode: string): Promise<string | null> {
  const row = await env.DB.prepare('select id from rooms where room_code = ?').bind(roomCode).first<{ id: string }>();
  return row?.id ?? null;
}

function broadcast(state: DurableObjectState, tables: readonly RoomTable[] = ROOM_TABLES): void {
  const message = JSON.stringify({ type: 'changed', tables });
  for (const socket of state.getWebSockets()) {
    try {
      socket.send(message);
    } catch {
      socket.close();
    }
  }
}

export class RoomDurableObject {
  private stateCache: RoomState | null = null;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const roomId = url.pathname.split('/').filter(Boolean).at(-1);
      if (!roomId) {
        throw new HttpError(400, '缺少房间 ID。');
      }

      if (request.headers.get('upgrade') === 'websocket') {
        return this.handleWebSocket(request);
      }

      const userId = requireSession(request);
      if (request.method === 'GET') {
        const fullRoundHistory = url.searchParams.get('fullRoundHistory') === 'true';
        const current = await this.requireState(roomId);
        return json(publicSnapshot(current, userId, fullRoundHistory), {}, request, this.env);
      }

      const body = (await request.json()) as Action;
      const result = await this.applyAction(roomId, userId, body);
      return json({ data: result }, {}, request, this.env);
    } catch (error) {
      return errorResponse(error, request, this.env);
    }
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    if (message === 'ping') {
      socket.send('pong');
    }
  }

  private handleWebSocket(request: Request): Response {
    requireSession(request);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    server.send(JSON.stringify({ type: 'ready' }));
    return new Response(null, { status: 101, webSocket: client });
  }

  private async requireState(roomId: string): Promise<RoomState> {
    if (this.stateCache?.room.id === roomId) {
      return this.stateCache;
    }

    const fromStorage = await this.state.storage.get<RoomState>('state');
    if (fromStorage?.room.id === roomId) {
      this.stateCache = fromStorage;
      return fromStorage;
    }

    const fromD1 = await loadStateById(this.env, roomId);
    if (!fromD1) {
      throw new HttpError(404, '房间不存在。');
    }

    this.stateCache = fromD1;
    await this.state.storage.put('state', fromD1);
    return fromD1;
  }

  private async save(current: RoomState, tables: readonly RoomTable[] = ROOM_TABLES): Promise<void> {
    touch(current);
    this.stateCache = current;
    await this.state.storage.put('state', current);
    await persistState(this.env, current);
    broadcast(this.state, tables);
  }

  private async applyAction(roomId: string, userId: string, action: Action): Promise<unknown> {
    if (action.type === 'initRoom') {
      if ((await loadStateById(this.env, roomId)) || (await this.state.storage.get('state'))) {
        throw new HttpError(409, '房间已经存在。');
      }

      const playerName = assertPlayerName(action.playerName);
      const roomCode = action.desiredRoomCode ? validateRoomCode(action.desiredRoomCode) : generateRoomCode();
      if (await roomIdByCode(this.env, roomCode)) {
        throw new HttpError(409, '这个房间码已经被使用。');
      }

      const created = createRoomState(roomId, roomCode, userId, playerName);
      this.stateCache = created;
      await this.save(created);
      return { room_id: created.room.id, room_code: created.room.room_code };
    }

    const current = await this.requireState(roomId);

    switch (action.type) {
      case 'joinRoom': {
        const existing = current.players.find((player) => player.auth_user_id === userId);
        if (existing) {
          existing.player_name = assertPlayerName(action.playerName);
          existing.connected = true;
        } else {
          if (current.room.status !== 'lobby') {
            throw new HttpError(409, '游戏已经开始，请选择中途加入或观战。');
          }
          upsertPlayer(current, userId, assertPlayerName(action.playerName));
        }
        await this.save(current, ['room_players', 'rooms']);
        return { room_id: current.room.id, room_code: current.room.room_code };
      }
      case 'joinMidgameRoom': {
        if (current.room.status !== 'active' || !current.room.allow_midgame_join) {
          throw new HttpError(409, '当前房间不允许中途加入。');
        }
        const team = validateTeam(action.team);
        const capacity = teamCapacity(current.room.seat_count);
        const used = new Set(current.players.filter((player) => player.team === team).map((player) => player.team_seat));
        const seat = Array.from({ length: capacity }, (_, index) => index + 1).find((value) => !used.has(value));
        if (!seat) {
          throw new HttpError(409, '该队伍已经满员。');
        }
        const player = upsertPlayer(current, userId, assertPlayerName(action.playerName));
        player.team = team;
        player.team_seat = seat;
        player.role = 'member';
        player.is_spectator = false;
        await this.save(current, ['room_players', 'rooms']);
        return { room_id: current.room.id, room_code: current.room.room_code };
      }
      case 'joinAsSpectator': {
        const player = upsertPlayer(current, userId, assertPlayerName(action.playerName));
        player.team = null;
        player.team_seat = null;
        player.role = null;
        player.is_spectator = true;
        await this.save(current, ['room_players', 'rooms']);
        return { room_id: current.room.id, room_code: current.room.room_code };
      }
      case 'cleanupExpiredRooms':
        return null;
      case 'leaveRoom':
        this.leaveRoom(current, userId);
        await this.save(current, ['room_players', 'rooms']);
        return null;
      case 'transferHost':
        this.transferHost(current, userId, action.playerId);
        await this.save(current, ['room_players', 'rooms']);
        return null;
      case 'kickPlayer':
        this.kickPlayer(current, userId, action.playerId);
        await this.save(current, ['room_players', 'rooms']);
        return null;
      case 'disbandRoom':
        requireHost(current, userId);
        await deleteState(this.env, current.room.id);
        await this.state.storage.deleteAll();
        this.stateCache = null;
        broadcast(this.state, ['rooms', 'room_players']);
        return null;
      case 'updateRoomLobbySettings':
        this.updateRoomLobbySettings(current, userId, action.payload);
        await this.save(current, ['rooms', 'room_players']);
        return null;
      case 'updateSelfSeat':
        this.updateSelfSeat(current, userId, action.team, action.teamSeat);
        await this.save(current, ['room_players', 'rooms']);
        return null;
      case 'updateSelfSpectator':
        this.updateSelfSpectator(current, userId, action.enabled);
        await this.save(current, ['room_players', 'rooms']);
        return null;
      case 'clearAllSeats':
        requireHost(current, userId);
        for (const player of current.players) {
          player.team = null;
          player.team_seat = null;
          player.role = null;
          player.is_spectator = false;
        }
        await this.save(current, ['room_players', 'rooms']);
        return null;
      case 'startGame':
        this.startGame(current, userId);
        await this.save(current);
        return null;
      case 'generateTeamWords': {
        this.requireTeamEncoder(current, userId, action.team);
        const slots = drawTeamSlots(current, action.team);
        await this.save(current, ['team_words', 'rooms']);
        return slots;
      }
      case 'replaceTeamWordSlot': {
        this.requireTeamEncoder(current, userId, action.team);
        const record = teamWordRecord(current, action.team);
        const slots = drawTeamSlots(current, action.team);
        record.word_slots[action.index] = slots[action.index] ?? record.word_slots[action.index];
        record.words = record.word_slots.map((slot) => slot.text);
        await this.save(current, ['team_words', 'rooms']);
        return record.word_slots;
      }
      case 'loadBangumiCatalog': {
        requireHost(current, userId);
        const result = await this.loadBangumiCatalog(current, action.payload);
        await this.save(current, ['rooms']);
        return result;
      }
      case 'saveTeamWords':
        this.saveTeamWords(current, userId, action.team, action.words);
        await this.save(current, ['team_words', 'rooms']);
        return null;
      case 'confirmTeamWords':
        this.confirmTeamWords(current, userId, action.team, action.words, action.slots);
        await this.save(current);
        return null;
      case 'requestTeamWordFeedback': {
        this.requestTeamWordFeedback(current, userId, action.team, action.words, action.slots);
        await this.save(current, ['team_words', 'team_word_feedback_requests', 'rooms']);
        return null;
      }
      case 'submitTeamWordFeedbackBatch':
        this.submitTeamWordFeedbackBatch(current, userId, action.requestId, action.feedback);
        await this.save(current, ['team_word_feedback_responses', 'rooms']);
        return null;
      case 'extractBangumiCharacters': {
        this.requireTeamEncoder(current, userId, action.team);
        if (!current.room.bangumi_character_extract_enabled) {
          throw new HttpError(409, '当前房间未开启角色名提取。');
        }
        const result = await extractCharactersFromSlots(teamWordRecord(current, action.team));
        await this.save(current, ['team_words', 'rooms']);
        return result;
      }
      case 'submitClues':
        this.submitClues(current, userId, action.team, action.clues);
        await this.save(current, ['round_submissions', 'rooms']);
        return null;
      case 'submitOwnGuess':
        this.submitOwnGuess(current, userId, action.team, action.guess);
        await this.save(current, ['round_submissions', 'rooms']);
        return null;
      case 'submitInterceptGuess':
        this.submitInterceptGuess(current, userId, action.targetTeam, action.guess);
        await this.save(current, ['round_submissions', 'rooms']);
        return null;
      case 'skipFirstIntercept':
        this.skipFirstIntercept(current, userId);
        await this.save(current, ['round_submissions', 'rooms']);
        return null;
      case 'submitRoundGuessFeedbackBatch':
        this.submitRoundGuessFeedbackBatch(current, userId, action.phase, action.team, action.guessDigits);
        await this.save(current, ['round_guess_feedback_responses', 'rooms']);
        return null;
      case 'advanceRound':
        this.advanceRound(current, userId);
        await this.save(current, ['round_codes', 'round_submissions', 'room_players', 'rooms']);
        return null;
      case 'restartRoom':
        this.restartRoom(current, userId, true);
        await this.save(current);
        return null;
      case 'terminateGame':
        this.restartRoom(current, userId, false);
        await this.save(current);
        return null;
      default:
        throw new HttpError(400, '未知操作。');
    }
  }

  private leaveRoom(current: RoomState, userId: string): void {
    const self = requireSelf(current, userId);
    if (current.room.status === 'active' && !self.is_spectator && self.role !== 'member') {
      throw new HttpError(409, '你当前有身份，不能退出。');
    }

    current.players = current.players.filter((player) => player.id !== self.id);
    if (self.is_host && current.players.length > 0) {
      current.players[0].is_host = true;
      current.room.host_user_id = current.players[0].auth_user_id;
    }
  }

  private transferHost(current: RoomState, userId: string, playerId: string): void {
    const self = requireHost(current, userId);
    const target = current.players.find((player) => player.id === playerId);
    if (!target || target.id === self.id) {
      throw new HttpError(404, '目标玩家不存在。');
    }

    for (const player of current.players) {
      player.is_host = player.id === target.id;
    }
    current.room.host_user_id = target.auth_user_id;
  }

  private kickPlayer(current: RoomState, userId: string, playerId: string): void {
    const self = requireHost(current, userId);
    if (self.id === playerId) {
      throw new HttpError(409, '房主不能踢出自己。');
    }

    current.players = current.players.filter((player) => player.id !== playerId);
  }

  private updateRoomLobbySettings(current: RoomState, userId: string, payload: LobbySettingsPayload): void {
    requireHost(current, userId);
    if (current.room.phase !== 'lobby') {
      throw new HttpError(409, '只有大厅阶段可以修改设置。');
    }

    if (![4, 6, 8, 10, 12, 14].includes(payload.seatCount)) {
      throw new HttpError(400, '座位数无效。');
    }

    current.room.seat_count = payload.seatCount;
    current.room.role_rotation_enabled = payload.roleRotationEnabled;
    current.room.encrypt_phase_minutes = clampInt(payload.timers.encryptMinutes, 1, 5);
    current.room.decode_phase_minutes = clampInt(payload.timers.decodeMinutes, 1, 5);
    current.room.intercept_phase_minutes = clampInt(payload.timers.interceptMinutes, 1, 5);
    current.room.miscommunication_limit = [2, 3, 4].includes(payload.miscommunicationLimit)
      ? payload.miscommunicationLimit
      : 2;
    current.room.life_mode_enabled = payload.lifeModeEnabled;
    current.room.life_points = [3, 4].includes(payload.lifePoints) ? payload.lifePoints : 3;
    current.room.allow_midgame_join = payload.allowMidgameJoin;
    current.room.bangumi_character_extract_enabled = payload.bangumiCharacterExtractEnabled;

    const capacity = teamCapacity(current.room.seat_count);
    for (const player of current.players) {
      if (player.team_seat && player.team_seat > capacity) {
        player.team = null;
        player.team_seat = null;
        player.role = null;
      }
    }
  }

  private updateSelfSeat(current: RoomState, userId: string, team: Team | null, teamSeat: number | null): void {
    const self = requireSelf(current, userId);
    if (current.room.phase !== 'lobby') {
      throw new HttpError(409, '只有大厅阶段可以选座。');
    }

    if (team === null || teamSeat === null) {
      self.team = null;
      self.team_seat = null;
      self.role = null;
      self.is_spectator = false;
      return;
    }

    validateTeam(team);
    if (self.team !== team || self.team_seat !== teamSeat) {
      validateSeat(
        {
          ...current,
          players: current.players.filter((player) => player.id !== self.id),
        },
        team,
        teamSeat,
      );
    }
    self.team = team;
    self.team_seat = teamSeat;
    self.role = roleForSeat(teamSeat);
    self.is_spectator = false;
  }

  private updateSelfSpectator(current: RoomState, userId: string, enabled: boolean): void {
    const self = requireSelf(current, userId);
    self.is_spectator = enabled;
    if (enabled) {
      self.team = null;
      self.team_seat = null;
      self.role = null;
    }
  }

  private startGame(current: RoomState, userId: string): void {
    requireHost(current, userId);
    if (current.players.some((player) => !player.is_spectator && (!player.team || !player.team_seat))) {
      throw new HttpError(409, '开始游戏前，所有已加入玩家都需要先入座。');
    }

    if (current.room.seat_count === 4) {
      const seated = current.players.filter((player) => player.team && player.team_seat && !player.is_spectator).length;
      if (seated !== 4) {
        throw new HttpError(409, '4 人房需要正好 4 名已入座玩家。');
      }
    }

    for (const team of ['A', 'B'] as Team[]) {
      if (!current.players.some((player) => player.team === team && player.team_seat === 1)) {
        throw new HttpError(409, '两队的 1 号位都必须有人。');
      }
      if (!current.players.some((player) => player.team === team && player.team_seat === 2)) {
        throw new HttpError(409, '两队的 2 号位都必须有人。');
      }
    }

    current.room.status = 'active';
    current.room.phase = 'word_assignment';
    current.room.round_number = 1;
    current.room.phase_started_at = nowIso();
    current.room.phase_deadline_at = null;
    current.room.winner = null;
    current.room.score_team_a_intercepts = 0;
    current.room.score_team_b_intercepts = 0;
    current.room.score_team_a_miscomms = 0;
    current.room.score_team_b_miscomms = 0;
    current.room.team_a_words_confirmed = false;
    current.room.team_b_words_confirmed = false;
    compressTeamSeats(current);
    assignRoles(current, 1);
    current.teamWords = [createTeamWords(current.room.id, 'A'), createTeamWords(current.room.id, 'B')];
    current.roundCodes = [];
    current.submissions = [];
    current.teamWordFeedbackRequests = [];
    current.teamWordFeedbackResponses = [];
    current.roundGuessFeedbackResponses = [];
  }

  private requireTeamEncoder(current: RoomState, userId: string, team: Team): PlayerRecord {
    validateTeam(team);
    const self = requireSelf(current, userId);
    if (self.team !== team || self.role !== 'encoder' || self.is_spectator) {
      throw new HttpError(403, '只有本队加密/拦截者可以执行该操作。');
    }

    return self;
  }

  private saveTeamWords(current: RoomState, userId: string, team: Team, words: string[]): void {
    this.requireTeamEncoder(current, userId, team);
    if (current.room.phase !== 'word_assignment') {
      throw new HttpError(409, '当前不是词语分配阶段。');
    }

    const record = teamWordRecord(current, team);
    record.words = normalizeWords(words);
    record.word_slots = slotsFromWords(record.words);
  }

  private confirmTeamWords(current: RoomState, userId: string, team: Team, words: string[], slots: TeamWordSlot[]): void {
    this.requireTeamEncoder(current, userId, team);
    if (current.room.phase !== 'word_assignment') {
      throw new HttpError(409, '当前不是词语分配阶段。');
    }

    const record = teamWordRecord(current, team);
    if (record.confirmed) {
      throw new HttpError(409, '本队词语已经确认。');
    }

    const normalizedWords = normalizeWords(words, true);
    record.words = normalizedWords;
    record.word_slots = slots.length === 4 ? slots.map((slot, index) => normalizeSlot({ ...slot, text: normalizedWords[index] }, true)) : slotsFromWords(normalizedWords);
    record.confirmed = true;
    current.room.team_a_words_confirmed = current.teamWords.some((entry) => entry.team === 'A' && entry.confirmed);
    current.room.team_b_words_confirmed = current.teamWords.some((entry) => entry.team === 'B' && entry.confirmed);

    if (current.room.team_a_words_confirmed && current.room.team_b_words_confirmed) {
      this.createRound(current, 1);
    }
  }

  private requestTeamWordFeedback(current: RoomState, userId: string, team: Team, words: string[], slots: TeamWordSlot[]): void {
    const self = this.requireTeamEncoder(current, userId, team);
    if (current.room.phase !== 'word_assignment') {
      throw new HttpError(409, '当前不是词语分配阶段。');
    }

    const record = teamWordRecord(current, team);
    if (record.confirmed) {
      throw new HttpError(409, '本队词语已经确认。');
    }

    const normalizedWords = normalizeWords(words, true);
    const normalizedSlots = slots.length === 4 ? slots.map((slot, index) => normalizeSlot({ ...slot, text: normalizedWords[index] }, true)) : slotsFromWords(normalizedWords);
    record.words = normalizedWords;
    record.word_slots = normalizedSlots;
    const requestNumber =
      Math.max(0, ...current.teamWordFeedbackRequests.filter((entry) => entry.team === team).map((entry) => entry.request_number)) + 1;
    current.teamWordFeedbackRequests.unshift({
      id: id(),
      room_id: current.room.id,
      team,
      request_number: requestNumber,
      requested_by_player_id: self.id,
      words: normalizedWords,
      word_slots: normalizedSlots,
      created_at: nowIso(),
    });
  }

  private submitTeamWordFeedbackBatch(current: RoomState, userId: string, requestId: string, feedback: boolean[]): void {
    if (feedback.length !== 4) {
      throw new HttpError(400, '需要给 4 个词语都选择打勾或打叉。');
    }

    const request = current.teamWordFeedbackRequests.find((entry) => entry.id === requestId);
    if (!request) {
      throw new HttpError(404, '词语反馈请求不存在。');
    }

    const self = requireSelf(current, userId);
    if (self.team !== request.team || self.role === 'encoder' || self.is_spectator) {
      throw new HttpError(403, '只有同队非加密者可以提交词语反馈。');
    }

    const timestamp = nowIso();
    current.teamWordFeedbackResponses = current.teamWordFeedbackResponses.filter(
      (entry) => !(entry.request_id === requestId && entry.player_id === self.id),
    );
    feedback.forEach((accepted, slotIndex) => {
      current.teamWordFeedbackResponses.push({
        id: id(),
        request_id: requestId,
        room_id: current.room.id,
        team: request.team,
        player_id: self.id,
        slot_index: slotIndex,
        accepted,
        created_at: timestamp,
        updated_at: timestamp,
      });
    });
  }

  private createRound(current: RoomState, roundNumber: number): void {
    assignRoles(current, roundNumber);
    current.roundCodes.push(createRoundCode(current.room.id, 'A', roundNumber, encoderFor(current, 'A').id));
    current.roundCodes.push(createRoundCode(current.room.id, 'B', roundNumber, encoderFor(current, 'B').id));
    current.submissions.push(createSubmission(current.room.id, 'A', roundNumber), createSubmission(current.room.id, 'B', roundNumber));
    current.room.phase = 'encrypt';
    current.room.round_number = roundNumber;
    current.room.phase_started_at = nowIso();
    current.room.phase_deadline_at = phaseDeadline(current.room, 'encrypt', current.room.phase_started_at);
  }

  private async loadBangumiCatalog(current: RoomState, payload: LoadBangumiCatalogPayload): Promise<unknown> {
    if (current.room.phase !== 'lobby') {
      throw new HttpError(409, '只有大厅阶段可以载入 Bangumi 词库。');
    }

    const sources = normalizeBangumiInputs(payload.inputs);
    const normalizedInputs = sources.map((source) => source.input);
    const collectionTypes = normalizeCollectionTypes(payload.collectionTypes);
    const mergeMode = payload.mergeMode === 'union' ? 'union' : 'intersection';
    const popularLimit = normalizePopularLimit(payload.popularLimit);
    const popularYearMin = normalizePopularYear(payload.popularYearMin);
    const popularYearMax = normalizePopularYear(payload.popularYearMax);
    if (sources.length === 0 && popularLimit === null) {
      throw new HttpError(400, '至少需要 1 个 Bangumi 用户/目录来源，或勾选热门榜单。');
    }

    const collections = await Promise.all(sources.map((source) => fetchCatalogForSource(source, collectionTypes)));
    const popularEntries = popularCatalogEntries(popularLimit, popularYearMin, popularYearMax);
    if (popularEntries.length > 0) {
      collections.push(new Map(popularEntries.map((entry) => [entry.subjectId, entry])));
    }

    const entries = mergeMode === 'union' ? unionCatalogs(collections) : intersectCatalogs(collections);
    if (entries.length < 8) {
      throw new HttpError(400, '可用动画词条少于 8 个，无法用于本局游戏。');
    }

    current.bangumiCatalogEntries = entries;
    current.room.bangumi_catalog_inputs = normalizedInputs;
    current.room.bangumi_catalog_types = collectionTypes;
    current.room.bangumi_catalog_merge_mode = mergeMode;
    current.room.bangumi_catalog_word_count = current.bangumiCatalogEntries.length;
    current.room.bangumi_catalog_updated_at = nowIso();
    current.room.bangumi_popular_catalog_limit = popularLimit;
    current.room.bangumi_popular_year_min = popularYearMin;
    current.room.bangumi_popular_year_max = popularYearMax;

    return {
      inputs: current.room.bangumi_catalog_inputs,
      collectionTypes: current.room.bangumi_catalog_types,
      mergeMode: current.room.bangumi_catalog_merge_mode,
      wordCount: current.room.bangumi_catalog_word_count,
      updatedAt: current.room.bangumi_catalog_updated_at,
      popularLimit: current.room.bangumi_popular_catalog_limit,
      popularYearMin: current.room.bangumi_popular_year_min,
      popularYearMax: current.room.bangumi_popular_year_max,
      popularSourceDate: popularLimit !== null ? BANGUMI_POPULAR_ANIME_SOURCE_DATE : null,
    };
  }

  private submitClues(current: RoomState, userId: string, team: Team, clues: string[]): void {
    this.requireTeamEncoder(current, userId, team);
    if (current.room.phase !== 'encrypt') {
      throw new HttpError(409, '当前不是加密阶段。');
    }
    if (clues.length !== 3 || clues.some((clue) => !clue.trim())) {
      throw new HttpError(400, '必须提交 3 条线索。');
    }

    const submission = submissionFor(current, team);
    submission.clues = clues.map((clue) => clue.trim());
    submission.updated_at = nowIso();
    if (current.submissions.filter((entry) => entry.round_number === current.room.round_number).every((entry) => entry.clues?.length === 3)) {
      current.room.phase = 'decode';
      current.room.phase_started_at = nowIso();
      current.room.phase_deadline_at = phaseDeadline(current.room, 'decode', current.room.phase_started_at);
    }
  }

  private submitOwnGuess(current: RoomState, userId: string, team: Team, guess: string): void {
    const self = requireSelf(current, userId);
    if (current.room.phase !== 'decode') {
      throw new HttpError(409, '当前不是解密阶段。');
    }
    if (self.team !== team || self.role !== 'decoder') {
      throw new HttpError(403, '只有本队解码者可以提交解密答案。');
    }

    const submission = submissionFor(current, team);
    submission.own_guess = assertGuess(guess, '解密');
    submission.updated_at = nowIso();
    if (current.submissions.filter((entry) => entry.round_number === current.room.round_number).every((entry) => entry.own_guess)) {
      current.room.phase = 'intercept';
      current.room.phase_started_at = nowIso();
      current.room.phase_deadline_at = phaseDeadline(current.room, 'intercept', current.room.phase_started_at);
    }
  }

  private submitInterceptGuess(current: RoomState, userId: string, targetTeam: Team, guess: string): void {
    validateTeam(targetTeam);
    const attackerTeam = otherTeam(targetTeam);
    const self = requireSelf(current, userId);
    if (current.room.phase !== 'intercept') {
      throw new HttpError(409, '当前不是拦截阶段。');
    }
    if (self.team !== attackerTeam || self.role !== 'encoder') {
      throw new HttpError(403, '只有本队加密/拦截者可以提交拦截。');
    }

    const submission = submissionFor(current, targetTeam);
    submission.intercept_guess = assertGuess(guess, '拦截');
    submission.updated_at = nowIso();
    if (current.submissions.filter((entry) => entry.round_number === current.room.round_number).every((entry) => entry.intercept_guess)) {
      resolveRound(current, false);
    }
  }

  private skipFirstIntercept(current: RoomState, userId: string): void {
    requireHost(current, userId);
    if (current.room.phase !== 'intercept' || current.room.round_number !== 1) {
      throw new HttpError(409, '只能跳过第一轮的拦截阶段。');
    }

    resolveRound(current, true);
  }

  private submitRoundGuessFeedbackBatch(
    current: RoomState,
    userId: string,
    phase: RoundGuessFeedbackPhase,
    team: Team,
    guessDigits: string[],
  ): void {
    const self = requireSelf(current, userId);
    if (current.room.phase !== phase || self.team !== team || self.is_spectator) {
      throw new HttpError(403, '当前不能提交该反馈。');
    }
    if ((phase === 'decode' && self.role !== 'member') || (phase === 'intercept' && self.role === 'encoder')) {
      throw new HttpError(403, '当前身份不能提交该反馈。');
    }
    if (guessDigits.length !== 3) {
      throw new HttpError(400, '反馈必须包含 3 个编号。');
    }

    const timestamp = nowIso();
    current.roundGuessFeedbackResponses = current.roundGuessFeedbackResponses.filter(
      (entry) => !(entry.round_number === current.room.round_number && entry.phase === phase && entry.player_id === self.id),
    );
    guessDigits.forEach((digit, clueIndex) => {
      const value = digit.trim();
      current.roundGuessFeedbackResponses.push({
        id: id(),
        room_id: current.room.id,
        round_number: current.room.round_number,
        phase,
        team,
        target_team: phase === 'decode' ? team : otherTeam(team),
        player_id: self.id,
        clue_index: clueIndex,
        guess_digit: value && ['1', '2', '3', '4'].includes(value) ? value : '-',
        created_at: timestamp,
        updated_at: timestamp,
      });
    });
  }

  private advanceRound(current: RoomState, userId: string): void {
    requireHost(current, userId);
    if (current.room.phase !== 'result') {
      throw new HttpError(409, '当前不是结算阶段。');
    }

    this.createRound(current, current.room.round_number + 1);
  }

  private restartRoom(current: RoomState, userId: string, requireFinished: boolean): void {
    requireHost(current, userId);
    if (requireFinished && (current.room.status !== 'finished' || current.room.phase !== 'finished')) {
      throw new HttpError(409, '只有游戏结束后可以重新开始。');
    }
    if (!requireFinished && current.room.status !== 'active') {
      throw new HttpError(409, '只有进行中的游戏可以终止。');
    }

    for (const player of current.players) {
      player.team = null;
      player.role = null;
      player.team_seat = null;
      player.is_spectator = false;
      player.connected = true;
    }
    current.room.status = 'lobby';
    current.room.phase = 'lobby';
    current.room.round_number = 0;
    current.room.phase_started_at = nowIso();
    current.room.phase_deadline_at = null;
    current.room.winner = null;
    current.room.score_team_a_intercepts = 0;
    current.room.score_team_b_intercepts = 0;
    current.room.score_team_a_miscomms = 0;
    current.room.score_team_b_miscomms = 0;
    current.room.team_a_words_confirmed = false;
    current.room.team_b_words_confirmed = false;
    current.teamWords = [];
    current.roundCodes = [];
    current.submissions = [];
    current.teamWordFeedbackRequests = [];
    current.teamWordFeedbackResponses = [];
    current.roundGuessFeedbackResponses = [];
  }
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function normalizeBangumiInput(value: string): BangumiCatalogSource | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d+$/.test(trimmed) || /^[A-Za-z0-9_-]+$/.test(trimmed)) {
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
    throw new HttpError(400, `无效的 Bangumi 输入：${trimmed}`);
  }

  if (!['bangumi.tv', 'bgm.tv', 'chii.in'].includes(url.hostname)) {
    throw new HttpError(400, `不支持的 Bangumi 链接：${trimmed}`);
  }

  const indexMatch = url.pathname.match(/^\/index\/(\d+)\/?$/);
  if (indexMatch?.[1]) {
    return {
      kind: 'index',
      id: indexMatch[1],
      key: `index:${indexMatch[1]}`,
      input: `https://bangumi.tv/index/${indexMatch[1]}`,
    };
  }

  const userMatch = url.pathname.match(/^\/(?:anime\/list|user)\/([^/]+)(?:\/[^/]+)?\/?$/);
  if (!userMatch?.[1]) {
    throw new HttpError(400, `只支持 Bangumi 用户主页、动画收藏页或目录链接：${trimmed}`);
  }

  const userId = decodeURIComponent(userMatch[1]).trim();
  return {
    kind: 'user',
    id: userId,
    key: `user:${userId}`,
    input: userId,
  };
}

function normalizeBangumiInputs(values: string[]): BangumiCatalogSource[] {
  const sources = values.map(normalizeBangumiInput).filter((value): value is BangumiCatalogSource => Boolean(value));
  return Array.from(new Map(sources.map((source) => [source.key, source])).values()).sort((left, right) =>
    left.input.localeCompare(right.input, 'zh-CN'),
  );
}

function normalizeCollectionTypes(values: number[]): number[] {
  const allowed = new Set([1, 2, 3, 4, 5]);
  const normalized = Array.from(new Set(values.filter((value) => Number.isInteger(value) && allowed.has(value)))).sort(
    (left, right) => left - right,
  );
  return normalized.length > 0 ? normalized : [2];
}

function normalizePopularLimit(value: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  const stepped = Math.round(value / 100) * 100;
  return Math.min(2000, Math.max(100, stepped));
}

function normalizePopularYear(value: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  const year = Math.trunc(value);
  return year >= 1900 && year <= 2100 ? year : null;
}

async function fetchBangumiJson<T>(url: URL | string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new HttpError(response.status, `Bangumi API 请求失败 (${response.status})。`);
  }

  return (await response.json()) as T;
}

async function fetchCollectionsForUserAndType(userId: string, collectionType: number): Promise<BangumiCollectionItem[]> {
  const items: BangumiCollectionItem[] = [];

  for (let offset = 0; ; offset += BANGUMI_PAGE_SIZE) {
    const url = new URL(`${BANGUMI_API_BASE}/users/${encodeURIComponent(userId)}/collections`);
    url.searchParams.set('subject_type', '2');
    url.searchParams.set('type', String(collectionType));
    url.searchParams.set('limit', String(BANGUMI_PAGE_SIZE));
    url.searchParams.set('offset', String(offset));

    const payload = await fetchBangumiJson<unknown>(url);
    const pageItems = Array.isArray(payload)
      ? payload
      : payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
        ? ((payload as { data: unknown[] }).data)
        : [];

    items.push(...(pageItems as BangumiCollectionItem[]));
    if (pageItems.length < BANGUMI_PAGE_SIZE) {
      break;
    }
  }

  return items;
}

async function fetchCollectionsForUser(userId: string, collectionTypes: number[]): Promise<BangumiCollectionItem[]> {
  return (await Promise.all(collectionTypes.map((type) => fetchCollectionsForUserAndType(userId, type)))).flat();
}

async function fetchSubjectsForIndex(indexId: string): Promise<BangumiSubject[]> {
  const subjects: BangumiSubject[] = [];

  for (let offset = 0; ; offset += BANGUMI_PAGE_SIZE) {
    const url = new URL(`${BANGUMI_API_BASE}/indices/${encodeURIComponent(indexId)}/subjects`);
    url.searchParams.set('limit', String(BANGUMI_PAGE_SIZE));
    url.searchParams.set('offset', String(offset));

    const payload = await fetchBangumiJson<unknown>(url);
    const pageItems = Array.isArray(payload)
      ? payload
      : payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
        ? ((payload as { data: unknown[] }).data)
        : [];

    subjects.push(...(pageItems as BangumiSubject[]));
    if (pageItems.length < BANGUMI_PAGE_SIZE) {
      break;
    }
  }

  return subjects;
}

function subjectToCatalogEntry(subject: BangumiSubject | null | undefined): { subjectId: number; title: string } | null {
  if (subject?.type !== undefined && subject.type !== 2) {
    return null;
  }

  const subjectId = subject?.id;
  if (typeof subjectId !== 'number' || !Number.isFinite(subjectId)) {
    return null;
  }

  const title = subject?.name_cn?.trim() || subject?.name?.trim() || '';
  return title ? { subjectId, title } : null;
}

function collectionItemToCatalogEntry(item: BangumiCollectionItem): { subjectId: number; title: string } | null {
  return subjectToCatalogEntry(item.subject ?? null);
}

async function fetchCatalogForSource(
  source: BangumiCatalogSource,
  collectionTypes: number[],
): Promise<Map<number, { subjectId: number; title: string }>> {
  const entries =
    source.kind === 'index'
      ? (await fetchSubjectsForIndex(source.id)).map(subjectToCatalogEntry)
      : (await fetchCollectionsForUser(source.id, collectionTypes)).map(collectionItemToCatalogEntry);
  const map = new Map<number, { subjectId: number; title: string }>();
  for (const entry of entries) {
    if (entry && !map.has(entry.subjectId)) {
      map.set(entry.subjectId, entry);
    }
  }
  return map;
}

function intersectCatalogs(collections: Array<Map<number, { subjectId: number; title: string }>>): Array<{ subjectId: number; title: string }> {
  if (collections.length === 0) {
    return [];
  }

  const [first, ...rest] = collections;
  const titles = new Set<string>();
  const entries: Array<{ subjectId: number; title: string }> = [];
  for (const [subjectId, entry] of first.entries()) {
    if (!rest.every((collection) => collection.has(subjectId)) || titles.has(entry.title)) {
      continue;
    }

    titles.add(entry.title);
    entries.push(entry);
  }

  return entries.sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'));
}

function unionCatalogs(collections: Array<Map<number, { subjectId: number; title: string }>>): Array<{ subjectId: number; title: string }> {
  const titles = new Set<string>();
  const entries: Array<{ subjectId: number; title: string }> = [];
  for (const collection of collections) {
    for (const entry of collection.values()) {
      if (titles.has(entry.title)) {
        continue;
      }

      titles.add(entry.title);
      entries.push(entry);
    }
  }

  return entries.sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'));
}

function popularCatalogEntries(
  limit: number | null,
  yearMin: number | null,
  yearMax: number | null,
): Array<{ subjectId: number; title: string }> {
  if (limit === null) {
    return [];
  }

  const minYear = yearMin !== null && yearMax !== null ? Math.min(yearMin, yearMax) : yearMin;
  const maxYear = yearMin !== null && yearMax !== null ? Math.max(yearMin, yearMax) : yearMax;
  return BANGUMI_POPULAR_ANIME.filter((entry) => {
    if (entry.year === null) {
      return minYear === null && maxYear === null;
    }

    if (minYear !== null && entry.year < minYear) {
      return false;
    }

    if (maxYear !== null && entry.year > maxYear) {
      return false;
    }

    return true;
  })
    .slice(0, limit)
    .map((entry) => ({
      subjectId: entry.subjectId,
      title: entry.title,
    }));
}

async function fetchCharacterNames(subjectId: number): Promise<string[]> {
  const payload = await fetchBangumiJson<BangumiSubjectPayload>(
    `${BANGUMI_LEGACY_API_BASE}/subject/${encodeURIComponent(String(subjectId))}?responseGroup=large`,
  );
  const names = new Set<string>();
  const result: string[] = [];
  for (const character of payload.crt ?? []) {
    const name = character.name_cn?.trim() || character.info?.name_cn?.trim() || character.name?.trim() || '';
    if (!name || names.has(name)) {
      continue;
    }

    names.add(name);
    result.push(name);
    if (result.length >= 12) {
      break;
    }
  }

  return result;
}

async function errorResponse(error: unknown, request: Request, env: Env): Promise<Response> {
  if (error instanceof HttpError) {
    return json({ error: error.message }, { status: error.status }, request, env);
  }

  const message = error instanceof Error ? error.message : '服务器内部错误。';
  return json({ error: message }, { status: 500 }, request, env);
}

async function proxyToRoom(env: Env, roomId: string, request: Request): Promise<Response> {
  const id = env.ROOM_OBJECTS.idFromName(roomId);
  return env.ROOM_OBJECTS.get(id).fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(request, env) });
    }

    try {
      const url = new URL(request.url);
      if (url.pathname === '/api/session') {
        const existing = sessionFromRequest(request);
        const userId = existing ?? id();
        return json(
          {
            user: { id: userId },
          },
          {
            headers: {
              'set-cookie': sessionCookie(request, userId),
            },
          },
          request,
          env,
        );
      }

      const userId = requireSession(request);
      if (url.pathname === '/api/rooms' && request.method === 'POST') {
        const body = (await request.json()) as { playerName?: string; desiredRoomCode?: string | null };
        const roomId = id();
        const roomRequest = new Request(new URL(`/room/${roomId}`, url.origin), {
          method: 'POST',
          headers: request.headers,
          body: JSON.stringify({
            type: 'initRoom',
            playerName: body.playerName ?? '',
            desiredRoomCode: body.desiredRoomCode ?? null,
          } satisfies Action),
        });
        return proxyToRoom(env, roomId, roomRequest);
      }

      if (url.pathname === '/api/rooms/join-status' && request.method === 'GET') {
        const roomCode = validateRoomCode(url.searchParams.get('code') ?? '');
        const roomId = await roomIdByCode(env, roomCode);
        if (!roomId) {
          throw new HttpError(404, '房间不存在。');
        }
        const state = await loadStateById(env, roomId);
        if (!state) {
          throw new HttpError(404, '房间不存在。');
        }
        return json(joinStatus(state, userId), {}, request, env);
      }

      if (url.pathname === '/api/rooms/join' && request.method === 'POST') {
        const body = (await request.json()) as { roomCode?: string; playerName?: string; team?: Team; spectator?: boolean; midgame?: boolean };
        const roomCode = validateRoomCode(body.roomCode ?? '');
        const roomId = await roomIdByCode(env, roomCode);
        if (!roomId) {
          throw new HttpError(404, '房间不存在。');
        }
        const action: Action = body.spectator
          ? { type: 'joinAsSpectator', playerName: body.playerName ?? '' }
          : body.midgame
            ? { type: 'joinMidgameRoom', playerName: body.playerName ?? '', team: validateTeam(body.team as Team) }
            : { type: 'joinRoom', playerName: body.playerName ?? '' };
        return proxyToRoom(
          env,
          roomId,
          new Request(new URL(`/room/${roomId}`, url.origin), {
            method: 'POST',
            headers: request.headers,
            body: JSON.stringify(action),
          }),
        );
      }

      const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)(?:\/(snapshot|action|catalog|ws))?$/);
      if (roomMatch) {
        const roomId = roomMatch[1];
        const target = roomMatch[2] ?? 'snapshot';
        if (target === 'catalog') {
          const state = await loadStateById(env, roomId);
          if (!state || !state.players.some((player) => player.auth_user_id === userId)) {
            throw new HttpError(403, '你不在该房间中。');
          }
          return json(state.bangumiCatalogEntries.map((entry) => entry.title), {}, request, env);
        }

        const roomUrl = new URL(`/room/${roomId}`, url.origin);
        if (target === 'snapshot') {
          roomUrl.search = url.search;
        }
        return proxyToRoom(env, roomId, new Request(roomUrl, request));
      }

      throw new HttpError(404, '接口不存在。');
    } catch (error) {
      return errorResponse(error, request, env);
    }
  },
};
