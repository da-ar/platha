import { useEffect, useState } from 'react'
import { me, type Me } from './api'
import { Join } from './pages/Join'
import { Login } from './pages/Login'
import { Setup } from './pages/Setup'

type Route = { page: 'setup' } | { page: 'join'; code: string } | { page: 'settings' } | { page: 'office' }

export function route(pathname: string): Route {
  if (pathname === '/setup') return { page: 'setup' }
  const join = /^\/join\/([A-Za-z0-9_-]+)\/?$/.exec(pathname)
  if (join) return { page: 'join', code: join[1] }
  if (pathname === '/settings') return { page: 'settings' }
  return { page: 'office' }
}

function Office({ data }: { data: Me }) {
  return <main className="office">Welcome, {data.member.name ?? data.member.login}</main>
}

export function App() {
  const r = route(window.location.pathname)
  if (r.page === 'setup') return <Setup />
  if (r.page === 'join') return <Join code={r.code} />
  return <SignedIn />
}

function SignedIn() {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'out' } | { status: 'in'; data: Me }>({ status: 'loading' })

  useEffect(() => {
    void me().then((res) => setState(res.ok ? { status: 'in', data: res.data } : { status: 'out' }))
  }, [])

  if (state.status === 'loading') return null
  if (state.status === 'out') return <Login />
  return <Office data={state.data} />
}
