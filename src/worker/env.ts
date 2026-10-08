import type { Office } from './office/Office'

export interface Env {
  OFFICE: DurableObjectNamespace<Office>
  ASSETS: Fetcher
  GITHUB_ORG: string
  SLACK_TEAM_ID: string
  SETUP_SECRET: string
  GITHUB_API_BASE: string
  /** Google's public iCal base; overridable for local testing. */
  CALENDAR_ICAL_BASE?: string
}
