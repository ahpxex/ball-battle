import { Hono } from 'hono'
import type { FriendsResponse, HistoryResponse, SeriesEntry } from '../src/net/apiTypes'
import { type GameMode, isRoomCode, normalizeRoomCode, type RoundRecord, type Seat, type UserSummary } from '../src/net/protocol'
import type { CharacterId } from '../src/game/engine/types'
import { apiError } from './errors'
import type { AppEnv } from './session'
import { summary, type UserRow } from './users'
import { now } from './util'

const HISTORY_LIMIT = 30


const hubOf = (env: Env, userId: string) => env.HUBS.get(env.HUBS.idFromName(userId))

/** Tells a user's open tabs that their friend list changed. */
async function pingFriends(env: Env, userId: string): Promise<void> {
  await hubOf(env, userId).notify({ t: 'friends' })
}

export const friendRoutes = new Hono<AppEnv>()

// Friends are a registered-user feature: guests are tied to one browser.
friendRoutes.use(async (c, next) => {
  const u = c.get('user')
  if (!u) return apiError(c, 'unauthorized')
  if (!u.registered) return apiError(c, 'guest')
  await next()
})

friendRoutes.get('/', async (c) => {
  const me = c.get('user')!
  const db = c.env.DB
  const [friends, incoming, outgoing] = await db.batch<UserRow>([
    db.prepare("SELECT u.* FROM friendships f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ? AND f.status = 'accepted' ORDER BY u.name").bind(me.id),
    db
      .prepare("SELECT u.* FROM friendships f JOIN users u ON u.id = f.user_id WHERE f.friend_id = ? AND f.status = 'pending' ORDER BY f.created_at DESC")
      .bind(me.id),
    db
      .prepare("SELECT u.* FROM friendships f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ? AND f.status = 'pending' ORDER BY f.created_at DESC")
      .bind(me.id),
  ])
  const online = await Promise.all(friends.results.map((f) => hubOf(c.env, f.id).online()))
  const body: FriendsResponse = {
    friends: friends.results.map((f, i) => ({ ...summary(f), online: online[i] })).sort((a, b) => Number(b.online) - Number(a.online)),
    incoming: incoming.results.map(summary),
    outgoing: outgoing.results.map(summary),
  }
  return c.json(body)
})

/** Sends a request by friend code, or by user id (e.g. a recent opponent). Accepts a crossing request. */
friendRoutes.post('/', async (c) => {
  const me = c.get('user')!
  const db = c.env.DB
  const body = (await c.req.json().catch(() => ({}))) as { code?: unknown; userId?: unknown }
  let target: UserRow | null = null
  if (typeof body.code === 'string') {
    target = await db.prepare('SELECT * FROM users WHERE friend_code = ?').bind(normalizeRoomCode(body.code)).first<UserRow>()
  } else if (typeof body.userId === 'string') {
    target = await db.prepare('SELECT * FROM users WHERE id = ?').bind(body.userId).first<UserRow>()
  }
  if (!target || !target.registered) return apiError(c, 'friend_not_found')
  if (target.id === me.id) return apiError(c, 'friend_self')

  const existing = await db
    .prepare('SELECT user_id, status FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)')
    .bind(me.id, target.id, target.id, me.id)
    .all<{ user_id: string; status: string }>()
  if (existing.results.some((r) => r.status === 'accepted')) return c.json({ status: 'accepted' })
  const t = now()
  if (existing.results.some((r) => r.user_id === target.id)) {
    // They already asked us: this is an accept.
    await acceptPair(db, target.id, me.id, t)
    await pingFriends(c.env, target.id)
    return c.json({ status: 'accepted' })
  }
  await db.prepare("INSERT OR IGNORE INTO friendships (user_id, friend_id, status, created_at) VALUES (?, ?, 'pending', ?)").bind(me.id, target.id, t).run()
  await pingFriends(c.env, target.id)
  return c.json({ status: 'pending' })
})

function acceptPair(db: D1Database, requester: string, accepter: string, t: number) {
  return db.batch([
    db.prepare("UPDATE friendships SET status = 'accepted' WHERE user_id = ? AND friend_id = ?").bind(requester, accepter),
    db.prepare("INSERT OR REPLACE INTO friendships (user_id, friend_id, status, created_at) VALUES (?, ?, 'accepted', ?)").bind(accepter, requester, t),
  ])
}

friendRoutes.post('/:id/accept', async (c) => {
  const me = c.get('user')!
  const id = c.req.param('id')
  const db = c.env.DB
  const req = await db.prepare("SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ? AND status = 'pending'").bind(id, me.id).first()
  if (!req) return apiError(c, 'request_gone')
  await acceptPair(db, id, me.id, now())
  await pingFriends(c.env, id)
  return c.json({ status: 'accepted' })
})

/** Declines a request, cancels one we sent, or removes a friend. */
friendRoutes.delete('/:id', async (c) => {
  const me = c.get('user')!
  const id = c.req.param('id')
  const { meta } = await c.env.DB.prepare('DELETE FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)')
    .bind(me.id, id, id, me.id)
    .run()
  if (meta.changes > 0) await pingFriends(c.env, id)
  return c.json({ status: 'removed' })
})

friendRoutes.post('/:id/invite', async (c) => {
  const me = c.get('user')!
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as { room?: unknown }
  const code = typeof body.room === 'string' ? normalizeRoomCode(body.room) : ''
  if (!isRoomCode(code)) return apiError(c, 'bad_room_code')
  const isFriend = await c.env.DB.prepare("SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ? AND status = 'accepted'").bind(me.id, id).first()
  if (!isFriend) return apiError(c, 'not_friend')
  const room = await c.env.ROOMS.get(c.env.ROOMS.idFromName(code)).summary()
  if (!room) return apiError(c, 'room_not_found')
  if (room.phase !== 'waiting') return apiError(c, 'room_busy')
  const { success } = await c.env.CREATE_LIMITER.limit({ key: `invite:${me.id}` })
  if (!success) return apiError(c, 'rate_limited')
  const delivered = await hubOf(c.env, id).notify({ t: 'invite', from: summary(me), room: code, mode: room.mode, at: now() })
  return c.json({ delivered: delivered > 0 })
})

// ───────────────────────────── history ─────────────────────────────

interface SeriesRow {
  id: string
  mode: GameMode
  p0: string
  p1: string
  score0: number
  score1: number
  winner: Seat
  forfeit: Seat | null
  ended_at: number
  opp_id: string
  opp_name: string
  opp_avatar: string | null
  opp_registered: number
}

interface RoundRow {
  series_id: string
  idx: number
  left_char: CharacterId
  right_char: CharacterId
  seed: number
  winner: Seat | null
  fight_time: number
}

export async function historyFor(db: D1Database, userId: string): Promise<HistoryResponse> {
  const [list, totals] = await db.batch<unknown>([
    db
      .prepare(
        `SELECT s.*, u.id AS opp_id, u.name AS opp_name, u.avatar_url AS opp_avatar, u.registered AS opp_registered
         FROM series s JOIN users u ON u.id = CASE WHEN s.p0 = ?1 THEN s.p1 ELSE s.p0 END
         WHERE s.p0 = ?1 OR s.p1 = ?1 ORDER BY s.ended_at DESC LIMIT ?2`,
      )
      .bind(userId, HISTORY_LIMIT),
    db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN (p0 = ?1 AND winner = 0) OR (p1 = ?1 AND winner = 1) THEN 1 ELSE 0 END), 0) AS wins,
                COUNT(*) AS games
         FROM series WHERE p0 = ?1 OR p1 = ?1`,
      )
      .bind(userId),
  ])
  const series = list.results as SeriesRow[]
  const { wins, games } = totals.results[0] as { wins: number; games: number }
  const rounds = new Map<string, RoundRecord[]>()
  if (series.length > 0) {
    const ids = series.map((s) => s.id)
    const { results } = await db
      .prepare(`SELECT * FROM rounds WHERE series_id IN (${ids.map(() => '?').join(',')}) ORDER BY series_id, idx`)
      .bind(...ids)
      .all<RoundRow>()
    for (const r of results) {
      const arr = rounds.get(r.series_id) ?? []
      arr.push({ left: r.left_char, right: r.right_char, seed: r.seed, winner: r.winner, fightTime: r.fight_time })
      rounds.set(r.series_id, arr)
    }
  }
  return {
    wins,
    losses: games - wins,
    series: series.map((s): SeriesEntry => ({
      id: s.id,
      mode: s.mode,
      endedAt: s.ended_at,
      you: s.p0 === userId ? 0 : 1,
      opponent: { id: s.opp_id, name: s.opp_name, avatar: s.opp_avatar, registered: s.opp_registered === 1 } satisfies UserSummary & { registered: boolean },
      score: [s.score0, s.score1],
      winner: s.winner,
      forfeit: s.forfeit,
      rounds: rounds.get(s.id) ?? [],
    })),
  }
}
