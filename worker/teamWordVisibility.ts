import type { PlayerRecord, RoomPhase, Team } from '../src/types';

type TeamWordViewer = Pick<PlayerRecord, 'is_spectator' | 'team'>;

export function canSeeTeamWords(team: Team, viewer: TeamWordViewer, phase: RoomPhase): boolean {
  return phase === 'finished' || viewer.is_spectator || viewer.team === team;
}
