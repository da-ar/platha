import type { ReactNode } from 'react'

/** Centered card used by the sign-in pages. */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="auth">
      <div className="auth__card">
        <p className="brand">Platha</p>
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  )
}
