import { useEffect, useState } from 'react'
import { me, type Me } from './api'
import { Join } from './pages/Join'
import { clearAutoLoginAttempt, Login } from './pages/Login'
import { AuthCard } from './pages/Shell'
import { Settings } from './pages/Settings'
import { Setup } from './pages/Setup'
import { OfficeView } from './office/OfficeView'

type Route = { page: 'setup' } | { page: 'join'; code: string } | { page: 'settings' } | { page: 'office' }

export function route(pathname: string): Route {
  if (pathname === '/setup') return { page: 'setup' }
  const join = /^\/join\/([A-Za-z0-9_-]+)\/?$/.exec(pathname)
  if (join) return { page: 'join', code: join[1] }
  if (pathname === '/settings') return { page: 'settings' }
  return { page: 'office' }
}

export function App() {
  const r = route(window.location.pathname)
  if (r.page === 'setup') return <Setup />
  if (r.page === 'join') return <Join code={r.code} />
  return <SignedIn page={r.page} />
}

const RETRY_START_MS = 2_000
const RETRY_MAX_MS = 30_000

function SignedIn({ page }: { page: 'settings' | 'office' }) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'out' } | { status: 'unreachable' } | { status: 'in'; data: Me }>({
    status: 'loading',
  })

  // Only a 401 means signed out. Anything else (a deploy in progress, a network blip)
  // retries in place: treating it as signed out would bounce through Login and reload.
  useEffect(() => {
    let cancelled = false
    let delay = RETRY_START_MS
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = () =>
      void me().then((res) => {
        if (cancelled) return
        if (res.ok) {
          clearAutoLoginAttempt()
          setState({ status: 'in', data: res.data })
        } else if (res.status === 401) {
          setState({ status: 'out' })
        } else {
          setState({ status: 'unreachable' })
          timer = setTimeout(check, delay)
          delay = Math.min(delay * 2, RETRY_MAX_MS)
        }
      })
    check()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  if (state.status === 'loading') return null
  if (state.status === 'out') return <Login />
  if (state.status === 'unreachable') {
    return (
      <AuthCard title="Can't reach Platha — retrying…">
        <p className="muted">This usually clears up in a few seconds, for example while a new version is being deployed.</p>
      </AuthCard>
    )
  }
  if (page === 'settings') return <Settings me={state.data.member} meetUrl={state.data.meetUrl} email={state.data.email} calendarState={state.data.calendarState} />
  return <OfficeView me={state.data.member} config={state.data.config} meetUrl={state.data.meetUrl} />
}
