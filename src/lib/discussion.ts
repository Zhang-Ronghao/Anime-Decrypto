import type { RoomRecord, RoundGuessFeedbackPhase, Team } from '../types';

/** The room has one discussion target; each team has a different task within it. */
export function discussionTarget(room: RoomRecord): Team | null {
  return room.phase === 'discuss' && room.discussion_mode === 'sequential' && room.round_number > 1 &&
    (room.discussion_team === 'A' || room.discussion_team === 'B') ? room.discussion_team : null;
}

export function guessPhaseForTeam(room: RoomRecord, team: Team): RoundGuessFeedbackPhase | null {
  const target = discussionTarget(room);
  if (target) return team === target ? 'decode' : 'intercept';
  return room.phase === 'decode' || room.phase === 'intercept' ? room.phase : null;
}
