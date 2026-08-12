import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { isRoomChatPhase, visibleRoomChatMessages } from '../lib/roomChat';
import type { PlayerRecord, RoomPhase, Team } from '../types';
import {
  ROOM_CHAT_MAX_TEXT_CODE_POINTS,
  type RoomChatAudience,
  type RoomChatMessage,
} from '../types/chat';

type RoomChatDisplayMode = 'closed' | 'compact' | 'expanded';

const ROOM_CHAT_PANEL_HEIGHT_STORAGE_KEY = 'anime-decrypto:room-chat-panel-height';
const ROOM_CHAT_PANEL_MIN_HEIGHT = 120;
const ROOM_CHAT_PANEL_DEFAULT_HEIGHT = 280;

export function clampRoomChatPanelHeight(height: number, viewportHeight = 800): number {
  const maximum = Math.max(ROOM_CHAT_PANEL_MIN_HEIGHT, Math.floor(viewportHeight * 0.55));
  return Math.max(ROOM_CHAT_PANEL_MIN_HEIGHT, Math.min(maximum, Math.round(height)));
}

function loadPanelHeight(): number {
  if (typeof window === 'undefined') {
    return ROOM_CHAT_PANEL_DEFAULT_HEIGHT;
  }

  try {
    const stored = Number(window.localStorage.getItem(ROOM_CHAT_PANEL_HEIGHT_STORAGE_KEY));
    return Number.isFinite(stored) && stored > 0
      ? clampRoomChatPanelHeight(stored, window.innerHeight)
      : clampRoomChatPanelHeight(ROOM_CHAT_PANEL_DEFAULT_HEIGHT, window.innerHeight);
  } catch {
    return ROOM_CHAT_PANEL_DEFAULT_HEIGHT;
  }
}

function savePanelHeight(height: number): void {
  try {
    window.localStorage.setItem(ROOM_CHAT_PANEL_HEIGHT_STORAGE_KEY, String(height));
  } catch {
    // The panel remains resizable for the current render session.
  }
}

function formatMessageTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(timestamp);
}

function teamTone(team: Team): 'red' | 'blue' {
  return team === 'A' ? 'red' : 'blue';
}

function teamName(team: Team): string {
  return team === 'A' ? '红队' : '蓝队';
}

function chatContext(options: {
  phase: RoomPhase;
  self: PlayerRecord;
  spectatorTeamView: Team;
  connected: boolean;
  channel: RoomChatAudience;
}): {
  canSend: boolean;
  label: string;
  placeholder: string;
  team: Team | null;
  tone: 'neutral' | 'red' | 'blue';
} {
  const { phase, self, spectatorTeamView, connected, channel } = options;
  if (isRoomChatPhase(phase)) {
    return {
      canSend: connected,
      label: '房间聊天',
      placeholder: connected ? '发送给房间所有人' : '聊天连接已断开，正在恢复',
      team: null,
      tone: 'neutral',
    };
  }

  const team = self.is_spectator ? spectatorTeamView : self.team;
  const teamLabel = self.is_spectator
    ? `观战 · ${teamName(team ?? spectatorTeamView)}`
    : team
      ? `${teamName(team)}聊天`
      : '队内聊天';
  const label = channel === 'room' ? '房间聊天' : teamLabel;
  if (!connected) {
    return { canSend: false, label, placeholder: '聊天连接已断开，正在恢复', team, tone: team ? teamTone(team) : 'neutral' };
  }

  if (self.is_spectator) {
    return {
      canSend: false,
      label,
      placeholder: '观战中，仅可查看当前队伍聊天',
      team,
      tone: team ? teamTone(team) : 'neutral',
    };
  }

  if (phase === 'decode' && self.role === 'encoder') {
    return {
      canSend: false,
      label,
      placeholder: '解密阶段，加密者暂时不能发言',
      team,
      tone: team ? teamTone(team) : 'neutral',
    };
  }

  if (!team) {
    return {
      canSend: false,
      label: '队内聊天',
      placeholder: '当前没有可用的队内聊天',
      team: null,
      tone: 'neutral',
    };
  }


  if (channel === 'room') {
    return {
      canSend: true,
      label,
      placeholder: '发送给房间所有人',
      team,
      tone: 'neutral',
    };
  }

  return {
    canSend: true,
    label,
    placeholder: `发送给${teamName(team)}`,
    team,
    tone: teamTone(team),
  };
}

export function RoomChat(props: {
  connected: boolean;
  error: string;
  messages: readonly RoomChatMessage[];
  onSend: (channel: RoomChatAudience, text: string) => boolean;
  phase: RoomPhase;
  self: PlayerRecord;
  spectatorTeamView: Team;
}): React.JSX.Element {
  const { connected, error, messages, onSend, phase, self, spectatorTeamView } = props;
  const [mode, setModeState] = useState<RoomChatDisplayMode>('compact');
  const [text, setText] = useState('');
  const [channel, setChannel] = useState<RoomChatAudience>(() => isRoomChatPhase(phase) ? 'room' : 'team');
  const [unreadCount, setUnreadCount] = useState(0);
  const [panelHeight, setPanelHeight] = useState(loadPanelHeight);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const listRef = useRef<HTMLDivElement | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const seenMessageIdsRef = useRef(new Set(messages.map((message) => message.messageId)));
  const context = chatContext({ phase, self, spectatorTeamView, connected, channel });
  const visibleMessages = useMemo(
    () => visibleRoomChatMessages(messages, phase, context.team),
    [context.team, messages, phase],
  );
  const recentMessages = visibleMessages.slice(-2);
  const isExpanded = mode === 'expanded';
  const roomAudienceActive = isRoomChatPhase(phase);
  const channelSwitchAvailable = !roomAudienceActive && !self.is_spectator && Boolean(self.team);

  const scrollToBottom = useCallback(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }

    list.scrollTop = list.scrollHeight;
    setIsNearBottom(true);
  }, []);

  useEffect(() => {
    const unseen = visibleMessages.filter((message) => !seenMessageIdsRef.current.has(message.messageId));
    for (const message of messages) {
      seenMessageIdsRef.current.add(message.messageId);
    }
    if (mode === 'closed' && unseen.length > 0) {
      setUnreadCount((count) => Math.min(99, count + unseen.length));
    }
  }, [messages, mode, visibleMessages]);

  useEffect(() => {
    if (!isExpanded || !isNearBottom) {
      return;
    }

    const frame = window.requestAnimationFrame(scrollToBottom);
    return () => window.cancelAnimationFrame(frame);
  }, [isExpanded, isNearBottom, scrollToBottom, visibleMessages.length]);

  useEffect(() => () => resizeCleanupRef.current?.(), []);

  useEffect(() => {
    setText('');
  }, [channel, context.canSend, context.team, roomAudienceActive]);

  useEffect(() => {
    setChannel(roomAudienceActive ? 'room' : 'team');
  }, [roomAudienceActive, self.id]);

  function setMode(nextMode: RoomChatDisplayMode): void {
    setModeState(nextMode);
    if (nextMode !== 'closed') {
      setUnreadCount(0);
    }
  }

  function submitMessage(): void {
    if (!context.canSend || !text.trim()) {
      return;
    }

    if (onSend(channel, text)) {
      setText('');
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    submitMessage();
  }

  function handleFormKeyDown(event: ReactKeyboardEvent<HTMLFormElement>): void {
    event.stopPropagation();
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    submitMessage();
  }

  function commitPanelHeight(height: number): void {
    const next = clampRoomChatPanelHeight(height, window.innerHeight);
    setPanelHeight(next);
    savePanelHeight(next);
  }

  function beginResize(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    resizeCleanupRef.current?.();
    const startY = event.clientY;
    const startHeight = panelHeight;
    let latestHeight = startHeight;
    const handleMove = (moveEvent: PointerEvent) => {
      latestHeight = clampRoomChatPanelHeight(startHeight + startY - moveEvent.clientY, window.innerHeight);
      setPanelHeight(latestHeight);
    };
    const finish = () => {
      commitPanelHeight(latestHeight);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      resizeCleanupRef.current = null;
    };
    resizeCleanupRef.current = finish;
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }

  function handleResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'Home') {
      return;
    }

    event.preventDefault();
    const step = event.shiftKey ? 48 : 16;
    const next = event.key === 'Home'
      ? ROOM_CHAT_PANEL_DEFAULT_HEIGHT
      : panelHeight + (event.key === 'ArrowUp' ? step : -step);
    commitPanelHeight(next);
  }

  return (
    <section className={`room-chat room-chat-${context.tone}`} aria-label={context.label}>
      <div className={`room-chat-bar room-chat-bar-${mode}`}>
        <div className="room-chat-display-column">
          {isExpanded ? (
            <div className="room-chat-history" style={{ height: panelHeight }}>
              <div
                aria-label="调整聊天面板高度"
                aria-orientation="horizontal"
                className="room-chat-resize-handle"
                role="separator"
                tabIndex={0}
                onDoubleClick={() => commitPanelHeight(ROOM_CHAT_PANEL_DEFAULT_HEIGHT)}
                onKeyDown={handleResizeKeyDown}
                onPointerDown={beginResize}
              >
                <span />
              </div>
              <div
                className="room-chat-message-list"
                ref={listRef}
                onScroll={(event) => {
                  const target = event.currentTarget;
                  setIsNearBottom(target.scrollHeight - target.scrollTop - target.clientHeight < 32);
                }}
              >
                {visibleMessages.length > 0 ? visibleMessages.map((message) => (
                  <div className="room-chat-message" key={message.messageId} title={`${message.playerName}：${message.text}`}>
                    <span className={message.playerId === self.id ? 'room-chat-message-self' : undefined}>
                      {!roomAudienceActive ? (
                        <span className={`room-chat-channel-label room-chat-channel-${message.audience}${message.team ? ` room-chat-channel-${teamTone(message.team)}` : ''}`}>
                          {message.audience === 'room' ? '房间' : message.team ? teamName(message.team) : '队内'}
                        </span>
                      ) : null}
                      <strong>{message.playerName}：</strong>{message.text}
                    </span>
                    <time>{formatMessageTime(message.sentAt)}</time>
                  </div>
                )) : (
                  <p className="room-chat-empty">还没有聊天消息</p>
                )}
              </div>
              {!isNearBottom ? (
                <button className="room-chat-new-button" type="button" onClick={scrollToBottom}>查看新消息</button>
              ) : null}
            </div>
          ) : null}

          {mode === 'closed' ? (
            <button className="room-chat-record-toggle" type="button" onClick={() => setMode('compact')}>
              显示记录
              {unreadCount > 0 ? <span>{unreadCount === 99 ? '99+' : unreadCount}</span> : null}
            </button>
          ) : isExpanded ? (
            <div className="room-chat-expanded-actions">
              <span className={`room-chat-context room-chat-context-${context.tone}`}>{context.label}</span>
              <button type="button" onClick={() => setMode('compact')}>收起</button>
            </div>
          ) : (
            <div className="room-chat-preview">
              <button aria-label="展开聊天记录" type="button" onClick={() => setMode('expanded')}>
                <span className="room-chat-preview-messages">
                  {recentMessages.length > 0 ? recentMessages.map((message) => (
                    <span className="room-chat-preview-message" key={message.messageId}>
                      {!roomAudienceActive ? (
                        <span className={`room-chat-channel-label room-chat-channel-${message.audience}${message.team ? ` room-chat-channel-${teamTone(message.team)}` : ''}`}>
                          {message.audience === 'room' ? '房间' : message.team ? teamName(message.team) : '队内'}
                        </span>
                      ) : null}
                      <strong>{message.playerName}：</strong>{message.text}
                    </span>
                  )) : <span className="room-chat-preview-empty">还没有聊天消息</span>}
                </span>
              </button>
              <div className="room-chat-preview-actions">
                <button type="button" onClick={() => setMode('expanded')}>展开</button>
                <button type="button" onClick={() => setMode('closed')}>隐藏</button>
              </div>
            </div>
          )}
        </div>

        <form className="room-chat-form" onSubmit={handleSubmit} onKeyDown={handleFormKeyDown}>
          {channelSwitchAvailable ? (
            <div aria-label="聊天频道" className="room-chat-channel-switch" role="group">
              {(['team', 'room'] as const).map((nextChannel) => (
                <button
                  aria-pressed={channel === nextChannel}
                  className={channel === nextChannel ? 'room-chat-channel-active' : undefined}
                  key={nextChannel}
                  type="button"
                  onClick={() => setChannel(nextChannel)}
                >
                  {nextChannel === 'team' ? '队内' : '房间'}
                </button>
              ))}
            </div>
          ) : null}
          <input
            aria-label={context.label}
            disabled={!context.canSend}
            name="roomChatText"
            placeholder={context.placeholder}
            value={text}
            onChange={(event) => setText(Array.from(event.target.value).slice(0, ROOM_CHAT_MAX_TEXT_CODE_POINTS).join(''))}
          />
          <span className="room-chat-character-count">{Array.from(text).length}/{ROOM_CHAT_MAX_TEXT_CODE_POINTS}</span>
          <button
            className="primary-button"
            disabled={!context.canSend || !text.trim()}
            type="button"
            onClick={submitMessage}
          >
            发送
          </button>
        </form>
      </div>
      {error ? <p className="room-chat-error" role="alert">{error}</p> : null}
    </section>
  );
}
