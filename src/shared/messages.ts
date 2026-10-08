import { z } from 'zod'
import { normalizeMeetUrl, STATUS_TEXT_MAX } from './validators'

const status = z.enum(['available', 'focusing', 'away'])
const githubId = z.number().int().positive()
const knockId = z.uuid()
const answer = z.enum(['join', 'decline'])

const meetUrl = z.string().transform((value, ctx) => {
  const url = normalizeMeetUrl(value)
  if (url === null) {
    ctx.addIssue({ code: 'custom', message: 'not a meet url' })
    return z.NEVER
  }
  return url
})

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('set_status'), status, text: z.string().max(STATUS_TEXT_MAX).optional() }),
  z.object({ type: z.literal('knock'), knockId, to: githubId, meetUrl }),
  z.object({ type: z.literal('knock_answer'), knockId, to: githubId, answer }),
])

const member = z.object({
  githubId,
  login: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.string(),
  slackUserId: z.string().nullable(),
  role: z.enum(['admin', 'member']),
  status,
  statusText: z.string().nullable(),
  online: z.boolean(),
})

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapshot'), members: z.array(member) }),
  z.object({ type: z.literal('member_updated'), member }),
  z.object({ type: z.literal('member_removed'), githubId }),
  z.object({ type: z.literal('knock'), knockId, from: githubId, meetUrl }),
  z.object({ type: z.literal('knock_answered'), knockId, answer }),
  z.object({ type: z.literal('knock_failed'), knockId, reason: z.literal('offline') }),
  z.object({ type: z.literal('session_revoked') }),
])

export type ClientMessage = z.output<typeof ClientMessageSchema>
export type ServerMessage = z.output<typeof ServerMessageSchema>

function parseWith<T>(schema: z.ZodType<T>, raw: string): T | null {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  const result = schema.safeParse(json)
  return result.success ? result.data : null
}

export function parseClientMessage(raw: string): ClientMessage | null {
  return parseWith(ClientMessageSchema, raw)
}

export function parseServerMessage(raw: string): ServerMessage | null {
  return parseWith(ServerMessageSchema, raw)
}
