import type { AttentionItem, AttentionKind } from '../github/attention'
import type { GitHubStatus } from '../github/useGitHub'

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

export function NeedsYou({ items, status, onOpen }: { items: AttentionItem[]; status: GitHubStatus; onOpen: (item: AttentionItem) => void }) {
  return (
    <section className="panel needs" aria-labelledby="needs-heading">
      <h2 id="needs-heading">
        Needs you{status !== 'loading' && status !== 'unauthorized' ? ` · ${items.length}` : ''}
      </h2>
      {status === 'loading' && items.length === 0 ? (
        <p className="muted">Checking GitHub…</p>
      ) : status === 'unauthorized' ? (
        <p className="muted">Add a GitHub token to see what needs you.</p>
      ) : items.length === 0 ? (
        <p className="muted">Nothing needs you right now.</p>
      ) : (
        <ul className="needs__list">
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
