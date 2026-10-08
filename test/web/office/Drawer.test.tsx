import { expect, test, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Drawer } from '../../../src/web/office/Drawer'
import { member, pr } from '../factories'

const bob = member({ githubId: 2, login: 'bob', name: 'Bob', slackUserId: 'U01ABCDEF' })
const base = { prs: [] as never[], isMe: false, slackTeamId: 'T0000000', onClose: () => {}, onCall: () => {} }

test('chat deep-links to the Slack DM', () => {
  render(<Drawer {...base} member={bob} />)
  expect(screen.getByRole('link', { name: 'Chat' })).toHaveAttribute('href', 'slack://user?team=T0000000&id=U01ABCDEF')
  expect(screen.getByRole('link', { name: 'Open Slack in browser' })).toHaveAttribute('href', 'https://app.slack.com/client/T0000000')
})

test('chat disabled with tooltip when no slack id', () => {
  render(<Drawer {...base} member={{ ...bob, slackUserId: null }} />)
  const chat = screen.getByRole('button', { name: 'Chat' })
  expect(chat).toBeDisabled()
  expect(chat).toHaveAttribute('title', "Bob hasn't added their Slack ID")
})

test('call disabled when offline, enabled when online', async () => {
  const onCall = vi.fn()
  const { rerender } = render(<Drawer {...base} member={{ ...bob, online: false }} onCall={onCall} />)
  expect(screen.getByRole('button', { name: 'Call' })).toBeDisabled()
  rerender(<Drawer {...base} member={bob} onCall={onCall} />)
  await userEvent.click(screen.getByRole('button', { name: 'Call' }))
  expect(onCall).toHaveBeenCalled()
})

test('lists every open PR with its state and link', () => {
  const prs = [pr(1, { title: 'One', isDraft: true }), pr(2, { title: 'Two', ci: 'FAILURE', reviewDecision: 'APPROVED' })]
  render(<Drawer {...base} member={bob} prs={prs} />)
  expect(screen.getByRole('link', { name: /#1 One/ })).toHaveAttribute('href', 'https://github.com/acme/api/pull/1')
  const two = within(screen.getByRole('link', { name: /#2 Two/ }))
  expect(two.getByRole('img', { name: 'CI failing' })).toHaveAttribute('title', 'CI failing')
  expect(two.getByRole('img', { name: 'Approved' })).toBeInTheDocument()
  expect(two.queryByRole('img', { name: 'Draft' })).toBeNull()
  expect(within(screen.getByRole('link', { name: /#1 One/ })).getByRole('img', { name: 'Draft' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /#2 Two/ })).toHaveTextContent('acme/api')
})

test('every PR state has an icon with a label', () => {
  const prs = [
    pr(1, { ci: 'SUCCESS', mergeable: 'CONFLICTING' }),
    pr(2, { ci: 'ERROR', reviewDecision: 'CHANGES_REQUESTED' }),
    pr(3, { ci: 'PENDING' }),
    pr(4, { ci: 'EXPECTED', reviewDecision: null }),
  ]
  render(<Drawer {...base} member={bob} prs={prs} />)
  const icons = (n: number) => within(screen.getByRole('link', { name: new RegExp(`#${n} `) })).getAllByRole('img').map((i) => i.getAttribute('aria-label'))
  expect(icons(1)).toEqual(['Review required', 'CI passing', 'Merge conflicts'])
  expect(icons(2)).toEqual(['Changes requested', 'CI error'])
  expect(icons(3)).toEqual(['Review required', 'CI running'])
  expect(icons(4)).toEqual(['CI waiting'])
})

test('my own drawer has no chat or call', () => {
  render(<Drawer {...base} member={bob} isMe />)
  expect(screen.queryByRole('button', { name: 'Call' })).toBeNull()
})

test('escape closes', async () => {
  const onClose = vi.fn()
  render(<Drawer {...base} member={bob} onClose={onClose} />)
  await userEvent.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalled()
})
