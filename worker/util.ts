const encoder = new TextEncoder()

function base64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Unguessable token with `bytes` of entropy, URL/cookie safe. */
export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

/** Uniformly random string over `alphabet` (rejection sampling, no modulo bias). */
export function randomString(alphabet: string, length: number): string {
  const limit = 256 - (256 % alphabet.length)
  let out = ''
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (b < limit) out += alphabet[b % alphabet.length]
      if (out.length === length) break
    }
  }
  return out
}

export async function sha256(text: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))))
}

export const newId = (): string => crypto.randomUUID()

export const now = (): number => Date.now()
