import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getCalendar, type BusyBlock, type CalendarView } from '../api'
import { clockTime } from './presence'
import { useNow } from './useNow'

export const HOUR_PX = 48
const REFRESH_MS = 5 * 60_000
const STALE_MS = 15 * 60_000
const HOUR = 3_600_000

function startOfDay(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function endOfDay(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
}

/** Pixel offset of `ms` from the top of the day's timeline. */
export function offsetPx(ms: number, dayStart: number): number {
  return ((ms - dayStart) / HOUR) * HOUR_PX
}

/** Timed blocks clipped to the local day; all-day blocks whose calendar date is today. */
export function blocksForDay(busy: BusyBlock[], now: number): { timed: BusyBlock[]; allDay: boolean } {
  const from = startOfDay(now)
  const to = endOfDay(now)
  const d = new Date(now)
  const todayUtc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  const timed = busy
    .filter((b) => !b.allDay && b.end > from && b.start < to)
    .map((b) => ({ ...b, start: Math.max(b.start, from), end: Math.min(b.end, to) }))
  const allDay = busy.some((b) => b.allDay && b.start <= todayUtc && todayUtc < b.end)
  return { timed, allDay }
}

function hourLabel(h: number): string {
  return new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' })
}

export function CalendarDay({ githubId, isMe }: { githubId: number; isMe: boolean }) {
  const now = useNow(60_000)
  const [view, setView] = useState<CalendarView | 'error' | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const scrolled = useRef(false)

  useEffect(() => {
    let cancelled = false
    const load = () =>
      void getCalendar(githubId).then((r) => {
        if (!cancelled) setView(r.ok ? r.data : 'error')
      })
    load()
    const t = setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [githubId])

  const dayStart = startOfDay(now)
  const showTimeline = view !== null && view !== 'error' && (view.state === 'ok' || (view.state === 'error' && view.busy.length > 0))

  // Start scrolled so "now" sits near the top, like Google Calendar.
  useLayoutEffect(() => {
    if (!showTimeline || scrolled.current || !scroller.current) return
    scroller.current.scrollTop = Math.max(0, offsetPx(Date.now(), dayStart) - 2 * HOUR_PX)
    scrolled.current = true
  }, [showTimeline, dayStart])

  const date = new Date(now).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
  const header = <h3 className="cal__date">{date}</h3>

  if (view === null) return <div className="cal">{header}<p className="muted">Loading calendar…</p></div>
  if (view === 'error') return <div className="cal">{header}<p className="muted">Couldn't load calendar.</p></div>
  if (view.state === 'pending') return <div className="cal">{header}<p className="muted">Checking calendar…</p></div>
  if (view.state === 'no_email' || view.state === 'unavailable') {
    return (
      <div className="cal">
        {header}
        <p className="muted">Calendar not shared.</p>
        {isMe && (
          <p className="hint">
            See <a href="/settings">Settings → Calendar</a> to share your free/busy times.
          </p>
        )}
      </div>
    )
  }
  if (!showTimeline) {
    return <div className="cal">{header}<p className="muted">Calendar temporarily unavailable — retrying.</p></div>
  }

  const { timed, allDay } = blocksForDay(view.busy, now)
  const stale = view.fetchedAt !== null && now - view.fetchedAt > STALE_MS
  return (
    <div className="cal">
      <div className="cal__head">
        {header}
        {stale && view.fetchedAt !== null && <span className="cal__stale">Last updated {clockTime(view.fetchedAt)}</span>}
      </div>
      {allDay && <div className="cal__allday">Busy all day</div>}
      {timed.length === 0 && !allDay && <p className="muted cal__free">Free all day</p>}
      <div className="cal__scroll" ref={scroller}>
        <div className="cal__grid" style={{ height: 24 * HOUR_PX }}>
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="cal__hour" style={{ top: h * HOUR_PX }}>
              <span className="cal__hour-label">{h === 0 ? '' : hourLabel(h)}</span>
            </div>
          ))}
          {timed.map((b) => {
            const label = `Busy ${clockTime(b.start)}–${clockTime(b.end)}`
            return (
              <div
                key={b.start}
                className="cal__busy"
                style={{ top: offsetPx(b.start, dayStart), height: Math.max(offsetPx(b.end, dayStart) - offsetPx(b.start, dayStart), 14) }}
                title={label}
              >
                <span>{label}</span>
              </div>
            )
          })}
          <div className="cal__now" style={{ top: offsetPx(now, dayStart) }} aria-label={`Now, ${clockTime(now)}`} role="img" />
        </div>
      </div>
    </div>
  )
}
