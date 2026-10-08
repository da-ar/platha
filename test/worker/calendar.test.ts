import { describe, expect, test } from 'vitest'
import { busyBlocks, calendarUrl, meetingUntil, nextAttempt, normalizeEmail, SYNC_OK_MS, SYNC_UNAVAILABLE_MS } from '../../src/worker/calendar'

const LONDON = `BEGIN:VTIMEZONE
TZID:Europe/London
BEGIN:DAYLIGHT
TZOFFSETFROM:+0000
TZOFFSETTO:+0100
TZNAME:BST
DTSTART:19700329T010000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0100
TZOFFSETTO:+0000
TZNAME:GMT
DTSTART:19701025T020000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE`

function cal(...events: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Google Inc//Google Calendar 70.9054//EN', LONDON, ...events, 'END:VCALENDAR'].join('\r\n')
}

function vevent(lines: Record<string, string>): string {
  return ['BEGIN:VEVENT', ...Object.entries(lines).map(([k, v]) => `${k}:${v}`), 'END:VEVENT'].join('\r\n')
}

const utc = (s: string) => Date.parse(s)
// Thursday 8 Oct 2026, a BST day (UTC+1). Range = that London day in UTC.
const FROM = utc('2026-10-07T23:00:00Z')
const TO = utc('2026-10-08T23:00:00Z')

describe('busyBlocks', () => {
  test('a single event in a named timezone', () => {
    const ics = cal(vevent({ UID: 'a', 'DTSTART;TZID=Europe/London': '20261008T100000', 'DTEND;TZID=Europe/London': '20261008T110000', SUMMARY: 'Busy' }))
    expect(busyBlocks(ics, FROM, TO)).toEqual([{ start: utc('2026-10-08T09:00:00Z'), end: utc('2026-10-08T10:00:00Z'), allDay: false }])
  })

  test('UTC times and events outside the range', () => {
    const ics = cal(
      vevent({ UID: 'a', DTSTART: '20261008T140000Z', DTEND: '20261008T143000Z' }),
      vevent({ UID: 'b', DTSTART: '20261009T140000Z', DTEND: '20261009T150000Z' }),
    )
    expect(busyBlocks(ics, FROM, TO)).toEqual([{ start: utc('2026-10-08T14:00:00Z'), end: utc('2026-10-08T14:30:00Z'), allDay: false }])
  })

  test('weekly recurrence with an exdate and a moved occurrence', () => {
    const ics = cal(
      // Thursdays 15:00 London from 2026-09-03; 2026-10-01 skipped; 2026-10-08 moved to 16:00
      vevent({
        UID: 'weekly',
        'DTSTART;TZID=Europe/London': '20260903T150000',
        'DTEND;TZID=Europe/London': '20260903T153000',
        RRULE: 'FREQ=WEEKLY;BYDAY=TH',
        'EXDATE;TZID=Europe/London': '20261001T150000',
      }),
      vevent({
        UID: 'weekly',
        'RECURRENCE-ID;TZID=Europe/London': '20261008T150000',
        'DTSTART;TZID=Europe/London': '20261008T160000',
        'DTEND;TZID=Europe/London': '20261008T170000',
      }),
    )
    expect(busyBlocks(ics, FROM, TO)).toEqual([{ start: utc('2026-10-08T15:00:00Z'), end: utc('2026-10-08T16:00:00Z'), allDay: false }])
    const oct1 = busyBlocks(ics, utc('2026-09-30T23:00:00Z'), utc('2026-10-01T23:00:00Z'))
    expect(oct1).toEqual([])
    // After the clocks change (25 Oct), 15:00 London is 15:00 UTC.
    expect(busyBlocks(ics, utc('2026-10-29T00:00:00Z'), utc('2026-10-30T00:00:00Z'))).toEqual([
      { start: utc('2026-10-29T15:00:00Z'), end: utc('2026-10-29T15:30:00Z'), allDay: false },
    ])
  })

  test('daily series started years ago still reaches today', () => {
    const ics = cal(vevent({ UID: 'd', 'DTSTART;TZID=Europe/London': '20200106T093000', 'DTEND;TZID=Europe/London': '20200106T094500', RRULE: 'FREQ=DAILY' }))
    expect(busyBlocks(ics, FROM, TO)).toEqual([{ start: utc('2026-10-08T08:30:00Z'), end: utc('2026-10-08T08:45:00Z'), allDay: false }])
  })

  test('all-day, transparent and cancelled events', () => {
    const ics = cal(
      vevent({ UID: 'ad', 'DTSTART;VALUE=DATE': '20261008', 'DTEND;VALUE=DATE': '20261009' }),
      vevent({ UID: 't', DTSTART: '20261008T120000Z', DTEND: '20261008T130000Z', TRANSP: 'TRANSPARENT' }),
      vevent({ UID: 'c', DTSTART: '20261008T120000Z', DTEND: '20261008T130000Z', STATUS: 'CANCELLED' }),
    )
    expect(busyBlocks(ics, FROM, TO)).toEqual([{ start: utc('2026-10-08T00:00:00Z'), end: utc('2026-10-09T00:00:00Z'), allDay: true }])
  })

  test('overlapping and touching events merge; blocks are clipped to the range', () => {
    const ics = cal(
      vevent({ UID: 'a', DTSTART: '20261008T090000Z', DTEND: '20261008T100000Z' }),
      vevent({ UID: 'b', DTSTART: '20261008T093000Z', DTEND: '20261008T103000Z' }),
      vevent({ UID: 'c', DTSTART: '20261008T103000Z', DTEND: '20261008T110000Z' }),
      vevent({ UID: 'd', DTSTART: '20261008T220000Z', DTEND: '20261009T010000Z' }),
    )
    expect(busyBlocks(ics, FROM, TO)).toEqual([
      { start: utc('2026-10-08T09:00:00Z'), end: utc('2026-10-08T11:00:00Z'), allDay: false },
      { start: utc('2026-10-08T22:00:00Z'), end: TO, allDay: false },
    ])
  })

  test('titles, locations and attendees never come out', () => {
    const ics = cal(
      vevent({
        UID: 'secret',
        DTSTART: '20261008T090000Z',
        DTEND: '20261008T100000Z',
        SUMMARY: 'Acquisition talks',
        LOCATION: 'Board room',
        DESCRIPTION: 'Confidential',
        'ATTENDEE;CN=Someone': 'mailto:ceo@example.com',
      }),
    )
    const out = JSON.stringify(busyBlocks(ics, FROM, TO))
    for (const word of ['Acquisition', 'Board', 'Confidential', 'ceo@', 'secret']) expect(out).not.toContain(word)
  })

  test('garbage throws', () => {
    expect(() => busyBlocks('<html>not a calendar</html>', FROM, TO)).toThrow()
  })
})

describe('helpers', () => {
  test('calendarUrl encodes the @', () => {
    expect(calendarUrl('dave@rapid7.com')).toBe('https://calendar.google.com/calendar/ical/dave%40rapid7.com/public/basic.ics')
  })

  test('normalizeEmail', () => {
    expect(normalizeEmail('  Dave@Rapid7.com ')).toBe('dave@rapid7.com')
    for (const bad of [null, '', 'nope', 'a@b', 'a b@c.com', 'a@b.com/../x', 42]) expect(normalizeEmail(bad)).toBeNull()
  })

  test('backoff schedule', () => {
    const now = 1_000_000
    expect(nextAttempt('ok', 0, now)).toBe(now + SYNC_OK_MS)
    expect(nextAttempt('unavailable', 0, now)).toBe(now + SYNC_UNAVAILABLE_MS)
    expect(nextAttempt('no_email', 0, now)).toBeNull()
    const mins = [1, 2, 3, 4, 5, 9].map((f) => (nextAttempt('error', f, now, 0.5)! - now) / 60_000)
    expect(mins).toEqual([5, 10, 20, 40, 60, 60])
    expect(nextAttempt('error', 1, now, 0)! - now).toBe(4 * 60_000)
    expect(nextAttempt('error', 1, now, 1)! - now).toBe(6 * 60_000)
  })

  test('meetingUntil', () => {
    const blocks = [
      { start: 0, end: 1000, allDay: true },
      { start: 100, end: 200, allDay: false },
    ]
    expect(meetingUntil(blocks, 99)).toBeNull()
    expect(meetingUntil(blocks, 100)).toBe(200)
    expect(meetingUntil(blocks, 199)).toBe(200)
    expect(meetingUntil(blocks, 200)).toBeNull()
  })
})
