import { beforeEach, describe, expect, test, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OfficeView } from '../../../src/web/office/OfficeView'
import { useOffice, type Office } from '../../../src/web/office/useOffice'
import { useGitHub, type GitHubState } from '../../../src/web/github/useGitHub'
import { openTab } from '../../../src/web/navigate'
import { getToken } from '../../../src/web/token'
import { member, pr, snapshot } from '../factories'

vi.mock('../../../src/web/navigate', () => ({ go: vi.fn(), openTab: vi.fn(() => null) }))
vi.mock('../../../src/web/office/useOffice', () => ({ useOffice: vi.fn() }))
vi.mock('../../../src/web/github/useGitHub', () => ({ useGitHub: vi.fn() }))

const me = member({ githubId: 1, login: 'alice', name: 'Alice' })
const config = { org: 'acme', slackTeamId: 'T0000000' }

let office: Office
let github: GitHubState

function setOffice(over: Partial<Office['state']> = {}) {
  office = {
    state: {
      connection: 'open',
      members: {
        1: me,
        2: member({ githubId: 2, login: 'bob', name: 'Bob', online: false }),
        3: member({ githubId: 3, login: 'carol', name: 'Carol' }),
        4: member({ githubId: 4, login: 'dan', name: 'Aaron', online: false }),
      },
      ...over,
    },
    send: vi.fn(() => true),
    subscribe: vi.fn(() => () => {}),
  }
  vi.mocked(useOffice).mockImplementation(() => office)
}

function setGitHub(over: Partial<GitHubState> = {}) {
  github = { snapshot: snapshot(), status: 'ok', updatedAt: Date.now(), fetching: false, refresh: vi.fn(), ...over }
  vi.mocked(useGitHub).mockImplementation(() => github)
}

beforeEach(() => {
  setOffice()
  setGitHub()
})

describe('tiles', () => {
  test('office orders online before offline', () => {
    render(<OfficeView me={me} config={config} />)
    const tiles = within(screen.getByRole('region', { name: 'Team' })).getAllByRole('button')
    expect(tiles.map((t) => t.getAttribute('aria-label'))).toEqual(['Alice, Online', 'Carol, Online', 'Aaron, Offline', 'Bob, Offline'])
  })

  test('teammates are polled by login, excluding me', () => {
    render(<OfficeView me={me} config={config} />)
    expect(useGitHub).toHaveBeenCalledWith({ org: 'acme', teammates: ['bob', 'carol', 'dan'] })
  })

  test('my tile uses my PRs, teammates use theirs', () => {
    setGitHub({ snapshot: snapshot({ mine: [pr(10)], byTeammate: { carol: [pr(20, { isDraft: true }), pr(21)], bob: 'error' } }) })
    render(<OfficeView me={me} config={config} />)
    expect(within(screen.getByRole('button', { name: 'Alice, Online' })).getByText('1 open PR')).toBeInTheDocument()
    const carol = within(screen.getByRole('button', { name: 'Carol, Online' }))
    expect(carol.getByText('2 open PRs')).toBeInTheDocument()
    expect(carol.getByText('1 draft')).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: 'Bob, Offline' })).getByText("Couldn't load")).toBeInTheDocument()
  })

  test("a teammate's PR you're asked to review shows as waiting on you", () => {
    const carols = pr(30, { author: 'carol' })
    setGitHub({ snapshot: snapshot({ reviewRequested: [carols], mine: [pr(10)], byTeammate: { carol: [carols] } }) })
    render(<OfficeView me={me} config={config} />)
    expect(within(screen.getByRole('button', { name: 'Carol, Online' })).getByText('1 waiting on you')).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: 'Alice, Online' })).queryByText(/waiting on you/)).toBeNull()
  })
})

describe('needs you', () => {
  test('clicking a needs-you row marks it seen and removes it on next render', async () => {
    const mention = { url: 'https://github.com/acme/api/issues/7', number: 7, title: 'Help', repo: 'acme/api', updatedAt: new Date(Date.now() + 60_000).toISOString() }
    setGitHub({ snapshot: snapshot({ mentions: [mention], reviewRequested: [pr(3)] }) })
    render(<OfficeView me={me} config={config} />)
    expect(screen.getByRole('heading', { name: 'Needs you · 2' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /#7 Help/ }))
    expect(openTab).toHaveBeenCalledWith(mention.url)
    expect(screen.queryByRole('button', { name: /#7 Help/ })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Needs you · 1' })).toBeInTheDocument()
  })

  test('empty state', () => {
    render(<OfficeView me={me} config={config} />)
    expect(screen.getByText('Nothing needs you right now.')).toBeInTheDocument()
  })
})

describe('banners', () => {
  test('unauthorized shows token banner', async () => {
    setGitHub({ snapshot: null, status: 'unauthorized' })
    render(<OfficeView me={me} config={config} />)
    const field = screen.getByLabelText('Your GitHub token stopped working — paste a new one.')
    await userEvent.type(field, ' tok-new ')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(getToken()).toBe('tok-new')
    expect(github.refresh).toHaveBeenCalled()
  })

  test('a failed refresh shows as stale in the panel, with no layout-shifting banner', () => {
    setGitHub({ status: 'error', updatedAt: Date.now() - 4 * 60_000 - 5_000 })
    render(<OfficeView me={me} config={config} />)
    expect(screen.getByText('Updated 4m ago · retrying')).toHaveClass('needs__updated--stale')
    expect(document.querySelector('.banner')).toBeNull()
  })

  test('the panel always shows how fresh the data is', () => {
    render(<OfficeView me={me} config={config} />)
    expect(screen.getByText('Updated just now')).not.toHaveClass('needs__updated--stale')
  })

  test('reconnecting indicator', () => {
    setOffice({ connection: 'reconnecting' })
    render(<OfficeView me={me} config={config} />)
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument()
  })

  test('removed replaces the office', () => {
    setOffice({ connection: 'removed' })
    render(<OfficeView me={me} config={config} />)
    expect(screen.getByText("You've been removed from this office.")).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Team' })).toBeNull()
  })
})

describe('refresh', () => {
  test('the refresh button fetches now', async () => {
    render(<OfficeView me={me} config={config} />)
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(github.refresh).toHaveBeenCalled()
  })

  test('disabled while fetching, hidden when the token is rejected', () => {
    setGitHub({ fetching: true })
    const { unmount } = render(<OfficeView me={me} config={config} />)
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()
    unmount()
    setGitHub({ snapshot: null, status: 'unauthorized' })
    render(<OfficeView me={me} config={config} />)
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull()
  })

  test('an unchanged item keeps its DOM node across refreshes', () => {
    const keep = pr(3)
    setGitHub({ snapshot: snapshot({ reviewRequested: [keep] }) })
    const { rerender } = render(<OfficeView me={me} config={config} />)
    const before = screen.getByRole('button', { name: /#3 PR 3/ })
    setGitHub({ snapshot: snapshot({ reviewRequested: [pr(4, { updatedAt: '2026-10-08T10:00:00Z' }), keep] }) })
    rerender(<OfficeView me={me} config={config} />)
    expect(screen.getByRole('button', { name: /#3 PR 3/ })).toBe(before)
    expect(screen.getByRole('button', { name: /#4 PR 4/ })).toBeInTheDocument()
  })
})

describe('status', () => {
  test('changing status sends set_status', async () => {
    render(<OfficeView me={me} config={config} />)
    await userEvent.selectOptions(screen.getByLabelText('Your status'), 'focusing')
    expect(office.send).toHaveBeenCalledWith({ type: 'set_status', status: 'focusing' })
    await userEvent.type(screen.getByLabelText('Status note'), 'Deep work{Enter}')
    expect(office.send).toHaveBeenLastCalledWith({ type: 'set_status', status: 'available', text: 'Deep work' })
  })
})

test('ticks without crashing', () => {
  vi.useFakeTimers()
  render(<OfficeView me={me} config={config} />)
  act(() => vi.advanceTimersByTime(60_000))
  vi.useRealTimers()
})

describe('calling', () => {
  test('with a saved room, Call rings straight away and opens the room', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const room = 'https://meet.google.com/xyz-abcd-efg'
    render(<OfficeView me={me} config={config} meetUrl={room} />)
    await userEvent.click(screen.getByRole('button', { name: 'Carol, Online' }))
    await userEvent.click(screen.getByRole('button', { name: 'Call' }))
    expect(office.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'knock', to: 3, meetUrl: room }))
    expect(openTab).toHaveBeenCalledWith(room)
    expect(open).not.toHaveBeenCalledWith('https://meet.new', '_blank')
    expect(screen.queryByLabelText('Meet link')).toBeNull()
    expect(screen.getByText('Calling Carol…')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open your Meet room' })).toHaveAttribute('href', room)
  })

  test('without a saved room, the paste flow suggests saving one', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    render(<OfficeView me={me} config={config} />)
    await userEvent.click(screen.getByRole('button', { name: 'Carol, Online' }))
    await userEvent.click(screen.getByRole('button', { name: 'Call' }))
    expect(screen.getByLabelText('Meet link')).toBeInTheDocument()
    expect(within(screen.getByRole('dialog', { name: 'Call Carol' })).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
  })

  test('tile opens drawer; call opens meet.new and the modal; ringing shows in the modal', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<OfficeView me={me} config={config} />)
    await userEvent.click(screen.getByRole('button', { name: 'Carol, Online' }))
    expect(screen.getByRole('dialog', { name: 'Carol' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Call' }))
    expect(open).toHaveBeenCalledWith('https://meet.new', '_blank')
    expect(screen.getByRole('link', { name: 'Open Google Meet' })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Meet link'), 'https://meet.google.com/abc-defg-hij')
    await userEvent.click(screen.getByRole('button', { name: 'Ring Carol' }))
    expect(office.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'knock', to: 3, meetUrl: 'https://meet.google.com/abc-defg-hij' }))
    expect(screen.getByText('Calling Carol…')).toBeInTheDocument()
  })
})
