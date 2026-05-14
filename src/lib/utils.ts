import type { PlayerRecord, Role, RoomPhase, Team } from '../types';

export const teamOrder: Team[] = ['A', 'B'];
export const roleOrder: Role[] = ['encoder', 'decoder'];

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

export function isSeatTaken(
  players: PlayerRecord[],
  team: Team,
  role: Role,
  selfId?: string,
): PlayerRecord | undefined {
  return players.find((player) => {
    if (selfId && player.id === selfId) {
      return false;
    }

    return player.team === team && player.role === role;
  });
}

export function phaseLabel(phase: RoomPhase): string {
  switch (phase) {
    case 'lobby':
      return '准备阶段';
    case 'clue':
      return '阶段一：出题';
    case 'intercept':
      return '阶段二：破译对手';
    case 'decode':
      return '阶段三：本队解码';
    case 'result':
      return '阶段四：回合结算';
    case 'finished':
      return '游戏结束';
    default:
      return phase;
  }
}

export function teamName(team: Team): string {
  return `${team} 队`;
}

export function roleName(role: Role): string {
  return role === 'encoder' ? '出题者' : '解码者';
}
