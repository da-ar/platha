import { expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tile } from '../../../src/web/office/Tile'
import { member, pr } from '../factories'
import { clockTime } from '../../../src/web/office/presence'

test('tile summarises open PRs instead of listing them', () => {
  const prs = [pr(1), pr(2, { ci: 'FAILURE' }), pr(3, { mergeable: 'CONFLICTING' }), pr(4), pr(5)]
  render(<Tile member={member()} prs={prs} reviewRequestedUrls={new Set([prs[0].url, prs[3].url])} onOpen={() => {}} />)
  expect(screen.getByText('5 open PRs')).toBeInTheDocument()
  expect(screen.getByText('2 waiting on you')).toHaveClass('tile__waiting')
  expect(screen.getByText('1 failing CI')).toBeInTheDocument()
  expect(screen.getByText('1 conflict')).toBeInTheDocument()
  expect(screen.queryByText(/#1/)).toBeNull()
})

test('no open PRs and nothing pending', () => {
  render(<Tile member={member()} prs={[]} onOpen={() => {}} />)
  expect(screen.getByText('No open PRs')).toBeInTheDocument()
})

test('offline tile is greyed and labelled Offline; focusing shows Focusing', () => {
  const { rerender } = render(<Tile member={member({ online: false, status: 'focusing' })} prs={[]} onOpen={() => {}} />)
  const tile = screen.getByRole('button', { name: 'Alice, Offline' })
  expect(tile).toHaveClass('tile--offline')
  rerender(<Tile member={member({ status: 'focusing', statusText: 'parser' })} prs={[]} onOpen={() => {}} />)
  expect(screen.getByRole('button', { name: 'Alice, Focusing' })).not.toHaveClass('tile--offline')
  expect(screen.getByText('parser')).toBeInTheDocument()
  rerender(<Tile member={member({ status: 'away' })} prs={[]} onOpen={() => {}} />)
  expect(screen.getByRole('button', { name: 'Alice, Away' })).toBeInTheDocument()
  rerender(<Tile member={member({ name: null })} prs={[]} onOpen={() => {}} />)
  expect(screen.getByRole('button', { name: 'alice, Online' })).toBeInTheDocument()
})

test("tile with error shows Couldn't load", () => {
  render(<Tile member={member()} prs="error" onOpen={() => {}} />)
  expect(screen.getByText("Couldn't load")).toBeInTheDocument()
})

test('github text renders as plain text', () => {
  render(<Tile member={member({ name: '<img src=x onerror=alert(1)>' })} prs={[pr(1, { title: '<b>x</b>' })]} onOpen={() => {}} />)
  expect(document.querySelector('img[src="x"]')).toBeNull()
  expect(document.querySelector('b')).toBeNull()
})

test('clicking opens', async () => {
  const onOpen = vi.fn()
  render(<Tile member={member()} prs={[]} onOpen={onOpen} />)
  await userEvent.click(screen.getByRole('button'))
  expect(onOpen).toHaveBeenCalled()
})

test('a member in a meeting shows until when, with the meeting dot', () => {
  const until = Date.now() + 30 * 60_000
  render(<Tile member={member({ meetingUntil: until })} prs={[]} onOpen={() => {}} />)
  const tile = screen.getByRole('button', { name: 'Alice, In a meeting' })
  expect(tile).toHaveTextContent(`In a meeting · until ${clockTime(until)}`)
  expect(tile.querySelector('.dot--meeting')).not.toBeNull()
})
