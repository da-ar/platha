import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
  localStorage.clear()
})
import '@testing-library/jest-dom/vitest'

// jsdom has no Web Animations API; animations are checked in the browser.
vi.mock('@formkit/auto-animate/react', () => ({ useAutoAnimate: () => [() => {}, () => {}] }))
