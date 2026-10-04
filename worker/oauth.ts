import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { type AuthProvider, isAuthProvider } from '../src/net/apiTypes'
import { cleanName } from '../src/net/protocol'
import { apiError } from './errors'
import { type AppContext, type AppEnv, startSession } from './session'
import { createRegisteredUser, findUserByIdentity, linkIdentity, mergeGuestInto, type ProviderProfile } from './users'
import { randomToken, sha256 } from './util'

/** Short-lived cookie carrying the OAuth `state`, PKCE verifier and where to return afterwards. */
const FLOW_COOKIE = 'bb_oauth'
const FLOW_PATH = '/api/auth'
const FLOW_TTL_S = 600

interface Flow {
  provider: AuthProvider
  state: string
  verifier: string
  returnTo: string
}

interface ProviderConfig {
  clientId: string
  clientSecret: string
}

export function providerConfig(env: Env, p: AuthProvider): ProviderConfig | null {
  const id = p === 'github' ? env.GITHUB_CLIENT_ID : env.GOOGLE_CLIENT_ID
  const secret = p === 'github' ? env.GITHUB_CLIENT_SECRET : env.GOOGLE_CLIENT_SECRET
  return id && secret ? { clientId: id, clientSecret: secret } : null
}

export const configuredProviders = (env: Env): AuthProvider[] => (['github', 'google'] as const).filter((p) => providerConfig(env, p))

const PLACEHOLDER_ORIGIN = 'https://return.invalid'

/**
 * Only same-site paths, so the login flow can't be used as an open redirect.
 * Browsers drop tabs/newlines and treat `\` like `/` when parsing URLs, so
 * those are rejected outright, and the result is re-parsed to confirm it
 * stays on this origin.
 */
function safeReturnPath(raw: string | undefined): string {
  if (!raw || /[\s\\\p{Cc}]/u.test(raw) || !raw.startsWith('/') || raw.startsWith('//')) return '/'
  const u = new URL(raw, PLACEHOLDER_ORIGIN)
  if (u.origin !== PLACEHOLDER_ORIGIN) return '/'
  // Check the normalized result too: dot segments can turn `/.//evil.com` into a protocol-relative `//evil.com`.
  return sameSitePath(u.pathname + u.search + u.hash)
}

/** A path that stays on this origin when used as a redirect target (no `//` or `/\` prefix). */
const sameSitePath = (path: string): string => (path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\') ? path : '/')

const callbackUrl = (c: AppContext, p: AuthProvider): string => `${new URL(c.req.url).origin}${FLOW_PATH}/${p}/callback`

async function pkceChallenge(verifier: string): Promise<string> {
  return sha256(verifier)
}

function authorizeUrl(c: AppContext, p: AuthProvider, cfg: ProviderConfig, flow: Flow, challenge: string): string {
  if (p === 'github') {
    const u = new URL('https://github.com/login/oauth/authorize')
    u.searchParams.set('client_id', cfg.clientId)
    u.searchParams.set('redirect_uri', callbackUrl(c, p))
    u.searchParams.set('state', flow.state)
    u.searchParams.set('scope', 'read:user')
    u.searchParams.set('allow_signup', 'true')
    u.searchParams.set('code_challenge', challenge)
    u.searchParams.set('code_challenge_method', 'S256')
    return u.toString()
  }
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  u.searchParams.set('client_id', cfg.clientId)
  u.searchParams.set('redirect_uri', callbackUrl(c, p))
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', 'openid profile')
  u.searchParams.set('state', flow.state)
  u.searchParams.set('code_challenge', challenge)
  u.searchParams.set('code_challenge_method', 'S256')
  u.searchParams.set('prompt', 'select_account')
  return u.toString()
}

class OAuthError extends Error {}

async function exchangeCode(c: AppContext, p: AuthProvider, cfg: ProviderConfig, code: string, verifier: string): Promise<string> {
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
    redirect_uri: callbackUrl(c, p),
    code_verifier: verifier,
    grant_type: 'authorization_code',
  })
  const url = p === 'github' ? 'https://github.com/login/oauth/access_token' : 'https://oauth2.googleapis.com/token'
  const res = await fetch(url, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string }
  if (!res.ok || !json.access_token) throw new OAuthError(`token exchange failed: ${json.error ?? res.status}`)
  return json.access_token
}

async function fetchProfile(p: AuthProvider, accessToken: string): Promise<ProviderProfile> {
  if (p === 'github') {
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'ball-battle' },
    })
    if (!res.ok) throw new OAuthError(`github profile failed: ${res.status}`)
    const u = (await res.json()) as { id: number; login: string; name: string | null; avatar_url: string | null }
    return { provider: p, providerUserId: String(u.id), name: cleanName(u.name) ?? cleanName(u.login) ?? 'GitHub player', avatar: u.avatar_url }
  }
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new OAuthError(`google profile failed: ${res.status}`)
  const u = (await res.json()) as { sub: string; name?: string; picture?: string }
  return { provider: p, providerUserId: u.sub, name: cleanName(u.name) ?? 'Google player', avatar: u.picture ?? null }
}

function readFlow(c: AppContext): Flow | null {
  const raw = getCookie(c, FLOW_COOKIE)
  if (!raw) return null
  try {
    const f = JSON.parse(atob(raw)) as Partial<Flow>
    if (!isAuthProvider(f.provider) || typeof f.state !== 'string' || typeof f.verifier !== 'string' || typeof f.returnTo !== 'string') return null
    return { provider: f.provider, state: f.state, verifier: f.verifier, returnTo: safeReturnPath(f.returnTo) }
  } catch {
    return null
  }
}

/** Constant-time comparison for the OAuth state. */
function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function withAuthError(path: string, code: string): string {
  const u = new URL(sameSitePath(path), PLACEHOLDER_ORIGIN)
  u.searchParams.set('auth_error', code)
  return sameSitePath(u.pathname + u.search)
}

export const oauthRoutes = new Hono<AppEnv>()

oauthRoutes.get('/:provider/start', async (c) => {
  const p = c.req.param('provider')
  if (!isAuthProvider(p)) return c.notFound()
  const cfg = providerConfig(c.env, p)
  if (!cfg) return apiError(c, 'not_configured')
  const flow: Flow = { provider: p, state: randomToken(16), verifier: randomToken(32), returnTo: safeReturnPath(c.req.query('return')) }
  setCookie(c, FLOW_COOKIE, btoa(JSON.stringify(flow)), {
    path: FLOW_PATH,
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    // Lax: the cookie must come back on the provider's top-level redirect to our callback.
    sameSite: 'Lax',
    maxAge: FLOW_TTL_S,
  })
  return c.redirect(authorizeUrl(c, p, cfg, flow, await pkceChallenge(flow.verifier)))
})

oauthRoutes.get('/:provider/callback', async (c) => {
  const p = c.req.param('provider')
  if (!isAuthProvider(p)) return c.notFound()
  const flow = readFlow(c)
  deleteCookie(c, FLOW_COOKIE, { path: FLOW_PATH })
  const returnTo = flow?.returnTo ?? '/'
  const state = c.req.query('state')
  const code = c.req.query('code')
  if (c.req.query('error')) return c.redirect(withAuthError(returnTo, 'cancelled'))
  if (!flow || flow.provider !== p || !state || !code || !sameString(state, flow.state)) return c.redirect(withAuthError(returnTo, 'state'))
  const cfg = providerConfig(c.env, p)
  if (!cfg) return c.redirect(withAuthError(returnTo, 'not_configured'))

  let profile: ProviderProfile
  try {
    profile = await fetchProfile(p, await exchangeCode(c, p, cfg, code, flow.verifier))
  } catch (e) {
    console.error('oauth', p, e)
    return c.redirect(withAuthError(returnTo, 'provider'))
  }

  const db = c.env.DB
  const current = c.get('user')
  const owner = await findUserByIdentity(db, p, profile.providerUserId)
  let userId: string
  if (owner) {
    // Existing account: sign in to it, folding a guest's history into it.
    if (current && current.id !== owner.id && !current.registered) await mergeGuestInto(db, current.id, owner.id)
    userId = owner.id
  } else if (current) {
    // New identity: upgrade the guest (keeping their name and history) or link it to the signed-in account.
    await linkIdentity(db, current, profile)
    userId = current.id
  } else {
    userId = (await createRegisteredUser(db, profile)).id
  }
  if (!current || current.id !== userId) await startSession(c, userId)
  return c.redirect(returnTo)
})
