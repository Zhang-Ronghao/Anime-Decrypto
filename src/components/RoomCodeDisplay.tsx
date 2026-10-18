import { useState } from 'react';

const HIDDEN_ROOM_CODE_KEY = 'decrypto-hide-room-code';

export function RoomCodeDisplay({ code, className }: { code: string; className: string }) {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDDEN_ROOM_CODE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  function toggleVisibility() {
    const nextHidden = !hidden;
    setHidden(nextHidden);
    try {
      localStorage.setItem(HIDDEN_ROOM_CODE_KEY, String(nextHidden));
    } catch {
      // Keep the toggle usable when browser storage is unavailable.
    }
  }

  const toggleLabel = hidden ? '显示房间码' : '隐藏房间码';

  return (
    <p className={`${className} room-code-display`}>
      <span>房间号</span>
      <span className="room-code-value" aria-label={hidden ? '房间码已隐藏' : undefined}>
        {hidden ? '••••••' : code}
      </span>
      <button
        className="room-code-toggle"
        type="button"
        aria-label={toggleLabel}
        aria-pressed={hidden}
        title={toggleLabel}
        onClick={toggleVisibility}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {hidden && <path d="m3 3 18 18" />}
        </svg>
      </button>
    </p>
  );
}
