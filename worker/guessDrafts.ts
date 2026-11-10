import type { PlayerRecord, RoomRecord, RoundSubmissionRecord } from '../src/types';
import type { GuessDraftChoice, GuessDraftStateEvent, GuessDraftTeamState } from '../src/types/guessDraft';
import { canSuggestGuess, guessDraftSeatKey, guessDraftTask, isGuessDraftDigits } from '../src/lib/guessDraftModel';

export interface GuessDraftContext {
  room: RoomRecord;
  players: PlayerRecord[];
  submissions: RoundSubmissionRecord[];
}

interface StoredChoice extends GuessDraftChoice { seatKey: string }

// Deliberately separate from RoomState: no DO storage, D1, alarms, or action journal.
export class GuessDrafts {
  readonly epoch = crypto.randomUUID();
  private fingerprint: string | null = null;
  private tasks: GuessDraftTeamState[] = [];
  private readonly choices = new Map<string, StoredChoice>();

  reconcile(context: GuessDraftContext): { changed: boolean; requestSync: boolean } {
    const tasks = (['A', 'B'] as const).flatMap((team) => {
      const task = guessDraftTask(context.room, context.players, context.submissions, team);
      return task ? [{ task, choices: [] }] : [];
    });
    const fingerprint = JSON.stringify([tasks, context.players.map(guessDraftSeatKey).sort()]);
    const initial = this.fingerprint === null;
    const changed = fingerprint !== this.fingerprint;
    this.fingerprint = fingerprint;
    this.tasks = tasks;
    for (const [key, choice] of this.choices) {
      const player = context.players.find((entry) => entry.id === choice.playerId);
      const task = tasks.find((entry) => key === `${entry.task.key}:${choice.playerId}`)?.task;
      if (!task || task.locked || !player || player.team !== task.team ||
        !canSuggestGuess(player, task.phase) || choice.seatKey !== guessDraftSeatKey(player)) this.choices.delete(key);
    }
    return { changed, requestSync: initial || changed };
  }

  update(context: GuessDraftContext, userId: string, payload: Record<string, unknown>): boolean {
    const player = context.players.find((entry) => entry.auth_user_id === userId);
    const task = this.tasks.find((entry) => entry.task.key === payload.taskKey)?.task;
    if (!player || !task || task.locked || player.team !== task.team || !canSuggestGuess(player, task.phase) ||
      !isGuessDraftDigits(payload.digits) || typeof payload.updatedAt !== 'number' ||
      !Number.isFinite(payload.updatedAt) || payload.updatedAt <= 0 || payload.updatedAt > Date.now() + 60_000) return false;
    const key = `${task.key}:${player.id}`;
    const previous = this.choices.get(key);
    if (previous && previous.updatedAt >= payload.updatedAt) return false;
    this.choices.set(key, {
      playerId: player.id,
      digits: [...payload.digits],
      updatedAt: payload.updatedAt,
      seatKey: guessDraftSeatKey(player),
    });
    return true;
  }

  event(context: GuessDraftContext, userId: string, requestSync = false): GuessDraftStateEvent | null {
    const player = context.players.find((entry) => entry.auth_user_id === userId);
    if (!player) return null;
    return {
      type: 'guess_draft_state', roomId: context.room.id, epoch: this.epoch, requestSync,
      teams: this.tasks.filter(({ task }) => player.is_spectator || player.team === task.team).map(({ task }) => ({
        task,
        choices: task.locked ? [] : context.players.flatMap((entry) => {
          const choice = this.choices.get(`${task.key}:${entry.id}`);
          return choice ? [{ playerId: choice.playerId, digits: choice.digits, updatedAt: choice.updatedAt }] : [];
        }),
      })),
    };
  }
}
