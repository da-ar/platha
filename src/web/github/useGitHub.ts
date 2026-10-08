import { useCallback, useEffect, useState } from 'react'
import { getToken } from '../token'
import { fetchSnapshot } from './query'
import type { GitHubSnapshot } from './types'

export const POLL_MS = 60_000
const BACKOFF_MAX_MS = 600_000

export type GitHubStatus = 'loading' | 'ok' | 'unauthorized' | 'error'

export interface GitHubState {
  snapshot: GitHubSnapshot | null
  status: GitHubStatus
  updatedAt: number | null
  refresh: () => void
}

export function useGitHub({ org, teammates }: { org: string; teammates: string[] }): GitHubState {
  const [snapshot, setSnapshot] = useState<GitHubSnapshot | null>(null)
  const [status, setStatus] = useState<GitHubStatus>('loading')
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [nonce, setNonce] = useState(0)
  const teammatesKey = teammates.join(',')

  useEffect(() => {
    const list = teammatesKey === '' ? [] : teammatesKey.split(',')
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let inFlight = false
    let stopped = false
    let backoff = 0 // 0 = not backing off
    let nextAt = 0

    const visible = () => document.visibilityState === 'visible'

    function schedule(delay: number) {
      clearTimeout(timer)
      nextAt = Date.now() + delay
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
      const r = await fetchSnapshot(token, org, list)
      inFlight = false
      if (cancelled) return
      if (r.status === 200 && r.snapshot) {
        backoff = 0
        setSnapshot(r.snapshot)
        setStatus('ok')
        setUpdatedAt(Date.now())
        schedule(POLL_MS)
      } else if (r.status === 401) {
        stopped = true
        setStatus('unauthorized')
      } else {
        backoff = Math.min(backoff === 0 ? POLL_MS * 2 : backoff * 2, BACKOFF_MAX_MS)
        setStatus('error')
        schedule(backoff)
      }
    }

    function onVisibility() {
      if (cancelled || stopped) return
      if (!visible()) {
        clearTimeout(timer)
        return
      }
      // Refresh straight away, unless GitHub asked us to back off.
      if (backoff > 0) schedule(Math.max(0, nextAt - Date.now()))
      else void poll()
    }

    document.addEventListener('visibilitychange', onVisibility)
    if (visible()) void poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [org, teammatesKey, nonce])

  const refresh = useCallback(() => {
    setStatus((s) => (s === 'unauthorized' ? 'loading' : s))
    setNonce((n) => n + 1)
  }, [])

  return { snapshot, status, updatedAt, refresh }
}
