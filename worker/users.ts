import type { AuthProvider, Me } from '../src/net/apiTypes'
import { ROOM_CODE_ALPHABET, type UserSummary } from '../src/net/protocol'
import { newId, now, randomString, randomToken, sha256 } from './util'

export interface UserRow {
  id: string
  name: string
  avatar_url: string | null
  registered: number
  friend_code: string | null
  created_at: number
}

export const SESSION_TTL_MS = 180 * 24 * 3600 * 1000
/** Sessions are extended on use once less than this much time is left. */
const SESSION_RENEW_MS = 30 * 24 * 3600 * 1000
const FRIEND_CODE_LENGTH = 8

export const summary = (u: UserRow): UserSummary => ({ id: u.id, name: u.name, avatar: u.avatar_url })

export async function toMe(db: D1Database, u: UserRow): Promise<Me> {
  const { results } = await db.prepare('SELECT provider FROM identities WHERE user_id = ? ORDER BY created_at').bind(u.id).all<{ provider: AuthProvider }>()
  return { ...summary(u), registered: u.registered === 1, friendCode: u.friend_code, linked: results.map((r) => r.provider) }
}

export function getUser(db: D1Database, id: string): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>()
}

// ───────────────────────────── sessions ─────────────────────────────

export interface SessionLookup {
  user: UserRow
  /** Set when the session was extended and the cookie should be re-issued. */
  renewedUntil: number | null
}

export async function userForSession(db: D1Database, token: string): Promise<SessionLookup | null> {
  const hash = await sha256(token)
  const row = await db
    .prepare('SELECT u.*, s.expires_at AS session_expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?')
    .bind(hash)
    .first<UserRow & { session_expires: number }>()
  if (!row) return null
  const t = now()
  if (row.session_expires <= t) {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hash).run()
    return null
  }
  const { session_expires, ...user } = row
  if (session_expires - t > SESSION_RENEW_MS) return { user, renewedUntil: null }
  const until = t + SESSION_TTL_MS
  await db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(until, hash).run()
  return { user, renewedUntil: until }
}

export async function createSession(db: D1Database, userId: string): Promise<{ token: string; expiresAt: number }> {
  const token = randomToken()
  const t = now()
  const expiresAt = t + SESSION_TTL_MS
  await db
    .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), userId, t, expiresAt)
    .run()
  return { token, expiresAt }
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  await db
    .prepare('DELETE FROM sessions WHERE token_hash = ?')
    .bind(await sha256(token))
    .run()
}

// ───────────────────────────── users ─────────────────────────────

export async function createGuest(db: D1Database, name: string): Promise<UserRow> {
  const user: UserRow = { id: newId(), name, avatar_url: null, registered: 0, friend_code: null, created_at: now() }
  await db
    .prepare('INSERT INTO users (id, name, avatar_url, registered, friend_code, created_at) VALUES (?, ?, ?, 0, NULL, ?)')
    .bind(user.id, user.name, null, user.created_at)
    .run()
  return user
}

export async function renameUser(db: D1Database, id: string, name: string): Promise<void> {
  await db.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, id).run()
}

export async function findUserByIdentity(db: D1Database, provider: AuthProvider, providerUserId: string): Promise<UserRow | null> {
  return db
    .prepare('SELECT u.* FROM identities i JOIN users u ON u.id = i.user_id WHERE i.provider = ? AND i.provider_user_id = ?')
    .bind(provider, providerUserId)
    .first<UserRow>()
}

/** Friend codes are unique; retry on the (astronomically unlikely) collision. */
async function withFriendCode<T>(run: (code: string) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run(randomString(ROOM_CODE_ALPHABET, FRIEND_CODE_LENGTH))
    } catch (e) {
      if (attempt >= 3 || !String(e).includes('UNIQUE')) throw e
    }
  }
}

export interface ProviderProfile {
  provider: AuthProvider
  providerUserId: string
  name: string
  avatar: string | null
}

/** Attaches an OAuth identity to an existing user, upgrading a guest to registered. */
export async function linkIdentity(db: D1Database, user: UserRow, p: ProviderProfile): Promise<void> {
  const t = now()
  const insertIdentity = db
    .prepare('INSERT INTO identities (provider, provider_user_id, user_id, created_at) VALUES (?, ?, ?, ?)')
    .bind(p.provider, p.providerUserId, user.id, t)
  if (user.registered) {
    await db.batch([insertIdentity, db.prepare('UPDATE users SET avatar_url = COALESCE(avatar_url, ?) WHERE id = ?').bind(p.avatar, user.id)])
    return
  }
  await withFriendCode((code) =>
    db.batch([
      insertIdentity,
      db.prepare('UPDATE users SET registered = 1, friend_code = ?, avatar_url = COALESCE(avatar_url, ?) WHERE id = ?').bind(code, p.avatar, user.id),
    ]),
  )
}

export async function createRegisteredUser(db: D1Database, p: ProviderProfile): Promise<UserRow> {
  const id = newId()
  const t = now()
  await withFriendCode((code) =>
    db.batch([
      db.prepare('INSERT INTO users (id, name, avatar_url, registered, friend_code, created_at) VALUES (?, ?, ?, 1, ?, ?)').bind(id, p.name, p.avatar, code, t),
      db.prepare('INSERT INTO identities (provider, provider_user_id, user_id, created_at) VALUES (?, ?, ?, ?)').bind(p.provider, p.providerUserId, id, t),
    ]),
  )
  return (await getUser(db, id))!
}

/**
 * A guest signed in to an account that already exists: their match history
 * moves to that account and the guest user is removed.
 */
export async function mergeGuestInto(db: D1Database, guestId: string, userId: string): Promise<void> {
  await db.batch([
    // Games the guest played against this very account would become self-play; drop them.
    db.prepare('DELETE FROM series WHERE (p0 = ?1 AND p1 = ?2) OR (p0 = ?2 AND p1 = ?1)').bind(guestId, userId),
    db.prepare('UPDATE series SET p0 = ? WHERE p0 = ?').bind(userId, guestId),
    db.prepare('UPDATE series SET p1 = ? WHERE p1 = ?').bind(userId, guestId),
    db.prepare('DELETE FROM users WHERE id = ? AND registered = 0').bind(guestId),
  ])
}
