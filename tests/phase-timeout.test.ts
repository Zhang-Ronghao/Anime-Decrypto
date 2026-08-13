import assert from 'node:assert/strict';
import test from 'node:test';
import { isCompleteGuess, PHASE_TIMEOUT_GRACE_MS, timeoutClues, timeoutGuess } from '../worker/phaseTimeout';

test('timeout guesses keep entered digits and mark missing positions with x', () => {
  assert.equal(timeoutGuess(['2', '4', null]), '2-4-x');
  assert.equal(timeoutGuess([null, '3', '1']), 'x-3-1');
  assert.equal(timeoutGuess([]), 'x-x-x');
});

test('timeout guesses reject invalid client values instead of creating a valid guess', () => {
  assert.equal(timeoutGuess(['5', 'x', '2']), 'x-x-2');
  assert.equal(isCompleteGuess('2-4-x'), false);
  assert.equal(isCompleteGuess('2-4-1'), true);
});

test('timeout clues preserve text and fill empty slots', () => {
  assert.deepEqual(timeoutClues([' 红色 ', '', '苹果']), ['红色', '未填写', '苹果']);
  assert.deepEqual(timeoutClues([]), ['未填写', '未填写', '未填写']);
});

test('forced timeout uses a short transport grace period', () => {
  assert.equal(PHASE_TIMEOUT_GRACE_MS, 2_000);
});
