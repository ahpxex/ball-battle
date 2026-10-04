import { useSyncExternalStore } from 'react'
import { api, errorText } from './api'
import type { AuthProvider, Me, MeResponse } from './apiTypes'

export type SessionState = { status: 'loading' } | { status: 'ready'; me: Me | null; providers: AuthProvider[] } | { status: 'error'; message: string }

/** The signed-in user (guest or registered), shared app-wide. Loaded lazily on first use. */
class SessionStore {
  private state: SessionState = { status: 'loading' }
  private readonly listeners = new Set<() => void>()
  private loading: Promise<void> | null = null

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    this.ensureLoaded()
    return () => this.listeners.delete(listener)
  }

  get = (): SessionState => this.state

  get me(): Me | null {
    return this.state.status === 'ready' ? this.state.me : null
  }

  ensureLoaded(): void {
    if (this.state.status === 'loading' && !this.loading) void this.refresh()
  }

  refresh(): Promise<void> {
    this.loading = api
      .me()
      .then((r) => this.apply(r))
      .catch((e: unknown) => this.set({ status: 'error', message: errorText(e) }))
      .finally(() => {
        this.loading = null
      })
    return this.loading
  }

  /** Creates a guest (or renames the current user) — enough to play online. */
  async playAsGuest(name: string): Promise<void> {
    this.apply(await api.guest(name))
  }

  async rename(name: string): Promise<void> {
    this.apply(await api.rename(name))
  }

  async logout(): Promise<void> {
    await api.logout()
    const providers = this.state.status === 'ready' ? this.state.providers : []
    this.set({ status: 'ready', me: null, providers })
  }

  private apply(r: MeResponse): void {
    this.set({ status: 'ready', me: r.user, providers: r.providers })
  }

  private set(s: SessionState): void {
    this.state = s
    for (const l of this.listeners) l()
  }
}

export const session = new SessionStore()

export function useSession(): SessionState {
  return useSyncExternalStore(session.subscribe, session.get)
}
