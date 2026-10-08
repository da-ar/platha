import { expect, test } from 'vitest'
import { initialOfficeState, officeReducer } from '../../../src/web/office/officeReducer'
import type { Member } from '../../../src/shared/types'

export function member(over: Partial<Member> = {}): Member {
  return {
    githubId: 1,
    login: 'alice',
    name: 'Alice',
    avatarUrl: 'https://avatars.githubusercontent.com/u/1',
    slackUserId: null,
    role: 'member',
    status: 'available',
    statusText: null,
    online: true,
    ...over,
  }
}

test('snapshot replaces members', () => {
  const s = officeReducer(
    { ...initialOfficeState, members: { 9: member({ githubId: 9 }) } },
    { type: 'snapshot', members: [member(), member({ githubId: 2, login: 'bob' })] },
  )
  expect(Object.keys(s.members)).toEqual(['1', '2'])
})

test('member_updated upserts', () => {
  const s1 = officeReducer(initialOfficeState, { type: 'snapshot', members: [member()] })
  const s2 = officeReducer(s1, { type: 'member_updated', member: member({ online: false }) })
  expect(s2.members[1].online).toBe(false)
  const s3 = officeReducer(s2, { type: 'member_updated', member: member({ githubId: 3 }) })
  expect(Object.keys(s3.members)).toEqual(['1', '3'])
})

test('member_removed deletes', () => {
  const s1 = officeReducer(initialOfficeState, { type: 'snapshot', members: [member(), member({ githubId: 2 })] })
  expect(Object.keys(officeReducer(s1, { type: 'member_removed', githubId: 2 }).members)).toEqual(['1'])
})

test('session_revoked marks removed', () => {
  expect(officeReducer(initialOfficeState, { type: 'session_revoked' }).connection).toBe('removed')
})

test('knock messages leave state unchanged', () => {
  const knock = { type: 'knock' as const, knockId: crypto.randomUUID(), from: 2, meetUrl: 'https://meet.google.com/abc-defg-hij' }
  expect(officeReducer(initialOfficeState, knock)).toBe(initialOfficeState)
})
