import type { D1Database, Fetcher } from '@cloudflare/workers-types'

export interface Env {
  DB: D1Database
  ASSETS?: Fetcher
  APP_ORIGIN: string
  INSTAGRAM_APP_ID: string
  INSTAGRAM_APP_SECRET: string
  INSTAGRAM_ACCOUNT_USERNAME: string
  INSTAGRAM_API_VERSION: string
  TOKEN_ENCRYPTION_KEY: string
  META_AD_ACCOUNT_ID?: string
  META_ADS_API_VERSION?: string
  META_ADS_ACCESS_TOKEN?: string
  ADMIN_PASSWORD_VERIFIER?: string
  ADMIN_ANALYTICS_KEY?: string
}

export interface ConnectionRow {
  id: 1
  user_id: string
  oauth_user_id: string | null
  app_scoped_id: string | null
  username: string
  encrypted_token: string
  connected_at: number
  token_expires_at: number
  last_refreshed_at: number
  refresh_error: string | null
}

export interface SessionRow {
  user_id: string
  csrf_token: string
  expires_at: number
}

export class ConnectionError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code)
  }
}
