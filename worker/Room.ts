import { DurableObject } from 'cloudflare:workers'
import { CHARACTERS } from '../src/game/characters/registry'
import { randomSeed } from '../src/game/core/rng'
import { FIXED_DT } from '../src/game/engine/constants'
import type { CharacterId } from '../src/game/engine/types'
import { playMatch } from '../src/game/referee'
import {
  type BattleInfo,
  DISCONNECT_FORFEIT_MS,
  type GameMode,
  HEARTBEAT,
  MODES,
  PICK_SECONDS,
  type PickView,
  type PlayerView,
  REVEAL_MS,
  ROUND_OVER_MS,
  type RoomPhase,
  type RoomSummary,
  type RoomView,
  type RoundRecord,
  type Seat,
  type ServerMessage,
  parseClientMessage,
} from '../src/net/protocol'
import { newId } from './util'

/** Who a socket belongs to; set by the Worker after authenticating the session cookie. */
export interface Identity {
  userId: string
  name: string
  avatar: string | null
  registered: boolean
}

export const IDENTITY_HEADER = 'X-Identity'

interface Seated extends Identity {
  /** When the player's last socket closed; null while connected. */
  disconnectedAt: number | null
  /** Left the room (explicitly or by timing out) after the series started; the seat is kept for the result screen. */
  left: boolean
}

interface PickState {
  required: boolean
  locked: boolean
  /** Tentative while unlocked; never shown to the opponent before the reveal. */
  char: CharacterId | null
}

interface RoomState {
  code: string
  mode: GameMode
  phase: RoomPhase
  players: [Seated | null, Seated | null]
  score: [number, number]
  round: number
  picks: [PickState, PickState]
  /** Characters each seat fought with last round: a BO3 winner keeps theirs, and re-picks start from them. */
  lastChars: [CharacterId | null, CharacterId | null]
  deadline: number | null
  battle: BattleInfo | null
  /** Referee result of the current battle, published when the battle clock runs out. */
  pending: { winner: Seat | null; fightTime: number } | null
  rounds: RoundRecord[]
  seriesWinner: Seat | null
  forfeit: Seat | null
  rematch: [boolean, boolean]
  seriesStartedAt: number
  /** Since when no socket at all has been connected. */
  emptySince: number | null
}

/** Rooms nobody is connected to are deleted after this long. */
const IDLE_TTL_MS = 30 * 60 * 1000
/** Extra time after the battle's last frame before the result is announced, covering clock-sync error. */
const BATTLE_END_GRACE_MS = 1200
const EMOTE_COOLDOWN_MS = 400

const SEATS: readonly Seat[] = [0, 1]
const other = (s: Seat): Seat => (s === 0 ? 1 : 0)
const unpicked = (): PickState => ({ required: true, locked: false, char: null })

/**
 * One online room. Uses the WebSocket Hibernation API: between messages (e.g.
 * while a battle plays out on the clients) the object is evicted from memory
 * and costs nothing, so all state lives in storage and on socket attachments.
 */
export class Room extends DurableObject<Env> {
  private state: RoomState | null = null
  private readonly lastEmote = new WeakMap<WebSocket, number>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(HEARTBEAT, HEARTBEAT))
    void ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get<RoomState>('state')) ?? null
    })
  }

  // ───────────────────────────── RPC (from the Worker) ─────────────────────────────

  /** Creates the room; false if this code is already taken. */
  async init(code: string, mode: GameMode): Promise<boolean> {
    if (this.state) return false
    this.state = {
      code,
      mode,
      phase: 'waiting',
      players: [null, null],
      score: [0, 0],
      round: 0,
      picks: [unpicked(), unpicked()],
      lastChars: [null, null],
      deadline: null,
      battle: null,
      pending: null,
      rounds: [],
      seriesWinner: null,
      forfeit: null,
      rematch: [false, false],
      seriesStartedAt: 0,
      emptySince: Date.now(),
    }
    await this.commit()
    return true
  }

  async summary(): Promise<RoomSummary | null> {
    const s = this.state
    if (!s) return null
    return { code: s.code, mode: s.mode, phase: s.phase, players: s.players.map((p) => (p && !p.left ? p.name : null)) }
  }

  // ───────────────────────────── sockets ─────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const s = this.state
    if (!s) return new Response('room not found', { status: 404 })
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 })
    const raw = request.headers.get(IDENTITY_HEADER)
    if (!raw) return new Response('unauthorized', { status: 401 })
    const who = JSON.parse(decodeURIComponent(raw)) as Identity

    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment(who)

    s.emptySince = null
    const seat = this.seatOf(who.userId)
    if (seat !== null) {
      // Returning player: refresh their profile (they may have renamed or signed in meanwhile).
      s.players[seat] = { ...who, disconnectedAt: null, left: false }
    } else if (s.phase === 'waiting') {
      // Nothing has started yet, so a seat held by someone who dropped is fair game
      // (e.g. a guest who left to sign in and comes back as a different user).
      for (const i of SEATS) if (s.players[i]?.disconnectedAt != null) s.players[i] = null
      const free = SEATS.find((i) => !s.players[i])
      if (free !== undefined) {
        s.players[free] = { ...who, disconnectedAt: null, left: false }
        if (s.players[0] && s.players[1]) this.startSeries()
      }
    }
    await this.commit()
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const s = this.state
    if (!s || typeof data !== 'string') return
    const msg = parseClientMessage(data)
    if (!msg) {
      this.send(ws, { t: 'error', code: 'bad_request', message: 'invalid message' })
      return
    }
    const who = ws.deserializeAttachment() as Identity
    const seat = this.seatOf(who.userId)

    switch (msg.t) {
      case 'ping':
        this.send(ws, { t: 'pong', c: msg.c, s: Date.now() })
        return
      case 'emote': {
        if (seat === null) return
        const t = Date.now()
        if (t - (this.lastEmote.get(ws) ?? 0) < EMOTE_COOLDOWN_MS) return
        this.lastEmote.set(ws, t)
        for (const sock of this.ctx.getWebSockets()) this.send(sock, { t: 'emote', seat, e: msg.e })
        return
      }
      case 'pick':
      case 'lock': {
        if (seat === null || s.phase !== 'picking') return
        const pick = s.picks[seat]
        if (!pick.required || pick.locked) return
        pick.char = msg.char
        if (msg.t === 'lock') {
          pick.locked = true
          if (s.picks.every((p) => p.locked)) this.reveal()
        }
        break
      }
      case 'rematch':
        if (seat === null || s.phase !== 'seriesOver') return
        s.rematch[seat] = true
        this.resolveRematch()
        break
      case 'leave':
        if (seat === null) return
        await this.leave(seat)
        break
    }
    await this.commit()
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    // Complete the closing handshake; 1005/1006 are reserved and can't be echoed back.
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, 'closed')
    } catch {
      // Already closed.
    }
    await this.onSocketGone(ws)
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.onSocketGone(ws)
  }

  private async onSocketGone(ws: WebSocket): Promise<void> {
    const s = this.state
    if (!s) return
    const who = ws.deserializeAttachment() as Identity | null
    const open = this.ctx.getWebSockets().filter((w) => w !== ws && w.readyState === WebSocket.OPEN)
    if (who && !open.some((w) => (w.deserializeAttachment() as Identity).userId === who.userId)) {
      const seat = this.seatOf(who.userId)
      if (seat !== null && s.players[seat]!.disconnectedAt === null) s.players[seat]!.disconnectedAt = Date.now()
    }
    if (open.length === 0 && s.emptySince === null) s.emptySince = Date.now()
    await this.commit()
  }

  // ───────────────────────────── timers ─────────────────────────────

  async alarm(): Promise<void> {
    const s = this.state
    if (!s) return
    const t = Date.now()

    if (s.emptySince !== null && t >= s.emptySince + IDLE_TTL_MS) {
      this.state = null
      await this.ctx.storage.deleteAll()
      return
    }

    // Whoever dropped first forfeits first.
    const timedOut = SEATS.filter((i) => {
      const p = s.players[i]
      return p && !p.left && p.disconnectedAt !== null && t >= p.disconnectedAt + DISCONNECT_FORFEIT_MS
    }).sort((a, b) => s.players[a]!.disconnectedAt! - s.players[b]!.disconnectedAt!)
    for (const seat of timedOut) await this.leave(seat)

    if (s.deadline !== null && t >= s.deadline) {
      if (s.phase === 'picking') this.autoLock()
      else if (s.phase === 'battle') await this.endBattle()
      else if (s.phase === 'roundOver') this.nextRound()
    }
    await this.commit()
  }

  private async schedule(): Promise<void> {
    const s = this.state
    if (!s) return
    const times: number[] = []
    if (s.deadline !== null) times.push(s.deadline)
    if (s.emptySince !== null) times.push(s.emptySince + IDLE_TTL_MS)
    for (const p of s.players) if (p && !p.left && p.disconnectedAt !== null) times.push(p.disconnectedAt + DISCONNECT_FORFEIT_MS)
    if (times.length === 0) await this.ctx.storage.deleteAlarm()
    else await this.ctx.storage.setAlarm(Math.min(...times))
  }

  // ───────────────────────────── game flow ─────────────────────────────

  private startSeries(): void {
    const s = this.state!
    s.score = [0, 0]
    s.round = 0
    s.rounds = []
    s.lastChars = [null, null]
    s.seriesWinner = null
    s.forfeit = null
    s.rematch = [false, false]
    s.seriesStartedAt = Date.now()
    this.startPicking([true, true])
  }

  private startPicking(required: [boolean, boolean]): void {
    const s = this.state!
    s.phase = 'picking'
    s.round += 1
    s.battle = null
    s.pending = null
    s.picks = [0, 1].map((i) => ({ required: required[i], locked: !required[i], char: s.lastChars[i] })) as [PickState, PickState]
    s.deadline = Date.now() + PICK_SECONDS * 1000
  }

  /** Pick timer ran out: lock whatever each side was hovering (or their last / a random character). */
  private autoLock(): void {
    const s = this.state!
    for (const p of s.picks) {
      if (p.locked) continue
      p.char ??= CHARACTERS[randomSeed() % CHARACTERS.length].id
      p.locked = true
    }
    this.reveal()
  }

  private reveal(): void {
    const s = this.state!
    const left = s.picks[0].char!
    const right = s.picks[1].char!
    const seed = randomSeed()
    const result = playMatch({ left, right, seed })
    const startAt = Date.now() + REVEAL_MS
    s.phase = 'battle'
    s.lastChars = [left, right]
    s.battle = { left, right, seed, startAt, steps: result.steps }
    s.pending = { winner: result.winner, fightTime: result.fightTime }
    s.deadline = startAt + Math.ceil(result.steps * FIXED_DT * 1000) + BATTLE_END_GRACE_MS
  }

  private async endBattle(): Promise<void> {
    const s = this.state!
    const b = s.battle!
    const r = s.pending!
    s.rounds.push({ left: b.left, right: b.right, seed: b.seed, winner: r.winner, fightTime: r.fightTime })
    if (r.winner !== null) s.score[r.winner] += 1
    s.pending = null
    const champion = SEATS.find((i) => s.score[i] >= MODES[s.mode].winsNeeded)
    if (champion !== undefined) await this.finishSeries(champion, null)
    else {
      s.phase = 'roundOver'
      s.deadline = Date.now() + ROUND_OVER_MS
    }
  }

  private nextRound(): void {
    const s = this.state!
    const last = s.rounds[s.rounds.length - 1]
    // A draw sends both back to the blind pick; otherwise only the loser may switch.
    const w = last?.winner ?? null
    this.startPicking(w === null || s.mode === 'single' ? [true, true] : [w !== 0, w !== 1])
  }

  private async finishSeries(winner: Seat, forfeit: Seat | null): Promise<void> {
    const s = this.state!
    s.phase = 'seriesOver'
    s.seriesWinner = winner
    s.forfeit = forfeit
    s.deadline = null
    s.battle = null
    s.pending = null
    s.rematch = [false, false]
    // A series abandoned before any battle finished isn't a result worth recording.
    if (s.rounds.length > 0) await this.record()
  }

  /** A player leaves: forfeits a running series; frees the seat outside of one. */
  private async leave(seat: Seat): Promise<void> {
    const s = this.state!
    const p = s.players[seat]!
    if (s.phase === 'waiting') {
      s.players[seat] = null
      return
    }
    p.left = true
    p.disconnectedAt = null
    if (s.phase !== 'seriesOver') await this.finishSeries(other(seat), seat)
    this.resolveRematch()
  }

  /** Starts the next series once both want it, or reopens the room if the opponent is gone. */
  private resolveRematch(): void {
    const s = this.state!
    if (s.phase !== 'seriesOver') return
    const gone = SEATS.filter((i) => !s.players[i] || s.players[i]!.left)
    if (gone.length === 2) {
      this.resetToWaiting()
    } else if (gone.length === 1) {
      if (s.rematch[other(gone[0])]) this.resetToWaiting()
    } else if (s.rematch[0] && s.rematch[1]) {
      this.startSeries()
    }
  }

  private resetToWaiting(): void {
    const s = this.state!
    s.players = s.players.map((p) => (p && !p.left ? p : null)) as RoomState['players']
    s.phase = 'waiting'
    s.score = [0, 0]
    s.round = 0
    s.rounds = []
    s.picks = [unpicked(), unpicked()]
    s.battle = null
    s.pending = null
    s.deadline = null
    s.seriesWinner = null
    s.forfeit = null
    s.rematch = [false, false]
  }

  private async record(): Promise<void> {
    const s = this.state!
    const [p0, p1] = s.players
    if (!p0 || !p1 || s.seriesWinner === null) return
    const id = newId()
    const db = this.env.DB
    try {
      await db.batch([
        db
          .prepare(
            'INSERT INTO series (id, room_code, mode, p0, p1, score0, score1, winner, forfeit, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(id, s.code, s.mode, p0.userId, p1.userId, s.score[0], s.score[1], s.seriesWinner, s.forfeit, s.seriesStartedAt, Date.now()),
        ...s.rounds.map((r, i) =>
          db
            .prepare('INSERT INTO rounds (series_id, idx, left_char, right_char, seed, winner, fight_time) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .bind(id, i, r.left, r.right, r.seed, r.winner, r.fightTime),
        ),
      ])
    } catch (e) {
      // History is best-effort; the room itself must keep working.
      console.error('failed to record series', s.code, e)
    }
  }

  // ───────────────────────────── views ─────────────────────────────

  private seatOf(userId: string): Seat | null {
    const s = this.state!
    return SEATS.find((i) => s.players[i]?.userId === userId) ?? null
  }

  private viewFor(viewerId: string, connected: Set<string>): RoomView {
    const s = this.state!
    const you = this.seatOf(viewerId)
    const player = (p: Seated | null): PlayerView | null =>
      p && { userId: p.userId, name: p.name, avatar: p.avatar, registered: p.registered, connected: !p.left && connected.has(p.userId) }
    const pick = (seat: Seat): PickView => {
      const p = s.picks[seat]
      const visible = seat === you || !p.required || s.phase !== 'picking'
      return { required: p.required, locked: p.locked, char: visible ? p.char : null }
    }
    return {
      code: s.code,
      mode: s.mode,
      phase: s.phase,
      you,
      players: [player(s.players[0]), player(s.players[1])],
      score: [s.score[0], s.score[1]],
      round: s.round,
      picks: [pick(0), pick(1)],
      deadline: s.deadline,
      battle: s.phase === 'battle' ? s.battle : null,
      rounds: s.rounds,
      seriesWinner: s.seriesWinner,
      forfeit: s.forfeit,
      rematch: [s.rematch[0], s.rematch[1]],
    }
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg))
    } catch {
      // Socket is closing; its close handler cleans up.
    }
  }

  /** Persists state, pushes each viewer their own view and re-arms the alarm. */
  private async commit(): Promise<void> {
    const s = this.state
    if (!s) return
    await this.ctx.storage.put('state', s)
    const sockets = this.ctx.getWebSockets().filter((w) => w.readyState === WebSocket.OPEN)
    const connected = new Set(sockets.map((w) => (w.deserializeAttachment() as Identity).userId))
    for (const ws of sockets) {
      const who = ws.deserializeAttachment() as Identity
      this.send(ws, { t: 'state', room: this.viewFor(who.userId, connected) })
    }
    await this.schedule()
  }
}
