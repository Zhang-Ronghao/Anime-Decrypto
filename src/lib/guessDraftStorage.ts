import { isGuessDraftDigits } from './guessDraftModel';
import type { GuessDraftChoice } from '../types/guessDraft';

export interface LocalGuessDraft extends GuessDraftChoice { taskKey: string; seatKey: string }
type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const storageKey = (roomId: string, playerId: string) => `decrypto-guess-draft:${roomId}:${playerId}`;

export function loadGuessDraft(roomId: string, playerId: string, storage: DraftStorage = sessionStorage): LocalGuessDraft | null {
  try {
    const value = JSON.parse(storage.getItem(storageKey(roomId, playerId)) ?? 'null');
    return value?.playerId === playerId && typeof value.taskKey === 'string' && typeof value.seatKey === 'string' &&
      isGuessDraftDigits(value.digits) && Number.isFinite(value.updatedAt) && value.updatedAt > 0 ? value : null;
  } catch { return null; }
}

export function saveGuessDraft(roomId: string, value: LocalGuessDraft, storage: DraftStorage = sessionStorage): void {
  try { storage.setItem(storageKey(roomId, value.playerId), JSON.stringify(value)); } catch { /* Private browsing/storage quota. */ }
}

export function clearGuessDraft(roomId: string, playerId: string, storage: DraftStorage = sessionStorage): void {
  try { storage.removeItem(storageKey(roomId, playerId)); } catch { /* Storage may be unavailable. */ }
}
