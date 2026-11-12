import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TeamSubmissionProgress } from '../src/components/TeamSubmissionProgress';
import { discussionHarness, discussionRoomFixture } from './fixtures/discussionRoom';
import type { RoomSnapshot } from '../src/types';

async function assertProgress(
  h: ReturnType<typeof discussionHarness>,
  expected: RoomSnapshot['submissionProgress'],
) {
  for (const player of ['A-1', 'A-2', 'B-1', 'B-2', 'spectator']) {
    assert.deepEqual((await h.snapshot(player)).submissionProgress, expected, player);
  }
}

for (const mode of ['parallel', 'sequential'] as const) {
  for (const lifeMode of [false, true]) {
    test(`${mode}, life=${lifeMode}: confirmation and clues use the same public progress`, async () => {
      const initial = discussionRoomFixture(1);
      Object.assign(initial.room, {
        phase: 'word_assignment', discussion_mode: mode, life_mode_enabled: lifeMode,
        team_a_words_confirmed: false, team_b_words_confirmed: false,
      });
      initial.teamWords.forEach((record) => { record.confirmed = false; });
      initial.submissions = [];
      initial.roundCodes = [];
      const h = discussionHarness(initial);
      await assertProgress(h, { A: false, B: false });
      await h.request('A-1', { type: 'confirmTeamWords', team: 'A', words: ['雷达', '琴键', '星轨', '沙丘'], slots: [] });
      await assertProgress(h, { A: true, B: false });
      await h.request('B-1', { type: 'confirmTeamWords', team: 'B', words: ['月亮', '花园', '城堡', '森林'], slots: [] });
      assert.equal(h.current().room.phase, 'encrypt');
      await assertProgress(h, { A: false, B: false });
      await h.request('B-1', { type: 'submitClues', team: 'B', clues: ['月光', '红色', '石头'] });
      await assertProgress(h, { A: false, B: true });
      h.reload();
      await assertProgress(h, { A: false, B: true });
      await h.request('A-1', { type: 'submitClues', team: 'A', clues: ['天空', '音乐', '轨道'] });
      assert.equal(h.current().room.phase, 'decode');
      await assertProgress(h, { A: false, B: false });
    });

    test(`${mode}, life=${lifeMode}: first-round decode is visible across teams, skip needs no submissions`, async () => {
      const initial = discussionRoomFixture(1);
      Object.assign(initial.room, { discussion_mode: mode, life_mode_enabled: lifeMode });
      const h = discussionHarness(initial);
      await h.start();
      await h.request('A-2', { type: 'submitOwnGuess', team: 'A', guess: '1-2-4' });
      await assertProgress(h, { A: true, B: false });
      const blue = await h.snapshot('B-1');
      assert.equal(blue.submissions.find((entry) => entry.team === 'A')!.own_guess, null);
      assert.equal(blue.submissions.find((entry) => entry.team === 'A')!.own_correct, null);
      h.reload();
      await assertProgress(h, { A: true, B: false });
      await h.request('B-2', { type: 'submitOwnGuess', team: 'B', guess: '1-2-3' });
      assert.equal(h.current().room.phase, 'intercept');
      await assertProgress(h, null);
      await h.request('A-1', { type: 'skipFirstIntercept' });
      await assertProgress(h, null);
    });

    test(`${mode}, life=${lifeMode}: progress follows the submitting team and resets for the next task`, async () => {
      const initial = discussionRoomFixture(2);
      Object.assign(initial.room, { discussion_mode: mode, life_mode_enabled: lifeMode });
      const h = discussionHarness(initial);
      await h.start();
      await h.request('A-2', { type: 'submitOwnGuess', team: 'A', guess: '2-3-4' });
      await assertProgress(h, { A: true, B: false });
      if (mode === 'parallel') {
        await h.request('B-2', { type: 'submitOwnGuess', team: 'B', guess: '1-2-3' });
        assert.equal(h.current().room.phase, 'intercept');
        await assertProgress(h, { A: false, B: false });
      }
      await h.request('B-1', { type: 'submitInterceptGuess', targetTeam: 'A', guess: '2-3-4' });
      if (mode === 'parallel') {
        await assertProgress(h, { A: false, B: true });
        const red = await h.snapshot('A-2');
        assert.equal(red.submissions.find((entry) => entry.team === 'A')!.intercept_guess, null);
      } else {
        assert.equal(h.current().room.discussion_team, 'B');
        await assertProgress(h, { A: false, B: false });
      }
      await h.request('A-1', { type: 'submitInterceptGuess', targetTeam: 'B', guess: '1-2-3' });
      if (mode === 'sequential') {
        await assertProgress(h, { A: true, B: false });
        const blue = await h.snapshot('B-2');
        assert.equal(blue.submissions.find((entry) => entry.team === 'B')!.intercept_guess, null);
        h.reload();
        await assertProgress(h, { A: true, B: false });
        await h.request('B-2', { type: 'submitOwnGuess', team: 'B', guess: '1-2-3' });
      }
      assert.equal(h.current().room.phase, 'result');
      await assertProgress(h, null);
      await h.request('A-1', { type: 'advanceRound' });
      await assertProgress(h, { A: false, B: false });
    });
  }
}

test('progress ignores prior rounds and counts automatic timeout submissions', async () => {
  const initial = discussionRoomFixture(3);
  Object.assign(initial.room, { phase: 'decode', discussion_mode: 'parallel' });
  initial.submissions.push(...initial.submissions.map((entry) => ({
    ...entry, id: `old-${entry.id}`, round_number: 2, own_guess: '1-2-3', intercept_guess: '1-2-3',
  })));
  initial.submissions[0].own_guess = '2-x-4';
  initial.submissions[0].own_guess_auto_submitted = true;
  const h = discussionHarness(initial);
  await assertProgress(h, { A: true, B: false });
  assert.equal((await h.snapshot('B-2')).submissions.find((entry) => entry.round_number === 3 && entry.team === 'A')!.own_guess, null);
});

test('progress uses names and icons, with status text only in accessibility labels and tooltips', () => {
  const markup = renderToStaticMarkup(createElement(TeamSubmissionProgress, {
    progress: { A: true, B: false }, fallback: '等待房间同步',
  }));
  const visibleText = markup.replace(/<[^>]*>/g, '');
  assert.equal(visibleText, '红队蓝队');
  assert.match(markup, /aria-label="红队：已提交"/);
  assert.match(markup, /aria-label="蓝队：待提交"/);
  assert.equal((markup.match(/<svg /g) ?? []).length, 2);
  assert.equal((markup.match(/is-submitted/g) ?? []).length, 1);
  assert.equal(renderToStaticMarkup(createElement(TeamSubmissionProgress, {
    progress: null, fallback: '等待房主跳过第一轮拦截',
  })), '<strong>等待房主跳过第一轮拦截</strong>');
});
