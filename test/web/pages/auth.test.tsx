import { beforeEach, describe, expect, test, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../../../src/web/App'
import { Join } from '../../../src/web/pages/Join'
import { Login } from '../../../src/web/pages/Login'
import { getToken, setToken } from '../../../src/web/token'
import { go } from '../../../src/web/navigate'
import { mockApi } from '../fetch-mock'

vi.mock('../../../src/web/navigate', () => ({ go: vi.fn(), openTab: vi.fn() }))
vi.mock('../../../src/web/office/OfficeView', () => ({ OfficeView: () => <p>office view</p> }))

const meBody = {
  member: { githubId: 1, login: 'alice', name: 'Alice', avatarUrl: '', slackUserId: null, role: 'admin', status: 'available', statusText: null, online: true, meetingUntil: null },
  meetUrl: null,
  email: null,
  calendarState: 'no_email',
  config: { org: 'acme', slackTeamId: 'T0' },
}

beforeEach(() => {
  vi.mocked(go).mockClear()
  sessionStorage.clear()
})

describe('join', () => {
  test('join posts code and trimmed token, stores token, redirects', async () => {
    const calls = mockApi(() => ({ status: 200, body: {} }))
    render(<Join code="abc" />)
    await userEvent.type(screen.getByLabelText('GitHub token'), '  tok-bob  ')
    await userEvent.click(screen.getByRole('button', { name: 'Join' }))
    await waitFor(() => expect(go).toHaveBeenCalledWith('/'))
    expect(calls).toEqual([{ method: 'POST', path: '/api/join', body: { code: 'abc', token: 'tok-bob' } }])
    expect(getToken()).toBe('tok-bob')
  })

  test('join shows invite error on 404', async () => {
    mockApi(() => ({ status: 404 }))
    render(<Join code="abc" />)
    await userEvent.type(screen.getByLabelText('GitHub token'), 'tok')
    await userEvent.click(screen.getByRole('button', { name: 'Join' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("That invite link isn't valid any more.")
    expect(getToken()).toBeNull()
  })

  test('join shows rate limit and token errors', async () => {
    let status = 429
    mockApi(() => ({ status }))
    render(<Join code="abc" />)
    await userEvent.type(screen.getByLabelText('GitHub token'), 'tok')
    await userEvent.click(screen.getByRole('button', { name: 'Join' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts — try again in 10 minutes.')
    status = 401
    await userEvent.click(screen.getByRole('button', { name: 'Join' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("GitHub didn't accept that token."))
  })
})

describe('login', () => {
  test('login shows "You need an invite link." on 403', async () => {
    mockApi(() => ({ status: 403 }))
    render(<Login />)
    await userEvent.type(screen.getByLabelText('GitHub token'), 'tok')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('You need an invite link.')
  })

  test('a saved token signs straight back in', async () => {
    setToken('tok-saved')
    const calls = mockApi(() => ({ status: 200, body: {} }))
    render(<Login />)
    await waitFor(() => expect(go).toHaveBeenCalledWith('/'))
    expect(calls[0]).toEqual({ method: 'POST', path: '/api/login', body: { token: 'tok-saved' } })
  })
})

describe('app', () => {
  test('app shows Login when /api/me is 401', async () => {
    mockApi(() => ({ status: 401 }))
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByText('You need an invite link.')).toBeInTheDocument()
  })
})

describe('when the server is unreachable', () => {
  test('a 500 from /api/me retries in place instead of showing sign-in', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let status = 500
    const calls = mockApi(({ path }) => (path === '/api/me' ? (status === 200 ? { status, body: meBody } : { status }) : { status: 404 }))
    render(<App />)
    expect(await screen.findByText("Can't reach Platha — retrying…")).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull()
    expect(calls.filter((c) => c.path === '/api/login')).toEqual([])
    status = 200
    await act(async () => vi.advanceTimersByTime(2_000))
    expect(await screen.findByText('office view')).toBeInTheDocument()
    expect(calls.filter((c) => c.path === '/api/me')).toHaveLength(2)
    expect(go).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  test('a network failure is treated the same as a 500', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    render(<App />)
    expect(await screen.findByText("Can't reach Platha — retrying…")).toBeInTheDocument()
  })

  test('a 401 still means signed out', async () => {
    mockApi(() => ({ status: 401 }))
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  test('a saved token signs back in automatically only once per tab', async () => {
    setToken('tok-saved')
    const calls = mockApi(() => ({ status: 200, body: {} }))
    const first = render(<Login />)
    await waitFor(() => expect(go).toHaveBeenCalledTimes(1))
    first.unmount()
    render(<Login />)
    await act(async () => {})
    expect(calls.filter((c) => c.path === '/api/login')).toHaveLength(1)
    expect(go).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('You need an invite link.')).toBeNull()
  })
})
