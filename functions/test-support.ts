// Fakes for exercising Pages Functions at the request → response seam.

interface StoredObject {
  bytes: Uint8Array;
  contentType?: string;
  etag: string;
}

// An in-memory stand-in for the parts of an R2 bucket the Functions use.
export class FakeBucket {
  private objects = new Map<string, StoredObject>();
  private nextEtag = 1;

  put(key: string, body: string, contentType?: string): void {
    const bytes = new TextEncoder().encode(body);
    this.objects.set(key, { bytes, contentType, etag: `etag-${this.nextEtag++}` });
  }

  async head(key: string): Promise<R2Object | null> {
    const stored = this.objects.get(key);
    return stored ? this.toObject(key, stored, stored.bytes) : null;
  }

  async get(key: string, options?: R2GetOptions): Promise<R2ObjectBody | null> {
    const stored = this.objects.get(key);
    if (!stored) return null;
    const range = options?.range as { offset: number; length: number } | undefined;
    const bytes = range
      ? stored.bytes.slice(range.offset, range.offset + range.length)
      : stored.bytes;
    return this.toObject(key, stored, bytes);
  }

  private toObject(key: string, stored: StoredObject, bytes: Uint8Array): R2ObjectBody {
    return {
      key,
      size: stored.bytes.length,
      etag: stored.etag,
      httpEtag: `"${stored.etag}"`,
      httpMetadata: { contentType: stored.contentType },
      writeHttpMetadata(headers: Headers) {
        if (stored.contentType) headers.set("Content-Type", stored.contentType);
      },
      get body() {
        return new Response(bytes).body!;
      },
    } as unknown as R2ObjectBody;
  }

  asR2(): R2Bucket {
    return this as unknown as R2Bucket;
  }
}

// Builds the context a Pages Function receives. Its `next` stands in for
// whatever sits behind the Function (later Functions or static assets) and
// answers "next".
export function context(
  request: Request,
  env: Partial<Env>,
): EventContext<Env, string, Record<string, unknown>> {
  const next = async () => new Response("next");
  return { request, env, next, params: {}, data: {} } as unknown as EventContext<
    Env,
    string,
    Record<string, unknown>
  >;
}
