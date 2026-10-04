import { Hono } from 'hono'
import type { CreateRoomResponse, MeResponse } from '../src/net/apiTypes'
import { cleanName, isGameMode, isRoomCode, normalizeRoomCode, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../src/net/protocol'
import { configuredProviders, oauthRoutes } from './oauth'
import { IDENTITY_HEADER, type Identity } from './Room'
import { type AppContext, type AppEnv, endSession, sessionMiddleware, startSession } from './session'
import { apiError } from './errors'
import { friendRoutes, historyFor } from './social'
import { createGuest, renameUser, toMe } from './users'
import { randomString } from './util'

export { Room } from './Room'
export { UserHub } from './UserHub'

const app = new Hono<AppEnv>().basePath('/api')


/** Per-IP limit on endpoints that create rows or rooms. */
async function rateLimited(c: AppContext, action: string): Promise<boolean> {
  const ip = c.req.header('CF-Connecting-IP') ?? 'local'
  const { success } = await c.env.CREATE_LIMITER.limit({ key: `${action}:${ip}` })
  return !success
}

/** WebSocket upgrades carry cookies, so only accept them from our own pages. */
function sameOrigin(c: AppContext): boolean {
  const origin = c.req.header('Origin')
  return !origin || origin === new URL(c.req.url).origin
}

app.use(sessionMiddleware)

// ───────────────────────────── identity ─────────────────────────────

app.get('/me', async (c) => {
  const u = c.get('user')
  const body: MeResponse = { user: u && (await toMe(c.env.DB, u)), providers: configuredProviders(c.env) }
  return c.json(body)
})

/** Starts playing online without an account: a guest tied to this browser's cookie. */
app.post('/session/guest', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown }
  const name = cleanName(body.name)
  if (!name) return apiError(c, 'bad_name')
  let u = c.get('user')
  if (u) {
    await renameUser(c.env.DB, u.id, name)
    u = { ...u, name }
  } else {
    if (await rateLimited(c, 'guest')) return apiError(c, 'rate_limited')
    u = await createGuest(c.env.DB, name)
    await startSession(c, u.id)
  }
  return c.json({ user: await toMe(c.env.DB, u), providers: configuredProviders(c.env) } satisfies MeResponse)
})

app.patch('/me', async (c) => {
  const u = c.get('user')
  if (!u) return apiError(c, 'unauthorized')
  const name = cleanName(((await c.req.json().catch(() => ({}))) as { name?: unknown }).name)
  if (!name) return apiError(c, 'bad_name')
  await renameUser(c.env.DB, u.id, name)
  return c.json({ user: await toMe(c.env.DB, { ...u, name }), providers: configuredProviders(c.env) } satisfies MeResponse)
})

app.post('/auth/logout', async (c) => {
  await endSession(c)
  return c.json({ ok: true })
})

app.route('/auth', oauthRoutes)

// ───────────────────────────── rooms ─────────────────────────────

const roomStub = (env: Env, code: string) => env.ROOMS.get(env.ROOMS.idFromName(code))

app.post('/rooms', async (c) => {
  const u = c.get('user')
  if (!u) return apiError(c, 'unauthorized')
  const { mode } = (await c.req.json().catch(() => ({}))) as { mode?: unknown }
  if (!isGameMode(mode)) return apiError(c, 'bad_mode')
  if (await rateLimited(c, 'room')) return apiError(c, 'rate_limited')
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomString(ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH)
    if (await roomStub(c.env, code).init(code, mode)) return c.json({ code } satisfies CreateRoomResponse)
  }
  throw new Error('could not allocate a room code')
})

app.get('/rooms/:code', async (c) => {
  const code = normalizeRoomCode(c.req.param('code'))
  if (!isRoomCode(code)) return apiError(c, 'bad_room_code')
  const room = await roomStub(c.env, code).summary()
  return room ? c.json(room) : apiError(c, 'room_not_found')
})

app.get('/rooms/:code/ws', async (c) => {
  const code = normalizeRoomCode(c.req.param('code'))
  if (c.req.header('Upgrade') !== 'websocket') return apiError(c, 'websocket_required')
  if (!sameOrigin(c)) return apiError(c, 'forbidden_origin')
  const u = c.get('user')
  if (!u) return apiError(c, 'unauthorized')
  if (!isRoomCode(code)) return apiError(c, 'bad_room_code')
  const who: Identity = { userId: u.id, name: u.name, avatar: u.avatar_url, registered: u.registered === 1 }
  const headers = new Headers(c.req.raw.headers)
  headers.set(IDENTITY_HEADER, encodeURIComponent(JSON.stringify(who)))
  return roomStub(c.env, code).fetch(new Request(c.req.raw.url, { headers }))
})

// ───────────────────────────── social ─────────────────────────────

app.get('/hub', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') return apiError(c, 'websocket_required')
  if (!sameOrigin(c)) return apiError(c, 'forbidden_origin')
  const u = c.get('user')
  if (!u?.registered) return apiError(c, 'unauthorized')
  return c.env.HUBS.get(c.env.HUBS.idFromName(u.id)).fetch(c.req.raw)
})

app.route('/friends', friendRoutes)

app.get('/history', async (c) => {
  const u = c.get('user')
  if (!u) return apiError(c, 'unauthorized')
  return c.json(await historyFor(c.env.DB, u.id))
})

app.notFound((c) => apiError(c, 'not_found'))

app.onError((err, c) => {
  console.error(err)
  return apiError(c, 'internal')
})

export default app satisfies ExportedHandler<Env>
