import type { RoomRecord, Team } from '../types';
import { discussionTarget } from './discussion';

function teamGuessNotice(team: Team, clueTeam: Team) {
  return {
    title: team === clueTeam ? '开始解密己方线索' : '开始拦截对方线索',
    detail: `当前线索：${clueTeam === 'A' ? '红队' : '蓝队'}`,
  };
}

export function phaseNotice(room: RoomRecord, team: Team | null) {
  const target = discussionTarget(room);
  if (target) {
    const clueTeam = target === 'A' ? '红队' : '蓝队';
    return team ? teamGuessNotice(team, target) : {
      title: `开始处理${clueTeam}线索`,
      detail: `${clueTeam}解密 · ${target === 'A' ? '蓝队' : '红队'}拦截`,
    };
  }
  if (room.phase === 'encrypt') return { title: '开始加密', detail: '加密者填写本轮线索' };
  if (room.phase === 'decode') return team ? teamGuessNotice(team, team)
    : { title: '开始解密', detail: '双方解密各自线索' };
  if (room.phase === 'intercept' && room.round_number > 1) return team ? teamGuessNotice(team, team === 'A' ? 'B' : 'A')
    : { title: '开始拦截', detail: '双方拦截对方线索' };
  return null;
}

export function phaseTransitionKey(room: RoomRecord): string {
  return `${room.id}:${room.round_number}:${room.phase}:${room.discussion_team ?? ''}:${room.phase_started_at ?? ''}`;
}
