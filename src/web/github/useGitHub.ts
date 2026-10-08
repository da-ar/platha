import { useCallback, useEffect, useRef, useState } from 'react'
import { getToken } from '../token'
import { fetchSnapshot } from './query'
import { stableSnapshot } from './stable'
import type { GitHubSnapshot } from './types'

export const POLL_MS = 60_000
const BACKOFF_MAX_MS = 600_000

export type GitHubStatus = 'loading' | 'ok' | 'unauthorized' | 'error'

export interface GitHubState {
  snapshot: GitHubSnapshot | null
  status: GitHubStatus
  updatedAt: number | null
  /** True while a request to GitHub is in flight. */
  fetching: boolean
  /** Fetch now, even during a backoff; the 60 s cycle restarts from here. */
  refresh: () => void
}

export function useGitHub({ org, teammates }: { org: string; teammates: string[] }): GitHubState {
  const [snapshot, setSnapshot] = useState<GitHubSnapshot | null>(null)
  const [status, setStatus] = useState<GitHubStatus>('loading')
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [fetching, setFetching] = useState(false)
  const [nonce, setNonce] = useState(0)
  const teammatesKey = teammates.join(',')
  // Kept across effect re-runs so a manual refresh doesn't reset GitHub's backoff.
  const backoffRef = useRef(0) // 0 = not backing off
  const nextAtRef = useRef(0)
  const manualRef = useRef(false)

  useEffect(() => {
    const list = teammatesKey === '' ? [] : teammatesKey.split(',')
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let inFlight = false
    let stopped = false

    const visible = () => document.visibilityState === 'visible'

    function schedule(delay: number) {
      clearTimeout(timer)
      nextAtRef.current = Date.now() + delay
      if (visible()) timer = setTimeout(poll, delay)
    }

    async function poll() {
      if (cancelled || stopped || inFlight) return
      const token = getToken()
      if (!token) {
        stopped = true
        setStatus('unauthorized')
        return
      }
      inFlight = true
      setFetching(true)
      const r = await fetchSnapshot(token, org, list)
      inFlight = false
      if (cancelled) return
      setFetching(false)
      if (r.status === 200 && r.snapshot) {
        backoffRef.current = 0
        const next = r.snapshot
        setSnapshot((prev) => stableSnapshot(prev, next))
        setStatus('ok')
        setUpdatedAt(Date.now())
        schedule(POLL_MS)
      } else if (r.status === 401) {
        stopped = true
        setStatus('unauthorized')
      } else {
        const b = backoffRef.current
        backoffRef.current = Math.min(b === 0 ? POLL_MS * 2 : b * 2, BACKOFF_MAX_MS)
        setStatus('error')
        schedule(backoffRef.current)
      }
    }

    function onVisibility() {
      if (cancelled || stopped) return
      if (!visible()) {
        clearTimeout(timer)
        return
      }
      // Refresh straight away, unless GitHub asked us to back off.
      if (backoffRef.current > 0) schedule(Math.max(0, nextAtRef.current - Date.now()))
      else void poll()
    }

    document.addEventListener('visibilitychange', onVisibility)
    const manual = manualRef.current
    manualRef.current = false
    if (visible()) {
      // A manual refresh always fetches; otherwise respect a backoff already in progress.
      if (manual || backoffRef.current === 0) void poll()
      else schedule(Math.max(0, nextAtRef.current - Date.now()))
    }
    return () => {
      cancelled = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [org, teammatesKey, nonce])

  const refresh = useCallback(() => {
    manualRef.current = true
    setStatus((s) => (s === 'unauthorized' ? 'loading' : s))
    setNonce((n) => n + 1)
  }, [])

  return { snapshot, status, updatedAt, fetching, refresh }
}
