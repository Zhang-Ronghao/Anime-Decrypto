import type { PlayerRecord, Role, RoomPhase, Team } from '../types';

export const teamOrder: Team[] = ['A', 'B'];
export const lobbySeatOptions = [4, 6, 8, 10, 12, 14] as const;

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
  teamSeat: number,
  selfId?: string,
): PlayerRecord | undefined {
  return players.find((player) => {
    if (selfId && player.id === selfId) {
      return false;
    }

    return player.team === team && player.team_seat === teamSeat;
  });
}

export function teamCapacity(seatCount: number): number {
  return Math.floor(seatCount / 2);
}

export function roleForSeat(teamSeat: number): Role {
  if (teamSeat === 1) {
    return 'encoder';
  }

  if (teamSeat === 2) {
    return 'decoder';
  }

  return 'member';
}

export function phaseLabel(phase: RoomPhase): string {
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
