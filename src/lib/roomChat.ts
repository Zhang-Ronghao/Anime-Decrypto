import type { RoomPhase, Team } from '../types';
import {
  ROOM_CHAT_MAX_MESSAGES,
  type RoomChatMessage,
} from '../types/chat';

const ROOM_CHAT_STORAGE_PREFIX = 'anime-decrypto:room-chat:';

function getStorage(storage?: Storage): Storage | null {
  if (storage) {
    return storage;
  }

  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isStoredRoomChatMessage(value: unknown): value is RoomChatMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const message = value as Partial<RoomChatMessage>;
  return (
    message.type === 'chat_message' &&
    typeof message.messageId === 'string' &&
    typeof message.clientMessageId === 'string' &&
    typeof message.roomId === 'string' &&
    typeof message.playerId === 'string' &&
    typeof message.playerName === 'string' &&
    (message.audience === 'room' || message.audience === 'team') &&
    (message.team === undefined || message.team === 'A' || message.team === 'B') &&
    typeof message.text === 'string' &&
    typeof message.sentAt === 'number' &&
    Number.isFinite(message.sentAt)
  );
}

export function isRoomChatPhase(phase: RoomPhase): boolean {
  return phase === 'lobby' || phase === 'result' || phase === 'finished';
}

export function appendRoomChatMessage(
  messages: readonly RoomChatMessage[],
  message: RoomChatMessage,
): RoomChatMessage[] {
  if (messages.some((current) => current.messageId === message.messageId)) {
    return [...messages];
  }

  return [...messages, message].slice(-ROOM_CHAT_MAX_MESSAGES);
}

export function visibleRoomChatMessages(
  messages: readonly RoomChatMessage[],
  phase: RoomPhase,
  team: Team | null,
): RoomChatMessage[] {
  if (isRoomChatPhase(phase)) {
    return messages.filter((message) => message.audience === 'room');
  }

  if (!team) {
    return messages.filter((message) => message.audience === 'room');
  }

  return messages.filter(
    (message) => message.audience === 'room' || (message.audience === 'team' && message.team === team),
  );
}

export function loadRoomChatMessages(roomId: string, storage?: Storage): RoomChatMessage[] {
  if (!roomId) {
    return [];
  }

  const target = getStorage(storage);
  if (!target) {
    return [];
  }

  try {
    const raw = target.getItem(`${ROOM_CHAT_STORAGE_PREFIX}${roomId}`);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isStoredRoomChatMessage).slice(-ROOM_CHAT_MAX_MESSAGES) : [];
  } catch {
    return [];
  }
}

export function saveRoomChatMessages(
  roomId: string,
  messages: readonly RoomChatMessage[],
  storage?: Storage,
): void {
  if (!roomId) {
    return;
  }

  const target = getStorage(storage);
  if (!target) {
    return;
  }

  try {
    target.setItem(`${ROOM_CHAT_STORAGE_PREFIX}${roomId}`, JSON.stringify(messages.slice(-ROOM_CHAT_MAX_MESSAGES)));
  } catch {
    // In-memory history remains usable when storage is unavailable or full.
  }
}

export function clearRoomChatMessages(roomId: string, storage?: Storage): void {
  if (!roomId) {
    return;
  }

  const target = getStorage(storage);
  if (!target) {
    return;
  }

  try {
    target.removeItem(`${ROOM_CHAT_STORAGE_PREFIX}${roomId}`);
  } catch {
    // Best-effort cleanup for restricted browser modes.
  }
}
