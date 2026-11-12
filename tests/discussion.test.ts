import assert from 'node:assert/strict';
import test from 'node:test';
import { discussionHarness, discussionRoomFixture } from './fixtures/discussionRoom';
import { guessDraftTask } from '../src/lib/guessDraftModel';
import { GuessDrafts } from '../worker/guessDrafts';
import { phaseNotice, phaseTransitionKey } from '../src/lib/phaseNotice';
import { resolveRoomChatAudience } from '../worker/roomChat';

test('only the lobby host can configure discussion mode, settings survive reload and partial old-client updates', async () => {
  const initial=discussionRoomFixture();initial.room.phase='lobby';initial.room.status='lobby';
  delete initial.room.discussion_mode;delete initial.room.discussion_phase_minutes;
  const h=discussionHarness(initial);
  assert.equal((await h.snapshot()).room.discussion_mode,'parallel');
  const payload={timers:{encryptMinutes:2,decodeMinutes:2,interceptMinutes:2},forcePhaseTimeoutEnabled:false,
    miscommunicationLimit:2,lifeModeEnabled:true,lifePoints:3,allowMidgameJoin:true,bangumiCharacterExtractEnabled:false};
  await h.request('A-2',{type:'updateRoomLobbySettings',payload:{...payload,discussion:{mode:'sequential',minutes:3}}},403);
  await h.request('A-1',{type:'updateRoomLobbySettings',payload:{...payload,discussion:{mode:'invalid',minutes:3}}},400);
  await h.request('A-1',{type:'updateRoomLobbySettings',payload:{...payload,discussion:{mode:'sequential',minutes:3}}});
  await h.request('A-1',{type:'updateRoomLobbySettings',payload});
  h.reload();assert.equal((await h.snapshot()).room.discussion_mode,'sequential');
  assert.equal(h.current().room.discussion_phase_minutes,3);
  const active=discussionHarness();await active.start();
  await active.request('A-1',{type:'updateRoomLobbySettings',payload:{...payload,discussion:{mode:'parallel',minutes:2}}},409);
});

test('sequential round accepts either submission order, always red then blue, and settles once at the end', async () => {
  for (const interceptFirst of [true, false]) {
    const initial = discussionRoomFixture(); initial.room.life_mode_enabled = interceptFirst;
    const h = discussionHarness(initial); await h.start();
    assert.equal(h.current().room.phase, 'discuss');
    assert.equal(h.current().room.discussion_team, 'A');
    const decode = () => h.request('A-2', { type: 'submitOwnGuess', team: 'A', guess: '2-3-4' });
    const intercept = () => h.request('B-1', { type: 'submitInterceptGuess', targetTeam: 'A', guess: '2-3-4' });
    await (interceptFirst ? intercept() : decode());
    assert.equal(h.current().room.discussion_team, 'A');
    assert.ok(h.current().submissions.every(s => !s.resolved_at && !s.revealed_code));
    assert.equal(h.current().room.score_team_b_intercepts, 0);
    await (interceptFirst ? decode() : intercept());
    assert.equal(h.current().room.discussion_team, 'B');
    assert.ok(h.current().submissions.every(s => !s.resolved_at));
    await h.request('A-1', { type: 'submitInterceptGuess', targetTeam: 'B', guess: '1-2-3' });
    assert.equal(h.current().room.phase, 'discuss');
    await h.request('B-2', { type: 'submitOwnGuess', team: 'B', guess: '1-2-3' });
    assert.equal(h.current().room.phase, 'result');
    assert.equal(h.current().room.discussion_team, null);
    assert.equal(h.current().room.score_team_a_intercepts, 1);
    assert.equal(h.current().room.score_team_b_intercepts, 1);
    assert.ok(h.current().submissions.every(s => s.resolved_at && s.own_correct && s.intercept_correct));
    await h.request('A-1', { type: 'submitInterceptGuess', targetTeam: 'B', guess: '1-2-3' }, 409);
    await h.request('B-2', { type: 'advanceRound' }, 403);
    await h.request('A-1', { type: 'advanceRound' });
    assert.equal(h.current().room.phase, 'encrypt');
    assert.equal(h.current().room.round_number, 3);
    for (const team of ['A','B'] as const) {
      const encoder=h.current().players.find(p=>p.team===team && p.role==='encoder')!;
      await h.request(encoder.id,{type:'submitClues',team,clues:['森林','少年','月光']});
    }
    assert.equal(h.current().room.discussion_team,'A');
  }
});

test('first round remains parallel with host skip; legacy rounds retain decode then intercept', async () => {
  for (const [round, mode] of [[1,'sequential'],[2,'parallel']] as const) {
    const initial = discussionRoomFixture(round); initial.room.discussion_mode = mode;
    const h = discussionHarness(initial); await h.start();
    assert.equal(h.current().room.phase, 'decode');
    await h.request('A-2', { type: 'submitOwnGuess', team: 'A', guess: '2-3-4' });
    await h.request('B-2', { type: 'submitOwnGuess', team: 'B', guess: '1-2-3' });
    assert.equal(h.current().room.phase, 'intercept');
    if (round === 1) {
      await h.request('B-1', { type: 'submitInterceptGuess', targetTeam: 'A', guess: '2-3-4' }, 409);
      await h.request('B-2', { type: 'skipFirstIntercept' }, 403);
      await h.request('A-1', { type: 'skipFirstIntercept' });
    } else {
      await h.request('B-1', { type: 'submitInterceptGuess', targetTeam: 'A', guess: '2-3-4' });
      await h.request('A-1', { type: 'submitInterceptGuess', targetTeam: 'B', guess: '1-2-3' });
    }
    assert.equal(h.current().room.phase, 'result');
  }
});

test('room snapshots expose submission progress, never opposing answers or secret words, and survive DO reload', async () => {
  const h = discussionHarness(); await h.start();
  await h.request('A-2', { type: 'submitOwnGuess', team: 'A', guess: '2-3-4' });
  const red = await h.snapshot('A-2'); const blue = await h.snapshot('B-2');
  assert.deepEqual(red.submissionProgress, { A: true, B: false });
  assert.deepEqual(blue.submissionProgress, red.submissionProgress);
  assert.equal(blue.submissions.find(s=>s.team==='A')!.own_guess, null);
  assert.ok(blue.teamWords.every(w=>w.team==='B'));
  assert.ok(red.submissions.every(s=>s.revealed_code===null && s.own_correct===null && s.intercept_correct===null));
  h.reload();
  assert.equal((await h.snapshot()).room.discussion_team, 'A');
  await h.request('B-1', { type: 'submitInterceptGuess', targetTeam: 'A', guess: '2-3-4' });
  h.reload();
  assert.equal((await h.snapshot()).room.discussion_team, 'B');
});

test('wrong team, wrong role, early target and duplicate answers are rejected', async () => {
  const h = discussionHarness(); await h.start();
  await h.request('B-2', { type:'submitOwnGuess', team:'B', guess:'1-2-3' },409);
  await h.request('A-1', { type:'submitInterceptGuess', targetTeam:'B', guess:'1-2-3' },409);
  await h.request('A-3', { type:'submitOwnGuess', team:'A', guess:'2-3-4' },403);
  await h.request('B-2', { type:'submitInterceptGuess', targetTeam:'A', guess:'2-3-4' },403);
  await h.request('spectator', { type:'submitOwnGuess', team:'A', guess:'2-3-4' },403);
  await h.request('A-2', { type:'submitOwnGuess', team:'A', guess:'2-3-4' });
  await h.request('A-2', { type:'submitOwnGuess', team:'A', guess:'1-2-3' },409);
  assert.equal(h.current().submissions[0].own_guess,'2-3-4');
});

test('mixed-phase suggestions stay team-private, forbid the target encoder, and reset on target switch', async () => {
  const h = discussionHarness(); await h.start();
  const current = h.current(); const hub = new GuessDrafts(); hub.reconcile(current);
  const a=guessDraftTask(current.room,current.players,current.submissions,'A')!;
  const b=guessDraftTask(current.room,current.players,current.submissions,'B')!;
  assert.equal(a.phase,'decode'); assert.equal(b.phase,'intercept');
  const vote=(player:string,key:string) => hub.update(current,current.players.find(p=>p.id===player)!.auth_user_id,{taskKey:key,digits:['2','3','4'],updatedAt:Date.now()});
  assert.equal(vote('A-1',a.key),false); assert.equal(vote('A-3',a.key),true);
  assert.equal(vote('B-1',b.key),true); assert.equal(vote('B-2',b.key),true);
  const red=hub.event(current,current.players[1].auth_user_id)!;
  assert.deepEqual(red.teams.map(t=>t.task.team),['A']);
  assert.deepEqual(red.teams[0].choices.map(c=>c.playerId),['A-3']);
  current.room.discussion_team='B'; hub.reconcile(current);
  assert.equal(vote('A-3',a.key),false);
  assert.ok(hub.event(current,current.players[1].auth_user_id)!.teams.every(t=>t.choices.length===0));
  assert.equal(guessDraftTask(current.room,current.players,current.submissions,'A')!.phase,'intercept');
  assert.equal(guessDraftTask(current.room,current.players,current.submissions,'B')!.phase,'decode');
});

test('forced discussion timeout handles both task types and only finalizes the active target', async () => {
  const initial=discussionRoomFixture(); initial.room.phase='discuss'; initial.room.discussion_team='A';
  initial.room.force_phase_timeout_enabled=true;
  initial.room.phase_deadline_at=new Date(Date.now()-100).toISOString();
  initial.submissions.forEach(s=>{s.clues=['琴弦','极光','玻璃'];});
  const h=discussionHarness(initial);
  const timeout=(player:string,digits:unknown[])=>h.request(player,{type:'submitTimeoutDraft',phase:'discuss',roundNumber:2,phaseDeadlineAt:initial.room.phase_deadline_at,draft:{kind:'guess',digits}});
  await timeout('A-2',['2',null,'4']);
  assert.equal(h.current().submissions[0].own_guess,'2-x-4');
  await timeout('B-1',['2','3','4']);
  assert.equal(h.current().submissions[0].intercept_guess,'2-3-4');
  assert.equal(h.current().room.discussion_team,'B');
  assert.equal(h.current().submissions[1].own_guess,null);
  await h.request('A-2',{type:'submitTimeoutDraft',phase:'discuss',roundNumber:2,phaseDeadlineAt:initial.room.phase_deadline_at,draft:{kind:'guess',digits:['1','2','3']}},409);

  const expired=discussionRoomFixture(); expired.room.phase='discuss';expired.room.discussion_team='A';
  expired.room.force_phase_timeout_enabled=true;expired.room.phase_deadline_at=new Date(Date.now()-5000).toISOString();
  const fallback=discussionHarness(expired);await fallback.alarm();
  assert.equal(fallback.current().room.discussion_team,'B');
  assert.equal(fallback.current().submissions[0].own_guess,'x-x-x');
  assert.equal(fallback.current().submissions[0].intercept_guess,'x-x-x');
  assert.equal(fallback.current().submissions[1].own_guess,null);
});

test('transition messages cover new and legacy modes without exposing secrets; target changes have unique keys', () => {
  const current=discussionRoomFixture();current.room.phase='discuss';current.room.discussion_team='A';
  assert.deepEqual(phaseNotice(current.room,'A'),{title:'开始解密己方线索',detail:'当前线索：红队'});
  assert.deepEqual(phaseNotice(current.room,'B'),{title:'开始拦截对方线索',detail:'当前线索：红队'});
  assert.deepEqual(phaseNotice(current.room,null),{title:'开始处理红队线索',detail:'红队解密 · 蓝队拦截'});
  const key=phaseTransitionKey(current.room);current.room.discussion_team='B';
  assert.notEqual(phaseTransitionKey(current.room),key);
  assert.deepEqual(phaseNotice(current.room,'A'),{title:'开始拦截对方线索',detail:'当前线索：蓝队'});
  assert.deepEqual(phaseNotice(current.room,'B'),{title:'开始解密己方线索',detail:'当前线索：蓝队'});
  assert.deepEqual(phaseNotice(current.room,null),{title:'开始处理蓝队线索',detail:'蓝队解密 · 红队拦截'});
  current.room.phase='decode';
  assert.deepEqual(phaseNotice(current.room,'A'),{title:'开始解密己方线索',detail:'当前线索：红队'});
  assert.deepEqual(phaseNotice(current.room,'B'),{title:'开始解密己方线索',detail:'当前线索：蓝队'});
  assert.deepEqual(phaseNotice(current.room,null),{title:'开始解密',detail:'双方解密各自线索'});
  current.room.phase='intercept';
  assert.deepEqual(phaseNotice(current.room,'A'),{title:'开始拦截对方线索',detail:'当前线索：蓝队'});
  assert.deepEqual(phaseNotice(current.room,'B'),{title:'开始拦截对方线索',detail:'当前线索：红队'});
  assert.deepEqual(phaseNotice(current.room,null),{title:'开始拦截',detail:'双方拦截对方线索'});
  current.room.round_number=1;assert.equal(phaseNotice(current.room,'A'),null);
});

test('knowledgeable encoder stays muted only while discussing their own team clues', () => {
  const current=discussionRoomFixture();const red=current.players[0],blue=current.players[7];
  assert.equal(resolveRoomChatAudience('discuss',red,'team','A').error?.code,'CHAT_MUTED');
  assert.equal(resolveRoomChatAudience('discuss',blue,'team','A').resolved?.audience,'team');
  assert.equal(resolveRoomChatAudience('discuss',red,'team','B').resolved?.audience,'team');
});
