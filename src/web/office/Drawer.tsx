import { useEffect } from 'react'
import { displayName, type Member } from '../../shared/types'
import { slackDmUrl, slackWebUrl } from '../call/slack'
import type { PullRequest } from '../github/types'
import { Avatar } from './Avatar'
import { presenceLabel } from './presence'

const REVIEW: Record<string, string> = {
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Changes requested',
  REVIEW_REQUIRED: 'Review required',
}

const CI: Record<string, string> = {
  SUCCESS: 'CI passing',
  FAILURE: 'CI failing',
  ERROR: 'CI error',
  PENDING: 'CI running',
  EXPECTED: 'CI waiting',
}

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
            {slackTeamId && (
              <a className="hint" href={slackWebUrl(slackTeamId)} target="_blank" rel="noopener noreferrer">
                Open Slack in browser
              </a>
            )}
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
                      <span>{pr.repo}</span>
                      <span>{pr.isDraft ? 'Draft' : 'Ready'}</span>
                      {pr.reviewDecision && <span>{REVIEW[pr.reviewDecision]}</span>}
                      {pr.ci && <span>{CI[pr.ci]}</span>}
                      {pr.mergeable === 'CONFLICTING' && <span>Conflicts</span>}
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
