import { describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../../../src/web/App'
import { Join } from '../../../src/web/pages/Join'
import { Login } from '../../../src/web/pages/Login'
import { getToken, setToken } from '../../../src/web/token'
import { go } from '../../../src/web/navigate'
import { mockApi } from '../fetch-mock'

vi.mock('../../../src/web/navigate', () => ({ go: vi.fn(), openTab: vi.fn() }))

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
