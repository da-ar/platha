import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ServerMessage } from '../../../src/shared/messages'
import { useKnocks } from '../../../src/web/call/useKnocks'
import { openTab } from '../../../src/web/navigate'
import { member } from '../factories'

vi.mock('../../../src/web/navigate', () => ({ go: vi.fn(), openTab: vi.fn() }))

const MEET = 'https://meet.google.com/abc-defg-hij'
const alice = member({ githubId: 1, login: 'alice', name: 'Alice' })
const bob = member({ githubId: 2, login: 'bob', name: 'Bob' })
const members = { 1: alice, 2: bob }

let listener: ((m: ServerMessage) => void) | null
const office = {
  send: vi.fn(),
  subscribe: vi.fn((fn: (m: ServerMessage) => void) => {
    listener = fn
    return () => {
      listener = null
    }
  }),
}
const emit = (m: ServerMessage) => act(() => listener?.(m))

beforeEach(() => {
  vi.useFakeTimers()
  listener = null
  office.send.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

test('call sends a knock and rings', () => {
  const { result } = renderHook(() => useKnocks(office, members))
  act(() => result.current.call(bob, MEET))
  const sent = office.send.mock.calls[0][0]
  expect(sent).toMatchObject({ type: 'knock', to: 2, meetUrl: MEET })
  expect(sent.knockId).toMatch(/^[0-9a-f-]{36}$/)
  expect(result.current.outgoing).toMatchObject({ knockId: sent.knockId, to: bob, state: 'ringing' })
})

test('outgoing knock times out after 45s → no_answer', () => {
  const { result } = renderHook(() => useKnocks(office, members))
  act(() => result.current.call(bob, MEET))
  act(() => vi.advanceTimersByTime(44_999))
  expect(result.current.outgoing?.state).toBe('ringing')
  act(() => vi.advanceTimersByTime(1))
  expect(result.current.outgoing?.state).toBe('no_answer')
})

test('answers update the outgoing knock and stick', () => {
  const { result } = renderHook(() => useKnocks(office, members))
  act(() => result.current.call(bob, MEET))
  const knockId = result.current.outgoing!.knockId
  emit({ type: 'knock_answered', knockId: crypto.randomUUID(), answer: 'join' })
  expect(result.current.outgoing?.state).toBe('ringing')
  emit({ type: 'knock_answered', knockId, answer: 'decline' })
  expect(result.current.outgoing?.state).toBe('declined')
  act(() => vi.advanceTimersByTime(45_000))
  expect(result.current.outgoing?.state).toBe('declined')
})

test('callee going offline while ringing → went_offline', () => {
  const { result } = renderHook(() => useKnocks(office, members))
  act(() => result.current.call(bob, MEET))
  emit({ type: 'member_updated', member: { ...bob, online: false } })
  expect(result.current.outgoing?.state).toBe('went_offline')
})

test('knock_failed → went_offline', () => {
  const { result } = renderHook(() => useKnocks(office, members))
  act(() => result.current.call(bob, MEET))
  emit({ type: 'knock_failed', knockId: result.current.outgoing!.knockId, reason: 'offline' })
  expect(result.current.outgoing?.state).toBe('went_offline')
})

test('incoming join sends knock_answer and opens meet url', () => {
  const { result } = renderHook(() => useKnocks(office, members))
  const knockId = crypto.randomUUID()
  emit({ type: 'knock', knockId, from: 1, meetUrl: MEET })
  expect(result.current.incoming).toEqual([{ knockId, from: alice, meetUrl: MEET }])
  act(() => result.current.answer(result.current.incoming[0], 'join'))
  expect(office.send).toHaveBeenCalledWith({ type: 'knock_answer', knockId, to: 1, answer: 'join' })
  expect(openTab).toHaveBeenCalledWith(MEET)
  expect(result.current.incoming).toEqual([])
})

test('incoming knock auto-dismisses after 45s; unknown callers are ignored', () => {
  const { result } = renderHook(() => useKnocks(office, members))
  emit({ type: 'knock', knockId: crypto.randomUUID(), from: 99, meetUrl: MEET })
  expect(result.current.incoming).toEqual([])
  emit({ type: 'knock', knockId: crypto.randomUUID(), from: 1, meetUrl: MEET })
  act(() => vi.advanceTimersByTime(45_000))
  expect(result.current.incoming).toEqual([])
})
