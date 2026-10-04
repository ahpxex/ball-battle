import i18next from 'i18next'
import type { ApiError, CreateRoomResponse, FriendsResponse, HistoryResponse, MeResponse } from './apiTypes'
import type { GameMode, RoomSummary } from './protocol'

/** An API failure: `code` is the server's error code (see `errors.*` in the locales); `message` is for logs. */
export class ApiRequestError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** User-facing, localized text for any error thrown by the API layer. */
export function errorText(e: unknown): string {
  if (!(e instanceof ApiRequestError)) return i18next.t('errors.unknown')
  if (e.code === 'http') return i18next.t('errors.http', { status: e.status })
  const key = `errors.${e.code}`
  return i18next.exists(key) ? i18next.t(key as 'errors.unknown') : i18next.t('errors.unknown')
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiRequestError(0, 'network', 'network error')
  }
  const json = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null
  if (!res.ok) throw new ApiRequestError(res.status, json?.error ?? 'http', `HTTP ${res.status}${json?.error ? ` ${json.error}` : ''}`)
  return json as T
}

export const api = {
  me: () => request<MeResponse>('GET', '/me'),
  guest: (name: string) => request<MeResponse>('POST', '/session/guest', { name }),
  rename: (name: string) => request<MeResponse>('PATCH', '/me', { name }),
  logout: () => request<{ ok: true }>('POST', '/auth/logout'),
  createRoom: (mode: GameMode) => request<CreateRoomResponse>('POST', '/rooms', { mode }),
  room: (code: string) => request<RoomSummary>('GET', `/rooms/${encodeURIComponent(code)}`),
  friends: () => request<FriendsResponse>('GET', '/friends'),
  addFriend: (target: { code: string } | { userId: string }) => request<{ status: 'pending' | 'accepted' }>('POST', '/friends', target),
  acceptFriend: (id: string) => request<{ status: 'accepted' }>('POST', `/friends/${encodeURIComponent(id)}/accept`),
  removeFriend: (id: string) => request<{ status: 'removed' }>('DELETE', `/friends/${encodeURIComponent(id)}`),
  invite: (friendId: string, room: string) => request<{ delivered: boolean }>('POST', `/friends/${encodeURIComponent(friendId)}/invite`, { room }),
  history: () => request<HistoryResponse>('GET', '/history'),
}

/** Full-page navigation into the OAuth flow; comes back to `returnTo`. */
export function loginUrl(provider: string, returnTo: string): string {
  return `/api/auth/${provider}/start?return=${encodeURIComponent(returnTo)}`
}

/** Same-origin WebSocket URL for an API path. */
export function socketUrl(path: string): string {
  const { protocol, host } = window.location
  return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}/api${path}`
}
