import type { Env } from './env'

export { Office } from './office/Office'

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname.startsWith('/api/') || url.pathname === '/ws') {
      return Response.json({ error: 'not_found' }, { status: 404 })
    }
    return env.ASSETS.fetch(req)
  },
} satisfies ExportedHandler<Env>
