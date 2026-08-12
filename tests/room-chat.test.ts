import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendRoomChatMessage,
  clearRoomChatMessages,
  loadRoomChatMessages,
  saveRoomChatMessages,
  visibleRoomChatMessages,
} from '../src/lib/roomChat';
import type { PlayerRecord, RoomPhase, Team } from '../src/types';
import type { RoomChatMessage } from '../src/types/chat';
import {
  handleRoomChatMessage,
  resolveRoomChatAudience,
  RoomChatRateLimiter,
  type RoomChatSocket,
} from '../worker/roomChat';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class TestSocket implements RoomChatSocket {
  readonly sent: string[] = [];
  closed = false;

  constructor(private readonly attachment: { roomId: string; userId: string }) {}

  close(): void {
    this.closed = true;
  }

  deserializeAttachment(): unknown {
    return this.attachment;
  }

  send(message: string): void {
    this.sent.push(message);
  }
}

function player(options: {
  id: string;
  userId: string;
  team?: Team | null;
  role?: PlayerRecord['role'];
  spectator?: boolean;
}): PlayerRecord {
  return {
    id: options.id,
    room_id: 'room-1',
    auth_user_id: options.userId,
    player_name: options.id,
    team: options.team ?? null,
    role: options.role ?? null,
    team_seat: options.team ? 1 : null,
    is_spectator: options.spectator === true,
    is_host: false,
    connected: true,
    joined_at: '2026-08-11T00:00:00.000Z',
  };
}

const players = [
  player({ id: 'A-encoder', userId: 'user-a', team: 'A', role: 'encoder' }),
  player({ id: 'B-decoder', userId: 'user-b', team: 'B', role: 'decoder' }),
  player({ id: 'spectator', userId: 'user-s', spectator: true }),
];

function stored(index: number, audience: 'room' | 'team', team?: Team): RoomChatMessage {
  return {
    type: 'chat_message',
    messageId: `message-${index}`,
    clientMessageId: `client-${index}`,
    roomId: 'room-1',
    playerId: 'A-encoder',
    playerName: 'A-encoder',
    audience,
    ...(team ? { team } : {}),
    text: `消息 ${index}`,
    sentAt: 1000 + index,
  };
}

function send(options: {
  sender: TestSocket;
  sockets: TestSocket[];
  phase: RoomPhase;
  channel?: 'room' | 'team';
  text?: string;
  limiter?: RoomChatRateLimiter;
  now?: number;
}): void {
  const envelope = {
    type: 'chat_send',
    clientMessageId: `client-${options.now ?? 1000}`,
    channel: options.channel ?? (['lobby', 'result', 'finished'].includes(options.phase) ? 'room' : 'team'),
    text: options.text ?? '测试消息',
  };
  handleRoomChatMessage({
    socket: options.sender,
    envelope,
    envelopeBytes: new TextEncoder().encode(JSON.stringify(envelope)).byteLength,
    sockets: options.sockets,
    context: { roomId: 'room-1', phase: options.phase, players },
    rateLimiter: options.limiter ?? new RoomChatRateLimiter(),
    now: options.now,
  });
}

test('room chat history deduplicates, limits to 100, persists, and clears', () => {
  let messages: RoomChatMessage[] = [];
  for (let index = 0; index < 105; index += 1) {
    messages = appendRoomChatMessage(messages, stored(index, 'room'));
  }

  assert.equal(messages.length, 100);
  assert.equal(messages[0]?.messageId, 'message-5');
  assert.deepEqual(appendRoomChatMessage(messages, messages.at(-1)!), messages);

  const storage = new MemoryStorage();
  saveRoomChatMessages('room-1', messages, storage);
  assert.deepEqual(loadRoomChatMessages('room-1', storage), messages);
  clearRoomChatMessages('room-1', storage);
  assert.deepEqual(loadRoomChatMessages('room-1', storage), []);
});

test('visible history includes room messages and follows the selected team view during play', () => {
  const messages = [stored(1, 'room'), stored(2, 'team', 'A'), stored(3, 'team', 'B')];

  for (const phase of ['lobby', 'result', 'finished'] as RoomPhase[]) {
    assert.deepEqual(visibleRoomChatMessages(messages, phase, 'A').map((message) => message.messageId), ['message-1']);
  }
  assert.deepEqual(visibleRoomChatMessages(messages, 'encrypt', 'A').map((message) => message.messageId), ['message-1', 'message-2']);
  assert.deepEqual(visibleRoomChatMessages(messages, 'encrypt', 'B').map((message) => message.messageId), ['message-1', 'message-3']);
  assert.deepEqual(visibleRoomChatMessages(messages, 'encrypt', null).map((message) => message.messageId), ['message-1']);
});

test('authority resolves room phases, spectator read-only, and decode encoder mute', () => {
  assert.deepEqual(resolveRoomChatAudience('lobby', players[2]!, 'room'), { resolved: { audience: 'room' } });
  assert.deepEqual(resolveRoomChatAudience('result', players[2]!, 'room'), { resolved: { audience: 'room' } });
  assert.equal(resolveRoomChatAudience('lobby', players[0]!, 'team').error?.code, 'TEAM_UNAVAILABLE');
  assert.equal(resolveRoomChatAudience('encrypt', players[2]!, 'team').error?.code, 'SPECTATOR_READ_ONLY');
  assert.equal(resolveRoomChatAudience('decode', players[0]!, 'room').error?.code, 'CHAT_MUTED');
  assert.deepEqual(resolveRoomChatAudience('intercept', players[0]!, 'team'), {
    resolved: { audience: 'team', team: 'A' },
  });
  assert.deepEqual(resolveRoomChatAudience('intercept', players[0]!, 'room'), {
    resolved: { audience: 'room' },
  });
});

test('team messages reach the sender team and every spectator, but never the opposing team', () => {
  const sender = new TestSocket({ roomId: 'room-1', userId: 'user-a' });
  const opponent = new TestSocket({ roomId: 'room-1', userId: 'user-b' });
  const spectator = new TestSocket({ roomId: 'room-1', userId: 'user-s' });

  send({ sender, sockets: [sender, opponent, spectator], phase: 'encrypt' });

  assert.equal(sender.sent.length, 1);
  assert.equal(opponent.sent.length, 0);
  assert.equal(spectator.sent.length, 1);
  const event = JSON.parse(sender.sent[0]!) as RoomChatMessage;
  assert.equal(event.audience, 'team');
  assert.equal(event.team, 'A');
});

test('room messages reach both teams and spectators during lobby and settlement', () => {
  for (const phase of ['lobby', 'result', 'finished'] as RoomPhase[]) {
    const sender = new TestSocket({ roomId: 'room-1', userId: 'user-s' });
    const teamA = new TestSocket({ roomId: 'room-1', userId: 'user-a' });
    const teamB = new TestSocket({ roomId: 'room-1', userId: 'user-b' });
    send({ sender, sockets: [sender, teamA, teamB], phase });
    assert.deepEqual([sender.sent.length, teamA.sent.length, teamB.sent.length], [1, 1, 1]);
    assert.equal((JSON.parse(sender.sent[0]!) as RoomChatMessage).audience, 'room');
  }
});

test('room channel reaches both teams and spectators during active play', () => {
  const sender = new TestSocket({ roomId: 'room-1', userId: 'user-a' });
  const opponent = new TestSocket({ roomId: 'room-1', userId: 'user-b' });
  const spectator = new TestSocket({ roomId: 'room-1', userId: 'user-s' });
  send({ sender, sockets: [sender, opponent, spectator], phase: 'encrypt', channel: 'room' });
  assert.deepEqual([sender.sent.length, opponent.sent.length, spectator.sent.length], [1, 1, 1]);
  assert.equal((JSON.parse(sender.sent[0]!) as RoomChatMessage).audience, 'room');
});

test('sockets whose player membership has been removed receive no later chat', () => {
  const sender = new TestSocket({ roomId: 'room-1', userId: 'user-a' });
  const removed = new TestSocket({ roomId: 'room-1', userId: 'removed-user' });
  send({ sender, sockets: [sender, removed], phase: 'lobby' });
  assert.equal(sender.sent.length, 1);
  assert.equal(removed.sent.length, 0);
});

test('spectators cannot send during play and encoders cannot send during decode', () => {
  const spectator = new TestSocket({ roomId: 'room-1', userId: 'user-s' });
  send({ sender: spectator, sockets: [spectator], phase: 'word_assignment' });
  assert.equal(JSON.parse(spectator.sent[0]!).code, 'SPECTATOR_READ_ONLY');

  const encoder = new TestSocket({ roomId: 'room-1', userId: 'user-a' });
  send({ sender: encoder, sockets: [encoder], phase: 'decode' });
  assert.equal(JSON.parse(encoder.sent[0]!).code, 'CHAT_MUTED');
});

test('chat validates identity, text length, and rate limits each socket', () => {
  const unknown = new TestSocket({ roomId: 'room-1', userId: 'missing' });
  send({ sender: unknown, sockets: [unknown], phase: 'lobby' });
  assert.equal(JSON.parse(unknown.sent[0]!).code, 'NO_IDENTITY');

  const sender = new TestSocket({ roomId: 'room-1', userId: 'user-a' });
  send({ sender, sockets: [sender], phase: 'lobby', text: 'x'.repeat(51) });
  assert.equal(JSON.parse(sender.sent[0]!).code, 'INVALID_MESSAGE');

  const limited = new TestSocket({ roomId: 'room-1', userId: 'user-a' });
  const limiter = new RoomChatRateLimiter();
  for (let index = 0; index < 4; index += 1) {
    send({ sender: limited, sockets: [limited], phase: 'lobby', limiter, now: 1000 + index });
  }
  assert.equal(JSON.parse(limited.sent.at(-1)!).code, 'RATE_LIMITED');

  const missingChannel = new TestSocket({ roomId: 'room-1', userId: 'user-a' });
  const invalidEnvelope = { type: 'chat_send', clientMessageId: 'missing-channel', text: '测试消息' };
  handleRoomChatMessage({
    socket: missingChannel,
    envelope: invalidEnvelope,
    envelopeBytes: new TextEncoder().encode(JSON.stringify(invalidEnvelope)).byteLength,
    sockets: [missingChannel],
    context: { roomId: 'room-1', phase: 'encrypt', players },
    rateLimiter: new RoomChatRateLimiter(),
  });
  assert.equal(JSON.parse(missingChannel.sent[0]!).code, 'INVALID_MESSAGE');
});
