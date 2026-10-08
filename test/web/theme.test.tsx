import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { applyTheme, getTheme, setTheme } from '../../src/web/theme'
import { Settings } from '../../src/web/pages/Settings'
import { useOffice } from '../../src/web/office/useOffice'
import { member } from './factories'
import { mockApi } from './fetch-mock'

vi.mock('../../src/web/navigate', () => ({ go: vi.fn(), openTab: vi.fn() }))
vi.mock('../../src/web/office/useOffice', () => ({ useOffice: vi.fn() }))

beforeEach(() => {
  delete document.documentElement.dataset.theme
})

afterEach(() => {
  delete document.documentElement.dataset.theme
})

test('defaults to system, with no override on the page', () => {
  expect(getTheme()).toBe('system')
  applyTheme(getTheme())
  expect(document.documentElement.dataset.theme).toBeUndefined()
})

test('light and dark are saved and applied; system clears both', () => {
  setTheme('dark')
  expect(getTheme()).toBe('dark')
  expect(document.documentElement.dataset.theme).toBe('dark')
  setTheme('light')
  expect(document.documentElement.dataset.theme).toBe('light')
  setTheme('system')
  expect(getTheme()).toBe('system')
  expect(localStorage.getItem('platha.theme')).toBeNull()
  expect(document.documentElement.dataset.theme).toBeUndefined()
})

test('a garbage stored value falls back to system', () => {
  localStorage.setItem('platha.theme', 'purple')
  expect(getTheme()).toBe('system')
})

test('Settings → Appearance switches the theme immediately', async () => {
  const me = member({ githubId: 2, login: 'bob' })
  vi.mocked(useOffice).mockReturnValue({ state: { connection: 'open', members: { 2: me } }, send: vi.fn(), subscribe: vi.fn() })
  mockApi(() => ({ status: 204 }))
  render(<Settings me={me} />)
  expect(screen.getByRole('radio', { name: 'System' })).toBeChecked()
  await userEvent.click(screen.getByRole('radio', { name: 'Dark' }))
  expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked()
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(localStorage.getItem('platha.theme')).toBe('dark')
  await userEvent.click(screen.getByRole('radio', { name: 'System' }))
  expect(document.documentElement.dataset.theme).toBeUndefined()
})
