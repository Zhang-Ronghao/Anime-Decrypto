import type {
  BangumiCatalogMergeMode,
  PlayerRecord,
  RoomJoinStatus,
  RoomRecord,
  RoomSnapshot,
  RoundCodeRecord,
  RoundGuessFeedbackResponseRecord,
  RoundSubmissionRecord,
  Team,
  TeamWordFeedbackRequestRecord,
  TeamWordFeedbackResponseRecord,
  TeamWordSlot,
  TeamWordsRecord,
} from '../types';

const DEFAULT_ROUND_HISTORY_ROW_LIMIT = 16;
let lastRoomId: string | null = null;

function apiBase(): string {
  return (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
}

function apiUrl(path: string): string {
  return `${apiBase()}${path}`;
}

function wsUrl(path: string): string {
  const base = apiBase();
  if (base) {
    const url = new URL(path, base);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString();
  }

  const url = new URL(path, window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...init.headers,
    },
  });

  const payload = (await response.json().catch(() => null)) as { data?: T; error?: string } | T | null;
  if (!response.ok) {
    throw new Error((payload && typeof payload === 'object' && 'error' in payload ? payload.error : null) || '请求失败');
  }

  if (payload && typeof payload === 'object' && 'data' in payload) {
    return payload.data as T;
  }

  return payload as T;
}

async function action<T = null>(roomId: string, payload: Record<string, unknown>): Promise<T> {
  return request<T>(`/api/rooms/${encodeURIComponent(roomId)}/action`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function createRoom(playerName: string, desiredRoomCode?: string) {
  return request<{ room_id: string; room_code: string }>('/api/rooms', {
    method: 'POST',
    body: JSON.stringify({
      playerName: playerName.trim(),
      desiredRoomCode: desiredRoomCode?.trim().toUpperCase() || null,
    }),
  });
}

export async function joinRoom(roomCode: string, playerName: string) {
  return request<{ room_id: string; room_code: string }>('/api/rooms/join', {
    method: 'POST',
    body: JSON.stringify({
      roomCode: roomCode.trim().toUpperCase(),
      playerName: playerName.trim(),
    }),
  });
}

export async function getRoomJoinStatus(roomCode: string): Promise<RoomJoinStatus> {
  return request<RoomJoinStatus>(`/api/rooms/join-status?code=${encodeURIComponent(roomCode.trim().toUpperCase())}`);
}

export async function joinMidgameRoom(roomCode: string, playerName: string, team: Team) {
  return request<{ room_id: string; room_code: string }>('/api/rooms/join', {
    method: 'POST',
    body: JSON.stringify({
      roomCode: roomCode.trim().toUpperCase(),
      playerName: playerName.trim(),
      team,
      midgame: true,
    }),
  });
}

export async function joinAsSpectator(roomCode: string, playerName: string) {
  return request<{ room_id: string; room_code: string }>('/api/rooms/join', {
    method: 'POST',
    body: JSON.stringify({
      roomCode: roomCode.trim().toUpperCase(),
      playerName: playerName.trim(),
      spectator: true,
    }),
  });
}

export async function cleanupExpiredRooms() {
  return null;
}

export async function leaveRoom(roomId: string) {
  await action(roomId, { type: 'leaveRoom' });
}

export async function transferHost(roomId: string, playerId: string) {
  await action(roomId, { type: 'transferHost', playerId });
}

export async function disbandRoom(roomId: string) {
  await action(roomId, { type: 'disbandRoom' });
}

export async function kickPlayer(roomId: string, playerId: string) {
  await action(roomId, { type: 'kickPlayer', playerId });
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
  await action(roomId, {
    type: 'updateRoomLobbySettings',
    payload: {
      seatCount,
      roleRotationEnabled,
      timers,
      miscommunicationLimit,
      lifeModeEnabled,
      lifePoints,
      allowMidgameJoin,
      bangumiCharacterExtractEnabled,
    },
  });
}

export async function updateSelfSeat(roomId: string, team: Team | null, teamSeat: number | null) {
  await action(roomId, { type: 'updateSelfSeat', team, teamSeat });
}

export async function updateSelfSpectator(roomId: string, enabled: boolean) {
  await action(roomId, { type: 'updateSelfSpectator', enabled });
}

export async function clearAllSeats(roomId: string) {
  await action(roomId, { type: 'clearAllSeats' });
}

export async function startGame(roomId: string) {
  await action(roomId, { type: 'startGame' });
}

export async function generateTeamWords(roomId: string, team: Team) {
  return action<TeamWordSlot[]>(roomId, { type: 'generateTeamWords', team });
}

export async function replaceTeamWordSlot(roomId: string, team: Team, index: number) {
  return action<TeamWordSlot[]>(roomId, { type: 'replaceTeamWordSlot', team, index });
}

export async function loadBangumiCatalog(
  roomId: string,
  inputs: string[],
  collectionTypes: number[],
  options: {
    mergeMode?: BangumiCatalogMergeMode;
    popularLimit?: number | null;
    popularYearMin?: number | null;
    popularYearMax?: number | null;
  } = {},
) {
  return action<{
    inputs: string[];
    collectionTypes: number[];
    mergeMode: BangumiCatalogMergeMode;
    wordCount: number;
    updatedAt: string;
    popularLimit: number | null;
    popularYearMin: number | null;
    popularYearMax: number | null;
    popularSourceDate: string | null;
  }>(roomId, {
    type: 'loadBangumiCatalog',
    payload: {
      inputs,
      collectionTypes,
      mergeMode: options.mergeMode ?? 'intersection',
      popularLimit: options.popularLimit ?? null,
      popularYearMin: options.popularYearMin ?? null,
      popularYearMax: options.popularYearMax ?? null,
    },
  });
}

export async function saveTeamWords(roomId: string, team: Team, words: string[]) {
  await action(roomId, { type: 'saveTeamWords', team, words });
}

export async function confirmTeamWords(roomId: string, team: Team, words: string[], slots: TeamWordSlot[]) {
  await action(roomId, { type: 'confirmTeamWords', team, words, slots });
}

export async function requestTeamWordFeedback(roomId: string, team: Team, words: string[], slots: TeamWordSlot[]) {
  await action(roomId, { type: 'requestTeamWordFeedback', team, words, slots });
}

export async function submitTeamWordFeedback(requestId: string, slotIndex: number, accepted: boolean) {
  const roomId = roomIdForRequest(requestId);
  if (!roomId) {
    throw new Error('缺少词语反馈请求所属房间，请刷新页面后重试。');
  }

  const snapshot = await fetchRoomSnapshot(roomId);
  const current = snapshot.teamWordFeedbackResponses
    .filter((entry) => entry.request_id === requestId)
    .sort((left, right) => left.slot_index - right.slot_index)
    .map((entry) => entry.accepted);
  const feedback = Array.from({ length: 4 }, (_, index) => (index === slotIndex ? accepted : current[index] ?? false));
  await action(roomId, { type: 'submitTeamWordFeedbackBatch', requestId, feedback });
}

export async function submitTeamWordFeedbackBatch(requestId: string, feedback: boolean[]) {
  const roomId = roomIdForRequest(requestId);
  if (!roomId) {
    throw new Error('缺少房间上下文，请刷新页面后重试。');
  }
  await action(roomId, { type: 'submitTeamWordFeedbackBatch', requestId, feedback });
}

export async function extractBangumiCharacters(roomId: string, team: Team) {
  return action<{ slots: TeamWordSlot[]; failedTitles: string[] }>(roomId, { type: 'extractBangumiCharacters', team });
}

export async function submitClues(roomId: string, team: Team, clues: string[]) {
  await action(roomId, { type: 'submitClues', team, clues: clues.map((item) => item.trim()) });
}

export async function submitInterceptGuess(roomId: string, targetTeam: Team, guess: string) {
  await action(roomId, { type: 'submitInterceptGuess', targetTeam, guess });
}

export async function skipFirstIntercept(roomId: string) {
  await action(roomId, { type: 'skipFirstIntercept' });
}

export async function submitOwnGuess(roomId: string, team: Team, guess: string) {
  await action(roomId, { type: 'submitOwnGuess', team, guess });
}

export async function submitRoundGuessFeedbackBatch(
  roomId: string,
  phase: 'decode' | 'intercept',
  team: Team,
  guessDigits: string[],
) {
  await action(roomId, { type: 'submitRoundGuessFeedbackBatch', phase, team, guessDigits });
}

export async function advanceRound(roomId: string) {
  await action(roomId, { type: 'advanceRound' });
}

export async function restartRoom(roomId: string) {
  await action(roomId, { type: 'restartRoom' });
}

export async function terminateGame(roomId: string) {
  await action(roomId, { type: 'terminateGame' });
}

export async function fetchRoomSnapshot(
  roomId: string,
  options: { fullRoundHistory?: boolean } = {},
): Promise<RoomSnapshot> {
  const snapshot = await request<RoomSnapshot>(
    `/api/rooms/${encodeURIComponent(roomId)}/snapshot?fullRoundHistory=${options.fullRoundHistory === true ? 'true' : 'false'}`,
  );
  lastRoomId = snapshot.room.id;
  rememberFeedbackRequestRooms(snapshot);
  return snapshot;
}

export async function fetchRoomCore(roomId: string): Promise<RoomRecord> {
  return (await fetchRoomSnapshot(roomId)).room;
}

export async function fetchRoomPlayers(roomId: string): Promise<PlayerRecord[]> {
  return (await fetchRoomSnapshot(roomId)).players;
}

export async function fetchTeamWords(roomId: string): Promise<TeamWordsRecord[]> {
  return (await fetchRoomSnapshot(roomId)).teamWords;
}

export async function fetchRoundCodes(roomId: string): Promise<RoundCodeRecord[]> {
  return (await fetchRoomSnapshot(roomId)).roundCodes;
}

export async function fetchRoundSubmissions(
  roomId: string,
  options: { full?: boolean } = {},
): Promise<RoundSubmissionRecord[]> {
  const submissions = (await fetchRoomSnapshot(roomId, { fullRoundHistory: options.full })).submissions;
  return options.full ? submissions : submissions.slice(0, DEFAULT_ROUND_HISTORY_ROW_LIMIT);
}

export async function fetchTeamWordFeedbackRequests(roomId: string): Promise<TeamWordFeedbackRequestRecord[]> {
  return (await fetchRoomSnapshot(roomId)).teamWordFeedbackRequests;
}

export async function fetchTeamWordFeedbackResponses(roomId: string): Promise<TeamWordFeedbackResponseRecord[]> {
  return (await fetchRoomSnapshot(roomId)).teamWordFeedbackResponses;
}

export async function fetchRoundGuessFeedbackResponses(roomId: string): Promise<RoundGuessFeedbackResponseRecord[]> {
  return (await fetchRoomSnapshot(roomId)).roundGuessFeedbackResponses;
}

export async function fetchBangumiCatalogWords(roomId: string): Promise<string[]> {
  return request<string[]>(`/api/rooms/${encodeURIComponent(roomId)}/catalog`);
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

export interface RoomSubscription {
  unsubscribe(): void;
}

export function subscribeToRoom(
  roomId: string,
  onChange: (table: RoomSubscriptionTable) => void,
  onStatus?: (status: RoomSubscriptionStatus, error?: Error) => void,
): RoomSubscription {
  const socket = new WebSocket(wsUrl(`/api/rooms/${encodeURIComponent(roomId)}/ws`));
  let opened = false;

  socket.addEventListener('open', () => {
    opened = true;
    onStatus?.('SUBSCRIBED');
  });

  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') {
      return;
    }

    try {
      const payload = JSON.parse(event.data) as { type?: string; tables?: RoomSubscriptionTable[] };
      if (payload.type === 'changed' && Array.isArray(payload.tables)) {
        for (const table of payload.tables) {
          onChange(table);
        }
      }
    } catch {
      // Ignore keepalive and malformed messages.
    }
  });

  socket.addEventListener('error', () => {
    onStatus?.('CHANNEL_ERROR', new Error('房间实时连接失败'));
  });

  socket.addEventListener('close', () => {
    onStatus?.(opened ? 'CLOSED' : 'TIMED_OUT');
  });

  return {
    unsubscribe() {
      socket.close();
    },
  };
}

export function subscribeToSelfNotifications(
  _authUserId: string,
  _onNotification: (notification: { roomId: string | null; kind: SelfNotificationKind }) => void,
  onStatus?: (status: RoomSubscriptionStatus, error?: Error) => void,
): RoomSubscription {
  onStatus?.('SUBSCRIBED');
  return {
    unsubscribe() {
      // Kicks are detected by the room snapshot membership check after room_players changes.
    },
  };
}

function rememberFeedbackRequestRooms(snapshot: RoomSnapshot): void {
  for (const request of snapshot.teamWordFeedbackRequests) {
    sessionStorage.setItem(`decrypto-request-room-${request.id}`, snapshot.room.id);
  }
}

function roomIdForRequest(requestId: string): string | null {
  const remembered = sessionStorage.getItem(`decrypto-request-room-${requestId}`);
  if (remembered) {
    return remembered;
  }

  return lastRoomId;
}
