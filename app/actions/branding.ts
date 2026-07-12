"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { revalidatePath } from "next/cache";

export type ActionResult = { error: string } | null;

const BUCKET = "restaurant-logos";

// Kept in lockstep with the bucket's own `allowed_mime_types` (migration
// 20260712300000). Storage rejects anything else even if this check is bypassed;
// checking here too is what lets us return a readable message instead of a 400.
const ALLOWED: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * The storage path inside our bucket, or null if `logo_url` points somewhere
 * else entirely. Used to delete the file a logo REPLACES — the brief asks for
 * one logo per restaurant, not a bucket that grows forever.
 */
function bucketPathOf(logoUrl: string | null): string | null {
  if (!logoUrl) return null;
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const i = logoUrl.indexOf(marker);
  if (i === -1) return null;
  const path = logoUrl.slice(i + marker.length).split("?")[0];
  return path || null;
}

export async function uploadRestaurantLogo(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  // The (superadmin) LAYOUT guards page rendering, not server actions — an action
  // is its own entry point and must check for itself.
  await requireSuperAdmin();

  const restaurantId = String(formData.get("restaurant_id") ?? "").trim();
  const file = formData.get("logo");

  if (!restaurantId) return { error: "Missing restaurant." };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image to upload." };

  const ext = ALLOWED[file.type];
  if (!ext) {
    return { error: "Unsupported format. Use PNG, JPG, SVG or WebP." };
  }
  if (file.size > MAX_BYTES) {
    return { error: "That image is over 2 MB. Use a smaller file." };
  }

  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: restaurant } = await (service as any)
    .from("restaurants")
    .select("id, logo_url")
    .eq("id", restaurantId)
    .maybeSingle();

  if (!restaurant) return { error: "Restaurant not found." };

  // A fresh filename each time, so a replaced logo can never be served from a
  // CDN/browser cache under the old URL.
  const path = `${restaurantId}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadErr } = await service.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadErr) return { error: "Upload failed. Try again." };

  const {
    data: { publicUrl },
  } = service.storage.from(BUCKET).getPublicUrl(path);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: saveErr } = await (service as any)
    .from("restaurants")
    .update({ logo_url: publicUrl })
    .eq("id", restaurantId);

  if (saveErr) {
    // Don't leave an orphan behind if the row didn't take the new URL.
    await service.storage.from(BUCKET).remove([path]);
    return { error: "Could not save the logo." };
  }

  // Only now is the old file unreachable — delete it last, so a failure above
  // never destroys the logo the restaurant is still using.
  const old = bucketPathOf(restaurant.logo_url);
  if (old && old !== path) {
    await service.storage.from(BUCKET).remove([old]);
  }

  revalidateBranding(restaurantId);
  return null;
}

export async function removeRestaurantLogo(restaurantId: string): Promise<ActionResult> {
  await requireSuperAdmin();

  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: restaurant } = await (service as any)
    .from("restaurants")
    .select("id, logo_url")
    .eq("id", restaurantId)
    .maybeSingle();

  if (!restaurant) return { error: "Restaurant not found." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("restaurants")
    .update({ logo_url: null })
    .eq("id", restaurantId);

  if (error) return { error: "Could not remove the logo." };

  const path = bucketPathOf(restaurant.logo_url);
  if (path) await service.storage.from(BUCKET).remove([path]);

  revalidateBranding(restaurantId);
  return null;
}

// The logo is chrome on every surface of the app, so a change has to invalidate
// all of them — not just the page the super admin was standing on.
function revalidateBranding(restaurantId: string) {
  revalidatePath(`/superadmin/restaurants/${restaurantId}`);
  revalidatePath("/superadmin/dashboard");
  revalidatePath("/admin", "layout");
  revalidatePath("/employee", "layout");
  revalidatePath("/c", "layout");
}
