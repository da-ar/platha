import { DurableObject } from 'cloudflare:workers'
import type { Env } from '../env'

export class Office extends DurableObject<Env> {}
