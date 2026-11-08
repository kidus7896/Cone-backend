import { DeleteObjectsCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { config } from "../config";
import { AppError } from "./errors";

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!config.S3_BUCKET || !config.S3_ACCESS_KEY || !config.S3_SECRET_KEY) {
    throw new AppError(503, "storage_unavailable", "Photo storage is not configured");
  }
  client ??= new S3Client({
    region: config.S3_REGION,
    endpoint: config.S3_ENDPOINT || undefined,
    // Path-style URLs work with MinIO and most self-hosted S3-compatible stores.
    forcePathStyle: true,
    credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
  });
  return client;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      // Keys are unique per upload, so browsers and CDNs can cache them for a long time.
      CacheControl: "public, max-age=31536000, immutable",
    })
  );
}

// Best effort: a failed cleanup must not block deleting the listing.
export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await getClient().send(
      new DeleteObjectsCommand({
        Bucket: config.S3_BUCKET,
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
      })
    );
  } catch (err) {
    console.error("Could not delete stored photos", err);
  }
}

export function publicUrl(key: string): string {
  return `${config.PUBLIC_MEDIA_BASE_URL.replace(/\/+$/, "")}/${key}`;
}
