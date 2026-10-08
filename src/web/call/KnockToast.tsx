import { displayName } from '../../shared/types'
import type { Incoming } from './useKnocks'

export function KnockToasts({ incoming, onAnswer }: { incoming: Incoming[]; onAnswer: (k: Incoming, a: 'join' | 'decline') => void }) {
  if (incoming.length === 0) return null
  return (
    <div className="toasts" aria-live="assertive">
      {incoming.map((k) => (
        <div key={k.knockId} className="toast" role="alert">
          <span className="toast__text">{displayName(k.from)} is calling</span>
          <button className="btn btn--primary" type="button" onClick={() => onAnswer(k, 'join')}>
            Join
          </button>
          <button className="btn" type="button" onClick={() => onAnswer(k, 'decline')}>
            Not now
          </button>
        </div>
      ))}
    </div>
  )
}
