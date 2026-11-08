import sharp from "sharp";
import { badRequest } from "./errors";

const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);
const MAX_INPUT_PIXELS = 50_000_000; // guards against decompression bombs

export interface ProcessedImage {
  full: Buffer;
  thumb: Buffer;
  bytes: number;
}

// The file type is detected from the file's own bytes, not from the name or the
// Content-Type header, which a client can fake. Output is always re-encoded WebP:
// that strips EXIF metadata (including GPS location), rotates by orientation,
// and keeps files small for slow connections.
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  const options = { limitInputPixels: MAX_INPUT_PIXELS };

  let format: string | undefined;
  try {
    format = (await sharp(input, options).metadata()).format;
  } catch {
    throw badRequest("That file is not a valid image", { file: "Upload a JPEG, PNG or WebP photo" });
  }
  if (!format || !ALLOWED_FORMATS.has(format)) {
    throw badRequest("Unsupported image type", { file: "Upload a JPEG, PNG or WebP photo" });
  }

  try {
    const full = await sharp(input, options)
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    const thumb = await sharp(input, options)
      .rotate()
      .resize({ width: 400, height: 400, fit: "cover" })
      .webp({ quality: 70 })
      .toBuffer();
    return { full, thumb, bytes: full.length };
  } catch {
    throw badRequest("That image could not be processed", { file: "Try a different photo" });
  }
}
