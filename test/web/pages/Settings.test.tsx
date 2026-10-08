import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Settings } from '../../../src/web/pages/Settings'
import { useOffice } from '../../../src/web/office/useOffice'
import { go } from '../../../src/web/navigate'
import { getToken, setToken } from '../../../src/web/token'
import { member } from '../factories'
import { mockApi } from '../fetch-mock'

vi.mock('../../../src/web/navigate', () => ({ go: vi.fn(), openTab: vi.fn() }))
vi.mock('../../../src/web/office/useOffice', () => ({ useOffice: vi.fn() }))

const admin = member({ githubId: 1, login: 'alice', name: 'Alice', role: 'admin' })
const bob = member({ githubId: 2, login: 'bob', name: 'Bob' })

beforeEach(() => {
  vi.mocked(useOffice).mockReturnValue({ state: { connection: 'open', members: { 1: admin, 2: bob } }, send: vi.fn(), subscribe: vi.fn() })
})

function api(extra: Record<string, { status: number; body?: unknown }> = {}) {
  return mockApi(({ method, path, body }) => {
    const key = `${method} ${path}`
    if (extra[key]) return extra[key]
    if (key === 'GET /api/admin/invite') return { status: 200, body: { inviteUrl: 'http://x/join/old' } }
    if (key === 'PATCH /api/profile') return { status: 200, body: { member: { ...admin, slackUserId: String((body as { slackUserId: string }).slackUserId).trim().toUpperCase() } } }
    return { status: 204 }
  })
}

test('saving a slack id calls updateProfile and shows saved', async () => {
  const calls = api()
  render(<Settings me={bob} />)
  await userEvent.type(screen.getByLabelText('Slack member ID'), 'u01abcdef')
  await userEvent.click(within(screen.getByRole('heading', { name: 'Slack' }).closest('section')!).getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('Saved')).toBeInTheDocument()
  expect(calls).toContainEqual({ method: 'PATCH', path: '/api/profile', body: { slackUserId: 'u01abcdef' } })
  expect(screen.getByLabelText('Slack member ID')).toHaveValue('U01ABCDEF')
})

test('invalid slack id shows error from 400', async () => {
  api({ 'PATCH /api/profile': { status: 400 } })
  render(<Settings me={bob} />)
  await userEvent.type(screen.getByLabelText('Slack member ID'), 'C123')
  await userEvent.click(within(screen.getByRole('heading', { name: 'Slack' }).closest('section')!).getByRole('button', { name: 'Save' }))
  expect(await screen.findByRole('alert')).toHaveTextContent("That isn't a Slack member ID")
})

test('admin section hidden for members', () => {
  vi.mocked(useOffice).mockReturnValue({ state: { connection: 'open', members: { 1: admin, 2: bob } }, send: vi.fn(), subscribe: vi.fn() })
  const calls = api()
  render(<Settings me={bob} />)
  expect(screen.queryByRole('heading', { name: 'Admin' })).toBeNull()
  expect(calls.some((c) => c.path.startsWith('/api/admin'))).toBe(false)
})

test('rotate asks for confirmation and shows the new link', async () => {
  api({ 'POST /api/admin/invite/rotate': { status: 200, body: { inviteUrl: 'http://x/join/new' } } })
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  render(<Settings me={admin} />)
  await waitFor(() => expect(screen.getByLabelText('Invite link')).toHaveValue('http://x/join/old'))
  await userEvent.click(screen.getByRole('button', { name: 'Rotate link' }))
  expect(screen.getByLabelText('Invite link')).toHaveValue('http://x/join/old')
  await userEvent.click(screen.getByRole('button', { name: 'Rotate link' }))
  await waitFor(() => expect(screen.getByLabelText('Invite link')).toHaveValue('http://x/join/new'))
  expect(confirm).toHaveBeenCalledTimes(2)
  expect(confirm.mock.calls[0][0]).toContain('old link will stop working')
})

test('remove asks for confirmation and calls removeMember', async () => {
  const calls = api()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  render(<Settings me={admin} />)
  expect(screen.queryByRole('button', { name: 'Remove Alice' })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Remove Bob' }))
  await waitFor(() => expect(calls).toContainEqual({ method: 'DELETE', path: '/api/admin/members/2', body: undefined }))
})

test('replace token and sign out', async () => {
  const calls = api()
  render(<Settings me={bob} />)
  await userEvent.type(screen.getByLabelText('Replace GitHub token'), ' tok-2 ')
  await userEvent.click(screen.getByRole('button', { name: 'Save token' }))
  expect(getToken()).toBe('tok-2')
  setToken('tok-2')
  await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
  await waitFor(() => expect(go).toHaveBeenCalledWith('/'))
  expect(calls).toContainEqual({ method: 'POST', path: '/api/logout', body: undefined })
  expect(getToken()).toBeNull()
})

test('saving a Meet room sends only the room and shows the saved state', async () => {
  const calls = api({
    'PATCH /api/profile': { status: 200, body: { member: bob, meetUrl: 'https://meet.google.com/abc-defg-hij' } },
  })
  render(<Settings me={bob} meetUrl={null} />)
  await userEvent.type(screen.getByLabelText('Meet room link'), 'meet.google.com/abc-defg-hij?authuser=0')
  await userEvent.click(within(screen.getByRole('heading', { name: 'Meet room' }).closest('section')!).getByRole('button', { name: 'Save' }))
  expect(await screen.findByText(/Call now rings straight away/)).toBeInTheDocument()
  expect(calls).toContainEqual({ method: 'PATCH', path: '/api/profile', body: { meetUrl: 'meet.google.com/abc-defg-hij?authuser=0' } })
  expect(screen.getByLabelText('Meet room link')).toHaveValue('https://meet.google.com/abc-defg-hij')
})

test('a saved room is pre-filled, can be cleared, and bad links are rejected', async () => {
  api({ 'PATCH /api/profile': { status: 400 } })
  render(<Settings me={bob} meetUrl="https://meet.google.com/abc-defg-hij" />)
  const field = screen.getByLabelText('Meet room link')
  expect(field).toHaveValue('https://meet.google.com/abc-defg-hij')
  const save = () => userEvent.click(within(screen.getByRole('heading', { name: 'Meet room' }).closest('section')!).getByRole('button', { name: 'Save' }))
  await userEvent.clear(field)
  await userEvent.type(field, 'https://zoom.us/j/1')
  await save()
  expect(await screen.findByRole('alert')).toHaveTextContent("That doesn't look like a Meet link")
  api({ 'PATCH /api/profile': { status: 200, body: { member: bob, meetUrl: null } } })
  await userEvent.clear(field)
  await save()
  expect(await screen.findByText('Removed')).toBeInTheDocument()
})

test('calendar section shows the public email and sharing steps', () => {
  api()
  render(<Settings me={bob} email="bob@acme.dev" calendarState="unavailable" />)
  const section = within(screen.getByRole('heading', { name: 'Calendar' }).closest('section')!)
  expect(section.getByText('bob@acme.dev')).toBeInTheDocument()
  expect(section.getByText(/isn't public yet/)).toBeInTheDocument()
  expect(section.getByText(/See only free\/busy/)).toBeInTheDocument()
})

test('calendar section explains how to add a public email', () => {
  api()
  render(<Settings me={bob} />)
  const section = within(screen.getByRole('heading', { name: 'Calendar' }).closest('section')!)
  expect(section.getByText(/no public email/)).toBeInTheDocument()
  expect(section.getByRole('link', { name: /Public profile/ })).toHaveAttribute('href', 'https://github.com/settings/profile')
})
