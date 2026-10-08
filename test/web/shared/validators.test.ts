import { describe, expect, test } from 'vitest'
import { normalizeMeetUrl, normalizeSlackUserId } from '../../../src/shared/validators'

describe('normalizeMeetUrl', () => {
  test('accepts a canonical link', () => {
    expect(normalizeMeetUrl('https://meet.google.com/abc-defg-hij')).toBe('https://meet.google.com/abc-defg-hij')
  })

  test('normalizeMeetUrl strips query, hash, slash and whitespace', () => {
    expect(normalizeMeetUrl('  https://meet.google.com/abc-defg-hij?authuser=0#x \n')).toBe('https://meet.google.com/abc-defg-hij')
    expect(normalizeMeetUrl('https://meet.google.com/abc-defg-hij/')).toBe('https://meet.google.com/abc-defg-hij')
  })

  test('rejects anything that is not a Meet room link', () => {
    expect(normalizeMeetUrl('http://meet.google.com/abc-defg-hij')).toBeNull()
    expect(normalizeMeetUrl('https://meet.google.com.evil.io/abc-defg-hij')).toBeNull()
    expect(normalizeMeetUrl('https://meet.google.com/lookup/abc')).toBeNull()
    expect(normalizeMeetUrl('https://user@meet.google.com/abc-defg-hij')).toBeNull()
    expect(normalizeMeetUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeMeetUrl('')).toBeNull()
  })
})

describe('normalizeSlackUserId', () => {
  test('trims and uppercases user ids', () => {
    expect(normalizeSlackUserId(' u01abcdef ')).toBe('U01ABCDEF')
    expect(normalizeSlackUserId('W0123456')).toBe('W0123456')
  })

  test('rejects channel ids and short ids', () => {
    expect(normalizeSlackUserId('C0123456')).toBeNull()
    expect(normalizeSlackUserId('U12')).toBeNull()
  })
})
