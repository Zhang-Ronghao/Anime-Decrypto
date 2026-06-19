import type {
  BangumiCatalogMergeMode,
  RoomJoinStatus,
  RoomSnapshot,
  RoundSubmissionRecord,
  Team,
  TeamWordSlot,
} from '../types';
import { getSessionIdForRequest } from './session';

const DEFAULT_ROUND_HISTORY_ROW_LIMIT = 16;
const WS_ACTION_TIMEOUT_MS = 4000;
let lastRoomId: string | null = null;
let actionSequence = 0;

interface PendingWsAction {
  reject(error: Error): void;
  resolve(value: unknown): void;
  timeoutId: number;
}

interface ActiveRoomSocket {
  pendingActions: Map<string, PendingWsAction>;
  roomId: string;
  socket: WebSocket;
}

class WsActionTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WsActionTransportError';
  }
}

let activeRoomSocket: ActiveRoomSocket | null = null;

function emitUsageMetric(kind: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent('decrypto-usage-metric', { detail: { kind } }));
}

function apiBase(): string {
  return (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
}

function apiUrl(path: string): string {
  return `${apiBase()}${path}`;
}

function pathWithSession(path: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}session=${encodeURIComponent(getSessionIdForRequest())}`;
}

function wsUrl(path: string): string {
  const withSession = `${path}${path.includes('?') ? '&' : '?'}session=${encodeURIComponent(getSessionIdForRequest())}`;
  const base = apiBase();
  if (base) {
    const url = new URL(withSession, base);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString();
  }

  const url = new URL(withSession, window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function clientActionId(type: string): string {
  actionSequence += 1;
  return `${getSessionIdForRequest()}:${Date.now().toString(36)}:${actionSequence.toString(36)}:${type}`;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const isGet = method.toUpperCase() === 'GET';
  const metric =
    path.includes('/snapshot')
      ? 'snapshotGet'
      : path.includes('/action')
        ? 'actionPost'
        : path.includes('/catalog')
          ? 'catalogGet'
          : path === '/api/session'
            ? 'session'
            : method === 'POST'
              ? 'otherPost'
              : 'otherGet';
  emitUsageMetric(metric);

  const headers = new Headers(init.headers);
  if (!isGet || init.body) {
    headers.set('content-type', headers.get('content-type') ?? 'application/json');
    headers.set('x-decrypto-session', headers.get('x-decrypto-session') ?? getSessionIdForRequest());
  }

  const response = await fetch(apiUrl(isGet ? pathWithSession(path) : path), {
    ...init,
    credentials: 'include',
    headers,
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
  const body = {
    ...payload,
    clientActionId: clientActionId(String(payload.type ?? 'action')),
  };

  try {
    const wsResult = sendActionOverSocket<T>(roomId, body);
    if (wsResult) {
      emitUsageMetric('wsAction');
      return await wsResult;
    }
  } catch (error) {
    if (!(error instanceof WsActionTransportError)) {
      throw error;
    }

    emitUsageMetric('wsActionFallback');
  }

  return request<T>(`/api/rooms/${encodeURIComponent(roomId)}/action`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function sendActionOverSocket<T>(roomId: string, actionBody: Record<string, unknown>): Promise<T> | null {
  const clientActionIdValue = actionBody.clientActionId;
  if (
    !activeRoomSocket ||
    activeRoomSocket.roomId !== roomId ||
    activeRoomSocket.socket.readyState !== WebSocket.OPEN ||
    typeof clientActionIdValue !== 'string'
  ) {
    return null;
  }

  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      activeRoomSocket?.pendingActions.delete(clientActionIdValue);
      reject(new WsActionTransportError('WebSocket action timed out'));
    }, WS_ACTION_TIMEOUT_MS);

    activeRoomSocket!.pendingActions.set(clientActionIdValue, {
      reject,
      resolve: (value) => resolve(value as T),
      timeoutId,
    });

    try {
      activeRoomSocket!.socket.send(JSON.stringify({ type: 'action', action: actionBody }));
    } catch {
      window.clearTimeout(timeoutId);
      activeRoomSocket!.pendingActions.delete(clientActionIdValue);
      reject(new WsActionTransportError('WebSocket action send failed'));
    }
  });
}

function registerActiveRoomSocket(roomId: string, socket: WebSocket, pendingActions: Map<string, PendingWsAction>): void {
  activeRoomSocket = { roomId, socket, pendingActions };
}

function unregisterActiveRoomSocket(socket: WebSocket, reason = 'WebSocket closed'): void {
  if (activeRoomSocket?.socket !== socket) {
    return;
  }

  for (const pending of activeRoomSocket.pendingActions.values()) {
    window.clearTimeout(pending.timeoutId);
    pending.reject(new WsActionTransportError(reason));
  }
  activeRoomSocket.pendingActions.clear();
  activeRoomSocket = null;
}

function handleWsActionResult(payload: { clientActionId?: string; data?: unknown; error?: string }, pendingActions: Map<string, PendingWsAction>): boolean {
  if (!payload.clientActionId) {
    return false;
  }

  const pending = pendingActions.get(payload.clientActionId);
  if (!pending) {
    return true;
  }

  window.clearTimeout(pending.timeoutId);
  pendingActions.delete(payload.clientActionId);
  if (payload.error) {
    pending.reject(new Error(payload.error));
  } else {
    pending.resolve(payload.data ?? null);
  }
  return true;
}

export async function createRoom(playerName: string, desiredRoomCode?: string) {
  return request<{ room_id: string; room_code: string }>('/api/rooms', {
    method: 'POST',
    body: JSON.stringify({
      playerName: playerName.trim(),
      desiredRoomCode: desiredRoomCode?.trim().toUpperCase() || null,
      clientActionId: clientActionId('create-room'),
    }),
  });
}

export async function joinRoom(roomCode: string, playerName: string) {
  return request<{ room_id: string; room_code: string }>('/api/rooms/join', {
    method: 'POST',
    body: JSON.stringify({
      roomCode: roomCode.trim().toUpperCase(),
      playerName: playerName.trim(),
      clientActionId: clientActionId('join-room'),
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
      clientActionId: clientActionId('join-midgame-room'),
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
      clientActionId: clientActionId('join-spectator-room'),
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
  rememberSnapshotContext(snapshot);
  return snapshot;
}

export async function fetchRoundSubmissions(
  roomId: string,
  options: { full?: boolean } = {},
): Promise<RoundSubmissionRecord[]> {
  const submissions = (await fetchRoomSnapshot(roomId, { fullRoundHistory: options.full })).submissions;
  return options.full ? submissions : submissions.slice(0, DEFAULT_ROUND_HISTORY_ROW_LIMIT);
}

export interface BangumiCatalogWordsPage {
  words: string[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export async function fetchBangumiCatalogWords(
  roomId: string,
  options: { offset?: number; limit?: number; query?: string } = {},
): Promise<BangumiCatalogWordsPage> {
  const params = new URLSearchParams();
  params.set('offset', String(options.offset ?? 0));
  params.set('limit', String(options.limit ?? 200));
  if (options.query?.trim()) {
    params.set('query', options.query.trim());
  }

  return request<BangumiCatalogWordsPage>(`/api/rooms/${encodeURIComponent(roomId)}/catalog?${params.toString()}`);
}

export type RoomSubscriptionStatus = 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR';
export type SelfNotificationKind = 'kicked';

export interface RoomSubscription {
  setFullRoundHistory(enabled: boolean): void;
  unsubscribe(): void;
}

export function subscribeToRoom(
  roomId: string,
  onSnapshot: (snapshot: RoomSnapshot) => void,
  onRoomClosed?: (reason: string) => void,
  onStatus?: (status: RoomSubscriptionStatus, error?: Error) => void,
  options: { fullRoundHistory?: boolean } = {},
): RoomSubscription {
  const initialFullRoundHistory = options.fullRoundHistory === true;
  const socket = new WebSocket(
    wsUrl(`/api/rooms/${encodeURIComponent(roomId)}/ws?fullRoundHistory=${initialFullRoundHistory ? 'true' : 'false'}`),
  );
  const pendingActions = new Map<string, PendingWsAction>();
  let opened = false;
  let requestedFullRoundHistory = initialFullRoundHistory;

  socket.addEventListener('open', () => {
    opened = true;
    registerActiveRoomSocket(roomId, socket, pendingActions);
    if (requestedFullRoundHistory !== initialFullRoundHistory) {
      socket.send(JSON.stringify({ type: 'subscription_options', fullRoundHistory: requestedFullRoundHistory }));
    }
    emitUsageMetric('wsOpen');
    onStatus?.('SUBSCRIBED');
  });

  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') {
      return;
    }

    try {
      const payload = JSON.parse(event.data) as {
        type?: string;
        snapshot?: RoomSnapshot;
        reason?: string;
        message?: string;
        clientActionId?: string;
        data?: unknown;
        error?: string;
      };
      if (payload.type === 'snapshot' && payload.snapshot) {
        emitUsageMetric('wsSnapshot');
        rememberSnapshotContext(payload.snapshot);
        onSnapshot(payload.snapshot);
      } else if (payload.type === 'action_result') {
        handleWsActionResult(payload, pendingActions);
      } else if (payload.type === 'room_closed') {
        onRoomClosed?.(payload.reason ?? 'closed');
      } else if (payload.type === 'error') {
        onStatus?.('CHANNEL_ERROR', new Error(payload.message ?? '鎴块棿瀹炴椂杩炴帴澶辫触'));
      }
    } catch {
      // Ignore keepalive and malformed messages.
    }
  });

  socket.addEventListener('error', () => {
    onStatus?.('CHANNEL_ERROR', new Error('房间实时连接失败'));
  });

  socket.addEventListener('close', () => {
    unregisterActiveRoomSocket(socket);
    emitUsageMetric('wsClose');
    onStatus?.(opened ? 'CLOSED' : 'TIMED_OUT');
  });

  return {
    setFullRoundHistory(enabled: boolean) {
      requestedFullRoundHistory = enabled;
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }

      socket.send(JSON.stringify({ type: 'subscription_options', fullRoundHistory: enabled }));
    },
    unsubscribe() {
      unregisterActiveRoomSocket(socket, 'WebSocket unsubscribed');
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
    setFullRoundHistory() {
      // Self-notification subscriptions do not carry room snapshots.
    },
    unsubscribe() {
      // Kicks are detected by the room snapshot membership check after room_players changes.
    },
  };
}

export function rememberSnapshotContext(snapshot: RoomSnapshot): void {
  lastRoomId = snapshot.room.id;
  rememberFeedbackRequestRooms(snapshot);
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
