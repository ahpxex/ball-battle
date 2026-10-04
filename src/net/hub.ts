import { useSyncExternalStore } from 'react'
import { socketUrl } from './api'
import { HEARTBEAT, type HubMessage, type UserSummary, type GameMode } from './protocol'

export interface Invite {
  id: number
  from: UserSummary
  room: string
  mode: GameMode
}

export interface HubState {
  online: boolean
  invites: readonly Invite[]
  /** Bumped whenever the server says the friend list changed. */
  friendsVersion: number
}

const HEARTBEAT_MS = 25_000
const RETRY_MS = [1000, 3000, 10_000, 30_000]
/** Invites older than this are dropped (the room has likely moved on). */
const INVITE_TTL_MS = 5 * 60 * 1000

/** Signed-in users keep one socket open for presence and incoming friend invites. */
class HubClient {
  private ws: WebSocket | null = null
  private wanted = false
  private attempt = 0
  private heartbeat = 0
  private retryTimer = 0
  private inviteId = 0
  private state: HubState = { online: false, invites: [], friendsVersion: 0 }
  private readonly listeners = new Set<() => void>()

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): HubState => this.state

  private set(patch: Partial<HubState>): void {
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l()
  }

  /** Connects while a registered user is signed in. */
  setActive(active: boolean): void {
    if (active === this.wanted) return
    this.wanted = active
    if (active) this.connect()
    else {
      clearTimeout(this.retryTimer)
      clearInterval(this.heartbeat)
      this.ws?.close(1000, 'signed out')
      this.ws = null
      this.set({ online: false, invites: [] })
    }
  }

  dismiss(id: number): void {
    this.set({ invites: this.state.invites.filter((i) => i.id !== id) })
  }

  private connect(): void {
    if (!this.wanted) return
    const ws = new WebSocket(socketUrl('/hub'))
    this.ws = ws
    ws.onopen = () => {
      this.attempt = 0
      this.set({ online: true })
      this.heartbeat = window.setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(HEARTBEAT), HEARTBEAT_MS)
    }
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string' || ev.data === HEARTBEAT) return
      this.handle(JSON.parse(ev.data) as HubMessage)
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      clearInterval(this.heartbeat)
      this.ws = null
      this.set({ online: false })
      if (!this.wanted) return
      const delay = RETRY_MS[Math.min(this.attempt++, RETRY_MS.length - 1)]
      this.retryTimer = window.setTimeout(() => this.connect(), delay)
    }
  }

  private handle(msg: HubMessage): void {
    if (msg.t === 'friends') {
      this.set({ friendsVersion: this.state.friendsVersion + 1 })
      return
    }
    // One invite per friend: a newer one replaces theirs.
    const invite: Invite = { id: ++this.inviteId, from: msg.from, room: msg.room, mode: msg.mode }
    this.set({ invites: [...this.state.invites.filter((i) => i.from.id !== msg.from.id), invite] })
    window.setTimeout(() => this.dismiss(invite.id), INVITE_TTL_MS)
  }
}

export const hub = new HubClient()

export function useHub(): HubState {
  return useSyncExternalStore(hub.subscribe, hub.getSnapshot)
}
