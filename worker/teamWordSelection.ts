import type { Team, TeamWordSlot } from '../src/types';

export interface TeamWordSelectionState {
  id: string;
  team: Team;
  candidates: TeamWordSlot[];
  exclusions: Record<string, number[]>;
  completed: boolean;
  unfamiliar_by_word: Record<string, number>;
}

function compare(left: number[], right: number[]): number {
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

/** Fill lower exclusion tiers first, then minimize the worst individual burden.
 * Reservoir sampling treats equally good combinations uniformly; the final
 * shuffle also prevents a word's position from revealing its exclusion tier.
 */
export function selectCandidateIndices(
  candidateCount: number,
  exclusions: number[][],
  available: number[] = Array.from({ length: candidateCount }, (_, i) => i),
  random: () => number = Math.random,
): number[] {
  if (available.length < 4) throw new Error('至少需要四个候选词。');
  const votes = exclusions.map(indices => new Set(indices));
  const counts = Array.from({ length: candidateCount }, (_, i) => votes.filter(vote => vote.has(i)).length);
  let best: number[] = [];
  let bestTiers: number[] | null = null;
  let bestBurden: number[] = [];
  let ties = 0;
  const visit = (start: number, chosen: number[]) => {
    if (chosen.length === 4) {
      // Ascending tiers preserve all possible zero-vote words before relaxing.
      const tiers = chosen.map(i => counts[i]).sort((a, b) => a - b);
      const burden = votes.map(vote => chosen.filter(i => vote.has(i)).length).sort((a, b) => b - a);
      const comparison = bestTiers === null ? -1 : compare(tiers, bestTiers) || compare(burden, bestBurden);
      if (comparison < 0) {
        best = [...chosen]; bestTiers = tiers; bestBurden = burden; ties = 1;
      } else if (comparison === 0 && random() < 1 / ++ties) {
        best = [...chosen];
      }
      return;
    }
    for (let i = start; i <= available.length - (4 - chosen.length); i++) {
      chosen.push(available[i]); visit(i + 1, chosen); chosen.pop();
    }
  };
  visit(0, []);
  for (let i = best.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [best[i], best[j]] = [best[j], best[i]];
  }
  return best;
}
