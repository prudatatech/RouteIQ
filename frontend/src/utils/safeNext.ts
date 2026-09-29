const PLACEHOLDER_ORIGIN = 'https://margixindia.invalid'
/** Pages that must never be the target after signing in, or sign-in would loop. */
const BLOCKED_PATHS = new Set(['/login', '/vendor/login'])

/**
 * Returns `raw` as a same-origin path ("/vendor/shipments?tab=open") when it is safe to
 * send the user there after signing in, or null. Anything that could leave the site
 * (absolute URLs, "//host", "/\host", control characters) is rejected, so `?next=` can't
 * be used as an open redirect.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null
  const value = raw.trim()
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) < 32 || value.charCodeAt(i) === 127) return null
  }
  let url: URL
  try {
    url = new URL(value, PLACEHOLDER_ORIGIN)
  } catch {
    return null
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return null
  const path = url.pathname.replace(/\/+$/, '') || '/'
  if (BLOCKED_PATHS.has(path)) return null
  return `${url.pathname}${url.search}${url.hash}`
}
