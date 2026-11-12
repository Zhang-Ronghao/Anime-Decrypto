import type { RoomSnapshot, Team } from '../types';
import { teamName } from '../lib/utils';

export function TeamSubmissionProgress({ progress, fallback }: {
  progress: RoomSnapshot['submissionProgress'];
  fallback: string;
}) {
  if (!progress) return <strong>{fallback}</strong>;

  return (
    <div className="team-submission-progress" role="group" aria-label="提交进度" aria-live="polite" aria-atomic="true">
      {(['A', 'B'] as Team[]).map((team) => {
        const name = teamName(team);
        const submitted = progress[team];
        const label = `${name}：${submitted ? '已提交' : '待提交'}`;
        return (
          <span className="team-submission-progress-item" key={team} aria-label={label} title={label}>
            <span className={`team-submission-progress-name team-submission-progress-name-${team}`} aria-hidden="true">{name}</span>
            <svg
              className={`team-submission-progress-icon${submitted ? ' is-submitted' : ''}`}
              width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true"
            >
              {submitted ? <>
                <circle cx="12" cy="12" r="9" />
                <path d="m8 12 2.5 2.5L16 9" />
              </> : <>
                <path d="M6 3h12M6 21h12M7 3v4c0 2 2 3.5 5 5-3 1.5-5 3-5 5v4M17 3v4c0 2-2 3.5-5 5 3 1.5 5 3 5 5v4" />
                <path d="M9 18h6" />
              </>}
            </svg>
          </span>
        );
      })}
    </div>
  );
}
