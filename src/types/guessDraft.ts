import type { RoundGuessFeedbackPhase, Team } from '../types';

export type GuessDraftDigits = [string, string, string];

export interface GuessDraftTask {
  key: string;
  roomId: string;
  roundNumber: number;
  phase: RoundGuessFeedbackPhase;
  team: Team;
  submitterId: string | null;
  locked: boolean;
}

export interface GuessDraftChoice {
  playerId: string;
  digits: GuessDraftDigits;
  updatedAt: number;
}

export interface GuessDraftTeamState {
  task: GuessDraftTask;
  choices: GuessDraftChoice[];
}

export interface GuessDraftStateEvent {
  type: 'guess_draft_state';
  roomId: string;
  epoch: string;
  requestSync: boolean;
  teams: GuessDraftTeamState[];
}

export interface GuessDraftUpdate {
  type: 'guess_draft_update';
  taskKey: string;
  digits: GuessDraftDigits;
  updatedAt: number;
}

export type GuessDraftClientEvent = GuessDraftUpdate | { type: 'guess_draft_request' };
