import { expect, test } from 'vitest'
import { clockTime, presenceLabel, presenceText, presenceTone } from '../../../src/web/office/presence'
import { member } from '../factories'

const NOW = 1_000_000_000
const meeting = { meetingUntil: NOW + 30 * 60_000 }

test('offline > away > in a meeting > focusing > online', () => {
  expect(presenceLabel(member({ online: false, ...meeting }), NOW)).toBe('Offline')
  expect(presenceLabel(member({ status: 'away', ...meeting }), NOW)).toBe('Away')
  expect(presenceLabel(member({ status: 'focusing', ...meeting }), NOW)).toBe('In a meeting')
  expect(presenceLabel(member({ status: 'focusing' }), NOW)).toBe('Focusing')
  expect(presenceLabel(member(), NOW)).toBe('Online')
})

test('a meeting that has ended no longer counts', () => {
  expect(presenceLabel(member({ meetingUntil: NOW }), NOW)).toBe('Online')
})

test('meeting text and tone', () => {
  expect(presenceText(member(meeting), NOW)).toBe(`In a meeting · until ${clockTime(meeting.meetingUntil)}`)
  expect(presenceText(member(), NOW)).toBe('Online')
  expect(presenceTone('In a meeting')).toBe('meeting')
  expect(presenceTone('Focusing')).toBe('focusing')
})
