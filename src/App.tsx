import { useEffect, useMemo, useState } from 'react';
import {
  advanceRound,
  cleanupExpiredRooms,
  createRoom,
  disbandRoom,
  fetchRoomSnapshot,
  joinRoom,
  leaveRoom,
  restartRoom,
  startGame,
  submitClues,
  submitInterceptGuess,
  submitOwnGuess,
  subscribeToRoom,
  updateSelfSeat,
} from './lib/game';
import { ensureSession, isSupabaseConfigured, supabase } from './lib/supabase';
import { cn, isEncryptPhase, isSeatTaken, normalizeGuess, otherTeam, phaseLabel, roleName, roleOrder, teamName, teamOrder } from './lib/utils';
import type { PlayerRecord, RoomSnapshot, Role, Team } from './types';

interface SeatCardProps {
  title: string;
  occupant?: PlayerRecord;
  active?: boolean;
  onClick?: () => void;
}

function SeatCard({ title, occupant, active, onClick }: SeatCardProps) {
  return (
    <button
      className={cn('seat-card', active && 'seat-card-active')}
      disabled={!onClick}
      onClick={onClick}
      type="button"
    >
      <span className="seat-card-title">{title}</span>
      <strong>{occupant ? occupant.player_name : '空位'}</strong>
    </button>
  );
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const parts = [record.message, record.details, record.hint]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

    if (parts.length > 0) {
      return parts.join(' | ');
    }
  }

  return fallback;
}

function scoreFor(snapshot: RoomSnapshot, team: Team): { intercepts: number; miscomms: number; net: number } {
  const intercepts = team === 'A' ? snapshot.room.score_team_a_intercepts : snapshot.room.score_team_b_intercepts;
  const miscomms = team === 'A' ? snapshot.room.score_team_a_miscomms : snapshot.room.score_team_b_miscomms;
  return { intercepts, miscomms, net: intercepts - miscomms };
}

function isMissingRoomError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const record = error as Record<string, unknown>;
  return record.code === 'PGRST116';
}

function App() {
  const [booting, setBooting] = useState(true);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [displayName, setDisplayName] = useState(() => localStorage.getItem('decrypto-name') ?? '');
  const [joinCode, setJoinCode] = useState(() => new URLSearchParams(window.location.search).get('room') ?? '');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [clueForm, setClueForm] = useState(['', '', '']);
  const [decodeGuess, setDecodeGuess] = useState('');
  const [interceptGuess, setInterceptGuess] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      if (!isSupabaseConfigured) {
        setBooting(false);
        return;
      }

      try {
        const session = await ensureSession();
        if (cancelled) {
          return;
        }

        setSessionUserId(session?.user.id ?? null);
        if (session?.user.id) {
          await cleanupExpiredRooms().catch(() => undefined);
        }

        const roomCodeFromUrl = new URLSearchParams(window.location.search).get('room');
        const savedName = localStorage.getItem('decrypto-name') ?? '';

        if (session?.user.id && roomCodeFromUrl && savedName.trim()) {
          const result = await joinRoom(roomCodeFromUrl, savedName.trim());
          if (!cancelled) {
            setRoomId(result.room_id);
            setJoinCode(result.room_code);
          }
        }
      } catch (error) {
        if (!cancelled) {
          setActionError(getErrorMessage(error, '恢复房间失败'));
        }
      } finally {
        if (!cancelled) {
          setBooting(false);
        }
      }
    }

    boot();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!roomId) {
      setSnapshot(null);
      return;
    }

    let cancelled = false;
    const channel = subscribeToRoom(roomId, () => {
      void loadSnapshot(roomId);
    });

    void loadSnapshot(roomId);

    async function loadSnapshot(nextRoomId: string) {
      try {
        const nextSnapshot = await fetchRoomSnapshot(nextRoomId);
        if (!cancelled) {
          setSnapshot(nextSnapshot);
        }
      } catch (error) {
        if (!cancelled) {
          if (isMissingRoomError(error)) {
            resetRoomState('房间已结束或不存在。');
          } else {
            setActionError(getErrorMessage(error, '读取房间失败'));
          }
        }
      }
    }

    return () => {
      cancelled = true;
      void channel.unsubscribe();
    };
  }, [roomId]);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionUserId(session?.user.id ?? null);
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  const self = useMemo(() => {
    if (!snapshot || !sessionUserId) {
      return null;
    }

    return snapshot.players.find((player) => player.auth_user_id === sessionUserId) ?? null;
  }, [sessionUserId, snapshot]);

  const currentRoundSubmissions = useMemo(() => {
    if (!snapshot) {
      return [];
    }

    return snapshot.submissions.filter((entry) => entry.round_number === snapshot.room.round_number);
  }, [snapshot]);

  const currentRoundSubmissionByTeam = useMemo(() => {
    return Object.fromEntries(currentRoundSubmissions.map((entry) => [entry.team, entry])) as Partial<
      Record<Team, (typeof currentRoundSubmissions)[number]>
    >;
  }, [currentRoundSubmissions]);

  const currentRoundCodeByTeam = useMemo(() => {
    if (!snapshot) {
      return {};
    }

    return Object.fromEntries(
      snapshot.roundCodes
        .filter((entry) => entry.round_number === snapshot.room.round_number)
        .map((entry) => [entry.team, entry]),
    ) as Partial<Record<Team, (typeof snapshot.roundCodes)[number]>>;
  }, [snapshot]);

  const teamWords = useMemo(() => {
    if (!snapshot || !self?.team) {
      return [];
    }

    return snapshot.teamWords.find((entry) => entry.team === self.team)?.words ?? [];
  }, [self?.team, snapshot]);

  const myTeamSubmission = self?.team ? currentRoundSubmissionByTeam[self.team] : undefined;
  const opponentSubmission = self?.team ? currentRoundSubmissionByTeam[otherTeam(self.team)] : undefined;
  const myVisibleCode = self?.team ? currentRoundCodeByTeam[self.team]?.code ?? null : null;
  const isCurrentEncryptPhase = isEncryptPhase(snapshot?.room.phase ?? 'lobby');
  const canLeaveCurrentRoom = snapshot ? snapshot.room.status === 'lobby' || snapshot.room.status === 'finished' : false;
  const allSeatsFilled = snapshot
    ? teamOrder.every((team) =>
        roleOrder.every((role) => snapshot.players.some((player) => player.team === team && player.role === role)),
      )
    : false;

  async function withAction<T>(key: string, action: () => Promise<T>): Promise<T | null> {
    setActionError(null);
    setBusyKey(key);

    try {
      return await action();
    } catch (error) {
      setActionError(getErrorMessage(error, '操作失败'));
      return null;
    } finally {
      setBusyKey(null);
    }
  }

  function resetRoomState(message?: string) {
    setRoomId(null);
    setSnapshot(null);
    setJoinCode('');
    setClueForm(['', '', '']);
    setDecodeGuess('');
    setInterceptGuess('');
    setActionError(message ?? null);
    window.history.replaceState({}, '', window.location.pathname);
  }

  async function handleCreateRoom() {
    const name = displayName.trim();
    if (!name) {
      setActionError('先输入你的昵称。');
      return;
    }

    localStorage.setItem('decrypto-name', name);
    const result = await withAction('create-room', () => createRoom(name, joinCode));
    if (!result) {
      return;
    }

    setRoomId(result.room_id);
    setJoinCode(result.room_code);
    window.history.replaceState({}, '', `?room=${result.room_code}`);
  }

  async function handleJoinRoom() {
    const name = displayName.trim();
    const code = joinCode.trim();

    if (!name || !code) {
      setActionError('加入房间前需要填写昵称和房间码。');
      return;
    }

    localStorage.setItem('decrypto-name', name);
    const result = await withAction('join-room', () => joinRoom(code, name));
    if (!result) {
      return;
    }

    setRoomId(result.room_id);
    setJoinCode(result.room_code);
    window.history.replaceState({}, '', `?room=${result.room_code}`);
  }

  async function handleSeat(team: Team, role: Role) {
    if (!snapshot) {
      return;
    }

    await withAction(`seat-${team}-${role}`, () => updateSelfSeat(snapshot.room.id, team, role));
  }

  async function handleStartGame() {
    if (!snapshot) {
      return;
    }

    await withAction('start-game', () => startGame(snapshot.room.id));
    setClueForm(['', '', '']);
    setDecodeGuess('');
    setInterceptGuess('');
  }

  async function handleClueSubmit() {
    if (!snapshot || !self?.team) {
      return;
    }

    if (clueForm.some((value) => !value.trim())) {
      setActionError('需要填写 3 条加密结果。');
      return;
    }

    await withAction('submit-clues', () => submitClues(snapshot.room.id, self.team!, clueForm));
    setClueForm(['', '', '']);
  }

  async function handleDecodeSubmit() {
    if (!snapshot || !self?.team) {
      return;
    }

    const guess = normalizeGuess(decodeGuess);
    if (guess.length !== 5) {
      setActionError('解密密码格式应为 1-2-3。');
      return;
    }

    await withAction('submit-decode', () => submitOwnGuess(snapshot.room.id, self.team!, guess));
    setDecodeGuess('');
  }

  async function handleInterceptSubmit() {
    if (!snapshot || !self?.team) {
      return;
    }

    const guess = normalizeGuess(interceptGuess);
    if (guess.length !== 5) {
      setActionError('拦截密码格式应为 1-2-3。');
      return;
    }

    await withAction('submit-intercept', () => submitInterceptGuess(snapshot.room.id, otherTeam(self.team!), guess));
    setInterceptGuess('');
  }

  async function handleAdvanceRound() {
    if (!snapshot) {
      return;
    }

    await withAction('advance-round', () => advanceRound(snapshot.room.id));
  }

  async function handleLeaveRoom() {
    if (!snapshot || self?.is_host) {
      return;
    }

    const result = await withAction('leave-room', () => leaveRoom(snapshot.room.id));
    if (result !== null) {
      resetRoomState();
    }
  }

  async function handleDisbandRoom() {
    if (!snapshot || !self?.is_host) {
      return;
    }

    const result = await withAction('disband-room', () => disbandRoom(snapshot.room.id));
    if (result !== null) {
      resetRoomState();
    }
  }

  async function handleRestartRoom() {
    if (!snapshot || !self?.is_host) {
      return;
    }

    const result = await withAction('restart-room', () => restartRoom(snapshot.room.id));
    if (result !== null) {
      setClueForm(['', '', '']);
      setDecodeGuess('');
      setInterceptGuess('');
    }
  }

  if (booting) {
    return (
      <main className="app-shell">
        <section className="panel hero-panel">
          <p className="eyebrow">解码战</p>
          <h1>正在建立匿名会话...</h1>
        </section>
      </main>
    );
  }

  if (!isSupabaseConfigured) {
    return (
      <main className="app-shell">
        <section className="panel hero-panel">
          <p className="eyebrow">解码战</p>
          <h1>先接入 Supabase 再开始。</h1>
          <p className="muted">
            需要在项目根目录创建 <code>.env.local</code>，填写 <code>VITE_SUPABASE_URL</code> 和{' '}
            <code>VITE_SUPABASE_ANON_KEY</code>，并执行 <code>supabase/schema.sql</code>。
          </p>
        </section>
      </main>
    );
  }

  if (roomId && !snapshot) {
    return (
      <main className="app-shell">
        <section className="panel hero-panel">
          <p className="eyebrow">房间 {joinCode}</p>
          <h1>正在同步房间状态...</h1>
          {actionError ? <p className="error-text">{actionError}</p> : null}
        </section>
      </main>
    );
  }

  if (roomId && snapshot && !self) {
    return (
      <main className="app-shell">
        <section className="panel hero-panel">
          <p className="eyebrow">房间 {snapshot.room.room_code}</p>
          <h1>你还没有加入这个房间。</h1>
          <p className="muted">请返回首页重新加入，或检查匿名登录是否被浏览器重置。</p>
        </section>
      </main>
    );
  }

  if (!roomId || !snapshot || !self) {
    return (
      <main className="app-shell">
        <section className="panel hero-panel">
          <div className="hero-copy">
            <p className="eyebrow">Decrypto / 解码战</p>
            <h1>四人联机密码战</h1>
            <p className="muted">
              2v2 分队，一人加密，一人解码。每轮依次进行加密、解密、拦截，再统一结算。
            </p>
          </div>

          <div className="form-grid">
            <label>
              <span>你的昵称</span>
              <input
                maxLength={18}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="例如：阿澈"
                value={displayName}
              />
            </label>

            <label>
              <span>房间码</span>
              <input
                maxLength={6}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                placeholder="6 位房间码"
                value={joinCode}
              />
            </label>
          </div>

          <div className="button-row">
            <button className="primary-button" disabled={busyKey !== null} onClick={() => void handleCreateRoom()} type="button">
              创建房间
            </button>
            <button className="ghost-button" disabled={busyKey !== null} onClick={() => void handleJoinRoom()} type="button">
              加入房间
            </button>
          </div>

          {actionError ? <p className="error-text">{actionError}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="panel top-panel">
        <div>
          <p className="eyebrow">房间 {snapshot.room.room_code}</p>
          <h1>{phaseLabel(snapshot.room.phase)}</h1>
          <p className="muted">
            第 {snapshot.room.round_number || 0} 回合 / 你是{' '}
            {self.team ? `${teamName(self.team)} · ${self.role ? roleName(self.role) : '未入座'}` : '未入座'}
          </p>
        </div>

        <div className="top-side">
          <div className="scoreboard">
            {teamOrder.map((team) => {
              const score = scoreFor(snapshot, team);
              return (
                <article key={team}>
                  <span>{teamName(team)}</span>
                  <strong>{score.intercepts}</strong>
                  <small>拦截</small>
                  <strong>{score.miscomms}</strong>
                  <small>误传</small>
                  <strong>{score.net}</strong>
                  <small>净分</small>
                </article>
              );
            })}
          </div>

          {canLeaveCurrentRoom ? (
            <div className="room-actions">
              {self.is_host ? (
                <button className="danger-button" disabled={busyKey !== null} onClick={() => void handleDisbandRoom()} type="button">
                  解散房间
                </button>
              ) : (
                <button className="ghost-button" disabled={busyKey !== null} onClick={() => void handleLeaveRoom()} type="button">
                  离开房间
                </button>
              )}
            </div>
          ) : null}
        </div>
      </section>

      {actionError ? <p className="error-banner">{actionError}</p> : null}

      {snapshot.room.phase === 'lobby' ? (
        <section className="layout-grid">
          <article className="panel">
            <h2>席位选择</h2>
            <p className="muted">每队固定 1 名加密者和 1 名解码者。点击空位直接入座。</p>

            <div className="seat-grid">
              {teamOrder.map((team) =>
                roleOrder.map((role) => {
                  const occupant = snapshot.players.find((player) => player.team === team && player.role === role);
                  return (
                    <SeatCard
                      active={self.team === team && self.role === role}
                      key={`${team}-${role}`}
                      occupant={occupant}
                      onClick={
                        isSeatTaken(snapshot.players, team, role, self.id) || busyKey !== null
                          ? undefined
                          : () => void handleSeat(team, role)
                      }
                      title={`${teamName(team)} · ${roleName(role)}`}
                    />
                  );
                }),
              )}
            </div>

            {self.is_host ? (
              <button
                className="primary-button wide-button"
                disabled={!allSeatsFilled || busyKey !== null}
                onClick={() => void handleStartGame()}
                type="button"
              >
                开始游戏
              </button>
            ) : (
              <p className="muted">等待房主开始游戏。</p>
            )}
          </article>

          <article className="panel">
            <h2>房间玩家</h2>
            <div className="roster-list">
              {snapshot.players.map((player) => (
                <div className="roster-item" key={player.id}>
                  <div>
                    <strong>{player.player_name}</strong>
                    <p>{player.is_host ? '房主' : '成员'}</p>
                  </div>
                  <div className="tag-row">
                    <span className="tag">{player.team ? teamName(player.team) : '未分队'}</span>
                    <span className="tag">{player.role ? roleName(player.role) : '未选角色'}</span>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>
      ) : (
        <section className="layout-grid">
          <article className="panel">
            <h2>你的情报</h2>
            <div className="info-stack">
              <div className="intel-card">
                <span>本队关键词</span>
                {teamWords.length ? <strong>{teamWords.join(' / ')}</strong> : <strong>等待发牌</strong>}
              </div>
              <div className="intel-card accent">
                <span>当前密码</span>
                <strong>{myVisibleCode ?? '你当前不可见'}</strong>
              </div>
            </div>

            {isCurrentEncryptPhase && self.role === 'encoder' ? (
              <div className="form-stack">
                <p className="muted">按密码顺序各写一条加密结果，公开给所有人。</p>
                {clueForm.map((value, index) => (
                  <input
                    key={index}
                    maxLength={24}
                    onChange={(event) =>
                      setClueForm((current) => current.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)))
                    }
                    placeholder={`加密结果 ${index + 1}`}
                    value={value}
                  />
                ))}
                <button className="primary-button" disabled={busyKey !== null || Boolean(myTeamSubmission?.clues)} onClick={() => void handleClueSubmit()} type="button">
                  提交加密结果
                </button>
              </div>
            ) : null}

            {snapshot.room.phase === 'decode' && self.role === 'decoder' && self.team ? (
              <div className="form-stack">
                <p className="muted">根据本队加密者给出的信息，解出本队密码。正确答案会在拦截后统一公开。</p>
                <strong>{myTeamSubmission?.clues?.join(' / ') ?? '等待本队加密结果'}</strong>
                <input
                  onChange={(event) => setDecodeGuess(normalizeGuess(event.target.value))}
                  placeholder="例如 1-3-4"
                  value={decodeGuess}
                />
                <button
                  className="primary-button"
                  disabled={busyKey !== null || Boolean(myTeamSubmission?.own_guess)}
                  onClick={() => void handleDecodeSubmit()}
                  type="button"
                >
                  提交本队解密
                </button>
              </div>
            ) : null}

            {snapshot.room.phase === 'intercept' && self.role === 'encoder' && self.team ? (
              <div className="form-stack">
                <p className="muted">根据对方公开的加密结果，尝试拦截对方密码。</p>
                <strong>{opponentSubmission?.clues?.join(' / ') ?? '等待对方加密结果'}</strong>
                <input
                  onChange={(event) => setInterceptGuess(normalizeGuess(event.target.value))}
                  placeholder="例如 2-4-1"
                  value={interceptGuess}
                />
                <button
                  className="primary-button"
                  disabled={busyKey !== null || Boolean(opponentSubmission?.intercept_guess)}
                  onClick={() => void handleInterceptSubmit()}
                  type="button"
                >
                  提交拦截
                </button>
              </div>
            ) : null}

            {!(
              (isCurrentEncryptPhase && self.role === 'encoder') ||
              (snapshot.room.phase === 'decode' && self.role === 'decoder') ||
              (snapshot.room.phase === 'intercept' && self.role === 'encoder')
            ) ? (
              <p className="muted">当前阶段没有你的主动操作，等待其他玩家提交即可。</p>
            ) : null}
          </article>

          <article className="panel">
            <h2>本轮信息板</h2>
            <div className="round-grid">
              {teamOrder.map((team) => {
                const entry = currentRoundSubmissionByTeam[team];
                return (
                  <div className="round-card" key={team}>
                    <p className="eyebrow">{teamName(team)}</p>
                    <strong>{entry?.clues?.join(' / ') ?? '尚未提交加密结果'}</strong>
                    <dl>
                      <div>
                        <dt>本队解密</dt>
                        <dd>{entry?.own_guess ?? '待提交'}</dd>
                      </div>
                      <div>
                        <dt>对手拦截</dt>
                        <dd>{entry?.intercept_guess ?? '待提交'}</dd>
                      </div>
                      <div>
                        <dt>公开答案</dt>
                        <dd>{entry?.revealed_code ?? '本轮未公开'}</dd>
                      </div>
                    </dl>
                  </div>
                );
              })}
            </div>

            <h3>历史记录</h3>
            <div className="history-list">
              {snapshot.submissions.map((entry) => (
                <div className="history-row" key={entry.id}>
                  <span>
                    R{entry.round_number} · {teamName(entry.team)}
                  </span>
                  <strong>{entry.clues?.join(' / ') ?? '未加密'}</strong>
                  <span>{entry.revealed_code ?? '未公开'}</span>
                </div>
              ))}
            </div>

            {snapshot.room.phase === 'result' && self.is_host ? (
              <button className="primary-button wide-button" disabled={busyKey !== null} onClick={() => void handleAdvanceRound()} type="button">
                下一回合
              </button>
            ) : null}
            {snapshot.room.phase === 'finished' ? (
              <div className="winner-banner">
                <strong>{snapshot.room.winner ? `${teamName(snapshot.room.winner)} 获胜` : '平局'}</strong>
                {self.is_host ? (
                  <button className="primary-button wide-button" disabled={busyKey !== null} onClick={() => void handleRestartRoom()} type="button">
                    重新开始
                  </button>
                ) : null}
              </div>
            ) : null}
          </article>
        </section>
      )}
    </main>
  );
}

export default App;
