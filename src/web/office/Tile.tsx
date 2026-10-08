import { displayName, type Member } from '../../shared/types'
import type { PullRequest } from '../github/types'
import { Avatar } from './Avatar'
import { presenceLabel } from './presence'
import { prPill, prPillTone } from './prPill'

const MAX_PILLS = 3

export function Tile({ member, prs, isMe = false, onOpen }: { member: Member; prs: PullRequest[] | 'error' | undefined; isMe?: boolean; onOpen: () => void }) {
  const name = displayName(member)
  const label = presenceLabel(member)
  const tone = label.toLowerCase()
  return (
    <button type="button" className={`tile${member.online ? '' : ' tile--offline'}`} aria-label={`${name}, ${label}`} onClick={onOpen}>
      <span className="tile__head">
        <span className="tile__avatar">
          <Avatar member={member} />
          <span className={`dot dot--${tone}`} aria-hidden="true" />
        </span>
        <span className="tile__who">
          <span className="tile__name">
            {name}
            {isMe && <span className="tile__you"> (you)</span>}
          </span>
          <span className={`tile__status tile__status--${tone}`}>{label}</span>
          {member.online && member.statusText && <span className="tile__note">{member.statusText}</span>}
        </span>
      </span>
      <span className="tile__prs">
        {prs === 'error' ? (
          <span className="muted">Couldn't load</span>
        ) : prs === undefined ? null : prs.length === 0 ? (
          <span className="muted">No open PRs</span>
        ) : (
          <>
            {prs.slice(0, MAX_PILLS).map((pr) => (
              <span key={pr.url} className={`pill pill--${prPillTone(pr)}`} title={pr.title}>
                {prPill(pr)}
              </span>
            ))}
            {prs.length > MAX_PILLS && <span className="pill pill--more">+{prs.length - MAX_PILLS} more</span>}
          </>
        )}
      </span>
    </button>
  )
}
