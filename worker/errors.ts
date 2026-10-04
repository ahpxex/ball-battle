import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { ApiError, ApiErrorCode } from '../src/net/apiTypes'

const STATUS: Record<ApiErrorCode, ContentfulStatusCode> = {
  unauthorized: 401,
  bad_name: 400,
  rate_limited: 429,
  bad_mode: 400,
  room_not_found: 404,
  bad_room_code: 400,
  websocket_required: 426,
  forbidden_origin: 403,
  not_found: 404,
  not_configured: 404,
  guest: 403,
  friend_not_found: 404,
  friend_self: 400,
  request_gone: 404,
  not_friend: 403,
  room_busy: 409,
  internal: 500,
}

/** An error response; the client shows the message for `code` in the player's language. */
export const apiError = (c: Context, code: ApiErrorCode) => c.json({ error: code } satisfies ApiError, STATUS[code])
