import { env, runInDurableObject } from 'cloudflare:test'
import type { Office } from '../../src/worker/office/Office'
import type { GitHubIdentity } from '../../src/worker/github'

export const alice: GitHubIdentity = { id: 1, login: 'alice', name: 'Alice', avatarUrl: 'https://avatars.githubusercontent.com/u/1' }
export const bob: GitHubIdentity = { id: 2, login: 'bob', name: 'Bob', avatarUrl: 'https://avatars.githubusercontent.com/u/2' }
export const carol: GitHubIdentity = { id: 3, login: 'carol', name: null, avatarUrl: 'https://avatars.githubusercontent.com/u/3' }

/** A fresh, isolated office per call. */
export function freshOffice(): DurableObjectStub<Office> {
  return env.OFFICE.get(env.OFFICE.idFromName(crypto.randomUUID()))
}

/** The single office instance the Worker routes use. */
export function mainOffice(): DurableObjectStub<Office> {
  return env.OFFICE.get(env.OFFICE.idFromName('office'))
}

export async function setNow(stub: DurableObjectStub<Office>, ms: number): Promise<void> {
  await runInDurableObject(stub, (office: Office) => {
    office.now = () => ms
  })
}
