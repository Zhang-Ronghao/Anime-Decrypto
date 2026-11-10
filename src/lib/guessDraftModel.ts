import type { PlayerRecord, RoomRecord, RoundSubmissionRecord, Team } from '../types';
import type { GuessDraftDigits, GuessDraftTask } from '../types/guessDraft';

export function isGuessDraftDigits(value: unknown): value is GuessDraftDigits {
  return Array.isArray(value) && value.length === 3 && value.every((digit) => ['', '1', '2', '3', '4'].includes(digit));
}

export function canSuggestGuess(player: PlayerRecord, phase: GuessDraftTask['phase']): boolean {
  return !player.is_spectator && Boolean(player.team) &&
    (phase === 'decode' ? player.role === 'decoder' || player.role === 'member' : Boolean(player.role));
}

export function guessDraftSeatKey(player: PlayerRecord): string {
  return `${player.id}:${player.team}:${player.role}:${player.team_seat}`;
}

export function guessDraftTask(
  room: RoomRecord,
  players: PlayerRecord[],
  submissions: RoundSubmissionRecord[],
  team: Team,
  now = Date.now(),
): GuessDraftTask | null {
  if (room.status !== 'active' || (room.phase !== 'decode' && room.phase !== 'intercept') ||
    (room.phase === 'intercept' && room.round_number === 1)) return null;
  const target = room.phase === 'decode' ? team : team === 'A' ? 'B' : 'A';
  const submission = submissions.find((entry) => entry.team === target && entry.round_number === room.round_number);
  if (submission?.clues?.length !== 3) return null;
  const submitter = players.find((player) => !player.is_spectator && player.team === team &&
    player.role === (room.phase === 'decode' ? 'decoder' : 'encoder'));
  const expired = room.force_phase_timeout_enabled && room.phase_deadline_at && now >= Date.parse(room.phase_deadline_at);
  return {
    key: `${room.id}:${submission.id}:${room.phase}:${room.phase_started_at}:${team}:${submitter?.id ?? ''}`,
    roomId: room.id,
    roundNumber: room.round_number,
    phase: room.phase,
    team,
    submitterId: submitter?.id ?? null,
    locked: Boolean(expired || (room.phase === 'decode' ? submission.own_guess : submission.intercept_guess)),
  };
}
