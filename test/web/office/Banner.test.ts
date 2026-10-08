import { expect, test } from 'vitest'
import { updatedAgo } from '../../../src/web/office/Banner'

test('updatedAgo wording', () => {
  const t = 1_000_000
  expect(updatedAgo(t, t)).toBe('Updated just now')
  expect(updatedAgo(t, t + 9_999)).toBe('Updated just now')
  expect(updatedAgo(t, t + 47_000)).toBe('Updated 40s ago')
  expect(updatedAgo(t, t + 3 * 60_000 + 20_000)).toBe('Updated 3m ago')
  expect(updatedAgo(t, t - 5_000)).toBe('Updated just now')
})
