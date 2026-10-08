import { expect, test } from 'vitest'
import { prPill } from '../../../src/web/office/prPill'
import { pr } from '../factories'

test('prPill priority', () => {
  expect(prPill(pr(5, { isDraft: true, ci: 'FAILURE' }))).toBe('#5 draft')
  expect(prPill(pr(5, { ci: 'FAILURE', reviewDecision: 'APPROVED' }))).toBe('#5 ❌')
  expect(prPill(pr(5, { ci: 'ERROR' }))).toBe('#5 ❌')
  expect(prPill(pr(5, { reviewDecision: 'CHANGES_REQUESTED' }))).toBe('#5 changes req')
  expect(prPill(pr(5, { reviewDecision: 'APPROVED' }))).toBe('#5 ready')
  expect(prPill(pr(5))).toBe('#5 in review')
})
