import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useGitHub } from '../../../src/web/github/useGitHub'
import { fetchSnapshot } from '../../../src/web/github/query'
import type { GitHubSnapshot } from '../../../src/web/github/types'
import { setToken } from '../../../src/web/token'

vi.mock('../../../src/web/github/query', () => ({ fetchSnapshot: vi.fn() }))
const fetchMock = vi.mocked(fetchSnapshot)

const empty: GitHubSnapshot = { reviewRequested: [], mine: [], mentions: [], byTeammate: {} }
let visibility: DocumentVisibilityState = 'visible'

function setVisibility(v: DocumentVisibilityState) {
  visibility = v
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers()
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  setToken('tok')
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ status: 200, snapshot: empty })
})

afterEach(() => {
  vi.useRealTimers()
})

const flush = () => act(async () => {})
const advance = (ms: number) => act(async () => vi.advanceTimersByTime(ms))

test('polls every 60s while visible and not while hidden', async () => {
  const { result } = renderHook(() => useGitHub({ org: 'acme', teammates: ['bob'] }))
  await flush()
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(fetchMock).toHaveBeenCalledWith('tok', 'acme', ['bob'])
  expect(result.current.status).toBe('ok')
  expect(result.current.updatedAt).not.toBeNull()
  await advance(60_000)
  expect(fetchMock).toHaveBeenCalledTimes(2)
  act(() => setVisibility('hidden'))
  await advance(300_000)
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

test('refreshes immediately when tab becomes visible', async () => {
  renderHook(() => useGitHub({ org: 'acme', teammates: [] }))
  await flush()
  act(() => setVisibility('hidden'))
  await advance(10_000)
  await act(async () => setVisibility('visible'))
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

test('401 → unauthorized and polling stops', async () => {
  fetchMock.mockResolvedValue({ status: 401 })
  const { result } = renderHook(() => useGitHub({ org: 'acme', teammates: [] }))
  await flush()
  expect(result.current.status).toBe('unauthorized')
  await advance(600_000)
  await act(async () => setVisibility('visible'))
  expect(fetchMock).toHaveBeenCalledTimes(1)
  fetchMock.mockResolvedValue({ status: 200, snapshot: empty })
  await act(async () => result.current.refresh())
  expect(result.current.status).toBe('ok')
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

test('no token → unauthorized without calling GitHub', async () => {
  localStorage.clear()
  const { result } = renderHook(() => useGitHub({ org: 'acme', teammates: [] }))
  await flush()
  expect(result.current.status).toBe('unauthorized')
  expect(fetchMock).not.toHaveBeenCalled()
})

test('429 keeps last snapshot and backs off 120s then 240s', async () => {
  const { result } = renderHook(() => useGitHub({ org: 'acme', teammates: [] }))
  await flush()
  const first = result.current.snapshot
  expect(first).toBe(empty)
  fetchMock.mockResolvedValue({ status: 429 })
  await advance(60_000)
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(result.current.status).toBe('error')
  expect(result.current.snapshot).toBe(first)
  await advance(119_999)
  expect(fetchMock).toHaveBeenCalledTimes(2)
  await advance(1)
  expect(fetchMock).toHaveBeenCalledTimes(3)
  await advance(239_999)
  expect(fetchMock).toHaveBeenCalledTimes(3)
  await advance(1)
  expect(fetchMock).toHaveBeenCalledTimes(4)
  // becoming visible during backoff does not skip the wait
  act(() => setVisibility('hidden'))
  await act(async () => setVisibility('visible'))
  expect(fetchMock).toHaveBeenCalledTimes(4)
  // success resets to 60s
  fetchMock.mockResolvedValue({ status: 200, snapshot: empty })
  await advance(480_000)
  expect(fetchMock).toHaveBeenCalledTimes(5)
  expect(result.current.status).toBe('ok')
  await advance(60_000)
  expect(fetchMock).toHaveBeenCalledTimes(6)
})

test('a change of teammates refetches immediately', async () => {
  const { rerender } = renderHook(({ t }) => useGitHub({ org: 'acme', teammates: t }), { initialProps: { t: ['bob'] } })
  await flush()
  rerender({ t: ['bob'] })
  await flush()
  expect(fetchMock).toHaveBeenCalledTimes(1)
  rerender({ t: ['bob', 'carol'] })
  await flush()
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(fetchMock).toHaveBeenLastCalledWith('tok', 'acme', ['bob', 'carol'])
})
