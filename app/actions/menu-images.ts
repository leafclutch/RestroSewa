"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { getRestaurantUser } from "@/lib/auth/get-restaurant-user";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";

// Photos of the restaurant's printed menu card — shown to guests on the QR menu from
// the right-edge "Menu card" button. See 20261011000000_menu_images.sql.

export type ActionResult = { error: string } | null;
export type MenuImage = { id: string; url: string };

const BUCKET = "menu-images";

// Kept in lockstep with the bucket's `allowed_mime_types`. Storage rejects anything
// else anyway; checking here is what returns a readable message instead of a 400.
const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const MAX_BYTES = 3 * 1024 * 1024; // the bucket's file_size_limit
const MAX_IMAGES = 20;

function revalidateMenuImages() {
  revalidatePath("/admin/menu");
  revalidatePath("/employee/dashboard");
  revalidatePath("/c", "layout");
}

/** The gallery, in display order. Public data — the customer menu reads it unauthenticated. */
export async function getMenuImages(restaurantId: string): Promise<MenuImage[]> {
  if (!restaurantId) return [];
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("menu_images")
    .select("id, url")
    .eq("restaurant_id", restaurantId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  return ((data ?? []) as MenuImage[]).map((r) => ({ id: r.id, url: r.url }));
}

export async function uploadMenuImage(formData: FormData): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_MENU)) return { error: "Permission denied." };

  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a photo to upload." };

  const ext = ALLOWED[file.type];
  if (!ext) return { error: "Unsupported format. Use JPG, PNG or WebP." };
  if (file.size > MAX_BYTES) return { error: "That photo is over 3 MB. Use a smaller one." };

  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (service as any)
    .from("menu_images")
    .select("sort_order")
    .eq("restaurant_id", ru.restaurant_id)
    .order("sort_order", { ascending: false });
  const rows = (existing ?? []) as { sort_order: number }[];
  if (rows.length >= MAX_IMAGES) {
    return { error: `You can add up to ${MAX_IMAGES} menu photos. Delete one first.` };
  }

  const path = `${ru.restaurant_id}/${crypto.randomUUID()}.${ext}`;
  const { error: uploadErr } = await service.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadErr) return { error: "Upload failed. Try again." };

  const {
    data: { publicUrl },
  } = service.storage.from(BUCKET).getPublicUrl(path);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: saveErr } = await (service as any).from("menu_images").insert({
    restaurant_id: ru.restaurant_id,
    url: publicUrl,
    path,
    sort_order: Number(rows[0]?.sort_order ?? 0) + 1,
  });

  if (saveErr) {
    // Don't leave an orphan file behind when the row didn't take.
    await service.storage.from(BUCKET).remove([path]);
    return { error: "Could not save the photo." };
  }

  revalidateMenuImages();
  return null;
}

export async function deleteMenuImage(id: string): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_MENU)) return { error: "Permission denied." };

  const service = createServiceClient();
  // Scoped by restaurant, so an id from another tenant matches nothing.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row, error } = await (service as any)
    .from("menu_images")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", ru.restaurant_id)
    .select("path")
    .maybeSingle();

  if (error) return { error: "Could not delete the photo." };
  if (!row) return { error: "Photo not found." };

  // The row is gone first, so a failed file delete only leaves an unreachable file,
  // never a broken image on the customer menu.
  await service.storage.from(BUCKET).remove([row.path]);

  revalidateMenuImages();
  return null;
}

/** Swap with the nearest neighbour — same approach as `moveItem` in menu.ts. */
export async function moveMenuImage(id: string, direction: "up" | "down"): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_MENU)) return { error: "Permission denied." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("menu_images")
    .select("id, sort_order")
    .eq("restaurant_id", ru.restaurant_id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const list = (data ?? []) as { id: string; sort_order: number }[];
  const i = list.findIndex((r) => r.id === id);
  if (i === -1) return { error: "Photo not found." };
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= list.length) return null; // already first / last

  // Renumber the whole (small) list in its new order, rather than swapping two
  // values — equal sort_orders (two uploads in the same instant) would make a swap a
  // no-op.
  [list[i], list[j]] = [list[j], list[i]];
  for (let k = 0; k < list.length; k++) {
    if (list[k].sort_order === k + 1) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (service as any)
      .from("menu_images")
      .update({ sort_order: k + 1 })
      .eq("id", list[k].id)
      .eq("restaurant_id", ru.restaurant_id);
    if (error) return { error: "Could not reorder the photos." };
  }

  revalidateMenuImages();
  return null;
}
