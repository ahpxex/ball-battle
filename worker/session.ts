import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { createSession, deleteSession, type UserRow, userForSession } from './users'

export interface AppEnv {
  Bindings: Env
  Variables: { user: UserRow | null }
}

export type AppContext = Context<AppEnv>

const SESSION_COOKIE = 'bb_session'

/** `Secure` cookies are only accepted over HTTPS (local dev runs on http://localhost). */
const isHttps = (c: AppContext): boolean => new URL(c.req.url).protocol === 'https:'

function writeSessionCookie(c: AppContext, token: string, expiresAt: number): void {
  setCookie(c, SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: isHttps(c),
    sameSite: 'Lax',
    expires: new Date(expiresAt),
  })
}

/** Resolves the signed-in user (guest or registered) from the session cookie. */
export const sessionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE)
  let user: UserRow | null = null
  if (token) {
    const found = await userForSession(c.env.DB, token)
    if (found) {
      user = found.user
      if (found.renewedUntil) writeSessionCookie(c, token, found.renewedUntil)
    } else {
      deleteCookie(c, SESSION_COOKIE, { path: '/' })
    }
  }
  c.set('user', user)
  await next()
}

export async function startSession(c: AppContext, userId: string): Promise<void> {
  const old = getCookie(c, SESSION_COOKIE)
  if (old) await deleteSession(c.env.DB, old)
  const { token, expiresAt } = await createSession(c.env.DB, userId)
  writeSessionCookie(c, token, expiresAt)
}

export async function endSession(c: AppContext): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) await deleteSession(c.env.DB, token)
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}
