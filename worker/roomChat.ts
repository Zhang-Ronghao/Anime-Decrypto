import type { PlayerRecord, RoomPhase, Team } from '../src/types';
import {
  ROOM_CHAT_MAX_ENVELOPE_BYTES,
  ROOM_CHAT_MAX_TEXT_BYTES,
  ROOM_CHAT_MAX_TEXT_CODE_POINTS,
  type RoomChatAudience,
  type RoomChatErrorCode,
  type RoomChatErrorMessage,
  type RoomChatMessage,
  type RoomChatSendMessage,
} from '../src/types/chat';

interface RoomChatSocketAttachment {
  userId?: string;
  roomId?: string;
}

export interface RoomChatSocket {
  close(code?: number, reason?: string): void;
  deserializeAttachment(): unknown;
  send(message: string): void;
}

interface RateWindow {
  startedAt: number;
  count: number;
}

export interface RoomChatContext {
  roomId: string;
  phase: RoomPhase;
  players: readonly PlayerRecord[];
}

export interface ResolvedRoomChatAudience {
  audience: RoomChatAudience;
  team?: Team;
}

const CHAT_RATE_WINDOW_MS = 5000;
const CHAT_RATE_MAX_MESSAGES = 3;
const encoder = new TextEncoder();

export class RoomChatRateLimiter {
  private readonly windows = new WeakMap<RoomChatSocket, RateWindow>();

  take(socket: RoomChatSocket, now: number): boolean {
    const current = this.windows.get(socket);
    if (!current || now - current.startedAt >= CHAT_RATE_WINDOW_MS) {
      this.windows.set(socket, { startedAt: now, count: 1 });
      return true;
    }

    if (current.count >= CHAT_RATE_MAX_MESSAGES) {
      return false;
    }

    current.count += 1;
    return true;
  }
}

function safeAttachment(socket: RoomChatSocket): RoomChatSocketAttachment | null {
  try {
    const attachment = socket.deserializeAttachment() as RoomChatSocketAttachment | null;
    return attachment && typeof attachment === 'object' ? attachment : null;
  } catch {
    return null;
  }
}

function sendError(
  socket: RoomChatSocket,
  code: RoomChatErrorCode,
  message: string,
  clientMessageId?: string,
): void {
  const payload: RoomChatErrorMessage = { type: 'chat_error', code, message, clientMessageId };
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    try {
      socket.close(1011, '聊天消息返回失败。');
    } catch {
      // The socket may already be closed.
    }
  }
}

function parseSendMessage(value: unknown): RoomChatSendMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Partial<RoomChatSendMessage>;
  if (
    candidate.type !== 'chat_send' ||
    typeof candidate.clientMessageId !== 'string' ||
    candidate.clientMessageId.length < 1 ||
    candidate.clientMessageId.length > 100 ||
    (candidate.channel !== 'room' && candidate.channel !== 'team') ||
    typeof candidate.text !== 'string'
  ) {
    return null;
  }

  return {
    type: 'chat_send',
    clientMessageId: candidate.clientMessageId,
    channel: candidate.channel,
    text: candidate.text,
  };
}

function isRoomAudiencePhase(phase: RoomPhase): boolean {
  return phase === 'lobby' || phase === 'result' || phase === 'finished';
}

export function resolveRoomChatAudience(
  phase: RoomPhase,
  sender: PlayerRecord,
  requestedAudience: RoomChatAudience,
): { resolved?: ResolvedRoomChatAudience; error?: { code: RoomChatErrorCode; message: string } } {
  if (isRoomAudiencePhase(phase)) {
    return requestedAudience === 'room'
      ? { resolved: { audience: 'room' } }
      : { error: { code: 'TEAM_UNAVAILABLE', message: '当前阶段仅使用房间聊天。' } };
  }

  if (sender.is_spectator) {
    return { error: { code: 'SPECTATOR_READ_ONLY', message: '对局进行中，观战者只能查看队伍聊天。' } };
  }

  if (!sender.team) {
    return { error: { code: 'TEAM_UNAVAILABLE', message: '当前没有可用的队内聊天。' } };
  }

  if (phase === 'decode' && sender.role === 'encoder') {
    return { error: { code: 'CHAT_MUTED', message: '解密阶段，加密者暂时不能发言。' } };
  }

  if (requestedAudience === 'room') {
    return { resolved: { audience: 'room' } };
  }

  return { resolved: { audience: 'team', team: sender.team } };
}

function canReceiveTeamMessage(player: PlayerRecord | undefined, team: Team): boolean {
  return Boolean(player && (player.is_spectator || player.team === team));
}

export function handleRoomChatMessage(options: {
  socket: RoomChatSocket;
  envelope: unknown;
  envelopeBytes: number;
  sockets: readonly RoomChatSocket[];
  context: RoomChatContext;
  rateLimiter: RoomChatRateLimiter;
  now?: number;
}): void {
  if (options.envelopeBytes > ROOM_CHAT_MAX_ENVELOPE_BYTES) {
    sendError(options.socket, 'INVALID_MESSAGE', '聊天消息过长。');
    return;
  }

  const parsed = parseSendMessage(options.envelope);
  if (!parsed) {
    sendError(options.socket, 'INVALID_MESSAGE', '聊天消息格式无效。');
    return;
  }

  const normalizedText = parsed.text.trim();
  if (
    normalizedText.length === 0 ||
    Array.from(normalizedText).length > ROOM_CHAT_MAX_TEXT_CODE_POINTS ||
    encoder.encode(normalizedText).byteLength > ROOM_CHAT_MAX_TEXT_BYTES
  ) {
    sendError(
      options.socket,
      'INVALID_MESSAGE',
      `聊天内容应为 1～${ROOM_CHAT_MAX_TEXT_CODE_POINTS} 个字符。`,
      parsed.clientMessageId,
    );
    return;
  }

  const attachment = safeAttachment(options.socket);
  const userId = attachment?.userId?.trim();
  if (!userId || attachment?.roomId !== options.context.roomId) {
    sendError(options.socket, 'NO_IDENTITY', '加入房间后才能发送聊天消息。', parsed.clientMessageId);
    return;
  }

  const sender = options.context.players.find((player) => player.auth_user_id === userId);
  if (!sender) {
    sendError(options.socket, 'NO_IDENTITY', '加入房间后才能发送聊天消息。', parsed.clientMessageId);
    return;
  }

  const audienceResult = resolveRoomChatAudience(options.context.phase, sender, parsed.channel);
  if (!audienceResult.resolved) {
    sendError(
      options.socket,
      audienceResult.error?.code ?? 'TEAM_UNAVAILABLE',
      audienceResult.error?.message ?? '当前不能发送聊天消息。',
      parsed.clientMessageId,
    );
    return;
  }

  const now = options.now ?? Date.now();
  if (!options.rateLimiter.take(options.socket, now)) {
    sendError(options.socket, 'RATE_LIMITED', '发送得太快，请稍后再试。', parsed.clientMessageId);
    return;
  }

  const outgoing: RoomChatMessage = {
    type: 'chat_message',
    messageId: crypto.randomUUID(),
    clientMessageId: parsed.clientMessageId,
    roomId: options.context.roomId,
    playerId: sender.id,
    playerName: sender.player_name,
    audience: audienceResult.resolved.audience,
    ...(audienceResult.resolved.team ? { team: audienceResult.resolved.team } : {}),
    text: normalizedText,
    sentAt: now,
  };
  const payload = JSON.stringify(outgoing);

  for (const target of options.sockets) {
    const targetAttachment = safeAttachment(target);
    if (targetAttachment?.roomId !== options.context.roomId || !targetAttachment.userId) {
      continue;
    }

    const targetPlayer = options.context.players.find(
      (player) => player.auth_user_id === targetAttachment.userId,
    );
    if (!targetPlayer) {
      continue;
    }
    if (
      audienceResult.resolved.audience === 'team' &&
      audienceResult.resolved.team &&
      !canReceiveTeamMessage(targetPlayer, audienceResult.resolved.team)
    ) {
      continue;
    }

    try {
      target.send(payload);
    } catch {
      try {
        target.close(1011, '聊天广播失败。');
      } catch {
        // Best-effort cleanup.
      }
    }
  }
}
