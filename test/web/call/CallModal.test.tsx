import { expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CallModal } from '../../../src/web/call/CallModal'
import { KnockToasts } from '../../../src/web/call/KnockToast'
import { member } from '../factories'

const bob = member({ githubId: 2, login: 'bob', name: 'Bob' })

test('call modal shows fallback link when popup blocked', () => {
  const { rerender } = render(<CallModal member={bob} popupBlocked outgoing={null} onSubmit={() => {}} onCancel={() => {}} />)
  expect(screen.getByRole('link', { name: 'Open Google Meet' })).toHaveAttribute('href', 'https://meet.new')
  rerender(<CallModal member={bob} popupBlocked={false} outgoing={null} onSubmit={() => {}} onCancel={() => {}} />)
  expect(screen.queryByRole('link', { name: 'Open Google Meet' })).toBeNull()
})

test('call modal rejects non-meet links and accepts ?authuser=0', async () => {
  const onSubmit = vi.fn()
  render(<CallModal member={bob} popupBlocked={false} outgoing={null} onSubmit={onSubmit} onCancel={() => {}} />)
  const field = screen.getByLabelText('Meet link')
  await userEvent.type(field, 'https://zoom.us/j/1')
  await userEvent.click(screen.getByRole('button', { name: 'Ring Bob' }))
  expect(screen.getByRole('alert')).toHaveTextContent("That doesn't look like a Meet link")
  expect(onSubmit).not.toHaveBeenCalled()
  await userEvent.clear(field)
  await userEvent.type(field, 'https://meet.google.com/abc-defg-hij?authuser=0')
  await userEvent.click(screen.getByRole('button', { name: 'Ring Bob' }))
  expect(onSubmit).toHaveBeenCalledWith('https://meet.google.com/abc-defg-hij')
})

test('call modal shows outgoing status copy', () => {
  const props = { member: bob, popupBlocked: false, onSubmit: () => {}, onCancel: () => {} }
  const { rerender } = render(<CallModal {...props} outgoing={{ knockId: 'k', to: bob, state: 'calling' }} />)
  expect(screen.getByRole('status')).toHaveTextContent('Calling Bob…')
  rerender(<CallModal {...props} outgoing={{ knockId: 'k', to: bob, state: 'ringing' }} />)
  expect(screen.getByRole('status')).toHaveTextContent('Ringing Bob…')
  rerender(<CallModal {...props} outgoing={{ knockId: 'k', to: bob, state: 'unreachable' }} />)
  expect(screen.getByRole('status')).toHaveTextContent("Couldn't reach Bob")
  rerender(<CallModal {...props} outgoing={{ knockId: 'k', to: bob, state: 'declined' }} />)
  expect(screen.getByRole('status')).toHaveTextContent("Bob can't talk right now")
  rerender(<CallModal {...props} outgoing={{ knockId: 'k', to: bob, state: 'no_answer' }} />)
  expect(screen.getByRole('status')).toHaveTextContent('No answer — try Slack?')
  rerender(<CallModal {...props} outgoing={{ knockId: 'k', to: bob, state: 'went_offline' }} />)
  expect(screen.getByRole('status')).toHaveTextContent('Bob just went offline')
})

test('knock toast offers Join and Not now', async () => {
  const onAnswer = vi.fn()
  const k = { knockId: 'k', from: bob, meetUrl: 'https://meet.google.com/abc-defg-hij' }
  render(<KnockToasts incoming={[k]} onAnswer={onAnswer} />)
  expect(screen.getByText('Bob is calling')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Not now' }))
  expect(onAnswer).toHaveBeenCalledWith(k, 'decline')
  await userEvent.click(screen.getByRole('button', { name: 'Join' }))
  expect(onAnswer).toHaveBeenCalledWith(k, 'join')
})
