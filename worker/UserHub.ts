import { DurableObject } from 'cloudflare:workers'
import { HEARTBEAT, type HubMessage } from '../src/net/protocol'

/**
 * One per signed-in user: the sockets of every tab they have open. Presence is
 * simply "has an open socket", and friend invites are pushed through it.
 * Hibernates between pushes, so idle connections cost nothing.
 */
export class UserHub extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(HEARTBEAT, HEARTBEAT))
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 })
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  async online(): Promise<boolean> {
    return this.openSockets().length > 0
  }

  /** Pushes a message to every open tab; returns how many received it. */
  async notify(msg: HubMessage): Promise<number> {
    const data = JSON.stringify(msg)
    let n = 0
    for (const ws of this.openSockets()) {
      try {
        ws.send(data)
        n++
      } catch {
        // Closing socket.
      }
    }
    return n
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, 'closed')
    } catch {
      // Already closed.
    }
  }

  private openSockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((w) => w.readyState === WebSocket.OPEN)
  }
}
