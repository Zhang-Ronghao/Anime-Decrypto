import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type {
  PlayerRecord,
  RoomSnapshot,
  RoundCodeRecord,
  RoundSubmissionRecord,
  Team,
  TeamWordsRecord,
} from '../types';

function assertSupabase() {
  if (!supabase) {
    throw new Error('Supabase 未配置。');
  }

  return supabase;
}

function expectSingle<T>(value: T | T[] | null): T {
  if (!value) {
    throw new Error('未返回预期数据。');
  }

  return Array.isArray(value) ? value[0] : value;
}

function normalizeRoomResult(data: unknown): { room_id: string; room_code: string } {
  const value = expectSingle<Record<string, unknown> | null>(data as Record<string, unknown> | Record<string, unknown>[] | null);
  if (!value) {
    throw new Error('房间 RPC 未返回数据。');
  }

  const roomId =
    typeof value.room_id === 'string'
      ? value.room_id
      : typeof value.created_room_id === 'string'
        ? value.created_room_id
        : typeof value.joined_room_id === 'string'
          ? value.joined_room_id
          : null;

  const roomCode =
    typeof value.room_code === 'string'
      ? value.room_code
      : typeof value.created_room_code === 'string'
        ? value.created_room_code
        : typeof value.joined_room_code === 'string'
          ? value.joined_room_code
          : null;

  if (!roomId || !roomCode) {
    throw new Error('房间 RPC 返回格式不正确。');
  }

  return { room_id: roomId, room_code: roomCode };
}

export async function createRoom(playerName: string, desiredRoomCode?: string) {
  const client = assertSupabase();
  const { data, error } = await client.rpc('create_room', {
    p_player_name: playerName.trim(),
    p_room_code: desiredRoomCode?.trim().toUpperCase() || null,
  });

  if (error) {
    throw error;
  }

  return normalizeRoomResult(data);
}

export async function joinRoom(roomCode: string, playerName: string) {
  const client = assertSupabase();
  const { data, error } = await client.rpc('join_room', {
    p_room_code: roomCode.trim().toUpperCase(),
    p_player_name: playerName.trim(),
  });

  if (error) {
    throw error;
  }

  return normalizeRoomResult(data);
}

export async function cleanupExpiredRooms() {
  const client = assertSupabase();
  const { error } = await client.rpc('cleanup_expired_rooms');

  if (error) {
    throw error;
  }
}

export async function leaveRoom(roomId: string) {
  const client = assertSupabase();
  const { error } = await client.rpc('leave_room', {
    p_room_id: roomId,
  });

  if (error) {
    throw error;
  }
}

export async function disbandRoom(roomId: string) {
  const client = assertSupabase();
  const { error } = await client.rpc('disband_room', {
    p_room_id: roomId,
  });

  if (error) {
    throw error;
  }
}

export async function kickPlayer(roomId: string, playerId: string) {
  const client = assertSupabase();
  const { error } = await client.rpc('kick_player', {
    p_room_id: roomId,
    p_player_id: playerId,
  });

  if (error) {
    throw error;
  }
}

export async function updateRoomLobbySettings(roomId: string, seatCount: number, roleRotationEnabled: boolean) {
  const client = assertSupabase();
  const { error } = await client.rpc('update_room_lobby_settings', {
    p_room_id: roomId,
    p_seat_count: seatCount,
    p_role_rotation_enabled: roleRotationEnabled,
  });

  if (error) {
    throw error;
  }
}

export async function updateSelfSeat(roomId: string, team: Team | null, teamSeat: number | null) {
  const client = assertSupabase();
  const { error } = await client.rpc('update_self_seat', {
    p_room_id: roomId,
    p_team: team,
    p_team_seat: teamSeat,
  });

  if (error) {
    throw error;
  }
}

export async function startGame(roomId: string) {
  const client = assertSupabase();
  const { error } = await client.rpc('start_game', {
    p_room_id: roomId,
  });

  if (error) {
    throw error;
  }
}

export async function generateTeamWords(roomId: string, team: Team) {
  const client = assertSupabase();
  const { data, error } = await client.rpc('generate_team_words', {
    p_room_id: roomId,
    p_team: team,
  });

  if (error) {
    throw error;
  }

  return (data ?? []) as string[];
}

export async function saveTeamWords(roomId: string, team: Team, words: string[]) {
  const client = assertSupabase();
  const { error } = await client.rpc('save_team_words', {
    p_room_id: roomId,
    p_team: team,
    p_words: words,
  });

  if (error) {
    throw error;
  }
}

export async function confirmTeamWords(roomId: string, team: Team, words: string[]) {
  const client = assertSupabase();
  const { error } = await client.rpc('confirm_team_words', {
    p_room_id: roomId,
    p_team: team,
    p_words: words,
  });

  if (error) {
    throw error;
  }
}

export async function submitClues(roomId: string, team: Team, clues: string[]) {
  const client = assertSupabase();
  const { error } = await client.rpc('submit_clues', {
    p_room_id: roomId,
    p_team: team,
    p_clues: clues.map((item) => item.trim()),
  });

  if (error) {
    throw error;
  }
}

export async function submitInterceptGuess(roomId: string, targetTeam: Team, guess: string) {
  const client = assertSupabase();
  const { error } = await client.rpc('submit_intercept_guess', {
    p_room_id: roomId,
    p_target_team: targetTeam,
    p_guess: guess,
  });

  if (error) {
    throw error;
  }
}

export async function skipFirstIntercept(roomId: string) {
  const client = assertSupabase();
  const { error } = await client.rpc('skip_first_intercept', {
    p_room_id: roomId,
  });

  if (error) {
    throw error;
  }
}

export async function submitOwnGuess(roomId: string, team: Team, guess: string) {
  const client = assertSupabase();
  const { error } = await client.rpc('submit_own_guess', {
    p_room_id: roomId,
    p_team: team,
    p_guess: guess,
  });

  if (error) {
    throw error;
  }
}

export async function advanceRound(roomId: string) {
  const client = assertSupabase();
  const { error } = await client.rpc('advance_round', {
    p_room_id: roomId,
  });

  if (error) {
    throw error;
  }
}

export async function restartRoom(roomId: string) {
  const client = assertSupabase();
  const { error } = await client.rpc('restart_room', {
    p_room_id: roomId,
  });

  if (error) {
    throw error;
  }
}

export async function terminateGame(roomId: string) {
  const client = assertSupabase();
  const { error } = await client.rpc('terminate_game', {
    p_room_id: roomId,
  });

  if (error) {
    throw error;
  }
}

export async function fetchRoomSnapshot(roomId: string): Promise<RoomSnapshot> {
  const client = assertSupabase();
  const roomQuery = client.from('rooms').select('*').eq('id', roomId).single();
  const playersQuery = client
    .from('room_players')
    .select('*')
    .eq('room_id', roomId)
    .order('team', { ascending: true })
    .order('team_seat', { ascending: true, nullsFirst: false })
    .order('joined_at', { ascending: true });
  const wordsQuery = client
    .from('team_words')
    .select('*')
    .eq('room_id', roomId)
    .order('team', { ascending: true });
  const codesQuery = client
    .from('round_codes')
    .select('*')
    .eq('room_id', roomId)
    .order('round_number', { ascending: true });
  const submissionsQuery = client
    .from('round_submissions')
    .select('*')
    .eq('room_id', roomId)
    .order('round_number', { ascending: false })
    .order('team', { ascending: true });

  const [roomResult, playersResult, wordsResult, codesResult, submissionsResult] = await Promise.all([
    roomQuery,
    playersQuery,
    wordsQuery,
    codesQuery,
    submissionsQuery,
  ]);

  if (roomResult.error) throw roomResult.error;
  if (playersResult.error) throw playersResult.error;
  if (wordsResult.error) throw wordsResult.error;
  if (codesResult.error) throw codesResult.error;
  if (submissionsResult.error) throw submissionsResult.error;

  return {
    room: roomResult.data,
    players: (playersResult.data ?? []) as PlayerRecord[],
    teamWords: (wordsResult.data ?? []) as TeamWordsRecord[],
    roundCodes: (codesResult.data ?? []) as RoundCodeRecord[],
    submissions: (submissionsResult.data ?? []) as RoundSubmissionRecord[],
  };
}

export function subscribeToRoom(roomId: string, onChange: () => void): RealtimeChannel {
  const client = assertSupabase();
  const channel = client
    .channel(`room-${roomId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
      onChange,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${roomId}` },
      onChange,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'team_words', filter: `room_id=eq.${roomId}` },
      onChange,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'round_codes', filter: `room_id=eq.${roomId}` },
      onChange,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'round_submissions', filter: `room_id=eq.${roomId}` },
      onChange,
    )
    .subscribe();

  return channel;
}
