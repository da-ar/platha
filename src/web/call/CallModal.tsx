import { useState, type FormEvent } from 'react'
import { displayName, type Member } from '../../shared/types'
import { normalizeMeetUrl } from '../../shared/validators'
import { MEET_NEW } from './meet'
import type { Outgoing } from './useKnocks'

export function outgoingCopy(o: Outgoing): string {
  const name = displayName(o.to)
  switch (o.state) {
    case 'calling':
      return `Calling ${name}…`
    case 'ringing':
      return `Ringing ${name}…`
    case 'unreachable':
      return `Couldn't reach ${name} — check your connection and try again.`
    case 'joined':
      return `${name} is joining the call`
    case 'declined':
      return `${name} can't talk right now`
    case 'no_answer':
      return 'No answer — try Slack?'
    case 'went_offline':
      return `${name} just went offline`
  }
}

export function CallModal({
  member,
  popupBlocked,
  outgoing,
  onSubmit,
  onCancel,
}: {
  member: Member
  popupBlocked: boolean
  outgoing: Outgoing | null
  onSubmit: (meetUrl: string) => void
  onCancel: () => void
}) {
  const [link, setLink] = useState('')
  const [error, setError] = useState<string | null>(null)
  const name = displayName(member)

  function submit(e: FormEvent) {
    e.preventDefault()
    const url = normalizeMeetUrl(link)
    if (!url) return setError("That doesn't look like a Meet link")
    setError(null)
    onSubmit(url)
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="call-title" onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <div className="modal__card">
        <h2 id="call-title">Call {name}</h2>
        {outgoing ? (
          <>
            <p role="status">{outgoingCopy(outgoing)}</p>
            <div className="modal__actions">
              <button className="btn" type="button" onClick={onCancel}>
                Close
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            {popupBlocked ? (
              <p>
                Your browser blocked the new tab.{' '}
                <a href={MEET_NEW} target="_blank" rel="noopener noreferrer">
                  Open Google Meet
                </a>
                , then copy the meeting link.
              </p>
            ) : (
              <p>A new Google Meet opened in another tab. Copy its link and paste it here.</p>
            )}
            <div className="field">
              <label htmlFor="meet-link">Meet link</label>
              <input
                id="meet-link"
                autoFocus
                autoComplete="off"
                placeholder="https://meet.google.com/abc-defg-hij"
                value={link}
                onChange={(e) => setLink(e.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <div className="modal__actions">
              <button className="btn" type="button" onClick={onCancel}>
                Cancel
              </button>
              <button className="btn btn--primary" type="submit" disabled={!link.trim()}>
                Ring {name}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
