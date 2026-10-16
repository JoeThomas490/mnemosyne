// Access-policy middleware (ADR 0002). Sits in front of every request (the
// page, its assets and /media/*) and decides whether it may proceed, based
// on the configured ACCESS_POLICY.
export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  switch (env.ACCESS_POLICY) {
    case "open":
      return next();
    case "password":
      return (await hasValidCredentials(request, env)) ? next() : challenge();
    default:
      // Fail closed: an unrecognised policy must never expose the footage.
      return new Response("Access policy misconfigured", { status: 500 });
  }
};

async function hasValidCredentials(request: Request, env: Env): Promise<boolean> {
  const expectedUser = env.BASIC_AUTH_USER;
  const expectedPassword = env.BASIC_AUTH_PASSWORD;
  // Unset secrets lock everyone out rather than letting empty credentials in.
  if (!expectedUser || !expectedPassword) return false;

  const supplied = parseBasicAuth(request.headers.get("Authorization"));
  if (!supplied) return false;

  // Evaluate both so the response time doesn't reveal which one was wrong.
  const [userMatches, passwordMatches] = await Promise.all([
    constantTimeEqual(supplied.user, expectedUser),
    constantTimeEqual(supplied.password, expectedPassword),
  ]);
  return userMatches && passwordMatches;
}

function parseBasicAuth(header: string | null): { user: string; password: string } | null {
  const match = header?.match(/^Basic\s+(\S+)$/i);
  if (!match) return null;
  let decoded: string;
  try {
    // atob yields one char per byte; credentials are UTF-8 (see challenge()).
    const bytes = Uint8Array.from(atob(match[1]), (char) => char.charCodeAt(0));
    decoded = new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
  // The password may itself contain colons; only the first one separates.
  const colon = decoded.indexOf(":");
  if (colon === -1) return null;
  return { user: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

// Compares fixed-length digests so the comparison time doesn't depend on
// how much of the secret an attacker has guessed.
async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const bytesA = new Uint8Array(digestA);
  const bytesB = new Uint8Array(digestB);
  let difference = 0;
  for (let i = 0; i < bytesA.length; i++) difference |= bytesA[i] ^ bytesB[i];
  return difference === 0;
}

function challenge(): Response {
  return new Response("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Mnemosyne", charset="UTF-8"' },
  });
}
