import type { RoomRecord, RoomSnapshot, RoundSubmissionRecord } from '../src/types';
import { discussionTarget } from '../src/lib/discussion';

/** Compute before filtering secrets; a hidden answer is not an unsubmitted answer. */
export function roomSubmissionProgress(
  room: RoomRecord,
  submissions: RoundSubmissionRecord[],
): RoomSnapshot['submissionProgress'] {
  const current = submissions.filter((entry) => entry.round_number === room.round_number);
  const red = current.find((entry) => entry.team === 'A');
  const blue = current.find((entry) => entry.team === 'B');

  switch (room.phase) {
    case 'word_assignment':
      return { A: room.team_a_words_confirmed, B: room.team_b_words_confirmed };
    case 'encrypt':
      return { A: red?.clues?.length === 3, B: blue?.clues?.length === 3 };
    case 'decode':
      return { A: Boolean(red?.own_guess), B: Boolean(blue?.own_guess) };
    case 'intercept':
      // Intercept answers live on the target team's record, not the submitting team's.
      return room.round_number === 1 ? null : {
        A: Boolean(blue?.intercept_guess), B: Boolean(red?.intercept_guess),
      };
    case 'discuss': {
      const target = discussionTarget(room);
      if (target === 'A') return { A: Boolean(red?.own_guess), B: Boolean(red?.intercept_guess) };
      if (target === 'B') return { A: Boolean(blue?.intercept_guess), B: Boolean(blue?.own_guess) };
      return null;
    }
    default:
      return null;
  }
}
