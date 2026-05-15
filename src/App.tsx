import { useEffect, useMemo, useState } from 'react';
import {
  advanceRound,
  cleanupExpiredRooms,
  confirmTeamWords,
  createRoom,
  disbandRoom,
  extractBangumiCharacters,
  fetchRoomSnapshot,
  generateTeamWords,
  joinRoom,
  kickPlayer,
  leaveRoom,
  loadBangumiCatalog,
  replaceTeamWordSlot,
  restartRoom,
  startGame,
  submitClues,
  submitInterceptGuess,
  skipFirstIntercept,
  submitOwnGuess,
  subscribeToRoom,
  terminateGame,
  updateRoomLobbySettings,
  updateSelfSeat,
} from './lib/game';
import { ensureSession, isSupabaseConfigured, supabase } from './lib/supabase';
import {
  cn,
  isEncryptPhase,
  isSeatTaken,
  lobbySeatOptions,
  normalizeGuess,
  otherTeam,
  phaseLabel,
  roleForSeat,
  roleName,
  teamCapacity,
  teamOrder,
} from './lib/utils';
import type { PlayerRecord, Role, RoomSnapshot, RoundSubmissionRecord, Team, TeamWordSlot, TeamWordsRecord } from './types';

interface SeatCardProps {
  team: Team;
  seatNumber: number;
  previewRole: Role;
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

interface RoleGroupProps {
  team: Team;
  players: PlayerRecord[];
  selfId?: string;
}

interface BangumiCatalogSummary {
  configured: boolean;
  userCount: number;
  wordCount: number;
}

type TeamWordDraftMode = 'manual' | 'generated' | 'characters';

type BangumiCollectionType = 1 | 2 | 3 | 4 | 5;

interface BangumiCollectionTypeOption {
  value: BangumiCollectionType;
  label: string;
}

const BANGUMI_COLLECTION_TYPE_OPTIONS: BangumiCollectionTypeOption[] = [
  { value: 1, label: '想看' },
  { value: 2, label: '看过' },
  { value: 3, label: '在看' },
  { value: 4, label: '搁置' },
  { value: 5, label: '抛弃' },
];

function SeatCard({ team, seatNumber, previewRole, occupant, active, onClick }: SeatCardProps) {
  return (
    <button
      className={cn('seat-card', `seat-card-${teamTone(team)}`, active && 'seat-card-active')}
      disabled={!onClick}
      onClick={onClick}
      type="button"
    >
      <div className="seat-card-head">
        <span className="seat-card-title">{seatNumber} 号位</span>
        <span className={cn('seat-role-pill', `seat-role-pill-${previewRole}`)}>{roleName(previewRole)}</span>
      </div>
      <strong>{occupant ? occupant.player_name : '空位'}</strong>
      <small>{occupant ? `当前座位 #${seatNumber}` : '点击入座'}</small>
    </button>
  );
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

function RoleGroup({ team, players, selfId }: RoleGroupProps) {
  const groups = [
    { role: 'encoder', players: players.filter((player) => player.role === 'encoder') },
    { role: 'decoder', players: players.filter((player) => player.role === 'decoder') },
    { role: 'member', players: players.filter((player) => player.role === 'member') },
  ] satisfies Array<{ role: Role; players: PlayerRecord[] }>;

  return (
    <article className={cn('role-strip-team', `role-strip-team-${teamTone(team)}`)}>
      <div className="role-strip-line">
        <strong className="role-strip-team-name">{displayTeamName(team)}</strong>
        <span className="role-strip-divider" aria-hidden="true">
          |
        </span>
        {groups.map((group) =>
          group.players.length > 0 ? (
            <div className="role-inline-group" key={group.role}>
              <span className="role-inline-label">{roleName(group.role)}：</span>
              <div className="role-inline-names">
                {group.players.map((player) => (
                  <span className={cn('role-chip', player.id === selfId && 'role-chip-self')} key={player.id}>
                    {player.player_name}
                  </span>
                ))}
              </div>
            </div>
          ) : null,
        )}
      </div>
    </article>
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

const ROOM_MEMBERSHIP_LOST_MESSAGE = '你已不在当前房间中，房间可能已结束或你已被房主移出';

function scoreFor(snapshot: RoomSnapshot, team: Team): TeamScore {
  const intercepts = team === 'A' ? snapshot.room.score_team_a_intercepts : snapshot.room.score_team_b_intercepts;
  const miscomms = team === 'A' ? snapshot.room.score_team_a_miscomms : snapshot.room.score_team_b_miscomms;
  return { intercepts, miscomms, net: intercepts - miscomms };
}

function displayTeamName(team: Team): string {
  return team === 'A' ? '红队' : '蓝队';
}

function teamTone(team: Team): 'red' | 'blue' {
  return team === 'A' ? 'red' : 'blue';
}

function formatGuessResult(guess: string | null, correct: boolean | null): string {
  if (!guess) {
    return correct === false ? '已跳过' : '待提交';
  }

  if (correct === null) {
    return `${guess} (-)`;
  }

  return `${guess} (${correct ? '✓' : '×'})`;
}

function resultClass(guess: string | null, correct: boolean | null): string {
  if (!guess && correct === false) {
    return 'result-skipped';
  }

  if (correct === true) {
    return 'result-good';
  }

  if (correct === false) {
    return 'result-bad';
  }

  return 'result-pending';
}

function guessDigits(value: string): string[] {
  const digits = value
    .split('-')
    .slice(0, 3)
    .map((digit) => (['1', '2', '3', '4'].includes(digit) ? digit : ''));

  return [digits[0] ?? '', digits[1] ?? '', digits[2] ?? ''];
}

function emptyWordForm(): string[] {
  return ['', '', '', ''];
}

function emptyTeamWordSlot(): TeamWordSlot {
  return {
    text: '',
    subjectId: null,
    sourceTitle: null,
    showSourceTitle: false,
    characterOptions: [],
  };
}

function emptyTeamWordSlots(): TeamWordSlot[] {
  return Array.from({ length: 4 }, () => emptyTeamWordSlot());
}

function normalizeTeamWordSlot(slot: Partial<TeamWordSlot> | null | undefined): TeamWordSlot {
  return {
    text: (slot?.text ?? '').trim(),
    subjectId: typeof slot?.subjectId === 'number' && Number.isFinite(slot.subjectId) ? slot.subjectId : null,
    sourceTitle: typeof slot?.sourceTitle === 'string' && slot.sourceTitle.trim() ? slot.sourceTitle.trim() : null,
    showSourceTitle:
      slot?.showSourceTitle === true && typeof slot?.sourceTitle === 'string' && slot.sourceTitle.trim().length > 0,
    characterOptions: Array.isArray(slot?.characterOptions)
      ? Array.from(new Set(slot.characterOptions.map((value) => value.trim()).filter((value) => value.length > 0)))
      : [],
  };
}

function teamWordSlotsToWords(slots: TeamWordSlot[]): string[] {
  return slots.map((slot) => slot.text.trim());
}

function teamWordSlotsFromRecord(record?: TeamWordsRecord | null): TeamWordSlot[] {
  if (record?.word_slots.length === 4) {
    return record.word_slots.map((slot) => normalizeTeamWordSlot(slot));
  }

  if (record?.words.length === 4) {
    return record.words.map((word) => ({
      text: word.trim(),
      subjectId: null,
      sourceTitle: null,
      showSourceTitle: false,
      characterOptions: [],
    }));
  }

  return emptyTeamWordSlots();
}

function clearTeamWordSlotAutomation(slots: TeamWordSlot[]): TeamWordSlot[] {
  return slots.map((slot) => ({
    text: slot.text.trim(),
    subjectId: null,
    sourceTitle: slot.showSourceTitle ? (slot.sourceTitle?.trim() || null) : null,
    showSourceTitle: slot.showSourceTitle && Boolean(slot.sourceTitle?.trim()),
    characterOptions: [],
  }));
}

function slotShowsSourceTitle(slot: TeamWordSlot): boolean {
  return slot.showSourceTitle && Boolean(slot.sourceTitle);
}

function renderTeamWordDisplay(slot: TeamWordSlot, fallback: string, prefix?: string) {
  if (slotShowsSourceTitle(slot)) {
    return (
      <div className="team-word-display team-word-display-dual">
        <span className="team-word-display-line" title={slot.sourceTitle ?? undefined}>
          {prefix ? `${prefix} ${slot.sourceTitle}` : slot.sourceTitle}
        </span>
        <span className="team-word-display-line" title={slot.text}>
          {slot.text || fallback}
        </span>
      </div>
    );
  }

  const value = slot.text || fallback;
  return (
    <span className="team-word-display-line" title={value}>
      {prefix ? `${prefix} ${value}` : value}
    </span>
  );
}

function renderOpponentWordDisplay(number: number, value: string, forceDual: boolean) {
  if (forceDual) {
    return (
      <div className="team-word-display team-word-display-dual">
        <span className="team-word-display-line" title={String(number)}>
          {number}
        </span>
        <span className="team-word-display-line" title={value}>
          {value}
        </span>
      </div>
    );
  }

  const text = `${number} ${value}`;
  return (
    <span className="team-word-display-line" title={text}>
      {text}
    </span>
  );
}

function inferTeamWordDraftMode(slots: TeamWordSlot[]): TeamWordDraftMode {
  if (slots.some((slot) => slot.characterOptions.length > 0)) {
    return 'characters';
  }

  if (slots.some((slot) => slot.subjectId !== null || Boolean(slot.sourceTitle))) {
    return 'generated';
  }

  return 'manual';
}

function serializeWords(words: string[]): string {
  return words.join('\u0001');
}

function emptyBangumiCatalogInputRow(): string[] {
  return [''];
}

function defaultBangumiCatalogTypes(): BangumiCollectionType[] {
  return [2];
}

function normalizeBangumiCatalogDraft(inputs: string[]): string[] {
  return inputs.map((value) => value.trim()).filter((value) => value.length > 0);
}

function isBangumiCatalogInputValid(value: string): boolean {
  if (/^\d+$/.test(value)) {
    return true;
  }

  try {
    const url = new URL(value);
    if (!['bangumi.tv', 'bgm.tv', 'chii.in'].includes(url.hostname)) {
      return false;
    }

    return /^\/anime\/list\/[^/]+(?:\/[^/]+)?\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

function getTeamWords(snapshot: RoomSnapshot, team: Team): string[] {
  return snapshot.teamWords.find((entry) => entry.team === team)?.words ?? [];
}

function getTeamPlayers(players: PlayerRecord[], team: Team): PlayerRecord[] {
  return players
    .filter((player) => player.team === team)
    .slice()
    .sort((left, right) => {
      const leftSeat = left.team_seat ?? Number.MAX_SAFE_INTEGER;
      const rightSeat = right.team_seat ?? Number.MAX_SAFE_INTEGER;

      if (leftSeat !== rightSeat) {
        return leftSeat - rightSeat;
      }

      return left.joined_at.localeCompare(right.joined_at);
    });
}

function getSortedRoster(players: PlayerRecord[]): PlayerRecord[] {
  return players.slice().sort((left, right) => {
    const leftTeam = left.team ?? 'Z';
    const rightTeam = right.team ?? 'Z';

    if (leftTeam !== rightTeam) {
      return leftTeam.localeCompare(rightTeam);
    }

    const leftSeat = left.team_seat ?? Number.MAX_SAFE_INTEGER;
    const rightSeat = right.team_seat ?? Number.MAX_SAFE_INTEGER;

    if (leftSeat !== rightSeat) {
      return leftSeat - rightSeat;
    }

    return left.joined_at.localeCompare(right.joined_at);
  });
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

function hasCoreSeats(players: PlayerRecord[], team: Team): boolean {
  return [1, 2].every((seat) => players.some((player) => player.team === team && player.team_seat === seat));
}

function teamLobbyStatus(players: PlayerRecord[], team: Team): string {
  const missingSeats = [1, 2].filter((seat) => !players.some((player) => player.team === team && player.team_seat === seat));

  if (missingSeats.length === 0) {
    return '已满足开局核心位';
  }

  return `缺少 ${missingSeats.join('、')} 号位`;
}

function isMissingRoomError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const record = error as Record<string, unknown>;
  return record.code === 'PGRST116';
}

function isRoomMembershipLostError(error: unknown): boolean {
  if (isMissingRoomError(error)) {
    return true;
  }

  if (!error || typeof error !== 'object') {
    return false;
  }

  const record = error as Record<string, unknown>;
  return [record.message, record.details, record.hint].some(
    (value) => typeof value === 'string' && value.includes('不在该房间中'),
  );
}

function App() {
  const [booting, setBooting] = useState(true);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [displayName, setDisplayName] = useState(() => localStorage.getItem('decrypto-name') ?? '');
  const [joinCode, setJoinCode] = useState(() => new URLSearchParams(window.location.search).get('room') ?? '');
  const [actionError, setActionError] = useState<string | null>(null);
  const [wordAssignmentNotice, setWordAssignmentNotice] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [clueForm, setClueForm] = useState(['', '', '']);
  const [teamWordSlotsDraft, setTeamWordSlotsDraft] = useState<TeamWordSlot[]>(() => emptyTeamWordSlots());
  const [teamWordDraftMode, setTeamWordDraftMode] = useState<TeamWordDraftMode>('manual');
  const [teamWordFormDirty, setTeamWordFormDirty] = useState(false);
  const [teamWordManualModePinned, setTeamWordManualModePinned] = useState(false);
  const [pendingConfirmedTeamWordSlots, setPendingConfirmedTeamWordSlots] = useState<TeamWordSlot[] | null>(null);
  const [decodeGuess, setDecodeGuess] = useState('');
  const [interceptGuess, setInterceptGuess] = useState('');
  const [kickSyncPollUntil, setKickSyncPollUntil] = useState<number | null>(null);
  const [bangumiCatalogModalOpen, setBangumiCatalogModalOpen] = useState(false);
  const [bangumiCatalogBrowserOpen, setBangumiCatalogBrowserOpen] = useState(false);
  const [bangumiCatalogInputsDraft, setBangumiCatalogInputsDraft] = useState<string[]>(() => emptyBangumiCatalogInputRow());
  const [bangumiCatalogTypesDraft, setBangumiCatalogTypesDraft] = useState<BangumiCollectionType[]>(() =>
    defaultBangumiCatalogTypes(),
  );

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

    const channel = subscribeToRoom(roomId, () => {
      void loadRoomSnapshot(roomId);
    });

    void loadRoomSnapshot(roomId);

    return () => {
      void channel.unsubscribe();
    };
  }, [roomId, sessionUserId]);

  async function loadRoomSnapshot(nextRoomId: string, options?: { silentError?: boolean }) {
    try {
      const nextSnapshot = await fetchRoomSnapshot(nextRoomId);
      if (sessionUserId && !nextSnapshot.players.some((player) => player.auth_user_id === sessionUserId)) {
        resetRoomState(ROOM_MEMBERSHIP_LOST_MESSAGE);
        return;
      }

      setSnapshot(nextSnapshot);
    } catch (error) {
      if (isRoomMembershipLostError(error)) {
        resetRoomState(ROOM_MEMBERSHIP_LOST_MESSAGE);
      } else if (!options?.silentError) {
        setActionError(getErrorMessage(error, '读取房间失败'));
      }
    }
  }

  useEffect(() => {
    if (!roomId || !kickSyncPollUntil) {
      return;
    }

    const remainingMs = kickSyncPollUntil - Date.now();
    if (remainingMs <= 0) {
      setKickSyncPollUntil(null);
      return;
    }

    const poller = window.setInterval(() => {
      if (Date.now() >= kickSyncPollUntil) {
        window.clearInterval(poller);
        setKickSyncPollUntil(null);
        return;
      }

      void loadRoomSnapshot(roomId, { silentError: true });
    }, 2500);

    const stopper = window.setTimeout(() => {
      setKickSyncPollUntil(null);
    }, remainingMs);

    return () => {
      window.clearInterval(poller);
      window.clearTimeout(stopper);
    };
  }, [kickSyncPollUntil, roomId, sessionUserId]);

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

  useEffect(() => {
    if (!snapshot || snapshot.room.phase !== 'lobby' || bangumiCatalogModalOpen) {
      return;
    }

    setBangumiCatalogInputsDraft(
      snapshot.room.bangumi_catalog_inputs.length > 0
        ? [...snapshot.room.bangumi_catalog_inputs]
        : emptyBangumiCatalogInputRow(),
    );
    setBangumiCatalogTypesDraft(
      snapshot.room.bangumi_catalog_types.length > 0
        ? (snapshot.room.bangumi_catalog_types.filter((value): value is BangumiCollectionType =>
            BANGUMI_COLLECTION_TYPE_OPTIONS.some((option) => option.value === value),
          ) as BangumiCollectionType[])
        : defaultBangumiCatalogTypes(),
    );
  }, [bangumiCatalogModalOpen, snapshot]);

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

  const rosterPlayers = useMemo(() => (snapshot ? getSortedRoster(snapshot.players) : []), [snapshot]);
  const teamAPlayers = useMemo(() => (snapshot ? getTeamPlayers(snapshot.players, 'A') : []), [snapshot]);
  const teamBPlayers = useMemo(() => (snapshot ? getTeamPlayers(snapshot.players, 'B') : []), [snapshot]);
  const bangumiCatalogWords = useMemo(
    () => (snapshot?.room.bangumi_catalog_words ?? []).slice().sort((left, right) => left.localeCompare(right, 'zh-CN')),
    [snapshot],
  );
  const bangumiCatalogSummary = useMemo<BangumiCatalogSummary>(
    () => ({
      configured: bangumiCatalogWords.length > 0,
      userCount: snapshot?.room.bangumi_catalog_inputs.length ?? 0,
      wordCount: bangumiCatalogWords.length,
    }),
    [bangumiCatalogWords, snapshot],
  );
  const isLoadingBangumiCatalog = busyKey === 'load-bangumi-catalog';

  const myTeam = self?.team ?? 'A';
  const opponentTeam = otherTeam(myTeam);
  const myTeamSubmission = self?.team ? currentRoundSubmissionByTeam[self.team] : undefined;
  const opponentSubmission = self?.team ? currentRoundSubmissionByTeam[otherTeam(self.team)] : undefined;
  const myVisibleCode = self?.team ? currentRoundCodeByTeam[self.team]?.code ?? null : null;
  const myTeamWordRecord = snapshot?.teamWords.find((entry) => entry.team === myTeam);
  const opponentTeamWords = snapshot ? getTeamWords(snapshot, opponentTeam) : [];
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
  const isLobbyPhase = snapshot?.room.phase === 'lobby';
  const isWordAssignmentPhase = snapshot?.room.phase === 'word_assignment';
  const isCurrentEncryptPhase = isEncryptPhase(snapshot?.room.phase ?? 'lobby');
  const isDecodePhase = snapshot?.room.phase === 'decode';
  const isInterceptPhase = snapshot?.room.phase === 'intercept';
  const isFinishedPhase = snapshot?.room.phase === 'finished';
  const isFirstRoundInterceptSkip = isInterceptPhase && snapshot?.room.round_number === 1;
  const canLeaveCurrentRoom = snapshot ? snapshot.room.status === 'lobby' || snapshot.room.status === 'finished' : false;
  const canTerminateCurrentGame = snapshot ? self?.is_host === true && snapshot.room.status === 'active' : false;
  const currentSeatCount = snapshot?.room.seat_count ?? 4;
  const perTeamCapacity = teamCapacity(currentSeatCount);
  const allPlayersSeated = snapshot
    ? snapshot.players.every((player) => Boolean(player.team) && player.team_seat !== null)
    : false;
  const coreSeatsReady = snapshot ? teamOrder.every((team) => hasCoreSeats(snapshot.players, team)) : false;
  const seatedPlayerCount = snapshot
    ? snapshot.players.filter((player) => Boolean(player.team) && player.team_seat !== null).length
    : 0;
  const startGameReady = snapshot
    ? allPlayersSeated && coreSeatsReady && (snapshot.room.seat_count > 4 || seatedPlayerCount === 4)
    : false;
  const wordAssignmentCount = snapshot
    ? Number(snapshot.room.team_a_words_confirmed) + Number(snapshot.room.team_b_words_confirmed)
    : 0;
  const clueSubmitCount = currentRoundSubmissions.filter((entry) => entry.clues?.length === 3).length;
  const decodeSubmitCount = currentRoundSubmissions.filter((entry) => entry.own_guess).length;
  const interceptSubmitCount = currentRoundSubmissions.filter((entry) => entry.intercept_guess).length;
  const teamWordServerSlots = teamWordSlotsFromRecord(myTeamWordRecord);
  const displayedMyTeamWordSlots =
    isWordAssignmentPhase && pendingConfirmedTeamWordSlots && !myTeamConfirmed
      ? pendingConfirmedTeamWordSlots
      : teamWordServerSlots;
  const hasCharacterDerivedWords = teamWordSlotsDraft.some((slot) => slot.characterOptions.length > 0);
  const canOmitSourceTitles = teamWordSlotsDraft.some((slot) => slotShowsSourceTitle(slot));
  const canRestoreSourceTitles =
    hasCharacterDerivedWords && teamWordSlotsDraft.some((slot) => !slot.showSourceTitle && Boolean(slot.sourceTitle));
  const canToggleSourceTitles = canOmitSourceTitles || canRestoreSourceTitles;
  const showsDualWordColumns = teamWordSlotsDraft.some((slot) => slotShowsSourceTitle(slot));
  const canEditWordAssignment = Boolean(
    isWordAssignmentPhase && self?.team && self.role === 'encoder' && myTeamWordRecord && !myTeamWordRecord.confirmed,
  );
  const canExtractTeamWordCharacters = teamWordDraftMode === 'generated';
  const shouldConfirmBeforeManualEdit = teamWordDraftMode === 'generated';
  const canReplaceGeneratedWords = teamWordDraftMode === 'generated';
  const canSubmitClues = isCurrentEncryptPhase && self?.role === 'encoder' && !myTeamSubmission?.clues;
  const canSubmitDecode = isDecodePhase && self?.role === 'decoder' && !myTeamSubmission?.own_guess;
  const canSubmitIntercept =
    isInterceptPhase && !isFirstRoundInterceptSkip && self?.role === 'encoder' && !opponentSubmission?.intercept_guess;
  const canSkipFirstIntercept = Boolean(isFirstRoundInterceptSkip && self?.is_host);
  const displayedDecodeDigits = myTeamSubmission?.own_guess ? guessDigits(myTeamSubmission.own_guess) : decodeDigits;
  const displayedInterceptDigits = opponentSubmission?.intercept_guess
    ? guessDigits(opponentSubmission.intercept_guess)
    : interceptDigits;
  const myTeamCluesSubmitted = Boolean(myTeamSubmission?.clues);
  const opponentCluesSubmitted = Boolean(opponentSubmission?.clues);
  const myTeamDecodeSubmitted = Boolean(myTeamSubmission?.own_guess);
  const opponentDecodeSubmitted = Boolean(opponentSubmission?.own_guess);
  const myTeamInterceptSubmitted = Boolean(opponentSubmission?.intercept_guess);
  const opponentInterceptSubmitted = Boolean(myTeamSubmission?.intercept_guess);
  const encryptCodeDigits = myVisibleCode?.split('-') ?? [];
  const encryptRows = [0, 1, 2].map((index) => {
    const digit = encryptCodeDigits[index] ?? '';
    const wordIndex = Number(digit) - 1;

    return {
      digit,
      word: wordIndex >= 0 ? myTeamWords[wordIndex] ?? '等待发牌' : '等待发牌',
    };
  });
  const actionTitle = isWordAssignmentPhase
    ? '设置本队词语'
    : snapshot?.room.phase === 'encrypt'
      ? '填写本轮线索'
      : isDecodePhase
        ? '讨论己方密码'
        : isInterceptPhase
          ? '讨论对方密码'
          : snapshot?.room.phase === 'result'
            ? '查看本轮结果'
            : snapshot?.room.phase === 'finished'
              ? '游戏已结束'
              : '等待其他玩家';
  const actionHint = isWordAssignmentPhase
    ? canEditWordAssignment
      ? '填好 4 个词语后确认'
      : myTeamConfirmed
        ? '本队已确认，等待另一队加密者确认词语'
        : '等待本队加密者确认词语'
    : canSubmitClues
      ? '按密码顺序填写 3 条线索'
      : snapshot?.room.phase === 'encrypt'
        ? myTeamCluesSubmitted
          ? opponentCluesSubmitted
            ? '双方线索已提交，等待进入解密阶段'
            : '本队线索已提交，等待另一队加密者提交线索'
          : '等待本队加密者提交线索'
      : canSubmitDecode
        ? '根据线索选择 3 位解码'
        : isDecodePhase
          ? myTeamDecodeSubmitted
            ? opponentDecodeSubmitted
              ? '双方解码已提交，等待进入截码阶段'
              : '本队解码已提交，等待另一队解码者提交'
            : '等待本队解码者提交'
          : canSubmitIntercept
            ? '根据对方线索进行拦截'
            : isInterceptPhase
              ? myTeamInterceptSubmitted
                ? opponentInterceptSubmitted
                  ? '双方截码已提交，等待公布结果'
                  : '本队截码已提交，等待另一队拦截者提交截码'
                : '等待本队拦截者提交截码'
              : snapshot?.room.phase === 'result'
                ? '查看本轮结算'
                : snapshot?.room.phase === 'finished'
                  ? '本局结束，可重新开始'
                  : '等待房间同步';
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
                ? '对局已结束'
                : '等待房间同步';
  const effectiveActionHint = isFirstRoundInterceptSkip
    ? canSkipFirstIntercept
      ? '第一轮拦截阶段无需提交，改由房主点击跳过'
      : '第一轮拦截阶段无需操作，等待房主跳过'
    : actionHint;
  const effectiveProgressText = isFirstRoundInterceptSkip ? '等待房主跳过第一轮拦截' : progressText;
  const lobbyStartHint = snapshot
    ? !allPlayersSeated
      ? '开始前，所有已加入房间的玩家都需要先入座'
      : !coreSeatsReady
        ? '开始前，两队的 1 号位和 2 号位都必须有人'
        : snapshot.room.seat_count === 4 && seatedPlayerCount !== 4
          ? '4 人房需要满员开局'
          : '已满足开局条件'
    : '';

  useEffect(() => {
    if (!isWordAssignmentPhase) {
      setTeamWordSlotsDraft(emptyTeamWordSlots());
      setTeamWordDraftMode('manual');
      setTeamWordFormDirty(false);
      setTeamWordManualModePinned(false);
      setPendingConfirmedTeamWordSlots(null);
      setWordAssignmentNotice(null);
      return;
    }

    if (self?.role !== 'encoder' || !self.team) {
      setTeamWordSlotsDraft(emptyTeamWordSlots());
      setTeamWordDraftMode('manual');
      setTeamWordFormDirty(false);
      setTeamWordManualModePinned(false);
      setPendingConfirmedTeamWordSlots(null);
      setWordAssignmentNotice(null);
      return;
    }
  }, [isWordAssignmentPhase, self?.role, self?.team]);

  useEffect(() => {
    if (!isWordAssignmentPhase || self?.role !== 'encoder' || !self.team || !myTeamWordRecord) {
      return;
    }

    if (teamWordManualModePinned && !myTeamWordRecord.confirmed) {
      return;
    }

    if (myTeamWordRecord.confirmed || !teamWordFormDirty) {
      setTeamWordSlotsDraft(teamWordServerSlots);
      setTeamWordDraftMode(inferTeamWordDraftMode(teamWordServerSlots));
      setTeamWordFormDirty(false);
      if (myTeamWordRecord.confirmed) {
        setPendingConfirmedTeamWordSlots(null);
      }
    }
  }, [
    isWordAssignmentPhase,
    myTeamWordRecord,
    self?.role,
    self?.team,
    teamWordFormDirty,
    teamWordManualModePinned,
    teamWordServerSlots,
  ]);

  async function withAction<T>(key: string, action: () => Promise<T>): Promise<T | null> {
    setActionError(null);
    setBusyKey(key);

    try {
      return await action();
    } catch (error) {
      if (isRoomMembershipLostError(error)) {
        resetRoomState(ROOM_MEMBERSHIP_LOST_MESSAGE);
      } else {
        setActionError(getErrorMessage(error, '操作失败'));
      }
      return null;
    } finally {
      setBusyKey(null);
    }
  }

  function resetRoomState(message?: string) {
    setRoomId(null);
    setSnapshot(null);
    setKickSyncPollUntil(null);
    setJoinCode('');
    setClueForm(['', '', '']);
    setTeamWordSlotsDraft(emptyTeamWordSlots());
    setTeamWordDraftMode('manual');
    setTeamWordFormDirty(false);
    setTeamWordManualModePinned(false);
    setPendingConfirmedTeamWordSlots(null);
    setWordAssignmentNotice(null);
    setDecodeGuess('');
    setInterceptGuess('');
    setBangumiCatalogModalOpen(false);
    setBangumiCatalogBrowserOpen(false);
    setBangumiCatalogInputsDraft(emptyBangumiCatalogInputRow());
    setBangumiCatalogTypesDraft(defaultBangumiCatalogTypes());
    setActionError(message ?? null);
    window.history.replaceState({}, '', window.location.pathname);
  }

  function updateGuessDigit(kind: 'decode' | 'intercept', index: number, digit: string) {
    const current = kind === 'decode' ? decodeDigits : interceptDigits;
    const next = current.map((item, itemIndex) => (itemIndex === index ? digit : item));
    const nextValue = next.join('-');

    if (kind === 'decode') {
      setDecodeGuess(nextValue);
    } else {
      setInterceptGuess(nextValue);
    }
  }

  function updateTeamWord(index: number, value: string) {
    setTeamWordFormDirty(true);
    setPendingConfirmedTeamWordSlots(null);
    setWordAssignmentNotice(null);
    setTeamWordSlotsDraft((current) =>
      current.map((slot, itemIndex) =>
        itemIndex === index
          ? {
              ...slot,
              text: value,
            }
          : slot,
      ),
    );
  }

  function updateTeamWordTitle(index: number, value: string) {
    setTeamWordFormDirty(true);
    setPendingConfirmedTeamWordSlots(null);
    setWordAssignmentNotice(null);
    setTeamWordSlotsDraft((current) =>
      current.map((slot, itemIndex) =>
        itemIndex === index
          ? {
              ...slot,
              sourceTitle: value,
              showSourceTitle: true,
            }
          : slot,
      ),
    );
  }

  function openBangumiCatalogModal() {
    if (!snapshot || !self?.is_host) {
      return;
    }

    setBangumiCatalogInputsDraft(
      snapshot.room.bangumi_catalog_inputs.length > 0
        ? [...snapshot.room.bangumi_catalog_inputs]
        : emptyBangumiCatalogInputRow(),
    );
    setBangumiCatalogTypesDraft(
      snapshot.room.bangumi_catalog_types.length > 0
        ? (snapshot.room.bangumi_catalog_types.filter((value): value is BangumiCollectionType =>
            BANGUMI_COLLECTION_TYPE_OPTIONS.some((option) => option.value === value),
          ) as BangumiCollectionType[])
        : defaultBangumiCatalogTypes(),
    );
    setBangumiCatalogModalOpen(true);
  }

  function closeBangumiCatalogModal() {
    setBangumiCatalogModalOpen(false);
  }

  function openBangumiCatalogBrowser() {
    if (!snapshot || snapshot.room.bangumi_catalog_words.length === 0) {
      return;
    }

    setBangumiCatalogBrowserOpen(true);
  }

  function closeBangumiCatalogBrowser() {
    setBangumiCatalogBrowserOpen(false);
  }

  function updateBangumiCatalogInput(index: number, value: string) {
    setBangumiCatalogInputsDraft((current) => current.map((item, itemIndex) => (itemIndex === index ? value : item)));
  }

  function addBangumiCatalogInput() {
    setBangumiCatalogInputsDraft((current) => [...current, '']);
  }

  function toggleBangumiCatalogType(value: BangumiCollectionType) {
    setBangumiCatalogTypesDraft((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value].sort((left, right) => left - right),
    );
  }

  function removeBangumiCatalogInput(index: number) {
    setBangumiCatalogInputsDraft((current) =>
      current.length <= 1 ? current.map(() => '') : current.filter((_, itemIndex) => itemIndex !== index),
    );
  }

  async function handleCreateRoom() {
    const name = displayName.trim();
    if (!name) {
      setActionError('先输入你的昵称');
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
      setActionError('加入房间前需要填写昵称和房间码');
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

  async function handleSeat(team: Team, teamSeat: number) {
    if (!snapshot) {
      return;
    }

    await withAction(`seat-${team}-${teamSeat}`, () => updateSelfSeat(snapshot.room.id, team, teamSeat));
  }

  async function handleStandUp() {
    if (!snapshot || !self?.team || self.team_seat === null) {
      return;
    }

    await withAction('seat-clear', () => updateSelfSeat(snapshot.room.id, null, null));
  }

  async function handleSeatCountChange(seatCount: number) {
    if (!snapshot || !self?.is_host || seatCount === snapshot.room.seat_count) {
      return;
    }

    await withAction('lobby-seat-count', () =>
      updateRoomLobbySettings(snapshot.room.id, seatCount, snapshot.room.role_rotation_enabled),
    );
  }

  async function handleRoleRotationToggle(enabled: boolean) {
    if (!snapshot || !self?.is_host || enabled === snapshot.room.role_rotation_enabled) {
      return;
    }

    await withAction('lobby-rotation', () =>
      updateRoomLobbySettings(snapshot.room.id, snapshot.room.seat_count, enabled),
    );
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
    setTeamWordSlotsDraft(emptyTeamWordSlots());
    setTeamWordDraftMode('manual');
    setTeamWordFormDirty(false);
    setTeamWordManualModePinned(false);
    setPendingConfirmedTeamWordSlots(null);
    setWordAssignmentNotice(null);
    setDecodeGuess('');
    setInterceptGuess('');
  }

  async function handleGenerateWords() {
    if (!snapshot || !self?.team) {
      return;
    }

    const team = self.team;
    const result = await withAction('generate-team-words', () => generateTeamWords(snapshot.room.id, team));
    if (!result || result.length !== 4) {
      return;
    }

    setTeamWordSlotsDraft(result.map((slot) => normalizeTeamWordSlot(slot)));
    setTeamWordDraftMode('generated');
    setTeamWordFormDirty(true);
    setTeamWordManualModePinned(false);
    setPendingConfirmedTeamWordSlots(null);
    setWordAssignmentNotice(null);
  }

  async function handleReplaceTeamWord(index: number) {
    if (!snapshot || !self?.team) {
      return;
    }

    const team = self.team;
    const result = await withAction('replace-team-word-slot', () => replaceTeamWordSlot(snapshot.room.id, team, index));
    if (!result || result.length !== 4) {
      return;
    }

    setTeamWordSlotsDraft(result.map((slot) => normalizeTeamWordSlot(slot)));
    setTeamWordDraftMode('generated');
    setTeamWordFormDirty(true);
    setTeamWordManualModePinned(false);
    setPendingConfirmedTeamWordSlots(null);
    setWordAssignmentNotice(null);
  }

  async function handleExtractCharacters() {
    if (!snapshot || !self?.team) {
      return;
    }

    const team = self.team;
    const result = await withAction('extract-bangumi-characters', () => extractBangumiCharacters(snapshot.room.id, team));
    if (!result || result.slots.length !== 4) {
      return;
    }

    setTeamWordSlotsDraft(result.slots.map((slot) => normalizeTeamWordSlot(slot)));
    setTeamWordDraftMode('characters');
    setTeamWordFormDirty(true);
    setTeamWordManualModePinned(false);
    setPendingConfirmedTeamWordSlots(null);
    setWordAssignmentNotice(
      result.failedTitles.length > 0 ? `${result.failedTitles.length} 个词未提取到角色，已保留原标题。` : null,
    );
  }

  function updateTeamWordCharacter(index: number, value: string) {
    setTeamWordFormDirty(true);
    setPendingConfirmedTeamWordSlots(null);
    setWordAssignmentNotice(null);
    setTeamWordSlotsDraft((current) =>
      current.map((slot, itemIndex) =>
        itemIndex === index
          ? {
              ...slot,
              text: value,
            }
          : slot,
      ),
    );
  }

  function handleToggleSourceTitles() {
    setTeamWordFormDirty(true);
    setPendingConfirmedTeamWordSlots(null);
    setWordAssignmentNotice(null);
    setTeamWordSlotsDraft((current) =>
      current.map((slot) => ({
        ...slot,
        showSourceTitle: canOmitSourceTitles ? false : Boolean(slot.sourceTitle),
      })),
    );
  }

  function handleManualEdit() {
    if (shouldConfirmBeforeManualEdit) {
      const confirmed = window.confirm('打开手动编辑后，将不能再自动提取角色名。是否继续？');
      if (!confirmed) {
        return;
      }
    }

    setTeamWordSlotsDraft((current) => clearTeamWordSlotAutomation(current));
    setTeamWordDraftMode('manual');
    setTeamWordFormDirty(true);
    setTeamWordManualModePinned(true);
    setPendingConfirmedTeamWordSlots(null);
    setWordAssignmentNotice(null);
  }

  async function handleLoadBangumiCatalog() {
    if (!snapshot || !self?.is_host) {
      return;
    }

    const normalizedInputs = normalizeBangumiCatalogDraft(bangumiCatalogInputsDraft);
    if (normalizedInputs.length === 0) {
      setActionError('至少填写 1 个 Bangumi 用户 ID 或收藏夹页面链接。');
      return;
    }

    const invalidValue = normalizedInputs.find((value) => !isBangumiCatalogInputValid(value));
    if (invalidValue) {
      setActionError('仅支持纯数字 ID，或 bangumi.tv / bgm.tv / chii.in 的收藏夹页面链接。');
      return;
    }

    if (bangumiCatalogTypesDraft.length === 0) {
      setActionError('至少勾选 1 个分类。');
      return;
    }

    const result = await withAction('load-bangumi-catalog', () =>
      loadBangumiCatalog(snapshot.room.id, normalizedInputs, bangumiCatalogTypesDraft),
    );
    if (result === null) {
      return;
    }

    setBangumiCatalogInputsDraft(result.inputs.length > 0 ? [...result.inputs] : emptyBangumiCatalogInputRow());
    setBangumiCatalogTypesDraft(
      result.collectionTypes.length > 0
        ? (result.collectionTypes.filter((value): value is BangumiCollectionType =>
            BANGUMI_COLLECTION_TYPE_OPTIONS.some((option) => option.value === value),
          ) as BangumiCollectionType[])
        : defaultBangumiCatalogTypes(),
    );
    setBangumiCatalogModalOpen(false);
    await loadRoomSnapshot(snapshot.room.id, { silentError: true });
  }

  async function handleConfirmWords() {
    if (!snapshot || !self?.team) {
      return;
    }

    const team = self.team;

    const normalizedWords = teamWordSlotsToWords(teamWordSlotsDraft);
    if (normalizedWords.some((word) => !word)) {
      setActionError('需要填写 4 个词语');
      return;
    }

    const uniqueWords = new Set(normalizedWords);
    if (uniqueWords.size !== normalizedWords.length) {
      setActionError('同队词语不能重复');
      return;
    }

    const normalizedSlots = teamWordSlotsDraft.map((slot, index) =>
      normalizeTeamWordSlot({
        ...slot,
        text: normalizedWords[index] ?? '',
      }),
    );
    const result = await withAction('confirm-team-words', () =>
      confirmTeamWords(snapshot.room.id, team, normalizedWords, normalizedSlots),
    );
    if (result === null) {
      return;
    }

    setTeamWordSlotsDraft(normalizedSlots);
    setPendingConfirmedTeamWordSlots(normalizedSlots);
    setTeamWordDraftMode(inferTeamWordDraftMode(normalizedSlots));
    setTeamWordFormDirty(false);
    setTeamWordManualModePinned(false);
    setWordAssignmentNotice(null);
  }

  async function handleClueSubmit() {
    if (!snapshot || !self?.team) {
      return;
    }

    const team = self.team;

    if (clueForm.some((value) => !value.trim())) {
      setActionError('需要填写 3 条加密结果');
      return;
    }

    await withAction('submit-clues', () => submitClues(snapshot.room.id, team, clueForm));
    setClueForm(['', '', '']);
  }

  async function handleDecodeSubmit() {
    if (!snapshot || !self?.team) {
      return;
    }

    const team = self.team;

    const guess = normalizeGuess(decodeGuess);
    if (guess.length !== 5) {
      setActionError('解密密码格式应为 1-2-3');
      return;
    }

    await withAction('submit-decode', () => submitOwnGuess(snapshot.room.id, team, guess));
    setDecodeGuess('');
  }

  async function handleInterceptSubmit() {
    if (!snapshot || !self?.team) {
      return;
    }

    const team = self.team;

    const guess = normalizeGuess(interceptGuess);
    if (guess.length !== 5) {
      setActionError('拦截密码格式应为 1-2-3');
      return;
    }

    await withAction('submit-intercept', () => submitInterceptGuess(snapshot.room.id, otherTeam(team), guess));
    setInterceptGuess('');
  }

  async function handleSkipFirstIntercept() {
    if (!snapshot || !self?.is_host) {
      return;
    }

    await withAction('skip-first-intercept', () => skipFirstIntercept(snapshot.room.id));
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

  async function handleKickPlayer(player: PlayerRecord) {
    if (!snapshot || !self?.is_host || player.id === self.id) {
      return;
    }

    const confirmed = window.confirm(`确定要踢出玩家“${player.player_name}”吗？`);
    if (!confirmed) {
      return;
    }

    const result = await withAction(`kick-player-${player.id}`, () => kickPlayer(snapshot.room.id, player.id));
    if (result !== null) {
      setSnapshot((current) =>
        current
          ? {
              ...current,
              players: current.players.filter((entry) => entry.id !== player.id),
            }
          : current,
      );
      setKickSyncPollUntil(Date.now() + 10_000);
    }
  }

  async function handleRestartRoom() {
    if (!snapshot || !self?.is_host) {
      return;
    }

    const result = await withAction('restart-room', () => restartRoom(snapshot.room.id));
    if (result !== null) {
      setClueForm(['', '', '']);
      setTeamWordSlotsDraft(emptyTeamWordSlots());
      setTeamWordDraftMode('manual');
      setTeamWordFormDirty(false);
      setTeamWordManualModePinned(false);
      setPendingConfirmedTeamWordSlots(null);
      setWordAssignmentNotice(null);
      setDecodeGuess('');
      setInterceptGuess('');
    }
  }

  async function handleTerminateGame() {
    if (!snapshot || !self?.is_host || snapshot.room.status !== 'active') {
      return;
    }

    const confirmed = window.confirm('确定要终止当前游戏吗？所有玩家将返回选座大厅');
    if (!confirmed) {
      return;
    }

    const result = await withAction('terminate-game', () => terminateGame(snapshot.room.id));
    if (result !== null) {
      setClueForm(['', '', '']);
      setTeamWordSlotsDraft(emptyTeamWordSlots());
      setTeamWordDraftMode('manual');
      setTeamWordFormDirty(false);
      setTeamWordManualModePinned(false);
      setPendingConfirmedTeamWordSlots(null);
      setWordAssignmentNotice(null);
      setDecodeGuess('');
      setInterceptGuess('');
    }
  }

  if (booting) {
    return (
      <main className="app-shell">
        <section className="panel hero-panel">
          <p className="eyebrow">动漫高手——截码战</p>
          <h1>正在建立匿名会话...</h1>
        </section>
      </main>
    );
  }

  if (!isSupabaseConfigured) {
    return (
      <main className="app-shell">
        <section className="panel hero-panel">
          <p className="eyebrow">动漫高手——截码战</p>
          <h1>先接入 Supabase 再开始</h1>
          <p className="muted">
            需要在项目根目录创建 <code>.env.local</code>，填写 <code>VITE_SUPABASE_URL</code> 和{' '}
            <code>VITE_SUPABASE_ANON_KEY</code>，并执行 <code>supabase/schema.sql</code>
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
          <h1>你还没有加入这个房间</h1>
          <p className="muted">请返回首页重新加入，或检查匿名登录是否被浏览器重置</p>
        </section>
      </main>
    );
  }

  if (!roomId || !snapshot || !self) {
    return (
      <main className="app-shell">
        <section className="panel hero-panel hero-panel-home">
          <div className="hero-orb hero-orb-red" aria-hidden="true" />
          <div className="hero-orb hero-orb-blue" aria-hidden="true" />
          <div className="hero-copy">
            <p className="eyebrow">动漫高手</p>
            <h1>动漫高手——截码战</h1>
            <div className="hero-tags" aria-label="游戏特点">
              <span>4-14 人</span>
              <span>双队对抗</span>
              <span>实时房间</span>
            </div>
          </div>

          <div className="hero-form-card">
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
                  placeholder="6位数字/字母"
                  value={joinCode}
                />
              </label>
            </div>

            <div className="button-row hero-button-row">
              <button className="primary-button" disabled={busyKey !== null} onClick={() => void handleCreateRoom()} type="button">
                创建房间
              </button>
              <button className="ghost-button" disabled={busyKey !== null} onClick={() => void handleJoinRoom()} type="button">
                加入房间
              </button>
            </div>
          </div>

          {actionError ? <p className="error-text">{actionError}</p> : null}
        </section>
      </main>
    );
  }

  const myWordPlaceholder =
    isWordAssignmentPhase && self.role !== 'encoder' && !myTeamConfirmed ? '待确认' : '等待发牌';

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

      {isLobbyPhase ? (
        <section className="layout-grid">
          <article className="panel">
            <div className="panel-head">
              <div>
                <h2>选座大厅</h2>
                <p className="muted">队内可自由选择任意空位 1 号位是加密/拦截者，2 号位是解码者，其余为队员位</p>
              </div>
            </div>

            {self.is_host ? (
              <div className="lobby-settings">
                <div className="lobby-settings-block">
                <label className="lobby-setting">
                  <span>房间席位</span>
                  <select
                    disabled={busyKey !== null}
                    onChange={(event) => void handleSeatCountChange(Number(event.target.value))}
                    value={snapshot.room.seat_count}
                  >
                    {lobbySeatOptions.map((option) => (
                      <option key={option} value={option}>
                        {option} 席
                      </option>
                    ))}
                  </select>
                </label>

                <label className="lobby-toggle">
                  <input
                    checked={snapshot.room.role_rotation_enabled}
                    disabled={busyKey !== null}
                    onChange={(event) => void handleRoleRotationToggle(event.target.checked)}
                    type="checkbox"
                  />
                  <div>
                    <strong>身份轮换</strong>
                    <span>默认开启，每轮结束后按队内顺序轮换身份</span>
                  </div>
                </label>
                </div>

                <div className="lobby-settings-block lobby-settings-catalog">
                  <div className="lobby-settings-head">
                    <div>
                      <strong>Bangumi 动画词库</strong>
                      <p className="muted">支持填写用户 ID 或收藏夹页面链接，保存后房间内持续复用。</p>
                    </div>
                    <div className="catalog-action-row">
                      <button
                        className="outline-button"
                        disabled={busyKey !== null}
                        onClick={openBangumiCatalogModal}
                        type="button"
                      >
                        {isLoadingBangumiCatalog ? '载入中...' : '载入 Bangumi 动画词库'}
                      </button>
                    </div>
                  </div>

                  <div className="catalog-summary-row">
                    <div className="catalog-summary-grid">
                      <div className="tag">{bangumiCatalogSummary.configured ? '已配置' : '未配置'}</div>
                      <div className="tag">用户数：{bangumiCatalogSummary.userCount}</div>
                      <div className="tag">交集词数：{bangumiCatalogSummary.wordCount}</div>
                    </div>

                    {bangumiCatalogSummary.configured ? (
                      <div className="catalog-card-footer">
                        <button className="ghost-button" onClick={openBangumiCatalogBrowser} type="button">
                          浏览词库
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : (
              <div className="lobby-settings lobby-settings-readonly">
                <div className="tag">房间席位：{snapshot.room.seat_count} 席</div>
                <div className="tag">身份轮换：{snapshot.room.role_rotation_enabled ? '开启' : '关闭'}</div>
              </div>
            )}

            {!self.is_host ? (
              <div className="lobby-readonly-catalog">
                <div className="catalog-summary-row">
                  <div className="catalog-summary-grid">
                    <div className="tag">{bangumiCatalogSummary.configured ? '词库：已配置' : '词库：未配置'}</div>
                    <div className="tag">用户数：{bangumiCatalogSummary.userCount}</div>
                    <div className="tag">交集词数：{bangumiCatalogSummary.wordCount}</div>
                  </div>

                  {bangumiCatalogSummary.configured ? (
                    <div className="catalog-card-footer">
                      <button className="ghost-button" onClick={openBangumiCatalogBrowser} type="button">
                        浏览词库
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="team-seat-columns">
              {teamOrder.map((team) => (
                <section className={cn('team-seat-panel', `team-seat-panel-${teamTone(team)}`)} key={team}>
                  <header className="team-seat-head">
                    <div>
                      <h3>{displayTeamName(team)}</h3>
                      <p>{teamLobbyStatus(snapshot.players, team)}</p>
                    </div>
                    <span className={cn('team-badge', `team-badge-${teamTone(team)}`)}>{perTeamCapacity} 席</span>
                  </header>

                  <div className="seat-grid">
                    {Array.from({ length: perTeamCapacity }, (_, index) => {
                      const seatNumber = index + 1;
                      const previewRole = roleForSeat(seatNumber);
                      const occupant = snapshot.players.find(
                        (player) => player.team === team && player.team_seat === seatNumber,
                      );

                      return (
                        <SeatCard
                          active={self.team === team && self.team_seat === seatNumber}
                          key={`${team}-${seatNumber}`}
                          occupant={occupant}
                          onClick={
                            isSeatTaken(snapshot.players, team, seatNumber, self.id) || busyKey !== null
                              ? undefined
                              : () => void handleSeat(team, seatNumber)
                          }
                          previewRole={previewRole}
                          seatNumber={seatNumber}
                          team={team}
                        />
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>

            <div className="seat-action-row">
              {self.team && self.team_seat ? (
                <button className="ghost-button" disabled={busyKey !== null} onClick={() => void handleStandUp()} type="button">
                  站起
                </button>
              ) : null}

              {self.is_host ? (
                <button
                  className="primary-button"
                  disabled={!startGameReady || busyKey !== null}
                  onClick={() => void handleStartGame()}
                  type="button"
                >
                  开始游戏
                </button>
              ) : null}
            </div>

            <p className="muted lobby-hint">{self.is_host ? lobbyStartHint : '等待房主开始游戏'}</p>
            <p className="muted lobby-hint">词语随机生成依赖 Bangumi 词库。未配置也可开局，但选词阶段随机抽词会失败。</p>
          </article>

          <article className="panel">
            <h2>房间玩家</h2>
            <div className="roster-list">
              {rosterPlayers.map((player) => (
                <div className="roster-item" key={player.id}>
                  <div>
                    <strong>{player.player_name}</strong>
                    <p>{player.is_host ? '房主' : '成员'}</p>
                  </div>
                  <div className="roster-item-side">
                    <div className="tag-row">
                    <span className="tag">{player.team ? displayTeamName(player.team) : '未入队'}</span>
                    <span className={cn('tag', player.role && `tag-role-${player.role}`)}>
                      {player.role ? roleName(player.role) : '未选座位'}
                    </span>
                    </div>
                    {self.is_host && player.id !== self.id ? (
                      <button
                        className="danger-button roster-kick-button"
                        disabled={busyKey !== null}
                        onClick={() => void handleKickPlayer(player)}
                        type="button"
                      >
                        踢出
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>
      ) : (
        <>
          <section className="role-strip">
            <RoleGroup players={teamAPlayers} selfId={self.id} team="A" />
            <RoleGroup players={teamBPlayers} selfId={self.id} team="B" />
          </section>

          <section className="action-panel">
            <div className="action-header">
              <div className="action-header-card">
                <div className="identity-banner">
                  <span className={cn('team-badge', `team-badge-${teamTone(myTeam)}`)}>{displayTeamName(myTeam)}</span>
                  {self.role ? <span className="identity-role">{roleName(self.role)}</span> : null}
                  {self.is_host ? <span className="identity-host-badge">房主</span> : null}
                </div>
                <h2>{actionTitle}</h2>
                <p className="action-hint">{effectiveActionHint}</p>
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
              ) : canSkipFirstIntercept ? (
                <button className="primary-button" disabled={busyKey !== null} onClick={() => void handleSkipFirstIntercept()} type="button">
                  跳过第一轮拦截
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
                      <div className="action-line-head-cell">本队词位</div>
                      {showsDualWordColumns ? (
                        <div className="action-line-head-word-pair">
                          <div className="action-line-head-cell">动画名</div>
                          <div className="action-line-head-cell">角色名</div>
                        </div>
                      ) : (
                        <div className="action-line-head-cell">填写词语</div>
                      )}
                    </div>

                    {teamWordSlotsDraft.map((slot, index) => (
                      <div className="action-line" key={`team-word-${index}`}>
                        <span className={cn('code-word', `code-word-${teamTone(myTeam)}`)}>
                          <b>{index + 1}</b>
                          <span>{`位置 ${index + 1}`}</span>
                        </span>
                        <div
                          className={cn('team-word-control', canReplaceGeneratedWords && 'team-word-control-with-replace')}
                          key={`team-word-control-${teamWordDraftMode}-${index}`}
                        >
                          {teamWordDraftMode === 'characters' && slotShowsSourceTitle(slot) ? (
                            <div className="team-word-pair">
                              <input
                                key={`team-word-title-${teamWordDraftMode}-${index}`}
                                disabled={teamWordDraftMode === 'characters'}
                                maxLength={48}
                                onChange={(event) => updateTeamWordTitle(index, event.target.value)}
                                placeholder={`动画名 ${index + 1}`}
                                title={slot.sourceTitle ?? ''}
                                value={slot.sourceTitle ?? ''}
                              />
                              {teamWordDraftMode === 'characters' ? (
                                <select
                                  key={`team-word-select-${index}`}
                                  onChange={(event) => updateTeamWordCharacter(index, event.target.value)}
                                  title={slot.text}
                                  value={slot.text}
                                >
                                  {slot.characterOptions.map((option) => (
                                    <option key={option} value={option}>
                                      {option}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  key={`team-word-input-dual-${teamWordDraftMode}-${index}`}
                                  maxLength={24}
                                  onChange={(event) => updateTeamWord(index, event.target.value)}
                                  placeholder={`角色名 ${index + 1}`}
                                  title={slot.text}
                                  value={slot.text}
                                />
                              )}
                            </div>
                          ) : teamWordDraftMode === 'characters' && slot.characterOptions.length > 0 ? (
                            <select
                              key={`team-word-select-single-${index}`}
                              onChange={(event) => updateTeamWordCharacter(index, event.target.value)}
                              title={slot.text}
                              value={slot.text}
                            >
                              {slot.characterOptions.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          ) : slotShowsSourceTitle(slot) ? (
                            <div className="team-word-pair">
                              <input
                                key={`team-word-title-${teamWordDraftMode}-${index}`}
                                maxLength={48}
                                onChange={(event) => updateTeamWordTitle(index, event.target.value)}
                                placeholder={`动画名 ${index + 1}`}
                                title={slot.sourceTitle ?? ''}
                                value={slot.sourceTitle ?? ''}
                              />
                              <input
                                key={`team-word-input-dual-${teamWordDraftMode}-${index}`}
                                maxLength={24}
                                onChange={(event) => updateTeamWord(index, event.target.value)}
                                placeholder={`角色名 ${index + 1}`}
                                title={slot.text}
                                value={slot.text}
                              />
                            </div>
                          ) : (
                            <input
                              key={`team-word-input-${teamWordDraftMode}-${index}`}
                              maxLength={24}
                              disabled={teamWordDraftMode === 'generated' || teamWordDraftMode === 'characters'}
                              onChange={(event) => updateTeamWord(index, event.target.value)}
                              placeholder={`填写第 ${index + 1} 个词语`}
                              title={slot.text}
                              value={slot.text}
                            />
                          )}
                          {canReplaceGeneratedWords ? (
                            <button
                              className="ghost-button team-word-replace-button"
                              disabled={busyKey !== null}
                              onClick={() => void handleReplaceTeamWord(index)}
                              type="button"
                            >
                              更换
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}

                    <div className="assignment-toolbar">
                      <button
                        className="ghost-button"
                        disabled={busyKey !== null}
                        onClick={() => void handleGenerateWords()}
                        type="button"
                      >
                        随机生成动画标题
                      </button>
                      <button
                        className="ghost-button"
                        disabled={busyKey !== null || !canExtractTeamWordCharacters}
                        onClick={() => void handleExtractCharacters()}
                        type="button"
                      >
                        提取动画主要角色
                      </button>
                      <button
                        className="ghost-button"
                        disabled={busyKey !== null || !canToggleSourceTitles}
                        onClick={handleToggleSourceTitles}
                        type="button"
                      >
                        {canOmitSourceTitles ? '删去动画名' : '补充动画名'}
                      </button>
                      <button
                        className="ghost-button"
                        disabled={busyKey !== null}
                        onClick={handleManualEdit}
                        type="button"
                      >
                        手动编辑
                      </button>
                      <span className="assignment-tip">若词语过长可能显示不全，建议手动编辑</span>
                    </div>
                    {wordAssignmentNotice ? <p className="muted assignment-note">{wordAssignmentNotice}</p> : null}
                  </div>
                ) : isWordAssignmentPhase ? (
                  <div className="wait-card">
                    <strong>{effectiveProgressText}</strong>
                    <p className="muted">
                      {myTeamConfirmed ? '本队词语已锁定，等待另一队加密者确认词语' : '等待本队加密者确认词语'}
                    </p>
                  </div>
                ) : isDecodePhase && (myTeamSubmission?.clues?.length ?? 0) > 0 ? (
                  <div className="action-lines">
                    <div className="action-line-head action-line-head-balanced">
                      <span className="action-line-head-cell">本轮线索</span>
                      <span className="action-line-head-cell">选择解码</span>
                    </div>
                    {(myTeamSubmission?.clues ?? []).map((clue, index) => (
                      <label className="action-line action-line-balanced" key={`${clue}-${index}`}>
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
                ) : isInterceptPhase && !isFirstRoundInterceptSkip && (opponentSubmission?.clues?.length ?? 0) > 0 ? (
                  <div className="action-lines">
                    <div className="action-line-head action-line-head-balanced">
                      <span className="action-line-head-cell">对方线索</span>
                      <span className="action-line-head-cell">选择截码</span>
                    </div>
                    {(opponentSubmission?.clues ?? []).map((clue, index) => (
                      <label className="action-line action-line-balanced" key={`${clue}-${index}`}>
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
                ) : isFirstRoundInterceptSkip ? (
                  <div className="wait-card">
                    <strong>跳过第一轮拦截</strong>
                    <p className="muted">
                      {canSkipFirstIntercept ? '由房主点击上方按钮跳过第一轮拦截' : '等待房主跳过第一轮拦截'}
                    </p>
                  </div>
                ) : canSubmitClues ? (
                  <div className="action-lines">
                    <div className="action-line-head">
                      <span className="action-line-head-cell">本轮密码</span>
                      <span className="action-line-head-cell">填写线索</span>
                    </div>
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
                ) : snapshot.room.phase === 'finished' ? (
                  <div
                    className={cn(
                      'finished-result-card',
                      snapshot.room.winner
                        ? `finished-result-card-${teamTone(snapshot.room.winner)}`
                        : 'finished-result-card-draw',
                    )}
                  >
                    <span className="finished-result-chip">最终结果</span>
                    <strong>{snapshot.room.winner ? `${displayTeamName(snapshot.room.winner)} 获胜` : '本局平局'}</strong>
                  </div>
                ) : (
                  <div className="wait-card">
                    <strong>{effectiveProgressText}</strong>
                  </div>
                )}
              </div>

              <aside className="action-progress">
                <span>进度</span>
                <strong>{effectiveProgressText}</strong>
              </aside>
            </div>
          </section>

          <section className="main-info-grid">
            <article className={cn('info-panel', `info-panel-${teamTone(myTeam)}`)}>
              <header className="info-header">
                <div className="info-header-copy">
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
                      {isWordAssignmentPhase && !myTeamConfirmed && !pendingConfirmedTeamWordSlots
                        ? index + 1
                        : renderTeamWordDisplay(
                            displayedMyTeamWordSlots[index] ?? emptyTeamWordSlot(),
                            myWordPlaceholder,
                            String(index + 1),
                          )}
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
                <div className="record-block-header">
                <h3>我方轮次记录</h3>
                </div>
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
                      <span className={resultClass(entry.own_guess, entry.own_correct)}>{formatGuessResult(entry.own_guess, entry.own_correct)}</span>
                      <span className={resultClass(entry.intercept_guess, entry.intercept_correct)}>{formatGuessResult(entry.intercept_guess, entry.intercept_correct)}</span>
                    </div>
                  ))}
                </div>
              </section>
            </article>

            <article className={cn('info-panel', `info-panel-${teamTone(opponentTeam)}`)}>
              <header className="info-header">
                <div className="info-header-copy">
                  <small className="header-note">鎷彿琛ㄧず瀵规柟鐚滄祴鐨勬暟瀛楋紝鍙湁鐚滈敊鏃舵墠鏄剧ず</small>
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
                    <div key={number}>
                      {renderOpponentWordDisplay(
                        number,
                        isFinishedPhase ? opponentTeamWords[number - 1]?.trim() || '待公开' : '??',
                        displayedMyTeamWordSlots.some((slot) => slotShowsSourceTitle(slot)),
                      )}
                    </div>
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
              <section className="record-block">
                <div className="record-block-header">
                  <span>对方轮次记录</span>
                  <small className="record-note">括号表示对方猜测的数字，只有猜错时才显示</small>
                </div>
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
                      <span className={resultClass(entry.own_guess, entry.own_correct)}>{formatGuessResult(entry.own_guess, entry.own_correct)}</span>
                      <span className={resultClass(entry.intercept_guess, entry.intercept_correct)}>{formatGuessResult(entry.intercept_guess, entry.intercept_correct)}</span>
                    </div>
                  ))}
                </div>
              </section>
            </article>
          </section>

          {canTerminateCurrentGame ? (
            <section className="game-footer-actions">
              <button className="danger-button" disabled={busyKey !== null} onClick={() => void handleTerminateGame()} type="button">
                终止游戏
              </button>
            </section>
          ) : null}
        </>
      )}

      {bangumiCatalogModalOpen ? (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget && busyKey !== 'load-bangumi-catalog') {
              closeBangumiCatalogModal();
            }
          }}
          role="presentation"
        >
          <section aria-modal="true" className="modal-card" role="dialog">
            <div className="modal-card-head">
              <div>
                <h2>载入 Bangumi 动画词库</h2>
                <p className="muted">填写用户 ID 或收藏夹页面链接，再勾选要搜索的分类。</p>
              </div>
              <button
                className="ghost-button"
                disabled={busyKey === 'load-bangumi-catalog'}
                onClick={closeBangumiCatalogModal}
                type="button"
              >
                关闭
              </button>
            </div>

            <div className="modal-form-stack">
              {isLoadingBangumiCatalog ? (
                <div className="catalog-loading-note" role="status">
                  正在从 Bangumi 载入并保存词库，通常会稍慢一些，请稍等。
                </div>
              ) : null}

              <div className="catalog-type-group">
                {BANGUMI_COLLECTION_TYPE_OPTIONS.map((option) => (
                  <label className="catalog-type-option" key={option.value}>
                    <input
                      checked={bangumiCatalogTypesDraft.includes(option.value)}
                      disabled={busyKey === 'load-bangumi-catalog'}
                      onChange={() => toggleBangumiCatalogType(option.value)}
                      type="checkbox"
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>

              {bangumiCatalogInputsDraft.map((value, index) => (
                <div className="modal-input-row" key={`bangumi-input-${index}`}>
                  <input
                    disabled={busyKey === 'load-bangumi-catalog'}
                    onChange={(event) => updateBangumiCatalogInput(index, event.target.value)}
                    placeholder="例如：790691 或 https://bangumi.tv/anime/list/790691"
                    value={value}
                  />
                  <button
                    className="ghost-button"
                    disabled={busyKey === 'load-bangumi-catalog' || bangumiCatalogInputsDraft.length <= 1}
                    onClick={() => removeBangumiCatalogInput(index)}
                    type="button"
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>

            <div className="modal-footer">
              <button
                className="ghost-button"
                disabled={busyKey === 'load-bangumi-catalog'}
                onClick={addBangumiCatalogInput}
                type="button"
              >
                新增用户
              </button>
              <button
                className="primary-button"
                disabled={busyKey === 'load-bangumi-catalog'}
                onClick={() => void handleLoadBangumiCatalog()}
                type="button"
              >
                {isLoadingBangumiCatalog ? '载入中...' : '载入并保存词库'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {bangumiCatalogBrowserOpen ? (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeBangumiCatalogBrowser();
            }
          }}
          role="presentation"
        >
          <section aria-modal="true" className="modal-card modal-card-compact" role="dialog">
            <div className="modal-card-head">
              <div>
                <h2>Bangumi 词库</h2>
                <p className="muted">当前房间已保存的动画词条，所有人都可以浏览。</p>
              </div>
              <button className="ghost-button" onClick={closeBangumiCatalogBrowser} type="button">
                关闭
              </button>
            </div>

            <div className="catalog-browser-summary">
              <div className="tag">词数：{bangumiCatalogWords.length}</div>
            </div>

            <div className="catalog-browser-list" role="list">
              {bangumiCatalogWords.map((word) => (
                <span className="catalog-browser-item" key={word} role="listitem">
                  {word}
                </span>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

export default App;
