import { readFileSync } from 'node:fs'
import { expect, test, type Browser, type Page } from '@playwright/test'

const graphql = readFileSync(new URL('../test/fixtures/graphql-full.json', import.meta.url), 'utf8')

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()
  // GitHub GraphQL comes from the recorded fixture; avatars aren't needed.
  await page.route('https://api.github.com/graphql', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: graphql }))
  await page.route('https://avatars.githubusercontent.com/**', (route) => route.abort())
  // Behave like a browser that blocks the meet.new popup.
  await page.addInitScript(() => {
    window.open = () => null
  })
  return page
}

test('two teammates see each other and can knock', async ({ browser }) => {
  const alice = await newPage(browser)
  await alice.goto('/setup')
  await alice.getByLabel('Setup code').fill('e2e-secret')
  await alice.getByLabel('GitHub token').fill('alice-token')
  await alice.getByRole('button', { name: 'Create office' }).click()
  const inviteUrl = await alice.getByLabel('Invite link').inputValue()
  expect(inviteUrl).toMatch(/\/join\/[\w-]{22}$/)
  await alice.getByRole('button', { name: 'Go to the office' }).click()

  const bob = await newPage(browser)
  await bob.goto(new URL(inviteUrl).pathname)
  await bob.getByLabel('GitHub token').fill('bob-token')
  await bob.getByRole('button', { name: 'Join' }).click()

  const bobHere = /^bob, (Online|In a meeting)$/
  await expect(alice.getByRole('button', { name: bobHere })).toBeVisible()
  await expect(bob.getByRole('button', { name: 'alice, Online' })).toBeVisible()
  await expect(alice.getByRole('heading', { name: /Needs you · \d+/ })).toBeVisible()

  await alice.getByRole('button', { name: bobHere }).click()
  await alice.getByRole('button', { name: 'Call', exact: true }).click()
  await expect(alice.getByRole('link', { name: 'Open Google Meet' })).toBeVisible()
  await alice.getByLabel('Meet link').fill('https://meet.google.com/abc-defg-hij')
  await alice.getByRole('button', { name: 'Ring bob' }).click()
  await expect(alice.getByText('Ringing bob…')).toBeVisible()

  await expect(bob.getByText('alice is calling')).toBeVisible()
  await expect(bob).toHaveTitle(/alice is calling|Platha/)
  expect(await bob.evaluate(() => new Promise<boolean>((resolve) => {
    // The title flashes; within two flashes it must show the caller.
    const end = Date.now() + 2500
    const check = () => (document.title.includes('alice is calling') ? resolve(true) : Date.now() > end ? resolve(false) : setTimeout(check, 100))
    check()
  }))).toBe(true)
  await bob.getByRole('button', { name: 'Not now' }).click()
  await expect(alice.getByText("bob can't talk right now")).toBeVisible()
  await expect(bob).toHaveTitle('Platha')

  await alice.getByRole('dialog', { name: 'Call bob' }).getByRole('button', { name: 'Close' }).click()
  await alice.keyboard.press('Escape')

  // With a saved Meet room, Call rings straight away: no meet.new tab, no pasting.
  await alice.goto('/settings')
  await alice.getByLabel('Meet room link').fill('meet.google.com/xyz-abcd-efg')
  await alice.getByRole('heading', { name: 'Meet room' }).locator('..').getByRole('button', { name: 'Save' }).click()
  await expect(alice.getByText(/Call now rings straight away/)).toBeVisible()
  await alice.goto('/')
  await alice.getByRole('button', { name: bobHere }).click()
  await alice.getByRole('button', { name: 'Call', exact: true }).click()
  await expect(alice.getByText('Ringing bob…')).toBeVisible()
  await expect(alice.getByLabel('Meet link')).toHaveCount(0)
  await expect(alice.getByRole('link', { name: 'Open your Meet room' })).toHaveAttribute('href', 'https://meet.google.com/xyz-abcd-efg')
  await expect(bob.getByText('alice is calling')).toBeVisible()
  await bob.getByRole('button', { name: 'Join' }).click()
  await expect(alice.getByText('bob is joining the call')).toBeVisible()
  await alice.getByRole('dialog', { name: 'Call bob' }).getByRole('button', { name: 'Close' }).click()
  await alice.keyboard.press('Escape')
  // Bob's public calendar has a meeting now: the office syncs it and shows him in a meeting.
  await expect(alice.getByRole('button', { name: 'bob, In a meeting' })).toBeVisible({ timeout: 60_000 })
  await alice.getByRole('button', { name: 'bob, In a meeting' }).click()
  await alice.getByRole('tab', { name: 'Calendar' }).click()
  await expect(alice.locator('.cal__busy').first()).toHaveAttribute('title', /^Busy /)
  await expect(alice.getByRole('img', { name: /^Now, / })).toBeVisible()
  await alice.keyboard.press('Escape')
  // Alice has no public email: her own calendar tab says so.
  await alice.getByRole('button', { name: /^alice, / }).click()
  await alice.getByRole('tab', { name: 'Calendar' }).click()
  await expect(alice.getByText('Calendar not shared.')).toBeVisible()
  await alice.keyboard.press('Escape')

  await bob.close()
  await expect(alice.getByRole('button', { name: 'bob, Offline' })).toBeVisible({ timeout: 40_000 })
})
