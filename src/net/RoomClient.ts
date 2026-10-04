import { api, ApiRequestError, errorText, socketUrl } from './api'
import { session } from './session'
import { type ClientMessage, type Emote, HEARTBEAT, type RoomView, type Seat, type ServerMessage } from './protocol'

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

export interface EmoteEvent {
  id: number
  seat: Seat
  emote: Emote
}

export interface RoomClientState {
  status: ConnectionStatus
  room: RoomView | null
  /** Set when the room can't be joined at all (e.g. it no longer exists). */
  fatal: string | null
  emotes: readonly EmoteEvent[]
}

const HEARTBEAT_MS = 25_000
const RESYNC_MS = 30_000
const SYNC_SAMPLES = 5
const SYNC_SPACING_MS = 120
const EMOTE_TTL_MS = 2600
const BACKOFF_MS = [500, 1000, 2000, 4000, 8000]

/**
 * WebSocket connection to one room: reconnects with backoff, and keeps a
 * server-clock estimate so battles start at the same moment for everyone.
 */
export class RoomClient {
  readonly code: string
  private ws: WebSocket | null = null
  private stopped = false
  private attempt = 0
  private timers: number[] = []
  private retryTimer = 0
  /** serverNow = performance.now() + clockBase; refined by the lowest-RTT ping seen. */
  private clockBase = Date.now() - performance.now()
  private bestRtt = Infinity
  private emoteId = 0
  /** Choices made while disconnected, re-sent on reconnect (the server ignores any that no longer apply). */
  private readonly outbox = new Map<'pick' | 'lock' | 'rematch', ClientMessage>()
  private state: RoomClientState = { status: 'connecting', room: null, fatal: null, emotes: [] }
  private readonly listeners = new Set<() => void>()

  constructor(code: string) {
    this.code = code
  }

  // ───────────────────────────── store ─────────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): RoomClientState => this.state

  private set(patch: Partial<RoomClientState>): void {
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l()
  }

  /** Current server epoch ms. */
  serverNow = (): number => performance.now() + this.clockBase

  // ───────────────────────────── lifecycle ─────────────────────────────

  start(): void {
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    this.clearTimers()
    clearTimeout(this.retryTimer)
    this.ws?.close(1000, 'bye')
    this.ws = null
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
    else if (msg.t === 'pick' || msg.t === 'lock' || msg.t === 'rematch') this.outbox.set(msg.t, msg)
  }

  private connect(): void {
    if (this.stopped) return
    this.set({ status: this.attempt === 0 ? 'connecting' : 'reconnecting' })
    const ws = new WebSocket(socketUrl(`/rooms/${this.code}/ws`))
    this.ws = ws
    ws.onopen = () => {
      this.attempt = 0
      this.bestRtt = Infinity
      this.set({ status: 'open' })
      for (const t of ['pick', 'lock', 'rematch'] as const) {
        const m = this.outbox.get(t)
        if (m) ws.send(JSON.stringify(m))
      }
      this.outbox.clear()
      this.syncClock()
      this.timers.push(window.setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(HEARTBEAT), HEARTBEAT_MS))
      this.timers.push(window.setInterval(() => this.ping(), RESYNC_MS))
    }
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string' && ev.data !== HEARTBEAT) this.handle(JSON.parse(ev.data) as ServerMessage)
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = null
      this.clearTimers()
      if (!this.stopped) void this.retry()
    }
  }

  private async retry(): Promise<void> {
    // After a failed attempt, find out whether the room is gone or our session expired before trying again.
    if (this.attempt > 0) {
      try {
        await api.room(this.code)
        if (!(await api.me()).user) {
          // Signed out elsewhere: the join gate asks for a name again and remounts the room.
          void session.refresh()
          return
        }
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 404) {
          this.set({ status: 'closed', fatal: errorText(e) })
          return
        }
      }
    }
    if (this.stopped) return
    this.set({ status: 'reconnecting' })
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)]
    this.attempt++
    this.retryTimer = window.setTimeout(() => this.connect(), delay)
  }

  private clearTimers(): void {
    for (const t of this.timers) {
      clearInterval(t)
      clearTimeout(t)
    }
    this.timers = []
  }

  // ───────────────────────────── messages ─────────────────────────────

  private handle(msg: ServerMessage): void {
    switch (msg.t) {
      case 'state':
        this.set({ room: msg.room })
        break
      case 'pong': {
        const now = performance.now()
        const rtt = now - msg.c
        if (rtt < 0 || rtt > this.bestRtt * 1.5 + 5) return
        this.bestRtt = Math.min(this.bestRtt, rtt)
        // The server stamped its clock roughly halfway through the round trip.
        this.clockBase = msg.s + rtt / 2 - now
        break
      }
      case 'emote': {
        const ev: EmoteEvent = { id: ++this.emoteId, seat: msg.seat, emote: msg.e }
        this.set({ emotes: [...this.state.emotes.slice(-11), ev] })
        window.setTimeout(() => this.set({ emotes: this.state.emotes.filter((x) => x.id !== ev.id) }), EMOTE_TTL_MS)
        break
      }
      case 'error':
        console.warn('room error', msg.code, msg.message)
        break
    }
  }

  private ping(): void {
    this.send({ t: 'ping', c: performance.now() })
  }

  private syncClock(): void {
    for (let i = 0; i < SYNC_SAMPLES; i++) this.timers.push(window.setTimeout(() => this.ping(), i * SYNC_SPACING_MS))
  }
}
