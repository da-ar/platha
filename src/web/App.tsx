import { useEffect, useState } from 'react'
import { me, type Me } from './api'
import { Join } from './pages/Join'
import { Login } from './pages/Login'
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

function SignedIn({ page }: { page: 'settings' | 'office' }) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'out' } | { status: 'in'; data: Me }>({ status: 'loading' })

  useEffect(() => {
    void me().then((res) => setState(res.ok ? { status: 'in', data: res.data } : { status: 'out' }))
  }, [])

  if (state.status === 'loading') return null
  if (state.status === 'out') return <Login />
  if (page === 'settings') return <Settings me={state.data.member} meetUrl={state.data.meetUrl} email={state.data.email} calendarState={state.data.calendarState} />
  return <OfficeView me={state.data.member} config={state.data.config} meetUrl={state.data.meetUrl} />
}
