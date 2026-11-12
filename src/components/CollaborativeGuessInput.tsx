import { useLayoutEffect, useRef, useState } from 'react';
import type { PlayerRecord } from '../types';
import type { GuessDraftChoice, GuessDraftDigits, GuessDraftTask } from '../types/guessDraft';

export function GuessSubmitterName({ name }: { name?: string }) {
  return <span className="guess-submitter-name" title={name}>{name || '待确定'}</span>;
}

function ChoiceNames({ players, selfId }: { players: PlayerRecord[]; selfId?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const fullRef = useRef<HTMLSpanElement>(null);
  const initialsRef = useRef<HTMLSpanElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const [layout, setLayout] = useState({ abbreviated: false, visible: players.length });
  const label = (player: PlayerRecord, abbreviated: boolean) => player.id === selfId ? '我' :
    abbreviated ? Array.from(player.player_name.trim())[0] || '？' : player.player_name;
  const chip = (player: PlayerRecord, abbreviated: boolean) => (
    <span className={`guess-choice-name${player.id === selfId ? ' guess-choice-name-self' : ''}`} key={player.id}>
      {label(player, abbreviated)}
    </span>
  );
  useLayoutEffect(() => {
    const element = ref.current;
    const full = fullRef.current;
    const initials = initialsRef.current;
    const count = countRef.current;
    if (!element || !full || !initials || !count) return;
    // Measure real chip widths so both short Chinese names and Latin names fit naturally.
    const measure = () => {
      const width = element.clientWidth;
      let abbreviated = full.getBoundingClientRect().width > width;
      let visible = players.length;
      if (abbreviated && initials.getBoundingClientRect().width > width) {
        visible = 0;
        let used = count.getBoundingClientRect().width;
        for (const child of initials.children) {
          used += child.getBoundingClientRect().width + 4;
          if (used > width) break;
          visible++;
        }
      }
      setLayout(previous => previous.abbreviated === abbreviated && previous.visible === visible ? previous : { abbreviated, visible });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(full);
    observer.observe(initials);
    return () => observer.disconnect();
  }, [players, selfId]);
  return <span className="guess-choice-names" ref={ref}>
    {players.slice(0, layout.visible).map(player => chip(player, layout.abbreviated))}
    {layout.visible < players.length && <span className="guess-choice-count">… {players.length}人</span>}
    <span className="guess-choice-measure" aria-hidden="true">
      <span className="guess-choice-measure-row" ref={fullRef}>{players.map(player => chip(player, false))}</span>
      <span className="guess-choice-measure-row" ref={initialsRef}>{players.map(player => chip(player, true))}</span>
      <span className="guess-choice-count" ref={countRef}>… {players.length}人</span>
    </span>
  </span>;
}

export function CollaborativeGuessInput({ clues, tone, task, choices, players, selfId, digits, submittedDigits, canEdit, readOnly, busy, connected, onSelect, clueTeamLabel }: {
  clueTeamLabel?: string;
  clues: string[];
  tone: 'red' | 'blue';
  task: GuessDraftTask | null;
  choices: GuessDraftChoice[];
  players: PlayerRecord[];
  selfId?: string;
  digits: GuessDraftDigits;
  submittedDigits: string[] | null;
  canEdit: boolean;
  readOnly: boolean;
  busy: boolean;
  connected: boolean;
  onSelect: (index: number, digit: string) => void;
}) {
  const submitter = players.find(player => player.id === task?.submitterId);
  const submitterRole = task?.phase === 'intercept' ? '拦截者' : '解密者';
  const isSubmitter = Boolean(task?.submitterId && task.submitterId === selfId);
  const instruction = submittedDigits ? '本队已提交' : task?.locked ? '本轮答题已结束' :
    readOnly ? '队友建议' : isSubmitter ? '点选编号，暂定答案' : '点选编号，提供建议';
  const status = submittedDigits ? `已提交 ${submittedDigits.join('－')}` : task?.locked ? '当前答题已结束' :
    !connected ? '连接恢复中，暂时无法点选' : null;
  return <div className={`collaborative-guess collaborative-guess-${tone}`}>
    <div className="guess-collab-scroll">
      <div className="action-lines guess-collab-lines">
        <div className="guess-collab-row action-line-head">
          <span className="action-line-head-cell">{clueTeamLabel ?? (task?.phase === 'intercept' ? '对方线索' : '本队线索')}</span>
          <span className="guess-collab-heading">
            <span className="guess-collab-instruction">{instruction}</span>
            <span className="guess-collab-legend">粗框：{submittedDigits ? '已提交的答案' : <>
              {isSubmitter ? '你' : <>{submitterRole}·<GuessSubmitterName name={submitter?.player_name} /></>}暂定提交的答案
            </>}</span>
          </span>
        </div>
        {clues.map((clue, index) => <div className="guess-collab-row" key={index}>
          <span className={`line-clue line-clue-${tone}`}>{clue}</span>
          <div className="guess-collab-options" role="group" aria-label={`线索 ${index + 1}：${clue}`}>
            {['1', '2', '3', '4'].map((digit) => {
              const voters = players.filter((player) => choices.some((choice) => choice.playerId === player.id && choice.digits[index] === digit))
                .sort((a, b) => Number(b.id === selfId) - Number(a.id === selfId) ||
                  Number(b.id === task?.submitterId) - Number(a.id === task?.submitterId) ||
                  (a.team_seat ?? Infinity) - (b.team_seat ?? Infinity));
              const draft = submittedDigits ? submittedDigits[index] === digit : choices.some((choice) => choice.playerId === task?.submitterId && choice.digits[index] === digit);
              const mine = digits[index] === digit;
              const names = voters.map((player) => `${player.player_name}${player.id === selfId ? '（我）' : ''}`);
              const tooltip = names.length ? names.join('、') : undefined;
              const description = `${digit} 号${draft ? submittedDigits ? '，已提交' : '，待提交答案' : ''}${names.length ? '：' + names.join('、') : '，暂无选择'}`;
              return <button
                type="button" key={digit}
                className={`guess-choice${draft ? ' guess-choice-draft' : ''}${mine ? ' guess-choice-mine' : ''}`}
                aria-pressed={mine} aria-label={description} title={tooltip}
                aria-disabled={!canEdit || busy}
                onClick={() => { if (canEdit && !busy) onSelect(index, digit); }}
              >
                {!readOnly && <span className="guess-choice-radio" aria-hidden="true" />}
                <span className="guess-choice-digit">{digit}</span>
                <ChoiceNames players={voters} selfId={selfId} />
              </button>;
            })}
          </div>
        </div>)}
      </div>
    </div>
    {status && <div className="guess-collab-status" role="status">{status}</div>}
  </div>;
}
