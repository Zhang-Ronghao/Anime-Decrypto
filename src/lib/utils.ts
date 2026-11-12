import type { Role, RoomPhase, Team } from '../types';

export const teamOrder: Team[] = ['A', 'B'];

export function otherTeam(team: Team): Team {
  return team === 'A' ? 'B' : 'A';
}

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function normalizeGuess(input: string): string {
  const digits = input
    .replace(/[^\d]/g, '')
    .split('')
    .filter((char) => ['1', '2', '3', '4'].includes(char))
    .slice(0, 3);

  return digits.join('-');
}

export function phaseLabel(phase: RoomPhase, discussionTeam?: Team | null): string {
  switch (phase) {
    case 'lobby':
      return '准备阶段';
    case 'word_assignment':
      return '词语分配';
    case 'encrypt':
      return '阶段一：加密';
    case 'decode':
      return '阶段二：解密';
    case 'intercept':
      return '阶段三：拦截';
    case 'discuss':
      return `讨论${discussionTeam === 'B' ? '蓝' : '红'}队线索`;
    case 'result':
      return '回合结算';
    case 'finished':
      return '游戏结束';
    default:
      return phase;
  }
}

export function isEncryptPhase(phase: RoomPhase): boolean {
  return phase === 'encrypt';
}

export function teamName(team: Team): string {
  return `${team} 队`;
}

export function roleName(role: Role): string {
  if (role === 'encoder') {
    return '加密/拦截者';
  }

  if (role === 'decoder') {
    return '解码者';
  }

  return '队员';
}
