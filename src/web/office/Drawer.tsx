import { useEffect } from 'react'
import { displayName, type Member } from '../../shared/types'
import { slackDmUrl } from '../call/slack'
import type { PullRequest } from '../github/types'
import { Avatar } from './Avatar'
import { presenceLabel } from './presence'
import { PrStatusIcons } from './PrStatusIcons'

export function Drawer({
  member,
  prs,
  isMe,
  slackTeamId,
  onClose,
  onCall,
}: {
  member: Member
  prs: PullRequest[] | 'error' | undefined
  isMe: boolean
  slackTeamId: string
  onClose: () => void
  onCall: () => void
}) {
  const name = displayName(member)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const noSlack = !member.slackUserId ? `${name} hasn't added their Slack ID` : !slackTeamId ? "Slack isn't set up for this office" : null

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={name}>
        <div className="drawer__head">
          <Avatar member={member} size={56} />
          <div>
            <h2>{name}</h2>
            <span className="muted">
              @{member.login} · {presenceLabel(member)}
              {member.online && member.statusText ? ` · ${member.statusText}` : ''}
            </span>
          </div>
          <button className="btn btn--ghost drawer__close" type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {!isMe && (
          <div className="drawer__actions">
            {noSlack ? (
              <button className="btn" type="button" disabled title={noSlack}>
                Chat
              </button>
            ) : (
              <a className="btn" href={slackDmUrl(slackTeamId, member.slackUserId!)}>
                Chat
              </a>
            )}
            <button className="btn btn--primary" type="button" disabled={!member.online} title={member.online ? undefined : `${name} is offline`} onClick={onCall}>
              Call
            </button>
          </div>
        )}

        <section className="drawer__section">
          <h2>Open pull requests</h2>
          {prs === 'error' ? (
            <p className="muted">Couldn't load</p>
          ) : prs === undefined ? (
            <p className="muted">Loading…</p>
          ) : prs.length === 0 ? (
            <p className="muted">No open pull requests.</p>
          ) : (
            <ul className="pr-list">
              {prs.map((pr) => (
                <li key={pr.url}>
                  <a href={pr.url} target="_blank" rel="noopener noreferrer">
                    <span className="pr-list__title">
                      #{pr.number} {pr.title}
                    </span>
                    <span className="pr-list__meta">
                      <span className="pr-list__repo">{pr.repo}</span>
                      <PrStatusIcons pr={pr} />
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </>
  )
}
