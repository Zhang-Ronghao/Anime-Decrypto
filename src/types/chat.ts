import type { Team } from '../types';

export const ROOM_CHAT_MAX_MESSAGES = 100;
export const ROOM_CHAT_MAX_TEXT_CODE_POINTS = 50;
export const ROOM_CHAT_MAX_TEXT_BYTES = 1024;
export const ROOM_CHAT_MAX_ENVELOPE_BYTES = 2048;

export type RoomChatAudience = 'room' | 'team';

export interface RoomChatSendMessage {
  type: 'chat_send';
  clientMessageId: string;
  channel: RoomChatAudience;
  text: string;
}

export interface RoomChatMessage {
  type: 'chat_message';
  messageId: string;
  clientMessageId: string;
  roomId: string;
  playerId: string;
  playerName: string;
  audience: RoomChatAudience;
  team?: Team;
  text: string;
  sentAt: number;
}

export type RoomChatErrorCode =
  | 'INVALID_MESSAGE'
  | 'RATE_LIMITED'
  | 'NO_IDENTITY'
  | 'TEAM_UNAVAILABLE'
  | 'CHAT_MUTED'
  | 'SPECTATOR_READ_ONLY';

export interface RoomChatErrorMessage {
  type: 'chat_error';
  clientMessageId?: string;
  code: RoomChatErrorCode;
  message: string;
}

export type RoomChatServerEvent = RoomChatMessage | RoomChatErrorMessage;
