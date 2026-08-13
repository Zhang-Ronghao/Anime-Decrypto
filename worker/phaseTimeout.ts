export const PHASE_TIMEOUT_GRACE_MS = 2_000;

export function timeoutGuess(digits: Array<string | null>): string {
  return Array.from({ length: 3 }, (_, index) => {
    const digit = digits[index];
    return typeof digit === 'string' && /^[1-4]$/.test(digit) ? digit : 'x';
  }).join('-');
}

export function timeoutClues(values: string[]): string[] {
  return Array.from({ length: 3 }, (_, index) => values[index]?.trim().slice(0, 24) || '未填写');
}

export function isCompleteGuess(guess: string | null): guess is string {
  return typeof guess === 'string' && /^[1-4]-[1-4]-[1-4]$/.test(guess);
}
