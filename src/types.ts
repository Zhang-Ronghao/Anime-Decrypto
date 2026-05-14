export type Team = 'A' | 'B';
export type Role = 'encoder' | 'decoder' | 'member';
export type RoomStatus = 'lobby' | 'active' | 'finished';
export type RoomPhase = 'lobby' | 'word_assignment' | 'encrypt' | 'decode' | 'intercept' | 'result' | 'finished';

export interface RoomRecord {
  id: string;
  room_code: string;
  host_user_id: string;
  status: RoomStatus;
  phase: RoomPhase;
  round_number: number;
  max_rounds: number;
  seat_count: number;
  role_rotation_enabled: boolean;
  winner: Team | null;
  score_team_a_intercepts: number;
  score_team_b_intercepts: number;
  score_team_a_miscomms: number;
  score_team_b_miscomms: number;
  team_a_words_confirmed: boolean;
  team_b_words_confirmed: boolean;
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
  is_host: boolean;
  connected: boolean;
  joined_at: string;
}

export interface TeamWordsRecord {
  id: string;
  room_id: string;
  team: Team;
  words: string[];
  confirmed: boolean;
  created_at: string;
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
  room: RoomRecord;
  players: PlayerRecord[];
  teamWords: TeamWordsRecord[];
  roundCodes: RoundCodeRecord[];
  submissions: RoundSubmissionRecord[];
}
