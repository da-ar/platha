import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useOffice } from '../../../src/web/office/useOffice'
import { go } from '../../../src/web/navigate'
import { FakeWebSocket, installFakeWebSocket } from '../fake-websocket'
import { mockApi } from '../fetch-mock'

vi.mock('../../../src/web/navigate', () => ({ go: vi.fn(), openTab: vi.fn() }))

beforeEach(() => {
  vi.useFakeTimers()
  installFakeWebSocket()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('connects to /ws on the same origin', () => {
  renderHook(() => useOffice())
  expect(FakeWebSocket.latest().url).toBe('ws://localhost:3000/ws')
})

test('pings every 25s', () => {
  renderHook(() => useOffice())
  const ws = FakeWebSocket.latest()
  act(() => ws.serverOpen())
  act(() => vi.advanceTimersByTime(25_000))
  expect(ws.sent).toEqual(['ping'])
  act(() => vi.advanceTimersByTime(25_000))
  expect(ws.sent).toEqual(['ping', 'ping'])
})

test('applies server messages and ignores pong', () => {
  const { result } = renderHook(() => useOffice())
  const ws = FakeWebSocket.latest()
  act(() => ws.serverOpen())
  expect(result.current.state.connection).toBe('open')
  act(() => ws.serverSend('pong'))
  act(() =>
    ws.serverSend({
      type: 'snapshot',
      members: [{ githubId: 1, login: 'a', name: null, avatarUrl: '', slackUserId: null, role: 'admin', status: 'available', statusText: null, online: true }],
    }),
  )
  expect(Object.keys(result.current.state.members)).toEqual(['1'])
})

test('send serialises client messages', () => {
  const { result } = renderHook(() => useOffice())
  const ws = FakeWebSocket.latest()
  act(() => ws.serverOpen())
  result.current.send({ type: 'set_status', status: 'away' })
  expect(ws.sent).toEqual(['{"type":"set_status","status":"away"}'])
})

test('reconnects with 1s,2s,4s… capped at 30s backoff', async () => {
  mockApi(() => ({ status: 500 }))
  const { result } = renderHook(() => useOffice())
  act(() => FakeWebSocket.latest().serverOpen())
  const delays = [1000, 2000, 4000, 8000, 16000, 30000, 30000]
  for (const delay of delays) {
    const before = FakeWebSocket.instances.length
    await act(async () => FakeWebSocket.latest().serverClose())
    expect(result.current.state.connection).toBe('reconnecting')
    await act(async () => vi.advanceTimersByTime(delay - 1))
    expect(FakeWebSocket.instances.length).toBe(before)
    await act(async () => vi.advanceTimersByTime(1))
    expect(FakeWebSocket.instances.length).toBe(before + 1)
  }
  // a successful open resets the backoff
  act(() => FakeWebSocket.latest().serverOpen())
  const before = FakeWebSocket.instances.length
  await act(async () => FakeWebSocket.latest().serverClose())
  await act(async () => vi.advanceTimersByTime(1000))
  expect(FakeWebSocket.instances.length).toBe(before + 1)
})

test('session_revoked sets removed and stops reconnecting', async () => {
  const { result } = renderHook(() => useOffice())
  const ws = FakeWebSocket.latest()
  act(() => ws.serverOpen())
  act(() => ws.serverSend({ type: 'session_revoked' }))
  await act(async () => ws.serverClose(4403))
  expect(result.current.state.connection).toBe('removed')
  await act(async () => vi.advanceTimersByTime(60_000))
  expect(FakeWebSocket.instances).toHaveLength(1)
})

test('a socket that never opens checks the session and goes to sign-in on 401', async () => {
  mockApi(() => ({ status: 401 }))
  renderHook(() => useOffice())
  await act(async () => FakeWebSocket.latest().serverClose())
  expect(go).toHaveBeenCalledWith('/')
  await act(async () => vi.advanceTimersByTime(60_000))
  expect(FakeWebSocket.instances).toHaveLength(1)
})

test('subscribers receive server messages', () => {
  const { result } = renderHook(() => useOffice())
  const ws = FakeWebSocket.latest()
  act(() => ws.serverOpen())
  const got: unknown[] = []
  const off = result.current.subscribe((m) => got.push(m))
  act(() => ws.serverSend({ type: 'member_removed', githubId: 3 }))
  off()
  act(() => ws.serverSend({ type: 'member_removed', githubId: 4 }))
  expect(got).toEqual([{ type: 'member_removed', githubId: 3 }])
})
