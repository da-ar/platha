import { useAutoAnimate } from '@formkit/auto-animate/react'
import type { AttentionItem, AttentionKind } from '../github/attention'
import type { GitHubStatus } from '../github/useGitHub'
import { updatedAgo } from './Banner'
import { GLYPHS } from './PrStatusIcons'

export const KIND_LABEL: Record<AttentionKind, string> = {
  review_requested: 'Review requested',
  changes_or_comments: 'Changes or comments',
  ready_to_merge: 'Ready to merge',
  mentioned: 'Mentioned',
  ci_failing: 'CI failing',
}

const KIND_ICON: Record<AttentionKind, string> = {
  review_requested: '👀',
  changes_or_comments: '💬',
  ready_to_merge: '✅',
  mentioned: '@',
  ci_failing: '❌',
}

export interface NeedsYouProps {
  items: AttentionItem[]
  status: GitHubStatus
  onOpen: (item: AttentionItem) => void
  updatedAt?: number | null
  now?: number
  fetching?: boolean
  onRefresh?: () => void
}

/** Freshness of the GitHub data; amber when the latest refresh failed. */
function Freshness({ status, updatedAt, now }: { status: GitHubStatus; updatedAt: number | null; now: number }) {
  const failed = status === 'error'
  if (updatedAt === null && !failed) return null
  const text = updatedAt === null ? "Couldn't reach GitHub" : updatedAgo(updatedAt, now)
  return (
    <span className={`needs__updated${failed ? ' needs__updated--stale' : ''}`}>
      {text}
      {failed ? ' · retrying' : ''}
    </span>
  )
}

export function NeedsYou({ items, status, onOpen, updatedAt = null, now = Date.now(), fetching = false, onRefresh }: NeedsYouProps) {
  // Animates only what changed: new rows fade in, removed rows fade out, moved rows glide.
  const [listRef] = useAutoAnimate<HTMLUListElement>()
  return (
    <section className="panel needs" aria-labelledby="needs-heading">
      <div className="needs__head">
        <h2 id="needs-heading">
          Needs you{status !== 'loading' && status !== 'unauthorized' ? ` · ${items.length}` : ''}
        </h2>
        {status !== 'unauthorized' && (
          <span className="needs__meta">
            <Freshness status={status} updatedAt={updatedAt} now={now} />
            {onRefresh && (
              <button
                type="button"
                className={`icon-btn${fetching ? ' icon-btn--busy' : ''}`}
                aria-label="Refresh"
                title="Refresh from GitHub"
                disabled={fetching}
                onClick={onRefresh}
              >
                <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {GLYPHS.refresh}
                </svg>
              </button>
            )}
          </span>
        )}
      </div>
      {status === 'loading' && items.length === 0 ? (
        <p className="muted">Checking GitHub…</p>
      ) : status === 'unauthorized' ? (
        <p className="muted">Add a GitHub token to see what needs you.</p>
      ) : items.length === 0 ? (
        <p className="muted">Nothing needs you right now.</p>
      ) : (
        <ul className="needs__list" ref={listRef}>
          {items.map((item) => (
            <li key={item.url}>
              <button type="button" className={`needs__item needs__item--${item.kind}`} onClick={() => onOpen(item)}>
                <span className="needs__icon" aria-hidden="true">
                  {KIND_ICON[item.kind]}
                </span>
                <span className="needs__body">
                  <span className="needs__kind">{KIND_LABEL[item.kind]}</span>
                  <span className="needs__title">
                    #{item.number} {item.title}
                  </span>
                  <span className="needs__repo">{item.repo}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
