// Placeholder Function so the Functions directory and R2 bindings can be
// exercised end to end. Reports only whether each binding is wired up.
export const onRequestGet: PagesFunction<Env> = ({ env }) =>
  Response.json({
    originals: env.ORIGINALS !== undefined,
    web: env.WEB !== undefined,
  });
