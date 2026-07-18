"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { getRestaurantUser } from "@/lib/auth/get-restaurant-user";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";

export type ActionResult = { error: string } | null;

// `kind` (kitchen/bar) is a legacy column, kept for existing data but no longer read:
// printing is now per-workstation, and each station's docket is named by `ticket_code`
// (see lib/workstations/ticket-code.ts) — Kitchen → KOT, Bar → BOT, Bakery → BAOT, …
// `ticket_code` is an optional admin override; null means "derive it from the name".
export type WorkstationRow = {
  id: string;
  name: string;
  display_color: string | null;
  sort_order: number;
  is_active: boolean;
  ticket_code: string | null;
};

/** Normalise an admin-typed ticket code to A–Z0–9 uppercase; empty → null (use the
 *  auto default derived from the name at render time). */
function normalizeTicketCode(v: unknown): string | null {
  const s = typeof v === "string" ? v.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
  return s || null;
}

export async function getWorkstations(restaurantId: string): Promise<WorkstationRow[]> {
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (service as any)
    .from("workstations")
    .select("id, name, display_color, sort_order, is_active, ticket_code")
    .eq("restaurant_id", restaurantId)
    .order("sort_order")
    .order("name");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data as any[]) ?? []).map((w) => ({
    id: w.id,
    name: w.name,
    display_color: w.display_color,
    sort_order: w.sort_order,
    is_active: w.is_active,
    ticket_code: w.ticket_code ?? null,
  }));
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
  const ticketCode = normalizeTicketCode(formData.get("ticket_code"));

  if (!name) return { error: "Name is required." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("workstations")
    .insert({ restaurant_id: restaurantId, name, display_color: displayColor, ticket_code: ticketCode });

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
  const ticketCode = normalizeTicketCode(formData.get("ticket_code"));

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
    .update({ name, display_color: displayColor, ticket_code: ticketCode })
    .eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/admin/workstations");
  return null;
}

// ─── Print settings (thermal paper width) ─────────────────────────────────────
// Restaurants print tickets/bills on thermal rolls — most 80mm, some 58mm. The
// chosen width lives in the restaurant's `settings` JSON so the print CSS can size
// the page to the roll. Set from the Workstations admin screen (the print-config page).
export type PaperWidth = "58" | "80";

export async function updatePrintSettings(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const ru = await getRestaurantUser();
  if (!hasPermission(ru, PERMISSIONS.MANAGE_TABLES) && !hasPermission(ru, PERMISSIONS.MANAGE_MENU))
    return { error: "Permission denied." };

  const raw = formData.get("print_paper_width");
  const width: PaperWidth = raw === "58" ? "58" : "80";

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rest } = await (service as any)
    .from("restaurants")
    .select("settings")
    .eq("id", ru.restaurant_id)
    .maybeSingle();

  const settings = { ...(rest?.settings ?? {}), print_paper_width: width };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("restaurants")
    .update({ settings })
    .eq("id", ru.restaurant_id);

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
