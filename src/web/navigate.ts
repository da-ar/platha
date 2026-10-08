/** Full-page navigation. Its own module so tests can mock it. */
export function go(path: string): void {
  window.location.assign(path)
}

export function openTab(url: string): Window | null {
  return window.open(url, '_blank', 'noopener')
}
