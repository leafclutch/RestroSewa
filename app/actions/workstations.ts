"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { getRestaurantUser } from "@/lib/auth/get-restaurant-user";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";

export type ActionResult = { error: string } | null;

export type WorkstationRow = {
  id: string;
  name: string;
  display_color: string | null;
  sort_order: number;
  is_active: boolean;
};

export async function getWorkstations(restaurantId: string): Promise<WorkstationRow[]> {
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("workstations")
    .select("id, name, display_color, sort_order, is_active")
    .eq("restaurant_id", restaurantId)
    .order("sort_order")
    .order("name");
  return (data as WorkstationRow[]) ?? [];
}

export async function createWorkstation(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_TABLES)) return { error: "Permission denied." };

  const restaurantId = formData.get("restaurant_id") as string;
  if (restaurantId !== ru.restaurant_id) return { error: "Permission denied." };
  const name = (formData.get("name") as string)?.trim();
  const displayColor = (formData.get("display_color") as string) || null;

  if (!name) return { error: "Name is required." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("workstations")
    .insert({ restaurant_id: restaurantId, name, display_color: displayColor });

  if (error) return { error: error.message };

  revalidatePath("/admin/workstations");
  return null;
}

export async function toggleWorkstationStatus(id: string, isActive: boolean) {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_TABLES)) return;
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any)
    .from("workstations")
    .update({ is_active: isActive })
    .eq("id", id);
  revalidatePath("/admin/workstations");
}

export async function updateWorkstation(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_TABLES)) return { error: "Permission denied." };

  const id = formData.get("id") as string;
  const name = (formData.get("name") as string)?.trim();
  const displayColor = (formData.get("display_color") as string) || null;

  if (!name) return { error: "Name is required." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (service as any)
    .from("workstations")
    .select("restaurant_id")
    .eq("id", id)
    .maybeSingle();
  if (!existing || existing.restaurant_id !== ru.restaurant_id)
    return { error: "Permission denied." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("workstations")
    .update({ name, display_color: displayColor })
    .eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/admin/workstations");
  return null;
}

export async function deleteWorkstation(id: string): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_TABLES)) return { error: "Permission denied." };
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("workstations")
    .delete()
    .eq("id", id);
  if (error) {
    if (error.code === "23503")
      return { error: "Cannot delete — menu categories or items are assigned to this workstation." };
    return { error: error.message };
  }
  revalidatePath("/admin/workstations");
  return null;
}
