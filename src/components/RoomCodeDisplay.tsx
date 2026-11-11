import { useEffect, useRef, useState } from 'react';

const HIDDEN_ROOM_CODE_KEY = 'decrypto-hide-room-code';

export function RoomCodeDisplay({ code, className, invite = false }: { code: string; className: string; invite?: boolean }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  async function copyInvite() {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('room', code);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyState('idle'), 2500);
  }
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

  const toggleLabel = hidden ? '显示房间号' : '隐藏房间号';
  const copyLabel = copyState === 'copied' ? '已复制邀请链接' : copyState === 'failed' ? '复制失败，点击重试' : '复制邀请链接';

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
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {hidden && <path d="m3 3 18 18" />}
        </svg>
      </button>
      {invite ? (
        <>
          <button className="room-code-toggle" aria-label={copyLabel} title={copyLabel} onClick={() => void copyInvite()} type="button">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {copyState === 'copied' ? <path d="m5 12 4 4L19 6" /> : copyState === 'failed' ? <><path d="m6 6 12 12M6 18 18 6" /></> : <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4" /></>}
            </svg>
          </button>
          <span className="visually-hidden" role="status">{copyState !== 'idle' ? copyLabel : ''}</span>
        </>
      ) : null}
    </p>
  );
}
