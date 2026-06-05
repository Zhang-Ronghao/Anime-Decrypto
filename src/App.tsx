import { useEffect, useMemo, useState } from 'react';
import { useRef } from 'react';
import {
  advanceRound,
  cleanupExpiredRooms,
  clearAllSeats,
  confirmTeamWords,
  createRoom,
  disbandRoom,
  extractBangumiCharacters,
  fetchRoomSnapshot,
  getRoomJoinStatus,
  generateTeamWords,
  joinRoom,
  joinAsSpectator,
  joinMidgameRoom,
  kickPlayer,
  leaveRoom,
  loadBangumiCatalog,
  replaceTeamWordSlot,
  restartRoom,
  requestTeamWordFeedback,
  startGame,
  submitClues,
  submitInterceptGuess,
  skipFirstIntercept,
  submitOwnGuess,
  submitTeamWordFeedbackBatch,
  subscribeToSelfNotifications,
  subscribeToRoom,
  type RoomSubscriptionStatus,
  terminateGame,
  transferHost,
  updateRoomLobbySettings,
  updateSelfSpectator,
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
import type {
  PlayerRecord,
  Role,
  RoomJoinStatus,
  RoomPhase,
  RoomSnapshot,
  RoundSubmissionRecord,
  Team,
  TeamWordFeedbackRequestRecord,
  TeamWordFeedbackResponseRecord,
  TeamWordSlot,
  TeamWordsRecord,
} from './types';

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
  kind: 'intercept' | 'miscomm' | 'life';
  limit: number;
  tone: 'red' | 'blue';
}

interface TeamLife {
  remaining: number;
  damage: number;
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
type TimedPhase = 'encrypt' | 'decode' | 'intercept';
type TeamWordFeedbackDraftValue = boolean | null;

type BangumiCollectionType = 1 | 2 | 3 | 4 | 5;

interface LobbyTimerSettings {
  encryptMinutes: number;
  decodeMinutes: number;
  interceptMinutes: number;
}

interface BangumiCollectionTypeOption {
  value: BangumiCollectionType;
  label: string;
}

const MAX_CHARACTER_OPTIONS = 12;

const BANGUMI_COLLECTION_TYPE_OPTIONS: BangumiCollectionTypeOption[] = [
  { value: 1, label: '想看' },
  { value: 2, label: '看过' },
  { value: 3, label: '在看' },
  { value: 4, label: '搁置' },
  { value: 5, label: '抛弃' },
];

const GITHUB_REPO_URL = 'https://github.com/Zhang-Ronghao/Anime-Decrypto';
const GAME_RULES_URL = 'https://github.com/Zhang-Ronghao/Anime-Decrypto/blob/main/docs/game-rules.md';
const VIDEO_INTRO_URL =
  'https://www.bilibili.com/video/BV1z4Gt6rEFC/?share_source=copy_web&vd_source=adcd58a56c0c896937ee4c3fe22de339';
const FEEDBACK_QQ_GROUP_URL = 'https://qm.qq.com/q/bHJQIRplmg';
const OTHER_GAME_URL: string | null = null;
const LOBBY_TIMER_MINUTE_OPTIONS = [1, 2, 3, 4, 5] as const;
const MISCOMMUNICATION_LIMIT_OPTIONS = [2, 3, 4] as const;
const DEFAULT_MISCOMMUNICATION_LIMIT = 2;
const LIFE_POINT_OPTIONS = [3, 4] as const;
const DEFAULT_LIFE_POINTS = 3;
const DEFAULT_LOBBY_TIMER_SETTINGS: LobbyTimerSettings = {
  encryptMinutes: 2,
  decodeMinutes: 2,
  interceptMinutes: 2,
};

interface HomeFooterLinkItemProps {
  label: string;
  href: string | null;
  icon: 'video' | 'rules' | 'github' | 'group' | 'spark';
  tooltip?: string;
  wide?: boolean;
}

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

function ScoreTrack({ count, kind, limit, tone }: ScoreTrackProps) {
  const safeLimit = Math.max(1, limit);
  const filledCount = Math.min(Math.max(count, 0), safeLimit);
  const displayCount = kind === 'life' ? count : filledCount;
  const label =
    kind === 'intercept'
      ? `拦截 ${filledCount}/${safeLimit}`
      : kind === 'miscomm'
        ? `失误 ${filledCount}/${safeLimit}`
        : `生命 ${displayCount}/${safeLimit}`;
  const text = kind === 'intercept' ? '拦截' : kind === 'miscomm' ? '失误' : '生命';

  return (
    <div className={cn('score-track', `score-track-${kind}`, filledCount >= safeLimit && 'score-track-full')} aria-label={label}>
      <span className="score-track-label" aria-hidden="true">
        {text}
      </span>

      <span className="score-track-cells" aria-hidden="true">
        {Array.from({ length: safeLimit }, (_, index) => (
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

function HomeFooterLinkItem({ label, href, icon, tooltip, wide = false }: HomeFooterLinkItemProps) {
  const iconNode =
    icon === 'video' ? (
      <svg aria-hidden="true" className="home-footer-icon" viewBox="0 0 24 24">
        <rect height="12" rx="2.5" width="15" x="3" y="6" />
        <path d="M18 10.2 22 8v8l-4-2.2" />
      </svg>
    ) : icon === 'rules' ? (
      <svg aria-hidden="true" className="home-footer-icon" viewBox="0 0 24 24">
        <path d="M7 4.5h8.5A2.5 2.5 0 0 1 18 7v12H8.5A2.5 2.5 0 0 0 6 21.5V7A2.5 2.5 0 0 1 8.5 4.5Z" />
        <path d="M6 7.5h9" />
        <path d="M9 11h6" />
        <path d="M9 14.5h6" />
      </svg>
    ) : icon === 'github' ? (
      <svg aria-hidden="true" className="home-footer-icon" viewBox="0 0 24 24">
        <path d="M12 2.5a9.5 9.5 0 0 0-3 18.52c.48.09.65-.2.65-.47v-1.66c-2.64.57-3.2-1.12-3.2-1.12-.43-1.1-1.06-1.4-1.06-1.4-.86-.59.07-.58.07-.58.95.07 1.45.97 1.45.97.84 1.44 2.21 1.02 2.75.78.09-.61.33-1.02.6-1.26-2.1-.24-4.31-1.05-4.31-4.67 0-1.03.37-1.88.97-2.54-.1-.24-.42-1.22.09-2.54 0 0 .79-.25 2.6.97A9.02 9.02 0 0 1 12 7.8c.8 0 1.6.1 2.35.31 1.8-1.22 2.59-.97 2.59-.97.52 1.32.2 2.3.1 2.54.6.66.97 1.51.97 2.54 0 3.63-2.21 4.42-4.32 4.66.34.29.64.86.64 1.74v2.58c0 .27.17.57.66.47A9.5 9.5 0 0 0 12 2.5Z" />
      </svg>
    ) : icon === 'group' ? (
      <svg aria-hidden="true" className="home-footer-icon" viewBox="0 0 24 24">
        <path d="M8 12.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
        <path d="M16.5 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
        <path d="M3.5 18.5a4.5 4.5 0 0 1 9 0" />
        <path d="M13 18.5a3.8 3.8 0 0 1 7.5 0" />
      </svg>
    ) : (
      <svg aria-hidden="true" className="home-footer-icon" viewBox="0 0 24 24">
        <path d="m12 3 1.85 5.15L19 10l-5.15 1.85L12 17l-1.85-5.15L5 10l5.15-1.85L12 3Z" />
      </svg>
    );

  const content = (
    <>
      {iconNode}
      <span>{label}</span>
    </>
  );

  if (!href) {
    return (
      <span
        className={cn('home-footer-link', 'home-footer-link-disabled', wide && 'home-footer-link-wide')}
        title={tooltip}
      >
        {content}
      </span>
    );
  }

  return (
    <a
      className={cn('home-footer-link', wide && 'home-footer-link-wide')}
      href={href}
      rel="noreferrer"
      target="_blank"
      title={tooltip}
    >
      {content}
    </a>
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

function lifeFor(snapshot: RoomSnapshot, team: Team): TeamLife {
  const score = scoreFor(snapshot, team);
  const opponentScore = scoreFor(snapshot, otherTeam(team));
  const lifePoints = lifePointsFromRoom(snapshot.room);
  const damage = score.miscomms + opponentScore.intercepts;
  return { remaining: lifePoints - damage, damage };
}

function displayTeamName(team: Team): string {
  return team === 'A' ? '红队' : '蓝队';
}

function teamTone(team: Team): 'red' | 'blue' {
  return team === 'A' ? 'red' : 'blue';
}

function isTimedPhase(phase: RoomPhase): phase is TimedPhase {
  return phase === 'encrypt' || phase === 'decode' || phase === 'intercept';
}

function timedPhaseLabel(phase: TimedPhase): string {
  if (phase === 'encrypt') {
    return '加密';
  }

  if (phase === 'decode') {
    return '解密';
  }

  return '拦截';
}

function lobbyTimerSettingsFromRoom(room?: RoomSnapshot['room'] | null): LobbyTimerSettings {
  if (!room) {
    return DEFAULT_LOBBY_TIMER_SETTINGS;
  }

  return {
    encryptMinutes: room.encrypt_phase_minutes,
    decodeMinutes: room.decode_phase_minutes,
    interceptMinutes: room.intercept_phase_minutes,
  };
}

function miscommunicationLimitFromRoom(room?: RoomSnapshot['room'] | null): number {
  return MISCOMMUNICATION_LIMIT_OPTIONS.includes(room?.miscommunication_limit as (typeof MISCOMMUNICATION_LIMIT_OPTIONS)[number])
    ? room!.miscommunication_limit
    : DEFAULT_MISCOMMUNICATION_LIMIT;
}

function lifePointsFromRoom(room?: RoomSnapshot['room'] | null): number {
  return LIFE_POINT_OPTIONS.includes(room?.life_points as (typeof LIFE_POINT_OPTIONS)[number])
    ? room!.life_points
    : DEFAULT_LIFE_POINTS;
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
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

function emptyTeamWordFeedbackDraft(): TeamWordFeedbackDraftValue[] {
  return [null, null, null, null];
}

function normalizeTeamWordSlot(slot: Partial<TeamWordSlot> | null | undefined): TeamWordSlot {
  return {
    text: (slot?.text ?? '').trim(),
    subjectId: typeof slot?.subjectId === 'number' && Number.isFinite(slot.subjectId) ? slot.subjectId : null,
    sourceTitle: typeof slot?.sourceTitle === 'string' ? slot.sourceTitle.trim() : null,
    showSourceTitle: slot?.showSourceTitle === true,
    characterOptions: Array.isArray(slot?.characterOptions)
      ? Array.from(new Set(slot.characterOptions.map((value) => value.trim()).filter((value) => value.length > 0))).slice(
          0,
          MAX_CHARACTER_OPTIONS,
        )
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
    sourceTitle: slot.showSourceTitle ? (slot.sourceTitle?.trim() ?? '') : null,
    showSourceTitle: slot.showSourceTitle,
    characterOptions: [],
  }));
}

function slotShowsSourceTitle(slot: TeamWordSlot): boolean {
  return slot.showSourceTitle;
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

  if (/^[A-Za-z0-9_-]+$/.test(value)) {
    return true;
  }

  try {
    const url = new URL(value);
    if (!['bangumi.tv', 'bgm.tv', 'chii.in'].includes(url.hostname)) {
      return false;
    }

    return /^\/(?:anime\/list|user)\/[^/]+(?:\/[^/]+)?\/?$/.test(url.pathname) || /^\/index\/\d+\/?$/.test(url.pathname);
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

function getLatestTeamWordFeedbackRequest(
  requests: TeamWordFeedbackRequestRecord[],
  team: Team,
): TeamWordFeedbackRequestRecord | null {
  return (
    requests
      .filter((entry) => entry.team === team)
      .slice()
      .sort((left, right) => {
        if (left.request_number !== right.request_number) {
          return right.request_number - left.request_number;
        }

        return right.created_at.localeCompare(left.created_at);
      })[0] ?? null
  );
}

function feedbackResponseKey(requestId: string, playerId: string, slotIndex: number): string {
  return `${requestId}:${playerId}:${slotIndex}`;
}

function filterVisibleRoundRecords(
  submissions: RoundSubmissionRecord[],
  currentRoundNumber: number,
  currentPhase: RoomSnapshot['room']['phase'] | null,
  showAll: boolean,
): RoundSubmissionRecord[] {
  const canRevealCurrentRound = currentPhase === 'result' || currentPhase === 'finished';

  if (showAll) {
    return submissions.filter((entry) => canRevealCurrentRound || entry.round_number !== currentRoundNumber);
  }

  const visibleRoundNumbers = canRevealCurrentRound
    ? new Set([currentRoundNumber - 1, currentRoundNumber].filter((roundNumber) => roundNumber >= 1))
    : new Set([currentRoundNumber - 1].filter((roundNumber) => roundNumber >= 1));

  return submissions.filter((entry) => visibleRoundNumbers.has(entry.round_number));
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
  const snapshotRequestIdRef = useRef(0);
  const realtimeRefreshTimerRef = useRef<number | null>(null);
  const teamWordDraftRevisionRef = useRef(0);
  const teamWordServerSyncFreezeUntilRef = useRef(0);
  const [booting, setBooting] = useState(true);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [timerNow, setTimerNow] = useState(() => Date.now());
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
  const [syncFallbackUntil, setSyncFallbackUntil] = useState<number | null>(null);
  const [lobbySettingsModalOpen, setLobbySettingsModalOpen] = useState(false);
  const [hostTransferDialogOpen, setHostTransferDialogOpen] = useState(false);
  const [pendingMidgameJoin, setPendingMidgameJoin] = useState<RoomJoinStatus | null>(null);
  const [spectatorTeamView, setSpectatorTeamView] = useState<Team>('A');
  const [bangumiCatalogModalOpen, setBangumiCatalogModalOpen] = useState(false);
  const [bangumiCatalogBrowserOpen, setBangumiCatalogBrowserOpen] = useState(false);
  const [bangumiCatalogInputsDraft, setBangumiCatalogInputsDraft] = useState<string[]>(() => emptyBangumiCatalogInputRow());
  const [bangumiCatalogTypesDraft, setBangumiCatalogTypesDraft] = useState<BangumiCollectionType[]>(() =>
    defaultBangumiCatalogTypes(),
  );
  const [showAllRoundRecords, setShowAllRoundRecords] = useState(false);
  const [teamWordFeedbackDraft, setTeamWordFeedbackDraft] = useState<{
    requestId: string | null;
    values: TeamWordFeedbackDraftValue[];
  }>(() => ({ requestId: null, values: emptyTeamWordFeedbackDraft() }));

  function invalidateTeamWordDraftAsyncResults() {
    teamWordDraftRevisionRef.current += 1;
  }

  function freezeTeamWordServerSync(durationMs = 2000) {
    teamWordServerSyncFreezeUntilRef.current = Date.now() + durationMs;
  }

  function beginSyncFallback(durationMs = 10_000) {
    setSyncFallbackUntil(Date.now() + durationMs);
  }

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
          const joinStatus = await getRoomJoinStatus(roomCodeFromUrl);
          if (joinStatus.status === 'active' && !joinStatus.is_member) {
            if (!cancelled) {
              setJoinCode(joinStatus.room_code);
              setPendingMidgameJoin(joinStatus);
            }
            return;
          }

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
      snapshotRequestIdRef.current += 1;
      setSnapshot(null);
      return;
    }

    const scheduleRealtimeRefresh = () => {
      if (realtimeRefreshTimerRef.current !== null) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
      }

      realtimeRefreshTimerRef.current = window.setTimeout(() => {
        realtimeRefreshTimerRef.current = null;
        void refreshRoomSnapshot(roomId, { silentError: true });
      }, 100);
    };

    const handleSubscriptionStatus = (status: RoomSubscriptionStatus) => {
      if (status === 'SUBSCRIBED') {
        setSyncFallbackUntil(null);
        void refreshRoomSnapshot(roomId, { silentError: true });
        return;
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        setSyncFallbackUntil(Date.now() + 10_000);
      }
    };

    const channel = subscribeToRoom(roomId, scheduleRealtimeRefresh, handleSubscriptionStatus);

    void refreshRoomSnapshot(roomId);

    return () => {
      if (realtimeRefreshTimerRef.current !== null) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
        realtimeRefreshTimerRef.current = null;
      }
      void channel.unsubscribe();
    };
  }, [roomId, sessionUserId]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    setTimerNow(Date.now());
    const intervalId = window.setInterval(() => {
      setTimerNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [snapshot]);

  useEffect(() => {
    if (!roomId) {
      return;
    }

    const resyncForegroundState = () => {
      beginSyncFallback(12_000);
      void refreshRoomSnapshot(roomId, { silentError: true }).then((success) => {
        if (success) {
          setSyncFallbackUntil(null);
        }
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        resyncForegroundState();
      }
    };

    const handleWindowFocus = () => {
      resyncForegroundState();
    };

    const handlePageShow = () => {
      resyncForegroundState();
    };

    const handleOnline = () => {
      resyncForegroundState();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('online', handleOnline);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('online', handleOnline);
    };
  }, [roomId, sessionUserId]);

  async function refreshRoomSnapshot(nextRoomId: string, options?: { silentError?: boolean }) {
    const requestId = snapshotRequestIdRef.current + 1;
    snapshotRequestIdRef.current = requestId;

    try {
      const nextSnapshot = await fetchRoomSnapshot(nextRoomId);
      if (snapshotRequestIdRef.current !== requestId) {
        return true;
      }

      if (sessionUserId && !nextSnapshot.players.some((player) => player.auth_user_id === sessionUserId)) {
        resetRoomState(ROOM_MEMBERSHIP_LOST_MESSAGE);
        return false;
      }

      setSnapshot(nextSnapshot);
      return true;
    } catch (error) {
      if (snapshotRequestIdRef.current !== requestId) {
        return true;
      }

      if (isRoomMembershipLostError(error)) {
        resetRoomState(ROOM_MEMBERSHIP_LOST_MESSAGE);
      } else if (!options?.silentError) {
        setActionError(getErrorMessage(error, '读取房间失败'));
      }

      return false;
    }
  }

  useEffect(() => {
    if (!roomId || !syncFallbackUntil) {
      return;
    }

    const remainingMs = syncFallbackUntil - Date.now();
    if (remainingMs <= 0) {
      setSyncFallbackUntil(null);
      return;
    }

    const poller = window.setInterval(() => {
      if (Date.now() >= syncFallbackUntil) {
        window.clearInterval(poller);
        setSyncFallbackUntil(null);
        return;
      }

      void refreshRoomSnapshot(roomId, { silentError: true });
    }, 2500);

    const stopper = window.setTimeout(() => {
      setSyncFallbackUntil(null);
    }, remainingMs);

    return () => {
      window.clearInterval(poller);
      window.clearTimeout(stopper);
    };
  }, [syncFallbackUntil, roomId, sessionUserId]);

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
    if (!sessionUserId) {
      return;
    }

    const channel = subscribeToSelfNotifications(sessionUserId, (notification) => {
      if (!roomId || notification.kind !== 'kicked') {
        return;
      }

      if (notification.roomId && notification.roomId !== roomId) {
        return;
      }

      resetRoomState(ROOM_MEMBERSHIP_LOST_MESSAGE);
    });

    return () => {
      void channel.unsubscribe();
    };
  }, [roomId, sessionUserId]);

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

  useEffect(() => {
    if (!hostTransferDialogOpen) {
      return;
    }

    if (!snapshot || snapshot.room.phase !== 'lobby' || !self?.is_host) {
      setHostTransferDialogOpen(false);
    }
  }, [hostTransferDialogOpen, self?.is_host, snapshot]);

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
  const hostTransferCandidates = useMemo(
    () => rosterPlayers.filter((player) => player.id !== self?.id),
    [rosterPlayers, self?.id],
  );
  const teamAPlayers = useMemo(() => (snapshot ? getTeamPlayers(snapshot.players, 'A') : []), [snapshot]);
  const teamBPlayers = useMemo(() => (snapshot ? getTeamPlayers(snapshot.players, 'B') : []), [snapshot]);
  const spectatorPlayers = useMemo(
    () =>
      snapshot
        ? snapshot.players
            .filter((player) => player.is_spectator)
            .slice()
            .sort((left, right) => left.joined_at.localeCompare(right.joined_at))
        : [],
    [snapshot],
  );
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

  const isSpectator = Boolean(self?.is_spectator);
  const myTeam = self?.team ?? spectatorTeamView;
  const opponentTeam = otherTeam(myTeam);
  const myTeamSubmission = currentRoundSubmissionByTeam[myTeam];
  const opponentSubmission = currentRoundSubmissionByTeam[opponentTeam];
  const myVisibleCode = self?.team ? currentRoundCodeByTeam[self.team]?.code ?? null : null;
  const myTeamWordRecord = snapshot?.teamWords.find((entry) => entry.team === myTeam);
  const opponentTeamWordRecord = snapshot?.teamWords.find((entry) => entry.team === opponentTeam);
  const opponentTeamWords = snapshot ? getTeamWords(snapshot, opponentTeam) : [];
  const myScore = snapshot ? scoreFor(snapshot, myTeam) : { intercepts: 0, miscomms: 0, net: 0 };
  const opponentScore = snapshot ? scoreFor(snapshot, opponentTeam) : { intercepts: 0, miscomms: 0, net: 0 };
  const myLife = snapshot ? lifeFor(snapshot, myTeam) : { remaining: DEFAULT_LIFE_POINTS, damage: 0 };
  const opponentLife = snapshot ? lifeFor(snapshot, opponentTeam) : { remaining: DEFAULT_LIFE_POINTS, damage: 0 };
  const myTeamWords = snapshot ? getTeamWords(snapshot, myTeam) : [];
  const myTeamConfirmed = snapshot
    ? myTeam === 'A'
      ? snapshot.room.team_a_words_confirmed
      : snapshot.room.team_b_words_confirmed
    : false;
  const mySubmissions = snapshot ? getTeamSubmissions(snapshot, myTeam) : [];
  const opponentSubmissions = snapshot ? getTeamSubmissions(snapshot, opponentTeam) : [];
  const currentRoundNumber = snapshot?.room.round_number ?? 0;
  const currentPhase = snapshot?.room.phase ?? null;
  const lobbyTimerSettings = lobbyTimerSettingsFromRoom(snapshot?.room);
  const miscommunicationLimit = miscommunicationLimitFromRoom(snapshot?.room);
  const lifeModeEnabled = snapshot?.room.life_mode_enabled === true;
  const lifePoints = lifePointsFromRoom(snapshot?.room);
  const visibleMySubmissions = useMemo(
    () => filterVisibleRoundRecords(mySubmissions, currentRoundNumber, currentPhase, showAllRoundRecords),
    [currentPhase, currentRoundNumber, mySubmissions, showAllRoundRecords],
  );
  const visibleOpponentSubmissions = useMemo(
    () => filterVisibleRoundRecords(opponentSubmissions, currentRoundNumber, currentPhase, showAllRoundRecords),
    [currentPhase, currentRoundNumber, opponentSubmissions, showAllRoundRecords],
  );
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
  const canLeaveCurrentRoom = snapshot
    ? snapshot.room.status === 'active' || snapshot.room.status === 'lobby' || snapshot.room.status === 'finished'
    : false;
  const canTerminateCurrentGame = snapshot ? self?.is_host === true && snapshot.room.status === 'active' : false;
  const currentSeatCount = snapshot?.room.seat_count ?? 4;
  const perTeamCapacity = teamCapacity(currentSeatCount);
  const allPlayersSeated = snapshot
    ? snapshot.players
        .filter((player) => player.team !== null || player.team_seat !== null)
        .every((player) => Boolean(player.team) && player.team_seat !== null)
    : false;
  const coreSeatsReady = snapshot ? teamOrder.every((team) => hasCoreSeats(snapshot.players, team)) : false;
  const seatedPlayerCount = snapshot
    ? snapshot.players.filter((player) => Boolean(player.team) && player.team_seat !== null).length
    : 0;
  const unassignedPlayerCount = snapshot
    ? snapshot.players.filter((player) => !player.is_spectator && (player.team === null || player.team_seat === null)).length
    : 0;
  const hasSeatedPlayers = seatedPlayerCount > 0;
  const startGameReady = snapshot
    ? unassignedPlayerCount === 0 && coreSeatsReady && (snapshot.room.seat_count > 4 || seatedPlayerCount === 4)
    : false;
  const wordAssignmentCount = snapshot
    ? Number(snapshot.room.team_a_words_confirmed) + Number(snapshot.room.team_b_words_confirmed)
    : 0;
  const clueSubmitCount = currentRoundSubmissions.filter((entry) => entry.clues?.length === 3).length;
  const decodeSubmitCount = currentRoundSubmissions.filter((entry) => entry.own_guess).length;
  const interceptSubmitCount = currentRoundSubmissions.filter((entry) => entry.intercept_guess).length;
  const teamWordServerSlots = useMemo(() => teamWordSlotsFromRecord(myTeamWordRecord), [myTeamWordRecord]);
  const opponentTeamWordSlots = useMemo(() => teamWordSlotsFromRecord(opponentTeamWordRecord), [opponentTeamWordRecord]);
  const displayedMyTeamWordSlots =
    isWordAssignmentPhase && pendingConfirmedTeamWordSlots && !myTeamConfirmed
      ? pendingConfirmedTeamWordSlots
      : teamWordServerSlots;
  const hasMyTeamWordPreview = displayedMyTeamWordSlots.some(
    (slot) => slot.text.trim().length > 0 || (slot.sourceTitle?.trim().length ?? 0) > 0,
  );
  const hasCharacterDerivedWords = teamWordSlotsDraft.some((slot) => slot.characterOptions.length > 0);
  const canOmitSourceTitles = teamWordSlotsDraft.some((slot) => slotShowsSourceTitle(slot));
  const canRestoreSourceTitles =
    hasCharacterDerivedWords && teamWordSlotsDraft.some((slot) => !slot.showSourceTitle && Boolean(slot.sourceTitle));
  const canToggleSourceTitles = canOmitSourceTitles || canRestoreSourceTitles;
  const showsDualWordColumns = teamWordSlotsDraft.some((slot) => slotShowsSourceTitle(slot));
  const canEditWordAssignment = Boolean(
    isWordAssignmentPhase && self?.team && self.role === 'encoder' && myTeamWordRecord && !myTeamWordRecord.confirmed,
  );
  const canViewWordAssignment = Boolean(isWordAssignmentPhase && self?.team);
  const isWordAssignmentReadOnly = canViewWordAssignment && !canEditWordAssignment;
  const hasCompleteTeamWordDraft = teamWordSlotsToWords(teamWordSlotsDraft).every((word) => word.length > 0);
  const canExtractTeamWordCharacters = teamWordDraftMode === 'generated';
  const shouldConfirmBeforeManualEdit = teamWordDraftMode === 'generated';
  const canReplaceGeneratedWords = teamWordDraftMode === 'generated';
  const latestTeamWordFeedbackRequest = useMemo(
    () => (snapshot ? getLatestTeamWordFeedbackRequest(snapshot.teamWordFeedbackRequests, myTeam) : null),
    [myTeam, snapshot],
  );
  const teamWordFeedbackResponses = useMemo(
    () =>
      snapshot && latestTeamWordFeedbackRequest
        ? snapshot.teamWordFeedbackResponses.filter((entry) => entry.request_id === latestTeamWordFeedbackRequest.id)
        : [],
    [latestTeamWordFeedbackRequest, snapshot],
  );
  const teamWordFeedbackResponseByPlayerSlot = useMemo(() => {
    return Object.fromEntries(
      teamWordFeedbackResponses.map((entry) => [
        feedbackResponseKey(entry.request_id, entry.player_id, entry.slot_index),
        entry,
      ]),
    ) as Record<string, TeamWordFeedbackResponseRecord>;
  }, [teamWordFeedbackResponses]);
  const submittedTeamWordFeedbackDraft = useMemo<TeamWordFeedbackDraftValue[]>(() => {
    if (!self || !latestTeamWordFeedbackRequest) {
      return emptyTeamWordFeedbackDraft();
    }

    return [0, 1, 2, 3].map(
      (slotIndex) =>
        teamWordFeedbackResponseByPlayerSlot[
          feedbackResponseKey(latestTeamWordFeedbackRequest.id, self.id, slotIndex)
        ]?.accepted ?? null,
    );
  }, [latestTeamWordFeedbackRequest, self, teamWordFeedbackResponseByPlayerSlot]);
  const myTeamFeedbackPlayers = useMemo(
    () =>
      (myTeam === 'A' ? teamAPlayers : teamBPlayers).filter(
        (player) => !player.is_spectator && player.role !== 'encoder',
      ),
    [myTeam, teamAPlayers, teamBPlayers],
  );
  const teamWordFeedbackPlayerById = useMemo(
    () => Object.fromEntries(myTeamFeedbackPlayers.map((player) => [player.id, player])) as Record<string, PlayerRecord>,
    [myTeamFeedbackPlayers],
  );
  const isLatestTeamWordFeedbackCurrent = Boolean(
    latestTeamWordFeedbackRequest &&
      serializeWords(latestTeamWordFeedbackRequest.words) === serializeWords(teamWordSlotsToWords(teamWordSlotsDraft)),
  );
  const canRequestTeamWordFeedback = canEditWordAssignment && hasCompleteTeamWordDraft;
  const canSubmitTeamWordFeedback = Boolean(
    isWordAssignmentReadOnly &&
      !isSpectator &&
      !myTeamConfirmed &&
      self?.team &&
      self.role !== 'encoder' &&
      latestTeamWordFeedbackRequest &&
      isLatestTeamWordFeedbackCurrent,
  );
  const currentTeamWordFeedbackDraft =
    latestTeamWordFeedbackRequest && teamWordFeedbackDraft.requestId === latestTeamWordFeedbackRequest.id
      ? teamWordFeedbackDraft.values
      : submittedTeamWordFeedbackDraft;
  const teamWordFeedbackDraftComplete = currentTeamWordFeedbackDraft.every((value) => value !== null);
  const teamWordFeedbackDraftChanged = currentTeamWordFeedbackDraft.some(
    (value, index) => value !== submittedTeamWordFeedbackDraft[index],
  );
  const canSubmitTeamWordFeedbackDraft =
    canSubmitTeamWordFeedback && teamWordFeedbackDraftComplete && teamWordFeedbackDraftChanged;
  const canSubmitClues = !isSpectator && isCurrentEncryptPhase && self?.role === 'encoder' && !myTeamSubmission?.clues;
  const canSubmitDecode = !isSpectator && isDecodePhase && self?.role === 'decoder' && !myTeamSubmission?.own_guess;
  const canSubmitIntercept =
    !isSpectator && isInterceptPhase && !isFirstRoundInterceptSkip && self?.role === 'encoder' && !opponentSubmission?.intercept_guess;
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
        : canViewWordAssignment
          ? '实时查看本队加密者正在设置的词语'
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
  const centerStatusText =
    snapshot?.room.phase === 'result'
      ? self?.is_host
        ? '本轮已经结算，请点击左侧按钮开始下一轮'
        : '本轮已经结算，等待房主开始下一轮'
      : effectiveProgressText;
  const activeTimedPhase = snapshot && isTimedPhase(snapshot.room.phase) ? snapshot.room.phase : null;
  const countdownHasDeadline = Boolean(activeTimedPhase && snapshot?.room.phase_deadline_at);
  const countdownSeconds =
    countdownHasDeadline && snapshot?.room.phase_deadline_at
      ? Math.max(0, Math.ceil((new Date(snapshot.room.phase_deadline_at).getTime() - timerNow) / 1000))
      : 0;
  const countdownExpired = countdownHasDeadline && countdownSeconds === 0;
  const countdownTitle = activeTimedPhase ? `${timedPhaseLabel(activeTimedPhase)}倒计时` : '倒计时';
  const countdownText = formatCountdown(countdownSeconds);
  const lobbyStartHint = snapshot
    ? unassignedPlayerCount > 0
      ? '开始前，未入队玩家需要选择队伍或加入观战'
      : !coreSeatsReady
        ? '开始前，两队的 1 号位和 2 号位都必须有人'
        : snapshot.room.seat_count === 4 && seatedPlayerCount !== 4
          ? '4 人房需要满员开局'
          : spectatorPlayers.length > 0
            ? '已满足开局条件，观战玩家不会占用席位'
            : '已满足开局条件'
    : '';

  useEffect(() => {
    if (!isWordAssignmentPhase) {
      invalidateTeamWordDraftAsyncResults();
      setTeamWordSlotsDraft(emptyTeamWordSlots());
      setTeamWordDraftMode('manual');
      setTeamWordFormDirty(false);
      setTeamWordManualModePinned(false);
      setPendingConfirmedTeamWordSlots(null);
      setWordAssignmentNotice(null);
      return;
    }

    if (!self?.team) {
      invalidateTeamWordDraftAsyncResults();
      setTeamWordSlotsDraft(emptyTeamWordSlots());
      setTeamWordDraftMode('manual');
      setTeamWordFormDirty(false);
      setTeamWordManualModePinned(false);
      setPendingConfirmedTeamWordSlots(null);
      setWordAssignmentNotice(null);
      return;
    }
  }, [isWordAssignmentPhase, self?.team]);

  useEffect(() => {
    if (!isWordAssignmentPhase || !self?.team || !myTeamWordRecord) {
      return;
    }

    const isEditingWordAssignment = self.role === 'encoder' && !myTeamWordRecord.confirmed;

    if (isEditingWordAssignment && Date.now() < teamWordServerSyncFreezeUntilRef.current) {
      return;
    }

    if (isEditingWordAssignment && teamWordManualModePinned) {
      return;
    }

    if (!isEditingWordAssignment || myTeamWordRecord.confirmed || !teamWordFormDirty) {
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

  useEffect(() => {
    if (!canSubmitTeamWordFeedback || !latestTeamWordFeedbackRequest) {
      setTeamWordFeedbackDraft((current) =>
        current.requestId === null ? current : { requestId: null, values: emptyTeamWordFeedbackDraft() },
      );
      return;
    }

    setTeamWordFeedbackDraft((current) =>
      current.requestId === latestTeamWordFeedbackRequest.id
        ? current
        : { requestId: latestTeamWordFeedbackRequest.id, values: submittedTeamWordFeedbackDraft },
    );
  }, [canSubmitTeamWordFeedback, latestTeamWordFeedbackRequest, submittedTeamWordFeedbackDraft]);

  async function withAction<T>(
    key: string,
    action: () => Promise<T>,
    options?: { refreshRoomId?: string | null },
  ): Promise<T | null> {
    setActionError(null);
    setBusyKey(key);

    try {
      const result = await action();

      if (options?.refreshRoomId) {
        const refreshed = await refreshRoomSnapshot(options.refreshRoomId);
        if (!refreshed) {
          return null;
        }
      }

      return result;
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
    snapshotRequestIdRef.current += 1;
    if (realtimeRefreshTimerRef.current !== null) {
      window.clearTimeout(realtimeRefreshTimerRef.current);
      realtimeRefreshTimerRef.current = null;
    }
    setRoomId(null);
    setSnapshot(null);
    setSyncFallbackUntil(null);
    setJoinCode('');
    setClueForm(['', '', '']);
    invalidateTeamWordDraftAsyncResults();
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
    setPendingMidgameJoin(null);
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
    invalidateTeamWordDraftAsyncResults();
    freezeTeamWordServerSync();
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
    invalidateTeamWordDraftAsyncResults();
    freezeTeamWordServerSync();
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
    const joinStatus = await withAction('join-room-check', () => getRoomJoinStatus(code));
    if (!joinStatus) {
      return;
    }

    if (joinStatus.status === 'active' && !joinStatus.is_member) {
      setPendingMidgameJoin(joinStatus);
      return;
    }

    const result = await withAction('join-room', () => joinRoom(code, name));
    if (!result) {
      return;
    }

    setRoomId(result.room_id);
    setJoinCode(result.room_code);
    window.history.replaceState({}, '', `?room=${result.room_code}`);
  }

  async function handleJoinMidgame(team: Team) {
    const name = displayName.trim();
    const code = joinCode.trim();
    if (!name || !code || !pendingMidgameJoin) {
      return;
    }

    const result = await withAction('join-midgame-room', () => joinMidgameRoom(code, name, team));
    if (!result) {
      return;
    }

    setPendingMidgameJoin(null);
    setRoomId(result.room_id);
    setJoinCode(result.room_code);
    window.history.replaceState({}, '', `?room=${result.room_code}`);
  }

  async function handleJoinSpectatorFromHome() {
    const name = displayName.trim();
    const code = joinCode.trim();
    if (!name || !code || !pendingMidgameJoin) {
      return;
    }

    localStorage.setItem('decrypto-name', name);
    const result = await withAction('join-spectator-room', () => joinAsSpectator(code, name));
    if (!result) {
      return;
    }

    setPendingMidgameJoin(null);
    setRoomId(result.room_id);
    setJoinCode(result.room_code);
    setSpectatorTeamView('A');
    window.history.replaceState({}, '', `?room=${result.room_code}`);
  }

  async function handleSeat(team: Team, teamSeat: number) {
    if (!snapshot) {
      return;
    }

    const result = await withAction(`seat-${team}-${teamSeat}`, () => updateSelfSeat(snapshot.room.id, team, teamSeat), {
      refreshRoomId: snapshot.room.id,
    });
    if (result !== null) {
      setHostTransferDialogOpen(false);
      beginSyncFallback();
    }
  }

  async function handleJoinSpectator() {
    if (!snapshot) {
      return;
    }

    const result = await withAction('spectator-join', () => updateSelfSpectator(snapshot.room.id, true), {
      refreshRoomId: snapshot.room.id,
    });
    if (result !== null) {
      setSpectatorTeamView('A');
      beginSyncFallback();
    }
  }

  async function handleExitSpectator() {
    if (!snapshot) {
      return;
    }

    const result = await withAction('spectator-exit', () => updateSelfSpectator(snapshot.room.id, false), {
      refreshRoomId: snapshot.room.id,
    });
    if (result !== null) {
      beginSyncFallback();
    }
  }

  async function handleStandUp() {
    if (!snapshot || (!self?.team && !self?.is_spectator)) {
      return;
    }

    const result = await withAction('seat-clear', () =>
      self.is_spectator ? updateSelfSpectator(snapshot.room.id, false) : updateSelfSeat(snapshot.room.id, null, null), {
      refreshRoomId: snapshot.room.id,
    });
    if (result !== null) {
      beginSyncFallback();
    }
  }

  async function handleClearAllSeats() {
    if (!snapshot || !self?.is_host || !hasSeatedPlayers) {
      return;
    }

    const result = await withAction('seat-clear-all', () => clearAllSeats(snapshot.room.id), {
      refreshRoomId: snapshot.room.id,
    });
    if (result !== null) {
      beginSyncFallback();
    }
  }

  async function handleSeatCountChange(seatCount: number) {
    if (!snapshot || !self?.is_host || seatCount === snapshot.room.seat_count) {
      return;
    }

    const timers = lobbyTimerSettingsFromRoom(snapshot.room);
    await withAction('lobby-seat-count', () =>
      updateRoomLobbySettings(
        snapshot.room.id,
        seatCount,
        snapshot.room.role_rotation_enabled,
        timers,
        miscommunicationLimitFromRoom(snapshot.room),
        snapshot.room.life_mode_enabled,
        lifePointsFromRoom(snapshot.room),
        snapshot.room.allow_midgame_join,
      ),
    );
  }

  async function handleRoleRotationToggle(enabled: boolean) {
    if (!snapshot || !self?.is_host || enabled === snapshot.room.role_rotation_enabled) {
      return;
    }

    const timers = lobbyTimerSettingsFromRoom(snapshot.room);
    await withAction('lobby-rotation', () =>
      updateRoomLobbySettings(
        snapshot.room.id,
        snapshot.room.seat_count,
        enabled,
        timers,
        miscommunicationLimitFromRoom(snapshot.room),
        snapshot.room.life_mode_enabled,
        lifePointsFromRoom(snapshot.room),
        snapshot.room.allow_midgame_join,
      ),
    );
  }

  async function handleLobbyTimerChange(phase: TimedPhase, minutes: number) {
    if (!snapshot || !self?.is_host) {
      return;
    }

    const currentTimers = lobbyTimerSettingsFromRoom(snapshot.room);
    const nextTimers: LobbyTimerSettings =
      phase === 'encrypt'
        ? { ...currentTimers, encryptMinutes: minutes }
        : phase === 'decode'
          ? { ...currentTimers, decodeMinutes: minutes }
          : { ...currentTimers, interceptMinutes: minutes };

    if (
      nextTimers.encryptMinutes === currentTimers.encryptMinutes &&
      nextTimers.decodeMinutes === currentTimers.decodeMinutes &&
      nextTimers.interceptMinutes === currentTimers.interceptMinutes
    ) {
      return;
    }

    await withAction(`lobby-timer-${phase}`, () =>
      updateRoomLobbySettings(
        snapshot.room.id,
        snapshot.room.seat_count,
        snapshot.room.role_rotation_enabled,
        nextTimers,
        miscommunicationLimitFromRoom(snapshot.room),
        snapshot.room.life_mode_enabled,
        lifePointsFromRoom(snapshot.room),
        snapshot.room.allow_midgame_join,
      ),
    );
  }

  async function handleMiscommunicationLimitChange(limit: number) {
    if (!snapshot || !self?.is_host || limit === miscommunicationLimitFromRoom(snapshot.room)) {
      return;
    }

    const timers = lobbyTimerSettingsFromRoom(snapshot.room);
    await withAction('lobby-miscommunication-limit', () =>
      updateRoomLobbySettings(
        snapshot.room.id,
        snapshot.room.seat_count,
        snapshot.room.role_rotation_enabled,
        timers,
        limit,
        snapshot.room.life_mode_enabled,
        lifePointsFromRoom(snapshot.room),
        snapshot.room.allow_midgame_join,
      ),
    );
  }

  async function handleLifeModeToggle(enabled: boolean) {
    if (!snapshot || !self?.is_host || enabled === snapshot.room.life_mode_enabled) {
      return;
    }

    const timers = lobbyTimerSettingsFromRoom(snapshot.room);
    await withAction('lobby-life-mode', () =>
      updateRoomLobbySettings(
        snapshot.room.id,
        snapshot.room.seat_count,
        snapshot.room.role_rotation_enabled,
        timers,
        miscommunicationLimitFromRoom(snapshot.room),
        enabled,
        lifePointsFromRoom(snapshot.room),
        snapshot.room.allow_midgame_join,
      ),
    );
  }

  async function handleLifePointsChange(points: number) {
    if (!snapshot || !self?.is_host || points === lifePointsFromRoom(snapshot.room)) {
      return;
    }

    const timers = lobbyTimerSettingsFromRoom(snapshot.room);
    await withAction('lobby-life-points', () =>
      updateRoomLobbySettings(
        snapshot.room.id,
        snapshot.room.seat_count,
        snapshot.room.role_rotation_enabled,
        timers,
        miscommunicationLimitFromRoom(snapshot.room),
        snapshot.room.life_mode_enabled,
        points,
        snapshot.room.allow_midgame_join,
      ),
    );
  }

  async function handleMidgameJoinToggle(enabled: boolean) {
    if (!snapshot || !self?.is_host || enabled === snapshot.room.allow_midgame_join) {
      return;
    }

    const timers = lobbyTimerSettingsFromRoom(snapshot.room);
    await withAction('lobby-midgame-join', () =>
      updateRoomLobbySettings(
        snapshot.room.id,
        snapshot.room.seat_count,
        snapshot.room.role_rotation_enabled,
        timers,
        miscommunicationLimitFromRoom(snapshot.room),
        snapshot.room.life_mode_enabled,
        lifePointsFromRoom(snapshot.room),
        enabled,
      ),
    );
  }

  async function handleStartGame() {
    if (!snapshot) {
      return;
    }

    const result = await withAction('start-game', () => startGame(snapshot.room.id), {
      refreshRoomId: snapshot.room.id,
    });
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

    invalidateTeamWordDraftAsyncResults();
    freezeTeamWordServerSync();
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

    invalidateTeamWordDraftAsyncResults();
    freezeTeamWordServerSync();
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
    const requestRevision = teamWordDraftRevisionRef.current;
    const result = await withAction('extract-bangumi-characters', () => extractBangumiCharacters(snapshot.room.id, team));
    if (!result || result.slots.length !== 4 || teamWordDraftRevisionRef.current !== requestRevision) {
      return;
    }

    invalidateTeamWordDraftAsyncResults();
    freezeTeamWordServerSync();
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
    invalidateTeamWordDraftAsyncResults();
    freezeTeamWordServerSync();
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
    invalidateTeamWordDraftAsyncResults();
    freezeTeamWordServerSync();
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

    invalidateTeamWordDraftAsyncResults();
    freezeTeamWordServerSync();
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
      setActionError('至少填写 1 个 Bangumi 用户 ID、收藏夹页面链接或目录链接。');
      return;
    }

    const invalidValue = normalizedInputs.find((value) => !isBangumiCatalogInputValid(value));
    if (invalidValue) {
      setActionError('仅支持用户 ID，或 bangumi.tv / bgm.tv / chii.in 的用户主页、收藏夹页面、目录链接。');
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
    await refreshRoomSnapshot(snapshot.room.id, { silentError: true });
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
    const result = await withAction(
      'confirm-team-words',
      () => confirmTeamWords(snapshot.room.id, team, normalizedWords, normalizedSlots),
      { refreshRoomId: snapshot.room.id },
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

  async function handleRequestTeamWordFeedback() {
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
    const result = await withAction(
      'request-team-word-feedback',
      () => requestTeamWordFeedback(snapshot.room.id, team, normalizedWords, normalizedSlots),
      { refreshRoomId: snapshot.room.id },
    );
    if (result === null) {
      return;
    }

    setTeamWordSlotsDraft(normalizedSlots);
    setTeamWordDraftMode(inferTeamWordDraftMode(normalizedSlots));
    setTeamWordFormDirty(false);
    setPendingConfirmedTeamWordSlots(null);
    setWordAssignmentNotice('已询问队友，请等待他们对每个词打勾或打叉。');
  }

  function updateTeamWordFeedbackDraft(index: number, accepted: boolean) {
    if (!latestTeamWordFeedbackRequest) {
      return;
    }

    setTeamWordFeedbackDraft((current) => {
      const currentValues =
        current.requestId === latestTeamWordFeedbackRequest.id ? current.values : submittedTeamWordFeedbackDraft;

      return {
        requestId: latestTeamWordFeedbackRequest.id,
        values: currentValues.map((value, itemIndex) => (itemIndex === index ? accepted : value)),
      };
    });
  }

  async function handleSubmitTeamWordFeedbackDraft() {
    if (!snapshot || !latestTeamWordFeedbackRequest) {
      return;
    }

    if (!teamWordFeedbackDraftComplete) {
      setActionError('需要给 4 个词语都选择打勾或打叉');
      return;
    }

    const feedback = currentTeamWordFeedbackDraft.filter((value): value is boolean => value !== null);
    if (feedback.length !== 4) {
      setActionError('需要给 4 个词语都选择打勾或打叉');
      return;
    }

    await withAction(
      'submit-team-word-feedback',
      () => submitTeamWordFeedbackBatch(latestTeamWordFeedbackRequest.id, feedback),
      { refreshRoomId: snapshot.room.id },
    );
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

    await withAction('submit-clues', () => submitClues(snapshot.room.id, team, clueForm), {
      refreshRoomId: snapshot.room.id,
    });
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

    await withAction('submit-decode', () => submitOwnGuess(snapshot.room.id, team, guess), {
      refreshRoomId: snapshot.room.id,
    });
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

    await withAction('submit-intercept', () => submitInterceptGuess(snapshot.room.id, otherTeam(team), guess), {
      refreshRoomId: snapshot.room.id,
    });
    setInterceptGuess('');
  }

  async function handleSkipFirstIntercept() {
    if (!snapshot || !self?.is_host) {
      return;
    }

    await withAction('skip-first-intercept', () => skipFirstIntercept(snapshot.room.id), {
      refreshRoomId: snapshot.room.id,
    });
  }

  async function handleAdvanceRound() {
    if (!snapshot) {
      return;
    }

    await withAction('advance-round', () => advanceRound(snapshot.room.id), {
      refreshRoomId: snapshot.room.id,
    });
  }

  async function handleLeaveRoom() {
    if (!snapshot || !self) {
      return;
    }

    if (snapshot.room.status === 'active' && !self.is_spectator && self.role !== 'member') {
      window.alert('你当前是加密/拦截者或解密者，因为有身份不能退出。');
      return;
    }

    const result = await withAction('leave-room', () => leaveRoom(snapshot.room.id));
    if (result !== null) {
      resetRoomState();
    }
  }

  async function handleTransferHost(player: PlayerRecord) {
    if (!snapshot || !self?.is_host || player.id === self.id) {
      return;
    }

    const confirmed = window.confirm(`确定把房主转让给“${player.player_name}”吗？`);
    if (!confirmed) {
      return;
    }

    setHostTransferDialogOpen(false);
    const result = await withAction(`transfer-host-${player.id}`, () => transferHost(snapshot.room.id, player.id), {
      refreshRoomId: snapshot.room.id,
    });
    if (result !== null) {
      beginSyncFallback();
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

    const result = await withAction(`kick-player-${player.id}`, () => kickPlayer(snapshot.room.id, player.id), {
      refreshRoomId: snapshot.room.id,
    });
    if (result !== null) {
      setSnapshot((current) =>
        current
          ? {
              ...current,
              players: current.players.filter((entry) => entry.id !== player.id),
            }
          : current,
      );
      beginSyncFallback();
    }
  }

  async function handleRestartRoom() {
    if (!snapshot || !self?.is_host) {
      return;
    }

    const result = await withAction('restart-room', () => restartRoom(snapshot.room.id), {
      refreshRoomId: snapshot.room.id,
    });
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

    const result = await withAction('terminate-game', () => terminateGame(snapshot.room.id), {
      refreshRoomId: snapshot.room.id,
    });
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
            <div className="hero-eyebrow-row">
              <p className="hero-tag">动漫高手4.0</p>
            </div>
            <h1>动漫高手——截码战</h1>
            <div className="hero-tags" aria-label="游戏特点">
              <span className="hero-tag">4人及以上</span>
              <span className="hero-tag">双队对抗</span>
              <span className="hero-tag">实时房间</span>
              <span className="hero-tag">Bangumi词库</span>
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

        <footer className="home-footer" aria-label="相关信息">
          <div className="home-footer-grid">
            <HomeFooterLinkItem href={VIDEO_INTRO_URL} icon="video" label="视频介绍" />
            <HomeFooterLinkItem href={GAME_RULES_URL} icon="rules" label="文字规则" />
            <HomeFooterLinkItem href={GITHUB_REPO_URL} icon="github" label="Github 仓库" />
            <HomeFooterLinkItem href={FEEDBACK_QQ_GROUP_URL} icon="group" label="交流反馈Q群" />
            <HomeFooterLinkItem
              href={OTHER_GAME_URL}
              icon="spark"
              label="作者其他动漫高手游戏：一眼顶针"
              tooltip="即将公布，敬请期待"
              wide
            />
          </div>
        </footer>

        {pendingMidgameJoin ? (
          <div
            className="modal-backdrop"
            onClick={(event) => {
              if (event.target === event.currentTarget && busyKey !== 'join-midgame-room') {
                setPendingMidgameJoin(null);
              }
            }}
            role="presentation"
          >
            <section aria-modal="true" className="modal-card modal-card-compact midgame-join-modal" role="dialog">
              <div className="modal-card-head">
                <div>
                  <h2>中途加入房间 {pendingMidgameJoin.room_code}</h2>
                  <p className="muted">当前游戏正在进行，上方可选择队伍加入，下方可选择观战加入。</p>
                </div>
                <button
                  className="ghost-button"
                  disabled={busyKey === 'join-midgame-room'}
                  onClick={() => setPendingMidgameJoin(null)}
                  type="button"
                >
                  取消
                </button>
              </div>

              <div className="midgame-team-grid">
                {teamOrder.map((team) => {
                  const count = team === 'A' ? pendingMidgameJoin.team_a_count : pendingMidgameJoin.team_b_count;
                  const isFull = count >= pendingMidgameJoin.team_capacity;
                  const teamJoinDisabled = !pendingMidgameJoin.allow_midgame_join || isFull;

                  return (
                    <article className={cn('midgame-team-card', `midgame-team-card-${teamTone(team)}`)} key={team}>
                      <div>
                        <strong>{displayTeamName(team)}</strong>
                        <span>
                          {count}/{pendingMidgameJoin.team_capacity}
                        </span>
                      </div>
                      <button
                        className="primary-button"
                        disabled={busyKey !== null || teamJoinDisabled}
                        onClick={() => void handleJoinMidgame(team)}
                        type="button"
                      >
                        {!pendingMidgameJoin.allow_midgame_join ? '已关闭' : isFull ? '已满' : '加入空位'}
                      </button>
                    </article>
                  );
                })}
              </div>

              <div className="midgame-spectator-panel">
                <div>
                  <strong>观战加入</strong>
                  <p className="muted">不占用队伍席位，进入后默认红队视角，可自由切换两队视角。</p>
                </div>
                <button
                  className="ghost-button"
                  disabled={busyKey !== null}
                  onClick={() => void handleJoinSpectatorFromHome()}
                  type="button"
                >
                  加入观战
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </main>
    );
  }

  const myWordPlaceholder =
    isWordAssignmentPhase && self.role !== 'encoder' && !myTeamConfirmed ? '待确认' : '等待发牌';

  return (
    <main className="app-shell">
      <section className="top-bar">
        <div className="brand-block">
          <div className="brand-copy">
            <p className="app-title">动漫高手——截码战</p>
            <p className="app-subtitle">房间号 {snapshot.room.room_code}</p>
          </div>
        </div>

        <div className="status-pills">
          <span className="status-pill status-pill-round">第 {snapshot.room.round_number || 0} 轮</span>
          <span className="status-pill status-pill-phase">{phaseLabel(snapshot.room.phase)}</span>
        </div>

        <div className="top-actions">
          {!isLobbyPhase ? (
            <>
              <article className={cn('team-score', `team-score-${teamTone(myTeam)}`)}>
                <div className="team-score-display">
                  <strong>{displayTeamName(myTeam)}</strong>
                  <div className="team-score-tracks">
                    {lifeModeEnabled ? (
                      <ScoreTrack count={myLife.remaining} kind="life" limit={lifePoints} tone={teamTone(myTeam)} />
                    ) : (
                      <>
                        <ScoreTrack count={myScore.intercepts} kind="intercept" limit={2} tone={teamTone(myTeam)} />
                        <ScoreTrack
                          count={myScore.miscomms}
                          key={`${myTeam}-miscomm-${miscommunicationLimit}`}
                          kind="miscomm"
                          limit={miscommunicationLimit}
                          tone={teamTone(myTeam)}
                        />
                      </>
                    )}
                  </div>
                </div>
                <div>
                  <strong>{displayTeamName(myTeam)}</strong>
                  <small>
                    {lifeModeEnabled
                      ? `生命 ${myLife.remaining}/${lifePoints} · 受伤 ${myLife.damage}`
                      : `拦截 ${myScore.intercepts} · 失误 ${myScore.miscomms}`}
                  </small>
                </div>
                <b>{lifeModeEnabled ? myLife.remaining : myScore.net}</b>
              </article>

              <article className={cn('team-score', `team-score-${teamTone(opponentTeam)}`)}>
                <div className="team-score-display">
                  <strong>{displayTeamName(opponentTeam)}</strong>
                  <div className="team-score-tracks">
                    {lifeModeEnabled ? (
                      <ScoreTrack count={opponentLife.remaining} kind="life" limit={lifePoints} tone={teamTone(opponentTeam)} />
                    ) : (
                      <>
                        <ScoreTrack count={opponentScore.intercepts} kind="intercept" limit={2} tone={teamTone(opponentTeam)} />
                        <ScoreTrack
                          count={opponentScore.miscomms}
                          key={`${opponentTeam}-miscomm-${miscommunicationLimit}`}
                          kind="miscomm"
                          limit={miscommunicationLimit}
                          tone={teamTone(opponentTeam)}
                        />
                      </>
                    )}
                  </div>
                </div>
                <div>
                  <strong>{displayTeamName(opponentTeam)}</strong>
                  <small>
                    {lifeModeEnabled
                      ? `生命 ${opponentLife.remaining}/${lifePoints} · 受伤 ${opponentLife.damage}`
                      : `拦截 ${opponentScore.intercepts} · 失误 ${opponentScore.miscomms}`}
                  </small>
                </div>
                <b>{lifeModeEnabled ? opponentLife.remaining : opponentScore.net}</b>
              </article>
            </>
          ) : null}

          {canLeaveCurrentRoom ? (
            <div className="room-actions">
              {self.is_host && snapshot.room.status !== 'active' ? (
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
        <>
          <section className="layout-grid">
            <article className="panel">
            <div className="panel-head">
              <div>
                <h2>选座大厅</h2>
              </div>
              <button
                className="ghost-button lobby-extra-settings-button"
                disabled={busyKey !== null}
                onClick={() => setLobbySettingsModalOpen(true)}
                type="button"
              >
                <svg aria-hidden="true" className="button-icon" viewBox="0 0 24 24">
                  <path d="M5 7h14" />
                  <path d="M5 17h14" />
                  <path d="M9 7a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z" />
                  <path d="M15 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z" />
                </svg>
                <span>其他设置</span>
              </button>
            </div>

            <div className={cn('lobby-settings', !self.is_host && 'lobby-settings-readonly')}>
              <div className="lobby-settings-block lobby-settings-main">
                <div className="lobby-settings-head">
                  <strong>人数/身份设置</strong>
                </div>

                <label className="lobby-setting lobby-setting-compact">
                  <span>席位数</span>
                  <select
                    disabled={!self.is_host || busyKey !== null}
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
                    disabled={!self.is_host || busyKey !== null}
                    onChange={(event) => void handleRoleRotationToggle(event.target.checked)}
                    type="checkbox"
                  />
                  <div>
                    <strong>每轮队内身份轮换</strong>
                  </div>
                </label>
              </div>

              <div className="lobby-settings-block lobby-settings-timers">
                <div className="lobby-settings-head">
                  <strong>各阶段时间设置</strong>
                </div>

                {([
                  { phase: 'encrypt', label: '加密阶段', value: lobbyTimerSettings.encryptMinutes },
                  { phase: 'decode', label: '解密阶段', value: lobbyTimerSettings.decodeMinutes },
                  { phase: 'intercept', label: '拦截阶段', value: lobbyTimerSettings.interceptMinutes },
                ] as Array<{ phase: TimedPhase; label: string; value: number }>).map((item) => (
                  <label className="lobby-setting lobby-setting-inline" key={item.phase}>
                    <span>{item.label}</span>
                    <select
                      disabled={!self.is_host || busyKey !== null}
                      onChange={(event) => void handleLobbyTimerChange(item.phase, Number(event.target.value))}
                      value={item.value}
                    >
                      {LOBBY_TIMER_MINUTE_OPTIONS.map((option) => (
                        <option key={`${item.phase}-${option}`} value={option}>
                          {option} 分钟
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>

              <div className="lobby-settings-block lobby-settings-catalog">
                <div className="lobby-settings-head">
                  <div>
                    <strong>Bangumi 动画词库</strong>
                    <p className="muted lobby-settings-copy">支持用户 ID、收藏夹页面链接或目录链接，多个来源取交集。</p>
                  </div>

                  {self.is_host ? (
                    <button
                      className="outline-button"
                      disabled={busyKey !== null}
                      onClick={openBangumiCatalogModal}
                      type="button"
                    >
                      {isLoadingBangumiCatalog ? '载入中...' : '载入 Bangumi 动画词库'}
                    </button>
                  ) : (
                    <span className="muted lobby-settings-note">房主可更新词库</span>
                  )}
                </div>

                <div className="catalog-summary-row">
                  <div className="catalog-summary-grid">
                    <div className="tag">{bangumiCatalogSummary.configured ? '已配置' : '未配置'}</div>
                    <div className="tag">来源数：{bangumiCatalogSummary.userCount}</div>
                    <div className="tag">交集词数：{bangumiCatalogSummary.wordCount}</div>
                  </div>

                  <div className="catalog-actions">
                    {bangumiCatalogSummary.configured ? (
                      <button className="ghost-button" onClick={openBangumiCatalogBrowser} type="button">
                        浏览词库
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

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

            <section className="spectator-panel">
              <div className="spectator-panel-main">
                <div>
                  <h3>观战区</h3>
                </div>
                <div className="spectator-list">
                  {spectatorPlayers.length > 0 ? (
                    spectatorPlayers.map((player) => (
                      <span className={cn('spectator-chip', player.id === self.id && 'spectator-chip-self')} key={player.id}>
                        {player.player_name}
                      </span>
                    ))
                  ) : (
                    <span className="spectator-empty">暂无观战玩家</span>
                  )}
                </div>
              </div>
              {isSpectator ? (
                <button className="ghost-button" disabled={busyKey !== null} onClick={() => void handleExitSpectator()} type="button">
                  退出观战
                </button>
              ) : (
                <button className="primary-button" disabled={busyKey !== null} onClick={() => void handleJoinSpectator()} type="button">
                  加入观战
                </button>
              )}
            </section>

            <div className="seat-action-row">
              {self.team && self.team_seat ? (
                <button className="ghost-button" disabled={busyKey !== null} onClick={() => void handleStandUp()} type="button">
                  站起
                </button>
              ) : null}

              {self.is_host ? (
                <button
                  className="ghost-button"
                  disabled={!hasSeatedPlayers || busyKey !== null}
                  onClick={() => void handleClearAllSeats()}
                  type="button"
                >
                  全体站起
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
            </article>

            <article className="panel">
              <div className="roster-panel-head">
                <h2>房间玩家</h2>
                {self.is_host && snapshot.room.phase === 'lobby' ? (
                  <button
                    className="ghost-button roster-transfer-button"
                    disabled={hostTransferCandidates.length === 0 || busyKey !== null}
                    onClick={() => setHostTransferDialogOpen(true)}
                    type="button"
                  >
                    转让房主
                  </button>
                ) : null}
              </div>
              <div className="roster-list">
                {rosterPlayers.map((player) => (
                  <div className="roster-item" key={player.id}>
                    <div>
                      <strong>{player.player_name}</strong>
                      <p>{player.is_host ? '房主' : '成员'}</p>
                    </div>
                    <div className="roster-item-side">
                      <div className="tag-row">
                      <span className="tag">{player.is_spectator ? '观战' : player.team ? displayTeamName(player.team) : '未入队'}</span>
                      <span className={cn('tag', player.role && `tag-role-${player.role}`)}>
                        {player.is_spectator ? '观战者' : player.role ? roleName(player.role) : '未选座位'}
                      </span>
                      </div>
                      {self.is_host && player.id !== self.id ? (
                        snapshot.room.phase === 'lobby' ? (
                          <button
                            className="danger-button roster-kick-button"
                            disabled={busyKey !== null}
                            onClick={() => void handleKickPlayer(player)}
                            type="button"
                          >
                            踢出
                          </button>
                        ) : null
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <footer className="home-footer" aria-label="相关信息">
            <div className="home-footer-grid">
              <HomeFooterLinkItem href={VIDEO_INTRO_URL} icon="video" label="视频介绍" />
              <HomeFooterLinkItem href={GAME_RULES_URL} icon="rules" label="文字规则" />
              <HomeFooterLinkItem href={GITHUB_REPO_URL} icon="github" label="Github 仓库" />
              <HomeFooterLinkItem href={FEEDBACK_QQ_GROUP_URL} icon="group" label="交流反馈Q群" />
              <HomeFooterLinkItem
                href={OTHER_GAME_URL}
                icon="spark"
                label="作者其他动漫高手游戏：一眼顶针"
                tooltip="即将公布，敬请期待"
                wide
              />
            </div>
          </footer>
        </>
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
                  {isSpectator ? <span className="identity-role">观战视角</span> : self.role ? <span className="identity-role">{roleName(self.role)}</span> : null}
                  {self.is_host ? <span className="identity-host-badge">房主</span> : null}
                </div>
                <h2>{actionTitle}</h2>
                <p className="action-hint">{effectiveActionHint}</p>
              </div>

              {isSpectator ? (
                <button
                  className="primary-button"
                  disabled={busyKey !== null}
                  onClick={() => setSpectatorTeamView((current) => otherTeam(current))}
                  type="button"
                >
                  切换{displayTeamName(otherTeam(spectatorTeamView))}视角
                </button>
              ) : canEditWordAssignment ? (
                <div className="action-header-actions">
                  <button
                    className="ghost-button"
                    disabled={busyKey !== null || !canRequestTeamWordFeedback}
                    onClick={() => void handleRequestTeamWordFeedback()}
                    type="button"
                  >
                    询问队友
                  </button>
                  <button className="primary-button" disabled={busyKey !== null} onClick={() => void handleConfirmWords()} type="button">
                    确认词语
                  </button>
                </div>
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
                  返回房间大厅
                </button>
              ) : (
                <button className="primary-button" disabled type="button">
                  等待中
                </button>
              )}
            </div>

            <div className="action-body">
              <div className="action-body-main">
                {canViewWordAssignment ? (
                  <div className="action-lines">
                    <div className="action-line-head action-line-word-assignment">
                      <div className="action-line-head-cell">词语</div>
                      {showsDualWordColumns ? (
                        <div className="action-line-head-word-pair">
                          <div className="action-line-head-cell">动画名</div>
                          <div className="action-line-head-cell">角色名</div>
                        </div>
                      ) : (
                        <div className="action-line-head-cell">填写词语</div>
                      )}
                      <div className="action-line-head-cell">
                        {latestTeamWordFeedbackRequest
                          ? isLatestTeamWordFeedbackCurrent
                            ? `反馈 ${latestTeamWordFeedbackRequest.request_number}`
                            : '反馈已过期'
                          : '反馈'}
                      </div>
                    </div>

                    {teamWordSlotsDraft.map((slot, index) => {
                      const slotResponses = teamWordFeedbackResponses.filter((entry) => entry.slot_index === index);
                      const responseByPlayerId = Object.fromEntries(
                        slotResponses.map((entry) => [entry.player_id, entry]),
                      ) as Record<string, TeamWordFeedbackResponseRecord>;
                      const acceptedNames = slotResponses
                        .filter((entry) => entry.accepted)
                        .map((entry) => teamWordFeedbackPlayerById[entry.player_id]?.player_name ?? '队友');
                      const rejectedNames = slotResponses
                        .filter((entry) => !entry.accepted)
                        .map((entry) => teamWordFeedbackPlayerById[entry.player_id]?.player_name ?? '队友');
                      const pendingNames = myTeamFeedbackPlayers
                        .filter((player) => !responseByPlayerId[player.id])
                        .map((player) => player.player_name);
                      const draftFeedback = currentTeamWordFeedbackDraft[index];

                      return (
                        <div className="action-line action-line-word-assignment" key={`team-word-${index}`}>
                          <span className={cn('code-word', 'code-word-compact', `code-word-${teamTone(myTeam)}`)}>
                            <b>{index + 1}</b>
                          </span>
                          <div
                            className={cn('team-word-control', canReplaceGeneratedWords && 'team-word-control-with-replace')}
                            key={`team-word-control-${teamWordDraftMode}-${index}`}
                          >
                            {teamWordDraftMode === 'characters' && slotShowsSourceTitle(slot) ? (
                              <div className="team-word-pair">
                                <input
                                  key={`team-word-title-${teamWordDraftMode}-${index}`}
                                  disabled={isWordAssignmentReadOnly || teamWordDraftMode === 'characters'}
                                  maxLength={48}
                                  onChange={(event) => updateTeamWordTitle(index, event.target.value)}
                                  placeholder={`动画名 ${index + 1}`}
                                  title={slot.sourceTitle ?? ''}
                                  value={slot.sourceTitle ?? ''}
                                />
                                {teamWordDraftMode === 'characters' ? (
                                  <select
                                    key={`team-word-select-${index}`}
                                    disabled={isWordAssignmentReadOnly}
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
                                    disabled={isWordAssignmentReadOnly}
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
                                disabled={isWordAssignmentReadOnly}
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
                                  disabled={isWordAssignmentReadOnly}
                                  maxLength={48}
                                  onChange={(event) => updateTeamWordTitle(index, event.target.value)}
                                  placeholder={`动画名 ${index + 1}`}
                                  title={slot.sourceTitle ?? ''}
                                  value={slot.sourceTitle ?? ''}
                                />
                                <input
                                  key={`team-word-input-dual-${teamWordDraftMode}-${index}`}
                                  disabled={isWordAssignmentReadOnly}
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
                                disabled={
                                  isWordAssignmentReadOnly || teamWordDraftMode === 'generated' || teamWordDraftMode === 'characters'
                                }
                                onChange={(event) => updateTeamWord(index, event.target.value)}
                                placeholder={`填写第 ${index + 1} 个词语`}
                                title={slot.text}
                                value={slot.text}
                              />
                            )}
                            {canReplaceGeneratedWords ? (
                              <button
                                className="ghost-button team-word-replace-button"
                                disabled={isWordAssignmentReadOnly || busyKey !== null}
                                onClick={() => void handleReplaceTeamWord(index)}
                                type="button"
                              >
                                更换
                              </button>
                            ) : null}
                          </div>
                          <div className="word-feedback-inline">
                            {latestTeamWordFeedbackRequest && isLatestTeamWordFeedbackCurrent ? (
                              canSubmitTeamWordFeedback ? (
                                <div className="word-feedback-choice" role="group" aria-label={`第 ${index + 1} 个词反馈`}>
                                  <button
                                    className={cn(
                                      'word-feedback-choice-button',
                                      'word-feedback-choice-yes',
                                      draftFeedback === true && 'word-feedback-choice-selected',
                                    )}
                                    disabled={busyKey !== null}
                                    onClick={() => updateTeamWordFeedbackDraft(index, true)}
                                    title="这个词能用"
                                    type="button"
                                  >
                                    ✓
                                  </button>
                                  <button
                                    className={cn(
                                      'word-feedback-choice-button',
                                      'word-feedback-choice-no',
                                      draftFeedback === false && 'word-feedback-choice-selected',
                                    )}
                                    disabled={busyKey !== null}
                                    onClick={() => updateTeamWordFeedbackDraft(index, false)}
                                    title="这个词不合适"
                                    type="button"
                                  >
                                    ×
                                  </button>
                                </div>
                              ) : (
                                <div className="word-feedback-summary">
                                  <span className="word-feedback-badge word-feedback-badge-yes" title={acceptedNames.join('、')}>
                                    ✓ {acceptedNames.length}
                                  </span>
                                  <span className="word-feedback-badge word-feedback-badge-no" title={rejectedNames.join('、')}>
                                    × {rejectedNames.length}
                                  </span>
                                  <span className="word-feedback-badge word-feedback-badge-pending" title={pendingNames.join('、')}>
                                    待 {pendingNames.length}
                                  </span>
                                </div>
                              )
                            ) : (
                              <span className="word-feedback-inline-empty">
                                {latestTeamWordFeedbackRequest ? '已过期' : canEditWordAssignment ? '未询问' : '待询问'}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {canSubmitTeamWordFeedback ? (
                      <div className="word-feedback-submit-row">
                        <button
                          className="primary-button word-feedback-submit-button"
                          disabled={busyKey !== null || !canSubmitTeamWordFeedbackDraft}
                          onClick={() => void handleSubmitTeamWordFeedbackDraft()}
                          type="button"
                        >
                          提交反馈
                        </button>
                      </div>
                    ) : null}

                    <div className="assignment-toolbar">
                      <button
                        className="ghost-button"
                        disabled={isWordAssignmentReadOnly || busyKey !== null}
                        onClick={() => void handleGenerateWords()}
                        type="button"
                      >
                        随机生成动画标题
                      </button>
                      <button
                        className="ghost-button"
                        disabled={isWordAssignmentReadOnly || busyKey !== null || !canExtractTeamWordCharacters}
                        onClick={() => void handleExtractCharacters()}
                        type="button"
                      >
                        提取动画主要角色
                      </button>
                      <button
                        className="ghost-button"
                        disabled={isWordAssignmentReadOnly || busyKey !== null || !canToggleSourceTitles}
                        onClick={handleToggleSourceTitles}
                        type="button"
                      >
                        {canOmitSourceTitles ? '删去动画名' : '补充动画名'}
                      </button>
                      <button
                        className="ghost-button"
                        disabled={isWordAssignmentReadOnly || busyKey !== null}
                        onClick={handleManualEdit}
                        type="button"
                      >
                        手动编辑
                      </button>
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
                      {canSkipFirstIntercept ? '由于第一轮没有对方信息，房主点击左方按钮跳过第一轮拦截' : '等待房主跳过第一轮拦截'}
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
                    <strong>{centerStatusText}</strong>
                  </div>
                )}
              </div>

              <aside className="action-progress">
                <div
                  className={cn(
                    'action-progress-block',
                    'action-progress-block-timer',
                    activeTimedPhase === null && 'action-progress-block-timer-idle',
                    countdownExpired && 'action-progress-block-timer-expired',
                  )}
                >
                  <span>{countdownTitle}</span>
                  <strong>{countdownText}</strong>
                  {countdownExpired ? <small>请尽快确认</small> : <small>&nbsp;</small>}
                </div>
                <div className="action-progress-block">
                  <span>进度</span>
                  <strong>{effectiveProgressText}</strong>
                </div>
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
                          : hasMyTeamWordPreview
                            ? '本队词语实时预览'
                            : '待本队加密者生成词语'}
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
                      {isWordAssignmentPhase && !myTeamConfirmed && !hasMyTeamWordPreview
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
                      ? myTeamConfirmed || canViewWordAssignment
                        ? '词语确认后，将从这里开始积累我方线索记录'
                        : '待本队加密者生成词语'
                      : '结算后会按轮次对齐显示我方线索'}
                  </div>
                )}
              </div>

              <section className="record-block" id="round-records">
                <div className="record-block-header">
                  <div className="record-block-header-main">
                    <h3>我方轮次记录</h3>
                    <button
                      className="ghost-button record-toggle-button"
                      onClick={() => setShowAllRoundRecords((current) => !current)}
                      type="button"
                    >
                      {showAllRoundRecords ? '隐藏信息' : '显示全部'}
                    </button>
                  </div>
                </div>
                <div className="record-table">
                  <div className="record-row record-head">
                    <span>轮次</span>
                    <span>线索</span>
                    <span>正确密码</span>
                    <span>我方解密</span>
                    <span>对方拦截</span>
                  </div>
                  {visibleMySubmissions.map((entry) => (
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
                      {isFinishedPhase
                        ? renderTeamWordDisplay(
                            opponentTeamWordSlots[number - 1] ?? emptyTeamWordSlot(),
                            opponentTeamWords[number - 1]?.trim() || '待公开',
                            String(number),
                          )
                        : renderOpponentWordDisplay(number, '??', false)}
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
                  <div className="record-block-header-main">
                    <h3>对方轮次记录</h3>
                    <button
                      className="ghost-button record-toggle-button"
                      onClick={() => setShowAllRoundRecords((current) => !current)}
                      type="button"
                    >
                      {showAllRoundRecords ? '隐藏信息' : '显示全部'}
                    </button>
                  </div>
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
                  {visibleOpponentSubmissions.map((entry) => (
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

          <section className="game-footer-actions">
            <small className="game-footer-note">页面切换刷新偶尔会失败，请尝试按F5手动刷新</small>
            {canTerminateCurrentGame ? (
              <button className="danger-button" disabled={busyKey !== null} onClick={() => void handleTerminateGame()} type="button">
                终止游戏
              </button>
            ) : null}
          </section>
        </>
      )}

      {hostTransferDialogOpen && snapshot?.room.phase === 'lobby' && self?.is_host ? (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget && busyKey === null) {
              setHostTransferDialogOpen(false);
            }
          }}
          role="presentation"
        >
          <section aria-modal="true" className="modal-card modal-card-settings" role="dialog">
            <div className="modal-card-head">
              <div>
                <h2>转让房主</h2>
                <p className="muted">选择一名玩家接管房间管理权限。</p>
              </div>
              <button
                className="ghost-button"
                disabled={busyKey !== null}
                onClick={() => setHostTransferDialogOpen(false)}
                type="button"
              >
                关闭
              </button>
            </div>

            <div className="host-transfer-list">
              {hostTransferCandidates.map((player) => (
                <button
                  className="host-transfer-option"
                  disabled={busyKey !== null}
                  key={player.id}
                  onClick={() => void handleTransferHost(player)}
                  type="button"
                >
                  <span>
                    <strong>{player.player_name}</strong>
                    <small>{player.is_spectator ? '观战者' : player.role ? roleName(player.role) : '未选座位'}</small>
                  </span>
                  <span className="tag">{player.is_spectator ? '观战' : player.team ? displayTeamName(player.team) : '未入队'}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {lobbySettingsModalOpen ? (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget && busyKey === null) {
              setLobbySettingsModalOpen(false);
            }
          }}
          role="presentation"
        >
          <section aria-modal="true" className="modal-card modal-card-settings" role="dialog">
            <div className="modal-card-head">
              <div>
                <h2>其他设置</h2>
                <p className="muted">调整本局的获胜规则。只有房主能在选座大厅修改。</p>
              </div>
              <button
                className="ghost-button"
                disabled={busyKey !== null}
                onClick={() => setLobbySettingsModalOpen(false)}
                type="button"
              >
                关闭
              </button>
            </div>

            <div className="modal-form-stack">
              <div className="settings-mode-grid" role="radiogroup" aria-label="容错模式">
                <section className={cn('settings-mode-card', !lifeModeEnabled && 'settings-mode-card-active')}>
                  <label className="settings-mode-choice">
                    <input
                      checked={!lifeModeEnabled}
                      disabled={!self?.is_host || busyKey !== null}
                      name="fault-mode"
                      onChange={() => void handleLifeModeToggle(false)}
                      type="radio"
                    />
                    <span>
                      <strong>经典模式</strong>
                      <small>拦截2次获胜，失误达到上限则败北</small>
                    </span>
                  </label>

                  <label className="settings-inline-select">
                    <span>失误上限</span>
                    <select
                      disabled={!self?.is_host || busyKey !== null || lifeModeEnabled}
                      onChange={(event) => void handleMiscommunicationLimitChange(Number(event.target.value))}
                      value={miscommunicationLimit}
                    >
                      {MISCOMMUNICATION_LIMIT_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option} 次
                        </option>
                      ))}
                    </select>
                  </label>
                </section>

                <section className={cn('settings-mode-card', lifeModeEnabled && 'settings-mode-card-active')}>
                  <label className="settings-mode-choice">
                    <input
                      checked={lifeModeEnabled}
                      disabled={!self?.is_host || busyKey !== null}
                      name="fault-mode"
                      onChange={() => void handleLifeModeToggle(true)}
                      type="radio"
                    />
                    <span>
                      <strong>生命模式</strong>
                      <small>失误或被拦截扣生命</small>
                    </span>
                  </label>

                  <label className="settings-inline-select">
                    <span>生命值</span>
                    <select
                      disabled={!self?.is_host || busyKey !== null || !lifeModeEnabled}
                      onChange={(event) => void handleLifePointsChange(Number(event.target.value))}
                      value={lifePoints}
                    >
                      {LIFE_POINT_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option} 点
                        </option>
                      ))}
                    </select>
                  </label>
                </section>
              </div>

              <label className="settings-toggle-row">
                <input
                  checked={snapshot.room.allow_midgame_join}
                  disabled={!self?.is_host || busyKey !== null}
                  onChange={(event) => void handleMidgameJoinToggle(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  <strong>允许中途加入</strong>
                  <small>开启后，游戏中有空位的队伍允许新玩家以队员身份加入</small>
                </span>
              </label>
            </div>
          </section>
        </div>
      ) : null}

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
                <p className="muted">填写<strong>用户 ID</strong>（推荐）或<strong>收藏夹链接</strong>或<strong>目录链接</strong></p>
                <p className="muted">支持填写多个用户/目录，词库将取<strong>交集</strong></p>
                <p className="muted">用户收藏夹可按如下按钮进行过滤</p>
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
                    placeholder="例如：123456 或 https://bangumi.tv/anime/list/123456"
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
                新增词库来源
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
