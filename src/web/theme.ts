export type Theme = 'system' | 'light' | 'dark'

const KEY = 'platha.theme'

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY)
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch {
    return 'system'
  }
}

/** Applies the theme to the page: `data-theme` on <html> overrides the system setting. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'system') delete root.dataset.theme
  else root.dataset.theme = theme
}

/** Saves the choice in this browser and applies it straight away. */
export function setTheme(theme: Theme): void {
  try {
    if (theme === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, theme)
  } catch {
    // storage unavailable: still applies for this page
  }
  applyTheme(theme)
}
