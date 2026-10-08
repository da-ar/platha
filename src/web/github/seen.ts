import type { AttentionItem } from './attention'

export interface SeenState {
  /** Activity before this time counts as seen, so a fresh install doesn't flag everything. */
  firstRunAt: string
  /** url → GitHub timestamp of the latest activity the user has opened. */
  seen: Record<string, string>
}

const KEY = 'platha.seen'
const KEEP_MS = 60 * 24 * 60 * 60 * 1000

function persist(state: SeenState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // storage unavailable; seen state lasts for this page only
  }
}

function read(): SeenState | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (raw && typeof raw.firstRunAt === 'string' && !Number.isNaN(Date.parse(raw.firstRunAt)) && raw.seen && typeof raw.seen === 'object') {
      return { firstRunAt: raw.firstRunAt, seen: raw.seen }
    }
  } catch {
    // fall through
  }
  return null
}

/**
 * Loads seen state, pruning entries older than 60 days. Pruned entries stay seen
 * because `firstRunAt` is moved up to the same cutoff.
 */
export function loadSeen(): SeenState {
  const now = Date.now()
  const state = read() ?? { firstRunAt: new Date(now).toISOString(), seen: {} }
  const cutoff = now - KEEP_MS
  if (Date.parse(state.firstRunAt) < cutoff) state.firstRunAt = new Date(cutoff).toISOString()
  const floor = Date.parse(state.firstRunAt)
  const seen: Record<string, string> = {}
  for (const [url, at] of Object.entries(state.seen)) {
    if (typeof at === 'string' && Date.parse(at) > floor) seen[url] = at
  }
  const next = { firstRunAt: state.firstRunAt, seen }
  persist(next)
  return next
}

/** Marks the item seen at its own GitHub activity time, never local time, so clock skew can't hide or revive it. */
export function markSeen(state: SeenState, item: AttentionItem): SeenState {
  const current = state.seen[item.url]
  if (current && Date.parse(current) >= Date.parse(item.activityAt)) return state
  const next = { ...state, seen: { ...state.seen, [item.url]: item.activityAt } }
  persist(next)
  return next
}
