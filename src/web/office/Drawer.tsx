import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { displayName, type Member } from '../../shared/types'
import { slackDmUrl } from '../call/slack'
import type { PullRequest } from '../github/types'
import { Avatar } from './Avatar'
import { CalendarDay } from './CalendarDay'
import { presenceText } from './presence'
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

  const [tab, setTab] = useState<'prs' | 'calendar'>('prs')
  const tabRefs = { prs: useRef<HTMLButtonElement>(null), calendar: useRef<HTMLButtonElement>(null) }
  function onTabKey(e: ReactKeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const next = tab === 'prs' ? 'calendar' : 'prs'
    setTab(next)
    tabRefs[next].current?.focus()
  }

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
              @{member.login} · {presenceText(member)}
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

        <div className="tabs" role="tablist" aria-label={`${name}'s work and calendar`} onKeyDown={onTabKey}>
          <button
            ref={tabRefs.prs}
            type="button"
            role="tab"
            id="tab-prs"
            aria-controls="panel-prs"
            aria-selected={tab === 'prs'}
            tabIndex={tab === 'prs' ? 0 : -1}
            className="tabs__tab"
            onClick={() => setTab('prs')}
          >
            Pull requests
          </button>
          <button
            ref={tabRefs.calendar}
            type="button"
            role="tab"
            id="tab-calendar"
            aria-controls="panel-calendar"
            aria-selected={tab === 'calendar'}
            tabIndex={tab === 'calendar' ? 0 : -1}
            className="tabs__tab"
            onClick={() => setTab('calendar')}
          >
            Calendar
          </button>
        </div>

        {tab === 'prs' ? (
          <section className="drawer__section" role="tabpanel" id="panel-prs" aria-labelledby="tab-prs">
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
        ) : (
          <section className="drawer__section drawer__section--calendar" role="tabpanel" id="panel-calendar" aria-labelledby="tab-calendar">
            <CalendarDay githubId={member.githubId} isMe={isMe} />
          </section>
        )}
      </aside>
    </>
  )
}
