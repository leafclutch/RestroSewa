// Shrinks a photo in the browser before upload.
//
// A phone camera photo of a menu card is 4–8 MB and 4000+ px wide; server actions
// accept 3 MB (next.config.ts) and the bucket caps files at 3 MB. 2000 px on the long
// side keeps printed menu text sharp enough to zoom into and read, at a few hundred KB.

const MAX_SIDE = 2000;
const TARGET_BYTES = 2.5 * 1024 * 1024;

/** Longest side clamped to `max`, aspect ratio kept. Never scales UP. */
export function fitWithin(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max || longest === 0) return { width, height };
  const k = max / longest;
  return { width: Math.round(width * k), height: Math.round(height * k) };
}

export async function shrinkImage(file: File): Promise<File> {
  // createImageBitmap honours EXIF orientation with this option, so a portrait phone
  // photo doesn't come out sideways.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const { width, height } = fitWithin(bitmap.width, bitmap.height);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't process images.");
  // White under transparent PNGs — JPEG has no alpha and would turn them black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  let blob: Blob | null = null;
  for (const quality of [0.85, 0.75, 0.6, 0.45]) {
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= TARGET_BYTES) break;
  }
  if (!blob) throw new Error("Could not process that photo.");

  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], name, { type: "image/jpeg" });
}
