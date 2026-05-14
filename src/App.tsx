import { useEffect, useMemo, useRef, useState } from 'react';
import {
  advanceRound,
  cleanupExpiredRooms,
  confirmTeamWords,
  createRoom,
  disbandRoom,
  fetchRoomSnapshot,
  generateTeamWords,
  joinRoom,
  leaveRoom,
  restartRoom,
  saveTeamWords,
  startGame,
  submitClues,
  submitInterceptGuess,
  submitOwnGuess,
  subscribeToRoom,
  terminateGame,
  updateSelfSeat,
} from './lib/game';
import { ensureSession, isSupabaseConfigured, supabase } from './lib/supabase';
import { cn, isEncryptPhase, isSeatTaken, normalizeGuess, otherTeam, phaseLabel, roleName, roleOrder, teamName, teamOrder } from './lib/utils';
import type { PlayerRecord, Role, RoomSnapshot, RoundSubmissionRecord, Team } from './types';

interface SeatCardProps {
  title: string;
  occupant?: PlayerRecord;
  active?: boolean;
  onClick?: () => void;
}

interface TeamScore {
  intercepts: number;
  miscomms: number;
  net: number;
}

interface ScoreTrackProps {
  count: number;
  kind: 'intercept' | 'miscomm';
  tone: 'red' | 'blue';
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

function scoreFor(snapshot: RoomSnapshot, team: Team): TeamScore {
  const intercepts = team === 'A' ? snapshot.room.score_team_a_intercepts : snapshot.room.score_team_b_intercepts;
  const miscomms = team === 'A' ? snapshot.room.score_team_a_miscomms : snapshot.room.score_team_b_miscomms;
  return { intercepts, miscomms, net: intercepts - miscomms };
}

function ScoreTrack({ count, kind, tone }: ScoreTrackProps) {
  const filledCount = Math.min(Math.max(count, 0), 2);
  const label = kind === 'intercept' ? `拦截 ${filledCount}/2` : `失误 ${filledCount}/2`;
  const text = kind === 'intercept' ? '拦截' : '失误';

  return (
    <div className={cn('score-track', `score-track-${kind}`, filledCount >= 2 && 'score-track-full')} aria-label={label}>
      <span className="score-track-label" aria-hidden="true">
        {text}
      </span>

      <span className="score-track-cells" aria-hidden="true">
        {Array.from({ length: 2 }, (_, index) => (
          <span
            className={cn(
              'score-track-cell',
              `score-track-cell-${tone}`,
              index < filledCount && 'score-track-cell-filled',
            )}
            key={`${kind}-${index}`}
          />
        ))}
      </span>
    </div>
  );
}

function displayTeamName(team: Team): string {
  return team === 'A' ? '红队' : '蓝队';
}

function teamTone(team: Team): 'red' | 'blue' {
  return team === 'A' ? 'red' : 'blue';
}

function formatGuessResult(guess: string | null, correct: boolean | null): string {
  if (!guess) {
    return '待提交';
  }

  if (correct === null) {
    return `${guess} (-)`;
  }

  return `${guess} (${correct ? '✓' : '×'})`;
}

function resultClass(correct: boolean | null): string {
  if (correct === true) {
    return 'result-good';
  }

  if (correct === false) {
    return 'result-bad';
  }

  return 'result-pending';
}

function guessDigits(value: string): string[] {
  const digits = normalizeGuess(value).split('-').filter(Boolean);
  return [digits[0] ?? '', digits[1] ?? '', digits[2] ?? ''];
}

function emptyWordForm(): string[] {
  return ['', '', '', ''];
}

function serializeWords(words: string[]): string {
  return words.join('\u0001');
}

function getTeamWords(snapshot: RoomSnapshot, team: Team): string[] {
  return snapshot.teamWords.find((entry) => entry.team === team)?.words ?? [];
}

function getTeamSubmissions(snapshot: RoomSnapshot, team: Team): RoundSubmissionRecord[] {
  return snapshot.submissions
    .filter((entry) => entry.team === team)
    .slice()
    .sort((a, b) => a.round_number - b.round_number);
}

function buildClueMatrixRows(
  submissions: RoundSubmissionRecord[],
  options: { showGuessNumbers?: boolean } = {},
): Array<{ id: string; roundNumber: number; cells: string[] }> {
  return submissions
    .filter((entry) => entry.clues?.length === 3 && entry.revealed_code)
    .map((entry) => {
      const cells = ['', '', '', ''];
      const codeDigits = entry.revealed_code!.split('-');
      const ownGuessDigits = entry.own_guess?.split('-') ?? [];

      entry.clues!.forEach((clue, clueIndex) => {
        const columnIndex = Number(codeDigits[clueIndex]) - 1;
        if (columnIndex < 0 || columnIndex > 3) {
          return;
        }

        const guessedDigit = ownGuessDigits[clueIndex];
        const actualDigit = codeDigits[clueIndex];
        const shouldShowGuessNumber =
          options.showGuessNumbers && Boolean(guessedDigit) && guessedDigit !== actualDigit;
        const suffix = shouldShowGuessNumber ? `（${guessedDigit}）` : '';
        cells[columnIndex] = `${clue}${suffix}`;
      });

      return {
        id: entry.id,
        roundNumber: entry.round_number,
        cells,
      };
    });
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
  const [teamWordForm, setTeamWordForm] = useState<string[]>(() => emptyWordForm());
  const [teamWordSavedKey, setTeamWordSavedKey] = useState('');
  const [decodeGuess, setDecodeGuess] = useState('');
  const [interceptGuess, setInterceptGuess] = useState('');
  const canEditWordsRef = useRef(false);

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

    void boot();

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

  const myTeam = self?.team ?? 'A';
  const opponentTeam = otherTeam(myTeam);
  const myTeamSubmission = self?.team ? currentRoundSubmissionByTeam[self.team] : undefined;
  const opponentSubmission = self?.team ? currentRoundSubmissionByTeam[otherTeam(self.team)] : undefined;
  const myVisibleCode = self?.team ? currentRoundCodeByTeam[self.team]?.code ?? null : null;
  const myTeamWordRecord = snapshot?.teamWords.find((entry) => entry.team === myTeam);
  const myScore = snapshot ? scoreFor(snapshot, myTeam) : { intercepts: 0, miscomms: 0, net: 0 };
  const opponentScore = snapshot ? scoreFor(snapshot, opponentTeam) : { intercepts: 0, miscomms: 0, net: 0 };
  const myTeamWords = snapshot ? getTeamWords(snapshot, myTeam) : [];
  const myTeamConfirmed = snapshot
    ? myTeam === 'A'
      ? snapshot.room.team_a_words_confirmed
      : snapshot.room.team_b_words_confirmed
    : false;
  const mySubmissions = snapshot ? getTeamSubmissions(snapshot, myTeam) : [];
  const opponentSubmissions = snapshot ? getTeamSubmissions(snapshot, opponentTeam) : [];
  const myClueRows = buildClueMatrixRows(mySubmissions);
  const opponentClueRows = buildClueMatrixRows(opponentSubmissions, { showGuessNumbers: true });
  const decodeDigits = guessDigits(decodeGuess);
  const interceptDigits = guessDigits(interceptGuess);
  const isWordAssignmentPhase = snapshot?.room.phase === 'word_assignment';
  const isCurrentEncryptPhase = isEncryptPhase(snapshot?.room.phase ?? 'lobby');
  const isDecodePhase = snapshot?.room.phase === 'decode';
  const isInterceptPhase = snapshot?.room.phase === 'intercept';
  const canLeaveCurrentRoom = snapshot ? snapshot.room.status === 'lobby' || snapshot.room.status === 'finished' : false;
  const canTerminateCurrentGame = snapshot ? self?.is_host === true && snapshot.room.status === 'active' : false;
  const allSeatsFilled = snapshot
    ? teamOrder.every((team) =>
        roleOrder.every((role) => snapshot.players.some((player) => player.team === team && player.role === role)),
      )
    : false;
  const wordAssignmentCount = snapshot
    ? Number(snapshot.room.team_a_words_confirmed) + Number(snapshot.room.team_b_words_confirmed)
    : 0;
  const clueSubmitCount = currentRoundSubmissions.filter((entry) => entry.clues?.length === 3).length;
  const decodeSubmitCount = currentRoundSubmissions.filter((entry) => entry.own_guess).length;
  const interceptSubmitCount = currentRoundSubmissions.filter((entry) => entry.intercept_guess).length;
  const teamWordFormKey = serializeWords(teamWordForm);
  const teamWordServerWords = myTeamWordRecord?.words ?? emptyWordForm();
  const teamWordServerKey = serializeWords(teamWordServerWords);
  const canEditWordAssignment = Boolean(
    isWordAssignmentPhase && self?.team && self.role === 'encoder' && myTeamWordRecord && !myTeamWordRecord.confirmed,
  );
  const canSubmitClues = isCurrentEncryptPhase && self?.role === 'encoder' && !myTeamSubmission?.clues;
  const canSubmitDecode = isDecodePhase && self?.role === 'decoder' && !myTeamSubmission?.own_guess;
  const canSubmitIntercept = isInterceptPhase && self?.role === 'encoder' && !opponentSubmission?.intercept_guess;
  const displayedDecodeDigits = myTeamSubmission?.own_guess ? guessDigits(myTeamSubmission.own_guess) : decodeDigits;
  const displayedInterceptDigits = opponentSubmission?.intercept_guess ? guessDigits(opponentSubmission.intercept_guess) : interceptDigits;
  const encryptCodeDigits = myVisibleCode?.split('-') ?? [];
  const encryptRows = [0, 1, 2].map((index) => {
    const digit = encryptCodeDigits[index] ?? '';
    const wordIndex = Number(digit) - 1;

    return {
      digit,
      word: wordIndex >= 0 ? myTeamWords[wordIndex] ?? '等待发牌' : '等待发牌',
    };
  });
  const displayedOwnWords = isWordAssignmentPhase && canEditWordAssignment ? teamWordForm : myTeamWords;
  const actionTitle = isWordAssignmentPhase
    ? canEditWordAssignment
      ? '设置本队词语'
      : myTeamConfirmed
        ? '本队词语已确认'
        : '等待加密者分配词语'
    : canSubmitClues
      ? '填写本轮线索'
      : canSubmitDecode
        ? '解出我方密码'
        : canSubmitIntercept
          ? '截获对方密码'
          : isDecodePhase
            ? '讨论我方解密'
            : isInterceptPhase
              ? '讨论对方拦截'
              : snapshot?.room.phase === 'result'
                ? '查看本轮结果'
                : snapshot?.room.phase === 'finished'
                  ? '游戏已结束'
                  : '等待其他玩家';
  const actionMeta = self?.team ? `${displayTeamName(myTeam)} · ${self.role ? roleName(self.role) : '未入座'}` : '未入座';
  const progressText =
    snapshot?.room.phase === 'word_assignment'
      ? `词语确认 ${wordAssignmentCount}/2`
      : snapshot?.room.phase === 'encrypt'
        ? `加密进度 ${clueSubmitCount}/2`
        : snapshot?.room.phase === 'decode'
          ? `解密进度 ${decodeSubmitCount}/2`
          : snapshot?.room.phase === 'intercept'
            ? `拦截进度 ${interceptSubmitCount}/2`
            : snapshot?.room.phase === 'result'
              ? '本轮已经结算'
              : snapshot?.room.phase === 'finished'
                ? '可以重新开始或解散房间'
                : '等待房间同步';

  useEffect(() => {
    canEditWordsRef.current = canEditWordAssignment;
  }, [canEditWordAssignment]);

  useEffect(() => {
    if (!isWordAssignmentPhase) {
      setTeamWordForm(emptyWordForm());
      setTeamWordSavedKey('');
      return;
    }

    if (self?.role !== 'encoder' || !self.team || !myTeamWordRecord) {
      return;
    }

    if (!myTeamWordRecord.confirmed && teamWordFormKey !== teamWordSavedKey) {
      return;
    }

    if (teamWordFormKey !== teamWordServerKey) {
      setTeamWordForm([...teamWordServerWords]);
    }

    if (teamWordSavedKey !== teamWordServerKey) {
      setTeamWordSavedKey(teamWordServerKey);
    }
  }, [
    isWordAssignmentPhase,
    myTeamWordRecord,
    self?.role,
    self?.team,
    teamWordFormKey,
    teamWordSavedKey,
    teamWordServerKey,
    teamWordServerWords,
  ]);

  useEffect(() => {
    if (!snapshot || !self?.team || !canEditWordAssignment) {
      return;
    }

    if (teamWordFormKey === teamWordSavedKey) {
      return;
    }

    const timer = window.setTimeout(() => {
      const nextWords = [...teamWordForm];

      void saveTeamWords(snapshot.room.id, self.team!, nextWords)
        .then(() => {
          setTeamWordSavedKey(serializeWords(nextWords));
        })
        .catch((error) => {
          if (canEditWordsRef.current) {
            setActionError(getErrorMessage(error, '保存词语草稿失败'));
          }
        });
    }, 450);

    return () => {
      window.clearTimeout(timer);
    };
  }, [canEditWordAssignment, self?.team, snapshot, teamWordForm, teamWordFormKey, teamWordSavedKey]);

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
    setTeamWordForm(emptyWordForm());
    setTeamWordSavedKey('');
    setDecodeGuess('');
    setInterceptGuess('');
    setActionError(message ?? null);
    window.history.replaceState({}, '', window.location.pathname);
  }

  function updateGuessDigit(kind: 'decode' | 'intercept', index: number, digit: string) {
    const current = kind === 'decode' ? decodeDigits : interceptDigits;
    const next = current.map((item, itemIndex) => (itemIndex === index ? digit : item));
    const nextValue = next.every(Boolean) ? next.join('-') : next.filter(Boolean).join('-');

    if (kind === 'decode') {
      setDecodeGuess(nextValue);
    } else {
      setInterceptGuess(nextValue);
    }
  }

  function updateTeamWord(index: number, value: string) {
    setTeamWordForm((current) => current.map((item, itemIndex) => (itemIndex === index ? value : item)));
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

  async function handleStandUp() {
    if (!snapshot || !self?.team || !self.role) {
      return;
    }

    await withAction('seat-clear', () => updateSelfSeat(snapshot.room.id, null, null));
  }

  async function handleStartGame() {
    if (!snapshot) {
      return;
    }

    const result = await withAction('start-game', () => startGame(snapshot.room.id));
    if (result === null) {
      return;
    }

    setClueForm(['', '', '']);
    setTeamWordForm(emptyWordForm());
    setTeamWordSavedKey('');
    setDecodeGuess('');
    setInterceptGuess('');
  }

  async function handleGenerateWords() {
    if (!snapshot || !self?.team) {
      return;
    }

    const result = await withAction('generate-team-words', () => generateTeamWords(snapshot.room.id, self.team!));
    if (!result || result.length !== 4) {
      return;
    }

    setTeamWordForm(result);
    setTeamWordSavedKey(serializeWords(result));
  }

  async function handleConfirmWords() {
    if (!snapshot || !self?.team) {
      return;
    }

    const normalizedWords = teamWordForm.map((word) => word.trim());
    if (normalizedWords.some((word) => !word)) {
      setActionError('需要填写 4 个词语。');
      return;
    }

    const uniqueWords = new Set(normalizedWords);
    if (uniqueWords.size !== normalizedWords.length) {
      setActionError('同队词语不能重复。');
      return;
    }

    const result = await withAction('confirm-team-words', () => confirmTeamWords(snapshot.room.id, self.team!, normalizedWords));
    if (result === null) {
      return;
    }

    setTeamWordForm(normalizedWords);
    setTeamWordSavedKey(serializeWords(normalizedWords));
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
      setTeamWordForm(emptyWordForm());
      setTeamWordSavedKey('');
      setDecodeGuess('');
      setInterceptGuess('');
    }
  }

  async function handleTerminateGame() {
    if (!snapshot || !self?.is_host || snapshot.room.status !== 'active') {
      return;
    }

    const confirmed = window.confirm('确定要终止当前游戏吗？所有玩家将返回选座大厅。');
    if (!confirmed) {
      return;
    }

    const result = await withAction('terminate-game', () => terminateGame(snapshot.room.id));
    if (result !== null) {
      setClueForm(['', '', '']);
      setTeamWordForm(emptyWordForm());
      setTeamWordSavedKey('');
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
            <h1>四人联机密码对抗</h1>
            <p className="muted">2v2 分队，一人加密，一人解码。每轮依次进行加密、解密、拦截，再统一结算。</p>
          </div>

          <div className="form-grid">
            <label>
              <span>你的昵称</span>
              <input
                maxLength={18}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="例如：阿澄"
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

  const myWordPlaceholder = isWordAssignmentPhase && self.role === 'decoder' && !myTeamConfirmed ? '待确认' : '等待发牌';

  return (
    <main className="app-shell">
      <section className="top-bar">
        <div className="brand-block">
          <div className="logo-mark" aria-hidden="true">
            <span />
          </div>
          <div>
            <p className="app-title">动漫高手——截码战</p>
            <p className="app-subtitle">房间号 {snapshot.room.room_code}</p>
          </div>
        </div>

        <div className="status-pills">
          <span className="status-pill status-pill-round">第 {snapshot.room.round_number || 0} 轮</span>
          <span className="status-pill status-pill-phase">{phaseLabel(snapshot.room.phase)}</span>
        </div>

        <div className="top-actions">
          <article className={cn('team-score', `team-score-${teamTone(myTeam)}`)}>
            <div className="team-score-display">
              <strong>{displayTeamName(myTeam)}</strong>
              <div className="team-score-tracks">
                <ScoreTrack count={myScore.intercepts} kind="intercept" tone={teamTone(myTeam)} />
                <ScoreTrack count={myScore.miscomms} kind="miscomm" tone={teamTone(myTeam)} />
              </div>
            </div>
            <div>
              <strong>{displayTeamName(myTeam)}</strong>
              <small>
                拦截 {myScore.intercepts} · 失误 {myScore.miscomms}
              </small>
            </div>
            <b>{myScore.net}</b>
          </article>

          <article className={cn('team-score', `team-score-${teamTone(opponentTeam)}`)}>
            <div className="team-score-display">
              <strong>{displayTeamName(opponentTeam)}</strong>
              <div className="team-score-tracks">
                <ScoreTrack count={opponentScore.intercepts} kind="intercept" tone={teamTone(opponentTeam)} />
                <ScoreTrack count={opponentScore.miscomms} kind="miscomm" tone={teamTone(opponentTeam)} />
              </div>
            </div>
            <div>
              <strong>{displayTeamName(opponentTeam)}</strong>
              <small>
                拦截 {opponentScore.intercepts} · 失误 {opponentScore.miscomms}
              </small>
            </div>
            <b>{opponentScore.net}</b>
          </article>

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
            <h2>座位选择</h2>
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

            {self.team && self.role ? (
              <div className="seat-action-row">
                <button className="ghost-button" disabled={busyKey !== null} onClick={() => void handleStandUp()} type="button">
                  站起
                </button>
              </div>
            ) : null}

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
        <>
          <section className="action-panel">
            <div className="action-header">
              <div>
                <p className="section-label">当前操作</p>
                <h2>{actionTitle}</h2>
                <span>{actionMeta}</span>
              </div>

              {canEditWordAssignment ? (
                <button className="primary-button" disabled={busyKey !== null} onClick={() => void handleConfirmWords()} type="button">
                  确认词语
                </button>
              ) : canSubmitClues ? (
                <button className="primary-button" disabled={busyKey !== null} onClick={() => void handleClueSubmit()} type="button">
                  提交线索
                </button>
              ) : canSubmitDecode ? (
                <button className="primary-button" disabled={busyKey !== null} onClick={() => void handleDecodeSubmit()} type="button">
                  提交解码
                </button>
              ) : canSubmitIntercept ? (
                <button className="primary-button" disabled={busyKey !== null} onClick={() => void handleInterceptSubmit()} type="button">
                  提交截码
                </button>
              ) : snapshot.room.phase === 'result' && self.is_host ? (
                <button className="primary-button" disabled={busyKey !== null} onClick={() => void handleAdvanceRound()} type="button">
                  下一回合
                </button>
              ) : snapshot.room.phase === 'finished' && self.is_host ? (
                <button className="primary-button" disabled={busyKey !== null} onClick={() => void handleRestartRoom()} type="button">
                  重新开始
                </button>
              ) : (
                <button className="primary-button" disabled type="button">
                  等待中
                </button>
              )}
            </div>

            <div className="action-body">
              <div className="action-body-main">
                {canEditWordAssignment ? (
                  <div className="action-lines">
                    <div className="action-line-head">
                      <span>本队词位</span>
                      <span>填写词语</span>
                    </div>

                    {teamWordForm.map((word, index) => (
                      <label className="action-line" key={`team-word-${index}`}>
                        <span className={cn('code-word', `code-word-${teamTone(myTeam)}`)}>
                          <b>{index + 1}</b>
                          <span>{word.trim() || `词语 ${index + 1}`}</span>
                        </span>
                        <input
                          maxLength={24}
                          onChange={(event) => updateTeamWord(index, event.target.value)}
                          placeholder={`填写第 ${index + 1} 个词语`}
                          value={word}
                        />
                      </label>
                    ))}

                    <div className="assignment-toolbar">
                      <button
                        className="ghost-button"
                        disabled={busyKey !== null}
                        onClick={() => void handleGenerateWords()}
                        type="button"
                      >
                        随机生成
                      </button>
                      <span className="muted">随机后仍可继续修改，双方确认后自动进入第一轮加密。</span>
                    </div>
                  </div>
                ) : isWordAssignmentPhase ? (
                  <div className="wait-card">
                    <strong>{progressText}</strong>
                    <p className="muted">
                      {myTeamConfirmed ? '本队词语已锁定，等待另一队确认。' : '等待本队加密者完成词语分配。'}
                    </p>
                  </div>
                ) : isDecodePhase && (myTeamSubmission?.clues?.length ?? 0) > 0 ? (
                  <div className="action-lines">
                    <div className="action-line-head">
                      <span>本轮线索</span>
                      <span>选择解码</span>
                    </div>
                    {(myTeamSubmission?.clues ?? []).map((clue, index) => (
                      <label className="action-line" key={`${clue}-${index}`}>
                        <span className={cn('line-clue', `line-clue-${teamTone(myTeam)}`)}>{clue}</span>
                        <select
                          disabled={!canSubmitDecode}
                          onChange={(event) => updateGuessDigit('decode', index, event.target.value)}
                          value={displayedDecodeDigits[index] ?? ''}
                        >
                          <option value="">-</option>
                          {[1, 2, 3, 4].map((option) => (
                            <option key={option} value={String(option)}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                ) : isInterceptPhase && (opponentSubmission?.clues?.length ?? 0) > 0 ? (
                  <div className="action-lines">
                    <div className="action-line-head">
                      <span>对方线索</span>
                      <span>选择截码</span>
                    </div>
                    {(opponentSubmission?.clues ?? []).map((clue, index) => (
                      <label className="action-line" key={`${clue}-${index}`}>
                        <span className={cn('line-clue', `line-clue-${teamTone(opponentTeam)}`)}>{clue}</span>
                        <select
                          disabled={!canSubmitIntercept}
                          onChange={(event) => updateGuessDigit('intercept', index, event.target.value)}
                          value={displayedInterceptDigits[index] ?? ''}
                        >
                          <option value="">-</option>
                          {[1, 2, 3, 4].map((option) => (
                            <option key={option} value={String(option)}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                ) : canSubmitClues ? (
                  <div className="action-lines">
                    {encryptRows.map((row, index) => (
                      <label className="action-line" key={index}>
                        <span className={cn('code-word', `code-word-${teamTone(myTeam)}`)}>
                          <b>{row.digit || '-'}</b>
                          <span>{row.word}</span>
                        </span>
                        <input
                          maxLength={24}
                          onChange={(event) =>
                            setClueForm((current) =>
                              current.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)),
                            )
                          }
                          placeholder={`线索 ${index + 1}`}
                          value={clueForm[index]}
                        />
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="wait-card">
                    <strong>{progressText}</strong>
                  </div>
                )}
              </div>

              <aside className="action-progress">
                <span>进度</span>
                <strong>{progressText}</strong>
              </aside>
            </div>
          </section>

          <section className="main-info-grid">
            <article className={cn('info-panel', `info-panel-${teamTone(myTeam)}`)}>
              <header className="info-header">
                <div>
                  <h2>我方信息区</h2>
                  {isWordAssignmentPhase ? (
                    <small className="header-note">
                      {myTeamConfirmed
                        ? '本队词语已确认'
                        : self.role === 'encoder'
                          ? '由你负责设置本队词语'
                          : '待本队加密者确认词语'}
                    </small>
                  ) : null}
                </div>
                <span className={cn('team-badge', `team-badge-${teamTone(myTeam)}`)}>{displayTeamName(myTeam)}</span>
                <div className="mini-stats">
                  <span>
                    拦截 <strong>{myScore.intercepts}</strong>
                  </span>
                  <span>
                    失误 <strong>{myScore.miscomms}</strong>
                  </span>
                </div>
              </header>

              <div className="clue-matrix">
                <div className="matrix-row matrix-head">
                  {[0, 1, 2, 3].map((index) => (
                    <div key={index}>
                      {index + 1} {displayedOwnWords[index]?.trim() || myWordPlaceholder}
                    </div>
                  ))}
                </div>
                {myClueRows.length > 0 ? (
                  myClueRows.map((row) => (
                    <div className="matrix-row" key={row.id}>
                      {row.cells.map((cell, index) => (
                        <div key={index}>{cell}</div>
                      ))}
                    </div>
                  ))
                ) : (
                  <div className="matrix-empty">
                      {isWordAssignmentPhase
                      ? myTeamConfirmed || canEditWordAssignment
                        ? '词语确认后，将从这里开始积累我方线索记录'
                        : '待本队加密者确认词语'
                      : '结算后会按轮次对齐显示我方线索'}
                  </div>
                )}
              </div>

              <section className="record-block" id="round-records">
                <h3>我方轮次记录</h3>
                <div className="record-table">
                  <div className="record-row record-head">
                    <span>轮次</span>
                    <span>线索</span>
                    <span>正确密码</span>
                    <span>我方解密</span>
                    <span>对方拦截</span>
                  </div>
                  {mySubmissions.map((entry) => (
                    <div className="record-row" key={entry.id}>
                      <span>第 {entry.round_number} 轮</span>
                      <span>{entry.clues?.join(' / ') ?? '待提交'}</span>
                      <span>{entry.revealed_code ?? '未公开'}</span>
                      <span className={resultClass(entry.own_correct)}>{formatGuessResult(entry.own_guess, entry.own_correct)}</span>
                      <span className={resultClass(entry.intercept_correct)}>{formatGuessResult(entry.intercept_guess, entry.intercept_correct)}</span>
                    </div>
                  ))}
                </div>
              </section>
            </article>

            <article className={cn('info-panel', `info-panel-${teamTone(opponentTeam)}`)}>
              <header className="info-header">
                <div>
                  <h2>对方信息区</h2>
                </div>
                <span className={cn('team-badge', `team-badge-${teamTone(opponentTeam)}`)}>{displayTeamName(opponentTeam)}</span>
                <div className="mini-stats">
                  <span>
                    拦截 <strong>{opponentScore.intercepts}</strong>
                  </span>
                  <span>
                    失误 <strong>{opponentScore.miscomms}</strong>
                  </span>
                </div>
              </header>

              <div className="clue-matrix">
                <div className="matrix-row matrix-head">
                  {[1, 2, 3, 4].map((number) => (
                    <div key={number}>{number} ??</div>
                  ))}
                </div>
                {opponentClueRows.length > 0 ? (
                  opponentClueRows.map((row) => (
                    <div className="matrix-row" key={row.id}>
                      {row.cells.map((cell, index) => (
                        <div key={index}>{cell}</div>
                      ))}
                    </div>
                  ))
                ) : (
                  <div className="matrix-empty">
                    {isWordAssignmentPhase ? '词语分配完成后，结算区会按轮次显示对方线索' : '结算后会按轮次对齐显示对方线索'}
                  </div>
                )}
              </div>
              <p className="muted">括号表示对方猜测的数字，只有猜错时才显示。</p>

              <section className="record-block">
                <h3>对方轮次记录</h3>
                <div className="record-table">
                  <div className="record-row record-head">
                    <span>轮次</span>
                    <span>线索</span>
                    <span>正确密码</span>
                    <span>对方解密</span>
                    <span>我方拦截</span>
                  </div>
                  {opponentSubmissions.map((entry) => (
                    <div className="record-row" key={entry.id}>
                      <span>第 {entry.round_number} 轮</span>
                      <span>{entry.clues?.join(' / ') ?? '待提交'}</span>
                      <span>{entry.revealed_code ?? '未公开'}</span>
                      <span className={resultClass(entry.own_correct)}>{formatGuessResult(entry.own_guess, entry.own_correct)}</span>
                      <span className={resultClass(entry.intercept_correct)}>{formatGuessResult(entry.intercept_guess, entry.intercept_correct)}</span>
                    </div>
                  ))}
                </div>
              </section>
            </article>
          </section>

          {snapshot.room.phase === 'finished' ? (
            <section className="winner-banner">
              <strong>{snapshot.room.winner ? `${displayTeamName(snapshot.room.winner)} 获胜` : '平局'}</strong>
            </section>
          ) : null}

          {canTerminateCurrentGame ? (
            <section className="game-footer-actions">
              <button className="danger-button" disabled={busyKey !== null} onClick={() => void handleTerminateGame()} type="button">
                终止游戏
              </button>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}

export default App;
