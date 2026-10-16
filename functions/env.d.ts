// Secrets aren't in wrangler.toml, so `wrangler types` can't see them
// unless `.dev.vars` exists. Declared here so Functions always type-check.
interface Env {
  BASIC_AUTH_USER?: string;
  BASIC_AUTH_PASSWORD?: string;
}
