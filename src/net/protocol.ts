/**
 * Wire protocol shared by the browser client and the Cloudflare Worker.
 *
 * Battles are not streamed: a round is fully described by its two characters
 * and a seed, so the server only coordinates picks and a start time, and every
 * viewer simulates the same battle locally (see game/core/dmath for why that is
 * bit-identical everywhere). The server re-runs the battle headless as referee.
 */
import { isCharacterId } from '../game/characters/registry'
import type { CharacterId } from '../game/engine/types'

export type GameMode = 'single' | 'bo3'
export type Seat = 0 | 1

/** Mode rules; their names and descriptions are localized under `modes.<mode>`. */
export const MODES: Record<GameMode, { winsNeeded: number }> = {
  single: { winsNeeded: 1 },
  bo3: { winsNeeded: 2 },
}

export const isGameMode = (v: unknown): v is GameMode => v === 'single' || v === 'bo3'

/** Room codes avoid look-alike characters (0/O, 1/I/L) so they can be read aloud. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const ROOM_CODE_LENGTH = 6
const ROOM_CODE_RE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`)
export const isRoomCode = (v: string): boolean => ROOM_CODE_RE.test(v)
export const normalizeRoomCode = (v: string): string => v.trim().toUpperCase()

/** Seconds each side gets to lock in a pick before the server picks for them. */
export const PICK_SECONDS = 45
/** Reveal animation between both picks locking and the battle clock starting (ms). */
export const REVEAL_MS = 3500
/** How long a round result stays up before the next pick phase in a series (ms). */
export const ROUND_OVER_MS = 6000
/** A seated player who stays disconnected this long mid-series forfeits (ms). */
export const DISCONNECT_FORFEIT_MS = 60_000

export const EMOTES = ['👍', '😂', '😱', '😭', '🔥', '🤔', '👏', '💀'] as const
export type Emote = (typeof EMOTES)[number]
const isEmote = (v: unknown): v is Emote => typeof v === 'string' && (EMOTES as readonly string[]).includes(v)

export const NAME_MAX_LENGTH = 16

/** Trims and validates a display name; returns null when unusable. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  // Collapse whitespace and drop control / zero-width / bidi-override characters.
  const name = raw
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
  if (!name || [...name].length > NAME_MAX_LENGTH) return null
  return name
}

// ───────────────────────────── room state ─────────────────────────────

export type RoomPhase = 'waiting' | 'picking' | 'battle' | 'roundOver' | 'seriesOver'

export interface PlayerView {
  userId: string
  name: string
  avatar: string | null
  /** Signed in with GitHub/Google (can be added as a friend). */
  registered: boolean
  connected: boolean
}

export interface PickView {
  /** Whether this seat chooses in the current pick phase (a BO3 round winner keeps its character). */
  required: boolean
  locked: boolean
  /** Hidden from everyone but the picker until both sides are revealed. */
  char: CharacterId | null
}

export interface BattleInfo {
  left: CharacterId
  right: CharacterId
  seed: number
  /** Server epoch ms at which the World starts stepping. */
  startAt: number
  /** Fixed steps the battle takes until the 'finished' phase. */
  steps: number
}

export interface RoundRecord {
  left: CharacterId
  right: CharacterId
  seed: number
  winner: Seat | null
  fightTime: number
}

export interface RoomView {
  code: string
  mode: GameMode
  phase: RoomPhase
  /** The viewer's seat, or null for spectators. */
  you: Seat | null
  players: [PlayerView | null, PlayerView | null]
  score: [number, number]
  /** 1-based number of the current (or last) round. */
  round: number
  picks: [PickView, PickView]
  /** Server epoch ms when the current phase times out (picking, roundOver). */
  deadline: number | null
  battle: BattleInfo | null
  rounds: RoundRecord[]
  seriesWinner: Seat | null
  /** Set when the series ended because this seat left or stayed disconnected. */
  forfeit: Seat | null
  rematch: [boolean, boolean]
}

/** Public room info (`GET /api/rooms/:code`), shown before connecting. */
export interface RoomSummary {
  code: string
  mode: GameMode
  phase: RoomPhase
  /** Names of seated players. */
  players: (string | null)[]
}

// ───────────────────────────── messages ─────────────────────────────

export type ClientMessage =
  /** Clock sync probe; `c` is the client's performance-time stamp. */
  | { t: 'ping'; c: number }
  /** Tentative selection (kept secret); auto-locked if the timer runs out. */
  | { t: 'pick'; char: CharacterId }
  | { t: 'lock'; char: CharacterId }
  | { t: 'rematch' }
  | { t: 'leave' }
  | { t: 'emote'; e: Emote }

export type ErrorCode = 'not_found' | 'unauthorized' | 'bad_request' | 'rate_limited'

export type ServerMessage =
  { t: 'state'; room: RoomView } | { t: 'pong'; c: number; s: number } | { t: 'emote'; seat: Seat; e: Emote } | { t: 'error'; code: ErrorCode; message: string }

/** Heartbeat answered by the Durable Object runtime without waking the room. */
export const HEARTBEAT = '{"t":"hb"}'

/** Parses and validates an untrusted client message. */
export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > 512) return null
  let m: unknown
  try {
    m = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof m !== 'object' || m === null) return null
  const o = m as Record<string, unknown>
  switch (o.t) {
    case 'ping':
      return typeof o.c === 'number' && Number.isFinite(o.c) ? { t: 'ping', c: o.c } : null
    case 'pick':
    case 'lock':
      return typeof o.char === 'string' && isCharacterId(o.char) ? { t: o.t, char: o.char } : null
    case 'rematch':
    case 'leave':
      return { t: o.t }
    case 'emote':
      return isEmote(o.e) ? { t: 'emote', e: o.e } : null
    default:
      return null
  }
}

// ───────────────────────────── user hub (presence + invites) ─────────────────────────────

export interface UserSummary {
  id: string
  name: string
  avatar: string | null
}

export type HubMessage =
  | { t: 'invite'; from: UserSummary; room: string; mode: GameMode; at: number }
  /** Friend list / requests changed; refetch. */
  | { t: 'friends' }
