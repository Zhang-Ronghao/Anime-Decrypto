import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TeamWordSelectionSnapshot } from '../types';
import { fetchBangumiCovers } from '../lib/game';

function CandidateCover({ src }: { src: string | null }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  return (
    <span className={`word-selection-cover${loaded ? ' is-loaded' : ''}`} aria-hidden="true">
      {src ? <img src={src}
        alt="" width={120} height={170} loading="lazy" decoding="async"
        onLoad={() => setLoaded(true)} onError={() => setFailed(true)} /> : null}
    </span>
  );
}

export function TeamWordSelectionDialog({ selection, memberCount, busy, error, onSubmit }: {
  selection: TeamWordSelectionSnapshot;
  memberCount: number;
  busy: boolean;
  error: string | null;
  onSubmit(indices: number[]): Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [excluded, setExcluded] = useState<number[]>(selection.own_excluded_indices ?? []);
  const [covers, setCovers] = useState<Record<number, string | null>>({});
  const subjectIds = JSON.stringify([...new Set(selection.candidates.map(slot => slot.subjectId)
    .filter((id): id is number => id !== null && Number.isInteger(id) && id > 0))]);
  const submitted = selection.own_excluded_indices !== null;
  const locked = busy || submitted || selection.completed;
  const savedSelection = JSON.stringify(selection.own_excluded_indices);

  useEffect(() => {
    const controller = new AbortController();
    const ids = JSON.parse(subjectIds) as number[];
    if (ids.length) {
      // Statistics already arrived with the snapshot. Only optional covers use HTTP.
      void fetchBangumiCovers(ids, controller.signal).then(({ covers: loaded }) => {
        if (!controller.signal.aborted) setCovers(current => ({ ...current, ...loaded }));
      }).catch(() => {
        if (!controller.signal.aborted) setCovers(current => ({ ...current, ...Object.fromEntries(ids.map(id => [id, null])) }));
      });
    }
    return () => controller.abort();
  }, [subjectIds]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { dialog?.close(); document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    if (selection.own_excluded_indices !== null) setExcluded(selection.own_excluded_indices);
  }, [savedSelection]);

  return (
    <dialog ref={dialogRef} className={`word-selection-dialog word-selection-${selection.team === 'A' ? 'red' : 'blue'}`}
      aria-labelledby="word-selection-title" aria-describedby="word-selection-description"
      onCancel={event => event.preventDefault()}>
      <div className="word-selection-content">
        <header className="word-selection-header">
          <div className="word-selection-heading">
            <h2 id="word-selection-title"><span className="word-selection-team">{selection.team === 'A' ? '红队' : '蓝队'}选词</span> · 筛选后抽取 4 词</h2>
            <span className="word-selection-progress" role="status">{selection.submitted_player_ids.length}/{memberCount} 已完成</span>
          </div>
          <p id="word-selection-description">点击排除没看过、也没云过，完全不了解的作品</p>
        </header>
        <div className="word-selection-grid" role="group" aria-label="候选词，点击排除">
          {selection.candidates.map((slot, index) => {
            const selected = excluded.includes(index);
            const info = slot.statistics;
            const cover = slot.subjectId === null ? null : covers[slot.subjectId];
            return <button key={slot.text} type="button" aria-pressed={selected}
              className={`word-selection-option${selected ? ' is-excluded' : ''}`}
              disabled={locked}
              onClick={() => setExcluded(current => current.includes(index) ? current.filter(i => i !== index) : [...current, index])}>
              <span className="word-selection-option-body">
                {slot.subjectId !== null && cover !== null ? <CandidateCover key={cover ?? slot.subjectId} src={cover ?? null} /> : null}
                <span className="word-selection-option-info">
                  <span className="word-selection-option-title">{slot.text}</span>
                  {info ? <span className="word-selection-metadata">
                    <span><span className="word-selection-meta-label">播出</span>{info.year ? `${info.year} 年` : '—'}</span>
                    <span><span className="word-selection-meta-label">评分</span>{info.score === null ? '—' : `${info.score.toFixed(1)} 分`}</span>
                    <span><span className="word-selection-meta-label">收藏</span>{info.collectionCount === null ? '—' : `${info.collectionCount.toLocaleString('zh-CN')} 人`}</span>
                  </span> : null}
                  {selected ? <span className="word-selection-option-state" aria-hidden="true">× 已排除</span> : null}
                </span>
              </span>
            </button>;
          })}
        </div>
        {error ? <p className="word-selection-error" role="alert">{error}</p> : null}
        <footer className="word-selection-footer">
          <div className="word-selection-status" role="status">
            <strong>已排除 {excluded.length} 词</strong>
          </div>
          {submitted || selection.completed
            ? <span className="word-selection-wait" role="status">{selection.completed ? '正在填入词语…' : '等待队友'}</span>
            : <button className="primary-button" type="button" disabled={busy}
                onClick={() => void onSubmit(excluded)}>{busy ? '提交中…' : '完成筛选'}</button>}
        </footer>
      </div>
    </dialog>
  );
}
