import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { CalendarDay, HOUR_PX, offsetPx } from '../../../src/web/office/CalendarDay'
import { clockTime } from '../../../src/web/office/presence'
import { mockApi } from '../fetch-mock'

const NOW = new Date(2026, 9, 8, 9, 30).getTime() // 09:30 local
const at = (h: number, m = 0) => new Date(2026, 9, 8, h, m).getTime()
const DAY = new Date(2026, 9, 8).getTime()

afterEach(() => {
  vi.useRealTimers()
})

async function show(body: unknown, status = 200) {
  vi.useFakeTimers({ now: NOW })
  mockApi(() => ({ status, body }))
  const utils = render(<CalendarDay githubId={2} isMe={false} />)
  await act(async () => {})
  return utils
}

describe('timeline', () => {
  test('busy blocks are placed by time and labelled', async () => {
    await show({ state: 'ok', busy: [{ start: at(10), end: at(11, 30), allDay: false }], fetchedAt: NOW })
    const label = `Busy ${clockTime(at(10))}–${clockTime(at(11, 30))}`
    const block = screen.getByTitle(label)
    expect(block).toHaveTextContent(label)
    expect(block.style.top).toBe(`${10 * HOUR_PX}px`)
    expect(block.style.height).toBe(`${1.5 * HOUR_PX}px`)
    expect(screen.queryByText('Free all day')).toBeNull()
  })

  test('the now line sits at the current time and moves each minute', async () => {
    await show({ state: 'ok', busy: [], fetchedAt: NOW })
    const line = () => screen.getByRole('img', { name: /^Now, / })
    expect(line().style.top).toBe(`${offsetPx(NOW, DAY)}px`)
    await act(async () => vi.advanceTimersByTime(60_000))
    expect(line().style.top).toBe(`${offsetPx(NOW + 60_000, DAY)}px`)
  })

  test('free all day, and busy all day', async () => {
    const { unmount } = await show({ state: 'ok', busy: [], fetchedAt: NOW })
    expect(screen.getByText('Free all day')).toBeInTheDocument()
    unmount()
    vi.useRealTimers()
    const today = Date.UTC(2026, 9, 8)
    await show({ state: 'ok', busy: [{ start: today, end: today + 86_400_000, allDay: true }], fetchedAt: NOW })
    expect(screen.getByText('Busy all day')).toBeInTheDocument()
    expect(screen.queryByText('Free all day')).toBeNull()
  })

  test('blocks from other days are left out; blocks crossing midnight are clipped', async () => {
    await show({
      state: 'ok',
      busy: [
        { start: at(-2), end: at(-1), allDay: false },
        { start: at(23), end: at(25), allDay: false },
      ],
      fetchedAt: NOW,
    })
    const blocks = document.querySelectorAll('.cal__busy')
    expect(blocks).toHaveLength(1)
    expect((blocks[0] as HTMLElement).style.height).toBe(`${HOUR_PX}px`)
  })

  test('old data after errors says when it was last updated', async () => {
    await show({ state: 'error', busy: [{ start: at(10), end: at(11), allDay: false }], fetchedAt: NOW - 40 * 60_000 })
    expect(screen.getByText(`Last updated ${clockTime(NOW - 40 * 60_000)}`)).toBeInTheDocument()
    expect(document.querySelectorAll('.cal__busy')).toHaveLength(1)
  })
})

describe('states', () => {
  test.each([
    [{ state: 'no_email', busy: [], fetchedAt: null }, 'Calendar not shared.'],
    [{ state: 'unavailable', busy: [], fetchedAt: null }, 'Calendar not shared.'],
    [{ state: 'pending', busy: [], fetchedAt: null }, 'Checking calendar…'],
    [{ state: 'error', busy: [], fetchedAt: null }, 'Calendar temporarily unavailable — retrying.'],
  ])('%o shows %s', async (body, text) => {
    await show(body)
    expect(screen.getByText(text)).toBeInTheDocument()
    expect(document.querySelector('.cal__grid')).toBeNull()
  })

  test('a failed request', async () => {
    await show({}, 502)
    expect(screen.getByText("Couldn't load calendar.")).toBeInTheDocument()
  })

  test('re-reads every 5 minutes', async () => {
    vi.useFakeTimers({ now: NOW })
    const calls = mockApi(() => ({ status: 200, body: { state: 'ok', busy: [], fetchedAt: NOW } }))
    render(<CalendarDay githubId={2} isMe={false} />)
    await act(async () => {})
    expect(calls).toHaveLength(1)
    expect(calls[0].path).toBe('/api/calendar/2')
    await act(async () => vi.advanceTimersByTime(5 * 60_000))
    expect(calls).toHaveLength(2)
  })
})
