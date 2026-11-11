import { useEffect, useRef } from 'react';
import type { PlayerRecord } from '../types';

export function MemberManagementDialog({ players, selfId, busy, error, onClose, onTransfer, onKick }: {
  players: PlayerRecord[];
  selfId: string;
  busy: boolean;
  error: string | null;
  onClose(): void;
  onTransfer(player: PlayerRecord): void;
  onKick(player: PlayerRecord): void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="member-management-dialog"
      aria-labelledby="member-management-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section className="modal-card modal-card-settings">
        <div className="modal-card-head">
          <div>
            <h2 id="member-management-title">成员管理 <span className="member-count">{players.length}</span></h2>
          </div>
          <button className="ghost-button" disabled={busy} onClick={onClose} type="button">关闭</button>
        </div>
        {error ? <p className="error-banner" role="alert">{error}</p> : null}
        <div className="member-management-list">
          {players.map((player) => (
            <div className="member-management-row" key={player.id}>
              <div className="member-management-identity">
                <strong>{player.player_name}{player.id === selfId ? '（我）' : ''}</strong>
                <small>{player.is_host ? '房主 · ' : ''}{player.is_spectator ? '观战' : player.team === 'A' ? '红队' : player.team === 'B' ? '蓝队' : '未入队'}</small>
              </div>
              {player.id !== selfId ? (
                <div className="member-management-actions">
                  <button className="ghost-button" disabled={busy} onClick={() => onTransfer(player)} type="button">转让房主</button>
                  <button className="danger-button" disabled={busy} onClick={() => onKick(player)} type="button">踢出</button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>
    </dialog>
  );
}
