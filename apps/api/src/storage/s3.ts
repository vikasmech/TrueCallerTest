import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import fs from "node:fs/promises";
import path from "node:path";
import type { Env } from "../env.js";
import type { StorageProvider } from "./provider.js";

/** S3/MinIO when S3_ENDPOINT is set; otherwise a local directory shared by API and worker. */
export function createStorageFromEnv(env: Env): StorageProvider {
  if (env.S3_ENDPOINT) {
    return createS3Storage({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      accessKey: env.S3_ACCESS_KEY,
      secretKey: env.S3_SECRET_KEY,
      bucket: env.S3_BUCKET_IMPORTS,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
  }
  return createFsStorage(env.LOCAL_STORAGE_DIR);
}

export function createS3Storage(opts: {
  endpoint?: string;
  region: string;
  accessKey?: string;
  secretKey?: string;
  bucket: string;
  forcePathStyle: boolean;
}): StorageProvider {
  const client = new S3Client({
    endpoint: opts.endpoint,
    region: opts.region,
    forcePathStyle: opts.forcePathStyle,
    credentials:
      opts.accessKey && opts.secretKey
        ? { accessKeyId: opts.accessKey, secretAccessKey: opts.secretKey }
        : undefined,
  });
  const Bucket = opts.bucket;
  return {
    async putObject(Key, Body, ContentType) {
      await client.send(new PutObjectCommand({ Bucket, Key, Body, ContentType }));
    },
    async getObject(Key) {
      const r = await client.send(new GetObjectCommand({ Bucket, Key }));
      const bytes = await r.Body?.transformToByteArray();
      if (!bytes) throw new Error("empty object body");
      return Buffer.from(bytes);
    },
    async deleteObject(Key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key }));
    },
    presignGet(Key, expiresIn, downloadName) {
      const safeName = downloadName.replace(/[^A-Za-z0-9._-]/g, "_");
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket,
          Key,
          ResponseContentDisposition: `attachment; filename="${safeName}"`,
          ResponseContentType: "text/csv",
        }),
        { expiresIn },
      );
    },
  };
}

/** Local filesystem storage for development without MinIO. Shared by API and worker via a common dir. */
export function createFsStorage(rootDir: string): StorageProvider {
  const resolveKey = (key: string) => {
    const p = path.resolve(rootDir, key);
    if (!p.startsWith(path.resolve(rootDir) + path.sep)) throw new Error("invalid object key");
    return p;
  };
  return {
    async putObject(key, body) {
      const p = resolveKey(key);
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, body);
    },
    async getObject(key) {
      return fs.readFile(resolveKey(key));
    },
    async deleteObject(key) {
      await fs.rm(resolveKey(key), { force: true });
    },
    async presignGet(key) {
      return `file://${resolveKey(key)}`;
    },
  };
}

/** In-memory storage for tests. */
export function createMemoryStorage(): StorageProvider {
  const objects = new Map<string, Buffer>();
  return {
    async putObject(key, body) {
      objects.set(key, body);
    },
    async getObject(key) {
      const b = objects.get(key);
      if (!b) throw new Error(`object not found: ${key}`);
      return b;
    },
    async deleteObject(key) {
      objects.delete(key);
    },
    async presignGet(key) {
      return `memory://${key}`;
    },
  };
}
