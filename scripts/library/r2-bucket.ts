// An R2 bucket reached through R2's S3-compatible API, using an R2 API token
// from the environment (see .env.example).
import {
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { createReadStream, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Bucket } from "./adapters.ts";

export function r2ClientFromEnv(): S3Client {
  const env = process.env;
  const missing = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"].filter(
    (name) => !env[name],
  );
  if (missing.length > 0) {
    throw new Error(`missing ${missing.join(", ")}: copy .env.example to .env and fill it in`);
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    },
    // R2 doesn't support the SDK's default (CRC32) integrity checksums,
    // which otherwise break multipart uploads.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

// Named apart from the Workers `R2Bucket` binding type used in functions/.
export class S3ApiBucket implements Bucket {
  constructor(
    private readonly client: S3Client,
    private readonly name: string,
  ) {}

  async has(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.name, Key: key }));
      return true;
    } catch (error) {
      if (error instanceof NotFound) return false;
      throw error;
    }
  }

  async upload(key: string, path: string, contentType: string): Promise<void> {
    // Multipart for large files, so Originals of any length upload.
    await new Upload({
      client: this.client,
      params: { Bucket: this.name, Key: key, Body: createReadStream(path), ContentType: contentType },
    }).done();
  }

  async download(key: string, path: string): Promise<void> {
    const { Body } = await this.client.send(new GetObjectCommand({ Bucket: this.name, Key: key }));
    if (!(Body instanceof Readable)) throw new Error(`no body for ${this.name}/${key}`);
    await pipeline(Body, createWriteStream(path));
  }

  async readText(key: string): Promise<string | null> {
    try {
      const { Body } = await this.client.send(new GetObjectCommand({ Bucket: this.name, Key: key }));
      return (await Body?.transformToString("utf-8")) ?? null;
    } catch (error) {
      if (error instanceof NoSuchKey) return null;
      throw error;
    }
  }

  async writeText(key: string, text: string, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.name, Key: key, Body: text, ContentType: contentType }),
    );
  }
}
