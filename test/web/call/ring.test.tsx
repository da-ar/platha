import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRinging } from '../../../src/web/call/ring'
import { AlertsButton } from '../../../src/web/call/AlertsButton'
import type { Incoming } from '../../../src/web/call/useKnocks'
import { member } from '../factories'

const alice = member({ githubId: 1, login: 'alice', name: 'Alice' })
const knock = (id: string): Incoming => ({ knockId: id, from: alice, meetUrl: 'https://meet.google.com/abc-defg-hij' })

class FakeNotification {
  static permission: NotificationPermission = 'granted'
  static requestPermission = vi.fn(async () => 'granted' as NotificationPermission)
  static shown: FakeNotification[] = []
  closed = false
  onclick: (() => void) | null = null
  constructor(
    public title: string,
    public options: NotificationOptions,
  ) {
    FakeNotification.shown.push(this)
  }
  close() {
    this.closed = true
  }
}

beforeEach(() => {
  FakeNotification.shown = []
  FakeNotification.permission = 'granted'
  vi.stubGlobal('Notification', FakeNotification)
  document.title = 'Platha'
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('an incoming knock shows one desktop notification, closed when the knock ends', () => {
  const { rerender } = renderHook(({ list }) => useRinging(list), { initialProps: { list: [knock('a')] } })
  expect(FakeNotification.shown.map((n) => n.title)).toEqual(['Alice is calling'])
  expect(FakeNotification.shown[0].options).toMatchObject({ tag: 'a', requireInteraction: true })
  rerender({ list: [knock('a')] })
  expect(FakeNotification.shown).toHaveLength(1)
  rerender({ list: [] })
  expect(FakeNotification.shown[0].closed).toBe(true)
})

test('no notification without permission', () => {
  FakeNotification.permission = 'default'
  renderHook(() => useRinging([knock('a')]))
  expect(FakeNotification.shown).toEqual([])
})

test('the tab title flashes while ringing and is restored after', () => {
  vi.useFakeTimers()
  const { rerender } = renderHook(({ list }) => useRinging(list), { initialProps: { list: [knock('a')] } })
  expect(document.title).toBe('📞 Alice is calling')
  act(() => vi.advanceTimersByTime(1_000))
  expect(document.title).toBe('Platha')
  act(() => vi.advanceTimersByTime(1_000))
  expect(document.title).toBe('📞 Alice is calling')
  rerender({ list: [] })
  expect(document.title).toBe('Platha')
})

test('alerts button asks for permission and hides once decided', async () => {
  FakeNotification.permission = 'default'
  render(<AlertsButton />)
  await userEvent.click(screen.getByRole('button', { name: 'Turn on call alerts' }))
  expect(FakeNotification.requestPermission).toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'Turn on call alerts' })).toBeNull()
})

test('alerts button is hidden when already granted', () => {
  render(<AlertsButton />)
  expect(screen.queryByRole('button')).toBeNull()
})
