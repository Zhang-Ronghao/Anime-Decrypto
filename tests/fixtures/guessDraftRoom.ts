import type { PlayerRecord, RoomRecord, RoomSnapshot, RoundSubmissionRecord, Team } from '../../src/types';

export function guessDraftFixture(phase: 'decode' | 'intercept' = 'decode') {
  const timestamp = '2026-11-10T00:00:00.000Z';
  const room: RoomRecord = {
    id: 'draft-test-room', room_code: 'DRAFTS', revision: 1, host_user_id: 'user-A-1', status: 'active', phase,
    round_number: 2, max_rounds: 8, seat_count: 14, role_rotation_enabled: false,
    encrypt_phase_minutes: 2, decode_phase_minutes: 2, intercept_phase_minutes: 2,
    force_phase_timeout_enabled: false, miscommunication_limit: 2, life_mode_enabled: false, life_points: 3,
    allow_midgame_join: true, bangumi_character_extract_enabled: false,
    phase_started_at: timestamp, phase_deadline_at: null, winner: null,
    score_team_a_intercepts: 0, score_team_b_intercepts: 0, score_team_a_miscomms: 1, score_team_b_miscomms: 0,
    team_a_words_confirmed: true, team_b_words_confirmed: true,
    bangumi_catalog_inputs: [], bangumi_catalog_types: [2], bangumi_catalog_merge_mode: 'intersection',
    bangumi_catalog_word_count: 0, bangumi_catalog_updated_at: null, bangumi_popular_catalog_limit: null,
    bangumi_popular_year_min: null, bangumi_popular_year_max: null, created_at: timestamp, updated_at: timestamp,
  };
  const players: PlayerRecord[] = (['A', 'B'] as Team[]).flatMap((team) => Array.from({ length: 7 }, (_, i) => ({
    id: `${team}-${i + 1}`, room_id: room.id, auth_user_id: `user-${team}-${i + 1}`,
    player_name: ['小红', '小明', '这是一个特别特别长的玩家昵称', '小李', '明日香', '星野', '小白'][i],
    team, role: i === 0 ? 'encoder' : i === 1 ? 'decoder' : 'member', team_seat: i + 1,
    is_spectator: false, is_host: team === 'A' && i === 0, connected: true, joined_at: timestamp,
  })));
  players.push({ ...players[0], id: 'spectator', auth_user_id: 'user-spectator', player_name: '观战者',
    team: null, role: null, team_seat: null, is_spectator: true, is_host: false });
  const submissions: RoundSubmissionRecord[] = (['A', 'B'] as Team[]).map((team) => ({
    id: `submission-${team}`, room_id: room.id, team, round_number: 2, clues: ['琴弦', '极光', '玻璃'],
    clues_auto_submitted: false, intercept_guess: null, intercept_guess_auto_submitted: false,
    own_guess: phase === 'intercept' ? '2-3-4' : null, own_guess_auto_submitted: false,
    revealed_code: null, intercept_correct: null, own_correct: null, resolved_at: null, created_at: timestamp, updated_at: timestamp,
  }));
  const snapshot: RoomSnapshot = {
    server_now: new Date().toISOString(), room, players, submissions,
    teamWords: (['A', 'B'] as Team[]).map((team) => ({ id: `words-${team}`, room_id: room.id, team,
      words: ['雷达', '琴键', '星轨', '沙丘'], seen_words: [], word_slots: [], confirmed: true, created_at: timestamp })),
    teamWordFeedbackRequests: [], teamWordFeedbackResponses: [], roundGuessFeedbackResponses: [], roundCodes: [],
  };
  return { ...snapshot, bangumiCatalogEntries: [] };
}
