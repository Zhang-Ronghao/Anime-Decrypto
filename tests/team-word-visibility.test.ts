import assert from 'node:assert/strict';
import test from 'node:test';
import type { PlayerRecord, RoomPhase, Team } from '../src/types';
import { canSeeTeamWords } from '../worker/teamWordVisibility';

const teams: Team[] = ['A', 'B'];

function visibleTeams(viewer: Pick<PlayerRecord, 'is_spectator' | 'team'>, phase: RoomPhase): Team[] {
  return teams.filter((team) => canSeeTeamWords(team, viewer, phase));
}

test('active players only receive their own team words before the game finishes', () => {
  const viewer = { is_spectator: false, team: 'A' } satisfies Pick<PlayerRecord, 'is_spectator' | 'team'>;

  for (const phase of ['word_assignment', 'encrypt', 'decode', 'intercept', 'result'] as RoomPhase[]) {
    assert.deepEqual(visibleTeams(viewer, phase), ['A'], phase);
  }
});

test('finished games reveal both teams words to active players', () => {
  const viewer = { is_spectator: false, team: 'A' } satisfies Pick<PlayerRecord, 'is_spectator' | 'team'>;

  assert.deepEqual(visibleTeams(viewer, 'finished'), ['A', 'B']);
});

test('spectators receive both teams words for client-side team view switching', () => {
  const viewer = { is_spectator: true, team: null } satisfies Pick<PlayerRecord, 'is_spectator' | 'team'>;

  for (const phase of ['word_assignment', 'encrypt', 'decode', 'intercept', 'result', 'finished'] as RoomPhase[]) {
    assert.deepEqual(visibleTeams(viewer, phase), ['A', 'B'], phase);
  }
});
