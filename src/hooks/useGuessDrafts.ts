import { useCallback, useEffect, useRef, useState } from 'react';
import { USE_COLLABORATIVE_GUESS_INPUT } from '../config/features';
import { canSuggestGuess, guessDraftSeatKey, guessDraftTask } from '../lib/guessDraftModel';
import { clearGuessDraft, loadGuessDraft, saveGuessDraft, type LocalGuessDraft } from '../lib/guessDraftStorage';
import type { PlayerRecord, RoomSnapshot, Team } from '../types';
import type { GuessDraftClientEvent, GuessDraftDigits, GuessDraftStateEvent } from '../types/guessDraft';

export function useGuessDrafts(
  snapshot: RoomSnapshot | null,
  self: PlayerRecord | null,
  team: Team,
  connected: boolean,
  send: (event: GuessDraftClientEvent) => boolean,
  serverClockOffsetMs: number,
) {
  const [event, setEvent] = useState<GuessDraftStateEvent | null>(null);
  const [local, setLocal] = useState<LocalGuessDraft | null>(null);
  const previousPlayer = useRef<{ roomId: string; playerId: string } | null>(null);
  const latest = useRef({ snapshot, self, send, serverClockOffsetMs });
  latest.current = { snapshot, self, send, serverClockOffsetMs };
  const task = snapshot ? guessDraftTask(snapshot.room, snapshot.players, snapshot.submissions, team, Date.now() + serverClockOffsetMs) : null;
  const canEdit = Boolean(USE_COLLABORATIVE_GUESS_INPUT && task && !task.locked && self &&
    self.team === team && canSuggestGuess(self, task.phase));

  const handleEvent = useCallback((next: GuessDraftStateEvent) => {
    if (!USE_COLLABORATIVE_GUESS_INPUT) return;
    const { snapshot: current, self: player, send: sendCurrent, serverClockOffsetMs: clockOffset } = latest.current;
    if (!current || next.roomId !== current.room.id) return;
    setEvent(next);
    if (!player || player.is_spectator || !player.team) return;
    const state = next.teams.find((entry) => entry.task.team === player.team);
    const predicted = guessDraftTask(current.room, current.players, current.submissions, player.team, Date.now() + clockOffset);
    // A phase snapshot may still be in flight. Its effect will request a fresh state.
    if (!state || !predicted || state.task.key !== predicted.key) return;
    const stored = loadGuessDraft(current.room.id, player.id);
    if (state.task.locked || !canSuggestGuess(player, state.task.phase)) {
      clearGuessDraft(current.room.id, player.id); setLocal(null); return;
    }
    const own = state.choices.find((choice) => choice.playerId === player.id);
    const validStored = stored?.taskKey === state.task.key && stored.seatKey === guessDraftSeatKey(player) ? stored : null;
    if (own && (!validStored || own.updatedAt >= validStored.updatedAt)) {
      const value = { ...own, taskKey: state.task.key, seatKey: guessDraftSeatKey(player) };
      saveGuessDraft(current.room.id, value); setLocal(value);
    } else if (next.requestSync && validStored) {
      setLocal(validStored);
      sendCurrent({ type: 'guess_draft_update', taskKey: validStored.taskKey, digits: validStored.digits, updatedAt: validStored.updatedAt });
    }
  }, []);

  useEffect(() => {
    if (!USE_COLLABORATIVE_GUESS_INPUT) return;
    const previous = previousPlayer.current;
    if (previous && (previous.roomId !== snapshot?.room.id || previous.playerId !== self?.id)) {
      clearGuessDraft(previous.roomId, previous.playerId);
    }
    previousPlayer.current = snapshot && self ? { roomId: snapshot.room.id, playerId: self.id } : null;
    if (!snapshot || !self) { setLocal(null); return; }
    const stored = loadGuessDraft(snapshot.room.id, self.id);
    if (!task || task.locked || !canEdit || stored?.taskKey !== task.key || stored.seatKey !== guessDraftSeatKey(self)) {
      clearGuessDraft(snapshot.room.id, self.id); setLocal(null);
    } else setLocal(stored);
    if (connected && task) send({ type: 'guess_draft_request' });
    // Only task/seat/connection changes trigger recovery, never ordinary incoming votes.
  }, [task?.key, task?.locked, snapshot?.room.id, self?.id, self?.role, self?.team_seat, connected, canEdit]);

  const state = event && event.roomId === snapshot?.room.id ? event.teams.find((entry) => entry.task.key === task?.key) : null;
  const choices = [...(state?.choices ?? [])];
  const ownLocal = local && local.taskKey === task?.key && self && local.seatKey === guessDraftSeatKey(self) ? local : null;
  const serverOwn = choices.find((choice) => choice.playerId === self?.id);
  if (ownLocal && !task?.locked && (!serverOwn || ownLocal.updatedAt > serverOwn.updatedAt)) {
    const index = choices.findIndex((choice) => choice.playerId === ownLocal.playerId);
    if (index >= 0) choices[index] = ownLocal;
    else choices.push(ownLocal);
  }
  const digits: GuessDraftDigits = choices.find((choice) => choice.playerId === self?.id)?.digits ?? ['', '', ''];

  function select(index: number, digit: string) {
    if (!canEdit || !task || !self || !snapshot || !connected) return;
    const next: GuessDraftDigits = [...digits];
    next[index] = next[index] === digit ? '' : digit;
    const previous = loadGuessDraft(snapshot.room.id, self.id);
    const value: LocalGuessDraft = {
      taskKey: task.key, seatKey: guessDraftSeatKey(self), playerId: self.id, digits: next,
      updatedAt: Math.max(Date.now() + serverClockOffsetMs, (previous?.updatedAt ?? 0) + 1),
    };
    saveGuessDraft(snapshot.room.id, value); setLocal(value);
    send({ type: 'guess_draft_update', taskKey: task.key, digits: next, updatedAt: value.updatedAt });
  }

  return { task, choices: task?.locked ? [] : choices, digits, canEdit: canEdit && connected, select, handleEvent };
}
