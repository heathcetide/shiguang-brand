import { createHash } from "node:crypto";

/** Stable for identical image bytes, including a data URI versus bare base64. */
export function inventoryPhotoKey(image: string) {
  const encoded = image.trim().replace(/^data:image\/[^;,]+;base64,/i, "").replace(/\s/g, "");
  const bytes = Buffer.from(encoded, "base64");
  return `inventory-photo:${createHash("sha256").update(bytes.length ? bytes : encoded).digest("hex")}`;
}
