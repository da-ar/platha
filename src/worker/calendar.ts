import ICAL from 'ical.js'

/** A busy period in UTC ms. All-day blocks span whole UTC dates (the calendar's local date). */
export interface BusyBlock {
  start: number
  end: number
  allDay: boolean
}

export type SyncState = 'ok' | 'error' | 'unavailable' | 'no_email'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
export const SYNC_OK_MS = 5 * MINUTE
export const SYNC_UNAVAILABLE_MS = 6 * HOUR
const ERROR_BASE_MS = 5 * MINUTE
const ERROR_MAX_MS = HOUR
/** Upper bound on recurrence expansion per event, to cap CPU on old daily series. */
const MAX_OCCURRENCES = 5000

const EMAIL = /^[^\s@/?#%]+@[^\s@/?#%]+\.[^\s@/?#%]+$/

export const GOOGLE_ICAL_BASE = 'https://calendar.google.com/calendar/ical'

/** The public iCal address Google serves for a calendar shared publicly. */
export function calendarUrl(email: string, base: string = GOOGLE_ICAL_BASE): string {
  return `${base}/${encodeURIComponent(email)}/public/basic.ics`
}

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const email = raw.trim().toLowerCase()
  return email.length <= 254 && EMAIL.test(email) ? email : null
}

/** When to try a calendar again. `failures` counts consecutive errors including this one. */
export function nextAttempt(state: SyncState, failures: number, now: number, rand: number = Math.random()): number | null {
  if (state === 'no_email') return null
  if (state === 'ok') return now + SYNC_OK_MS
  if (state === 'unavailable') return now + SYNC_UNAVAILABLE_MS
  const base = Math.min(ERROR_BASE_MS * 2 ** Math.max(0, failures - 1), ERROR_MAX_MS)
  return now + Math.round(base * (0.8 + 0.4 * rand))
}

function isFree(component: ICAL.Component): boolean {
  const transp = component.getFirstPropertyValue('transp')
  const status = component.getFirstPropertyValue('status')
  return String(transp ?? '').toUpperCase() === 'TRANSPARENT' || String(status ?? '').toUpperCase() === 'CANCELLED'
}

function toBlock(start: ICAL.Time, end: ICAL.Time | null): BusyBlock {
  if (start.isDate) {
    // All-day: keep the calendar date, encoded as UTC midnight.
    const s = Date.UTC(start.year, start.month - 1, start.day)
    const e = end ? Date.UTC(end.year, end.month - 1, end.day) : s + 24 * HOUR
    return { start: s, end: Math.max(e, s + 24 * HOUR), allDay: true }
  }
  const s = start.toJSDate().getTime()
  const e = end ? end.toJSDate().getTime() : s
  return { start: s, end: Math.max(e, s), allDay: false }
}

function merge(blocks: BusyBlock[]): BusyBlock[] {
  const out: BusyBlock[] = []
  for (const b of [...blocks].sort((x, y) => x.start - y.start || x.end - y.end)) {
    const last = out[out.length - 1]
    if (last && b.start <= last.end) last.end = Math.max(last.end, b.end)
    else out.push({ ...b })
  }
  return out
}

/**
 * Busy periods overlapping [from, to), from an iCal feed. Only times survive:
 * titles, locations, attendees and every other field are dropped here.
 * Throws if the feed can't be parsed.
 */
export function busyBlocks(ics: string, from: number, to: number): BusyBlock[] {
  const root = new ICAL.Component(ICAL.parse(ics))
  for (const tz of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz)

  const vevents = root.getAllSubcomponents('vevent')
  const masters = new Map<string, ICAL.Event>()
  const exceptions: ICAL.Component[] = []
  const singles: ICAL.Event[] = []
  for (const v of vevents) {
    if (v.hasProperty('recurrence-id')) exceptions.push(v)
    else {
      const ev = new ICAL.Event(v)
      if (ev.isRecurring()) masters.set(ev.uid, ev)
      else singles.push(ev)
    }
  }
  for (const ex of exceptions) {
    const master = masters.get(String(ex.getFirstPropertyValue('uid')))
    if (master) master.relateException(ex)
    else singles.push(new ICAL.Event(ex)) // an override whose series isn't in the feed
  }

  const found: BusyBlock[] = []
  const add = (b: BusyBlock) => {
    if (b.end > from && b.start < to && b.end > b.start) found.push(b)
  }

  for (const ev of singles) {
    if (isFree(ev.component)) continue
    add(toBlock(ev.startDate, ev.endDate))
  }

  for (const ev of masters.values()) {
    const it = ev.iterator()
    for (let i = 0; i < MAX_OCCURRENCES; i++) {
      const next = it.next()
      if (!next) break
      const details = ev.getOccurrenceDetails(next)
      const block = toBlock(details.startDate, details.endDate)
      if (block.start >= to && !details.startDate.isDate) break
      if (details.startDate.isDate && block.start >= to + 24 * HOUR) break
      if (isFree(details.item.component)) continue
      add(block)
    }
  }

  const timed = merge(found.filter((b) => !b.allDay)).map((b) => ({ ...b, start: Math.max(b.start, from), end: Math.min(b.end, to) }))
  const allDay = merge(found.filter((b) => b.allDay))
  return [...allDay, ...timed]
}

/** End of the timed busy block covering `now`, or null. All-day blocks don't count as meetings. */
export function meetingUntil(blocks: BusyBlock[], now: number): number | null {
  const covering = blocks.find((b) => !b.allDay && b.start <= now && now < b.end)
  return covering ? covering.end : null
}
