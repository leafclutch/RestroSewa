/**
 * Returns the canonical application base URL.
 *
 * Priority order:
 *   1. NEXT_PUBLIC_APP_URL — explicitly configured (set this in every deployment)
 *   2. VERCEL_URL          — auto-injected by Vercel per deployment (server-only, no NEXT_PUBLIC_ prefix)
 *   3. http://localhost:3000 — local dev fallback of last resort
 *
 * VERCEL_URL is only available server-side. For client components that need
 * the base URL, always set NEXT_PUBLIC_APP_URL in the Vercel project settings.
 */
export function getAppUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }
  return 'http://localhost:3000'
}

export function getTableUrl(qrToken: string): string {
  return `${getAppUrl()}/t/${qrToken}`
}
