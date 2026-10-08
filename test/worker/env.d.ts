import type { Env as PlathaEnv } from '../../src/worker/env'

declare global {
  namespace Cloudflare {
    interface Env extends PlathaEnv {}
  }
}

export {}
