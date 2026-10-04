/** JSON shapes of the Worker's HTTP API (`/api/*`), shared by client and server. */
import type { GameMode, RoundRecord, Seat, UserSummary } from './protocol'

export type AuthProvider = 'github' | 'google'
export const AUTH_PROVIDERS: Record<AuthProvider, { name: string }> = {
  github: { name: 'GitHub' },
  google: { name: 'Google' },
}
export const isAuthProvider = (v: unknown): v is AuthProvider => v === 'github' || v === 'google'

export interface Me extends UserSummary {
  /** Linked to a GitHub/Google account (otherwise a guest tied to this browser). */
  registered: boolean
  /** Code others enter to send a friend request; registered users only. */
  friendCode: string | null
  linked: AuthProvider[]
}

export interface MeResponse {
  user: Me | null
  /** Sign-in providers configured on this deployment. */
  providers: AuthProvider[]
}

export interface FriendEntry extends UserSummary {
  online: boolean
}

export interface FriendsResponse {
  friends: FriendEntry[]
  incoming: UserSummary[]
  outgoing: UserSummary[]
}

export interface SeriesEntry {
  id: string
  mode: GameMode
  endedAt: number
  /** The viewer's seat in that series. */
  you: Seat
  opponent: UserSummary & { registered: boolean }
  score: [number, number]
  winner: Seat
  forfeit: Seat | null
  rounds: RoundRecord[]
}

export interface HistoryResponse {
  wins: number
  losses: number
  series: SeriesEntry[]
}

export interface CreateRoomResponse {
  code: string
}

/** Error codes the API returns as `{ error }`; each has a localized message under `errors.<code>`. */
export type ApiErrorCode =
  | 'unauthorized'
  | 'bad_name'
  | 'rate_limited'
  | 'bad_mode'
  | 'room_not_found'
  | 'bad_room_code'
  | 'websocket_required'
  | 'forbidden_origin'
  | 'not_found'
  | 'not_configured'
  | 'guest'
  | 'friend_not_found'
  | 'friend_self'
  | 'request_gone'
  | 'not_friend'
  | 'room_busy'
  | 'internal'

export interface ApiError {
  error: ApiErrorCode
}
