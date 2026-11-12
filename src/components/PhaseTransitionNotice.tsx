import { useEffect, useRef, useState } from 'react';
import { phaseNotice, phaseTransitionKey } from '../lib/phaseNotice';
import type { RoomRecord, Team } from '../types';

export function PhaseTransitionNotice({ room, team, serverClockOffsetMs }: {
  room: RoomRecord; team: Team | null; serverClockOffsetMs: number;
}) {
  const [notice, setNotice] = useState<ReturnType<typeof phaseNotice>>(null);
  const previous = useRef<{ roomId: string; key: string } | null>(null);
  const latest = useRef({ room, team, serverClockOffsetMs });
  latest.current = { room, team, serverClockOffsetMs };
  const key = phaseTransitionKey(room);

  useEffect(() => {
    const { room: current, team: currentTeam, serverClockOffsetMs: offset } = latest.current;
    const prior = previous.current;
    previous.current = { roomId: current.id, key };
    setNotice(null);
    // Initial load/refresh establishes a baseline; reconnects never replay old transitions.
    if (!prior || prior.roomId !== current.id || prior.key === key) return;
    const age = Date.now() + offset - Date.parse(current.phase_started_at ?? '');
    if (!Number.isFinite(age) || age < -1000 || age > 5000) return;
    const next = phaseNotice(current, currentTeam);
    if (!next) return;
    setNotice(next);
    const timer = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [key]);

  return <div className="phase-notice-region" role="status" aria-live="polite" aria-atomic="true">
    {notice && <div className="phase-notice" key={key}>
      <strong>{notice.title}</strong>
      <span>{notice.detail}</span>
    </div>}
  </div>;
}
