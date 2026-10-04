/** Optional OAuth secrets (see .dev.vars.example); a provider is offered only when both values are set. */
interface OAuthSecrets {
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
}

interface Env extends OAuthSecrets {}

declare namespace Cloudflare {
  interface Env extends OAuthSecrets {}
}
