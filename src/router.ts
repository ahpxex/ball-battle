import { useSyncExternalStore } from 'react'

/** Minimal History-API router: the app has only a handful of top-level pages. */
export type Route = { page: 'local' } | { page: 'online' } | { page: 'room'; code: string } | { page: 'me' }

export function parseRoute(pathname: string): Route {
  const room = /^\/r\/([^/]+)\/?$/.exec(pathname)
  // Room codes are plain ASCII; anything that needs decoding is invalid and rejected by the room screen.
  if (room) return { page: 'room', code: room[1].toUpperCase() }
  if (pathname === '/online' || pathname === '/online/') return { page: 'online' }
  if (pathname === '/me' || pathname === '/me/') return { page: 'me' }
  return { page: 'local' }
}

export function routePath(r: Route): string {
  switch (r.page) {
    case 'local':
      return '/'
    case 'online':
      return '/online'
    case 'room':
      return `/r/${r.code}`
    case 'me':
      return '/me'
  }
}

const listeners = new Set<() => void>()
const notify = () => {
  for (const l of listeners) l()
}
window.addEventListener('popstate', notify)

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Current location (path + query), re-rendering on navigation. */
export function useLocation(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname + window.location.search)
}

export function navigate(to: string | Route, opts: { replace?: boolean } = {}): void {
  const path = typeof to === 'string' ? to : routePath(to)
  if (path === window.location.pathname + window.location.search) return
  if (opts.replace) history.replaceState(null, '', path)
  else history.pushState(null, '', path)
  window.scrollTo(0, 0)
  notify()
}

/** Removes a query parameter without adding a history entry (e.g. one-shot `?auth_error=`). */
export function dropQueryParam(name: string): void {
  const url = new URL(window.location.href)
  if (!url.searchParams.has(name)) return
  url.searchParams.delete(name)
  history.replaceState(null, '', url.pathname + url.search)
  notify()
}
