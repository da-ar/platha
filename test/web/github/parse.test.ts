import { expect, test } from 'vitest'
import { parseSnapshot } from '../../../src/web/github/parse'
import full from '../../fixtures/graphql-full.json'
import partial from '../../fixtures/graphql-partial-error.json'

test('parse maps fields and lastActivity picks newer of comment/review', () => {
  const s = parseSnapshot(full, ['bob', 'carol'])
  expect(s.reviewRequested.map((p) => p.number)).toEqual([412])
  const [p401, p405, p398] = s.mine
  expect(p401).toEqual({
    url: 'https://github.com/acme/api/pull/401',
    number: 401,
    title: 'Ship the parser',
    repo: 'acme/api',
    author: 'alice',
    isDraft: false,
    reviewDecision: 'APPROVED',
    mergeable: 'MERGEABLE',
    ci: 'SUCCESS',
    updatedAt: '2026-10-07T10:00:00Z',
    lastActivity: { author: 'bob', at: '2026-10-07T09:00:00Z' },
  })
  expect(p405).toMatchObject({ ci: 'FAILURE', repo: 'acme/web', lastActivity: null })
  expect(p398).toMatchObject({ isDraft: true, reviewDecision: null, lastActivity: { author: 'carol', at: '2026-10-07T12:00:00Z' } })
  expect(s.mentions).toEqual([
    { url: 'https://github.com/acme/api/issues/77', number: 77, title: 'Outage follow-up', repo: 'acme/api', updatedAt: '2026-10-07T08:00:00Z' },
  ])
  expect((s.byTeammate.bob as unknown[]).length).toBe(2)
  expect(s.byTeammate.carol).toEqual([])
})

test('parse treats a null rollup as no CI', () => {
  const s = parseSnapshot(full, ['bob'])
  const bob = s.byTeammate.bob
  expect(Array.isArray(bob) && bob[1].ci).toBeNull()
})

test('parse marks a teammate with a path error as "error" and keeps the others', () => {
  const s = parseSnapshot(partial, ['bob', 'carol'])
  expect(s.byTeammate.bob).toBe('error')
  expect(s.byTeammate.carol).toMatchObject([{ number: 9, author: 'carol' }])
  expect(s.mine).toEqual([])
})
