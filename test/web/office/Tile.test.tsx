import { expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tile } from '../../../src/web/office/Tile'
import { member, pr } from '../factories'

test('tile shows 3 pills then +2 more', () => {
  render(<Tile member={member()} prs={[1, 2, 3, 4, 5].map((n) => pr(n))} onOpen={() => {}} />)
  expect(screen.getByText('#1 in review')).toBeInTheDocument()
  expect(screen.getByText('#3 in review')).toBeInTheDocument()
  expect(screen.queryByText('#4 in review')).toBeNull()
  expect(screen.getByText('+2 more')).toBeInTheDocument()
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
