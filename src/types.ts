export type Team = 'A' | 'B';
export type Role = 'encoder' | 'decoder' | 'member';
export type BangumiCatalogMergeMode = 'intersection' | 'union';
export type RoomStatus = 'lobby' | 'active' | 'finished';
export type RoomPhase = 'lobby' | 'word_assignment' | 'encrypt' | 'decode' | 'intercept' | 'result' | 'finished';

export interface BangumiCatalogEntry {
  subjectId: number;
  title: string;
}

export interface TeamWordSlot {
  text: string;
  subjectId: number | null;
  sourceTitle: string | null;
  showSourceTitle: boolean;
  characterOptions: string[];
}

export interface RoomRecord {
  id: string;
  revision: number;
  room_code: string;
  host_user_id: string;
  status: RoomStatus;
  phase: RoomPhase;
  round_number: number;
  max_rounds: number;
  seat_count: number;
  role_rotation_enabled: boolean;
  encrypt_phase_minutes: number;
  decode_phase_minutes: number;
  intercept_phase_minutes: number;
  miscommunication_limit: number;
  life_mode_enabled: boolean;
  life_points: number;
  allow_midgame_join: boolean;
  bangumi_character_extract_enabled: boolean;
  phase_started_at: string | null;
  phase_deadline_at: string | null;
  winner: Team | null;
  score_team_a_intercepts: number;
  score_team_b_intercepts: number;
  score_team_a_miscomms: number;
  score_team_b_miscomms: number;
  team_a_words_confirmed: boolean;
  team_b_words_confirmed: boolean;
  bangumi_catalog_inputs: string[];
  bangumi_catalog_types: number[];
  bangumi_catalog_merge_mode: BangumiCatalogMergeMode;
  bangumi_catalog_word_count: number;
  bangumi_catalog_updated_at: string | null;
  bangumi_popular_catalog_limit: number | null;
  bangumi_popular_year_min: number | null;
  bangumi_popular_year_max: number | null;
  created_at: string;
  updated_at: string;
}

export interface PlayerRecord {
  id: string;
  room_id: string;
  auth_user_id: string;
  player_name: string;
  team: Team | null;
  role: Role | null;
  team_seat: number | null;
  is_spectator: boolean;
  is_host: boolean;
  connected: boolean;
  joined_at: string;
}

export interface TeamWordsRecord {
  id: string;
  room_id: string;
  team: Team;
  words: string[];
  seen_words: string[];
  word_slots: TeamWordSlot[];
  confirmed: boolean;
  created_at: string;
}

export interface TeamWordFeedbackRequestRecord {
  id: string;
  room_id: string;
  team: Team;
  request_number: number;
  requested_by_player_id: string;
  words: string[];
  word_slots: TeamWordSlot[];
  created_at: string;
}

export interface TeamWordFeedbackResponseRecord {
  id: string;
  request_id: string;
  room_id: string;
  team: Team;
  player_id: string;
  slot_index: number;
  accepted: boolean;
  created_at: string;
  updated_at: string;
}

export type RoundGuessFeedbackPhase = 'decode' | 'intercept';

export interface RoundGuessFeedbackResponseRecord {
  id: string;
  room_id: string;
  round_number: number;
  phase: RoundGuessFeedbackPhase;
  team: Team;
  target_team: Team;
  player_id: string;
  clue_index: number;
  guess_digit: string;
  created_at: string;
  updated_at: string;
}

export interface RoundCodeRecord {
  id: string;
  room_id: string;
  team: Team;
  round_number: number;
  encoder_player_id: string;
  code: string;
  created_at: string;
}

export interface RoundSubmissionRecord {
  id: string;
  room_id: string;
  team: Team;
  round_number: number;
  clues: string[] | null;
  intercept_guess: string | null;
  own_guess: string | null;
  revealed_code: string | null;
  intercept_correct: boolean | null;
  own_correct: boolean | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoomSnapshot {
  server_now: string;
  room: RoomRecord;
  players: PlayerRecord[];
  teamWords: TeamWordsRecord[];
  teamWordFeedbackRequests: TeamWordFeedbackRequestRecord[];
  teamWordFeedbackResponses: TeamWordFeedbackResponseRecord[];
  roundGuessFeedbackResponses: RoundGuessFeedbackResponseRecord[];
  roundCodes: RoundCodeRecord[];
  submissions: RoundSubmissionRecord[];
}

export interface RoomJoinStatus {
  room_id: string;
  room_code: string;
  status: RoomStatus;
  phase: RoomPhase;
  seat_count: number;
  allow_midgame_join: boolean;
  team_capacity: number;
  team_a_count: number;
  team_b_count: number;
  is_member: boolean;
}
