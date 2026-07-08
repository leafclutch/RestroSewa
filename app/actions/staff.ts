"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { PERMISSIONS } from "@/lib/permissions";
import type { Permission } from "@/lib/permissions";

export type ActionResult = { error: string } | { redirectTo: string } | null;

const PIN_REGEX = /^[0-9]{4}$/;
const VALID_PERMISSIONS = new Set<string>(Object.values(PERMISSIONS));

function parsePermissions(raw: string | null): string[] {
  try {
    const parsed = JSON.parse(raw ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return (parsed as unknown[]).filter(
      (p): p is string => typeof p === "string" && VALID_PERMISSIONS.has(p)
    );
  } catch {
    return [];
  }
}

export async function createStaffMember(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const restaurantId = formData.get("restaurant_id") as string;
  const displayName  = (formData.get("display_name") as string)?.trim();
  const title        = (formData.get("title") as string)?.trim() ?? "";
  const role         = formData.get("role") as string;
  const pin          = formData.get("pin") as string;
  const permissions  = parsePermissions(formData.get("permissions") as string | null);

  if (!displayName || !restaurantId) return { error: "Name is required." };
  if (!PIN_REGEX.test(pin)) return { error: "PIN must be exactly 4 digits (numbers only)." };
  if (!["restaurant_admin", "restaurant_employee"].includes(role))
    return { error: "Invalid role." };

  const service = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: newUser, error: insertError } = await (service as any)
    .from("restaurant_users")
    .insert({ restaurant_id: restaurantId, display_name: displayName, title, role, permissions })
    .select("id")
    .single();

  if (insertError) return { error: "Failed to create staff record." };

  // Supabase Auth hashes the PIN with bcrypt before storing — plain text never persists.
  const admin = createAdminClient();
  const syntheticEmail = `emp-${newUser.id}@restrosewa.internal`;

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: syntheticEmail,
    password: pin,
    email_confirm: true,
  });

  if (authError) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (service as any).from("restaurant_users").delete().eq("id", newUser.id);
    return { error: `Auth account failed: ${authError.message}` };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any)
    .from("restaurant_users")
    .update({ auth_user_id: authData.user.id })
    .eq("id", newUser.id);

  return { redirectTo: `/superadmin/restaurants/${restaurantId}` };
}

export async function updateStaffPermissions(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const staffId      = formData.get("staff_id") as string;
  const restaurantId = formData.get("restaurant_id") as string;
  const permissions  = parsePermissions(formData.get("permissions") as string | null);

  if (!staffId || !restaurantId) return { error: "Invalid request." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("restaurant_users")
    .update({ permissions })
    .eq("id", staffId);

  if (error) return { error: "Failed to update permissions." };
  revalidatePath(`/superadmin/restaurants/${restaurantId}`);
  return null;
}

export async function resetStaffPin(
  staffId: string,
  authUserId: string,
  newPin: string
): Promise<ActionResult> {
  if (!PIN_REGEX.test(newPin)) return { error: "PIN must be exactly 4 digits (numbers only)." };

  const admin = createAdminClient();
  const syntheticEmail = `emp-${staffId}@restrosewa.internal`;

  // createUser accepts 4-digit PINs; updateUserById enforces a 6-char minimum — so recreate
  const { data: newAuthUser, error: createErr } = await admin.auth.admin.createUser({
    email: syntheticEmail,
    password: newPin,
    email_confirm: true,
  });
  if (createErr) return { error: `Failed to update PIN: ${createErr.message}` };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateErr } = await (service as any)
    .from("restaurant_users")
    .update({ auth_user_id: newAuthUser.user.id })
    .eq("id", staffId);

  if (updateErr) {
    await admin.auth.admin.deleteUser(newAuthUser.user.id);
    return { error: "Failed to update staff record." };
  }

  await admin.auth.admin.deleteUser(authUserId);
  return null;
}

export async function deleteStaffMember(
  staffId: string,
  authUserId: string | null,
  restaurantId: string
): Promise<ActionResult> {
  if (authUserId) {
    const admin = createAdminClient();
    const { error: authError } = await admin.auth.admin.deleteUser(authUserId);
    if (authError) return { error: `Failed to delete login account: ${authError.message}` };
  }

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any).from("restaurant_users").delete().eq("id", staffId);

  if (error) return { error: "Failed to delete staff member." };

  revalidatePath(`/superadmin/restaurants/${restaurantId}`);
  return null;
}

export async function toggleStaffStatus(
  staffId: string,
  authUserId: string | null,
  isActive: boolean,
  restaurantId: string
): Promise<ActionResult> {
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("restaurant_users")
    .update({ is_active: isActive })
    .eq("id", staffId);

  if (error) return { error: "Failed to update staff status." };

  if (authUserId) {
    const admin = createAdminClient();
    await admin.auth.admin.updateUserById(authUserId, {
      ban_duration: isActive ? "none" : "876600h",
    });
  }

  revalidatePath(`/superadmin/restaurants/${restaurantId}`);
  return null;
}

export async function softDeleteStaffMember(
  staffId: string,
  authUserId: string | null,
  restaurantId: string
): Promise<ActionResult> {
  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("restaurant_users")
    .update({ is_active: false, deleted_at: new Date().toISOString() })
    .eq("id", staffId);

  if (error) return { error: "Failed to delete staff member." };

  if (authUserId) {
    const admin = createAdminClient();
    await admin.auth.admin.updateUserById(authUserId, { ban_duration: "876600h" });
  }

  revalidatePath(`/superadmin/restaurants/${restaurantId}`);
  return null;
}

export async function updateWorkstationAssignments(
  staffId: string,
  restaurantId: string,
  workstationIds: string[]
): Promise<ActionResult> {
  const service = createServiceClient();

  // Delete existing assignments
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: delErr } = await (service as any)
    .from("restaurant_user_workstations")
    .delete()
    .eq("restaurant_user_id", staffId);
  if (delErr) return { error: "Failed to update assignments." };

  if (workstationIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: insErr } = await (service as any)
      .from("restaurant_user_workstations")
      .insert(workstationIds.map((wid) => ({ restaurant_user_id: staffId, workstation_id: wid })));
    if (insErr) return { error: "Failed to save assignments." };
  }

  revalidatePath(`/admin/staff`);
  revalidatePath(`/superadmin/restaurants/${restaurantId}`);
  return null;
}

export async function updateStaffMember(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const staffId      = formData.get("staff_id") as string;
  const restaurantId = formData.get("restaurant_id") as string;
  const authUserId   = (formData.get("auth_user_id") as string) || null;
  const displayName  = (formData.get("display_name") as string)?.trim();
  const title        = (formData.get("title") as string)?.trim() || null;
  const role         = formData.get("role") as string;
  const permissions  = parsePermissions(formData.get("permissions") as string | null);
  const newPin       = (formData.get("new_pin") as string)?.trim() || null;

  if (!staffId || !restaurantId) return { error: "Invalid request." };
  if (!displayName) return { error: "Name is required." };
  if (!["restaurant_admin", "restaurant_employee"].includes(role))
    return { error: "Invalid role." };
  if (newPin && !PIN_REGEX.test(newPin))
    return { error: "PIN must be exactly 4 digits." };

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (service as any)
    .from("restaurant_users")
    .update({
      display_name: displayName,
      title,
      role,
      permissions: role === "restaurant_employee" ? permissions : [],
    })
    .eq("id", staffId);

  if (error) return { error: "Failed to update staff member." };

  if (newPin && authUserId) {
    const admin = createAdminClient();
    const syntheticEmail = `emp-${staffId}@restrosewa.internal`;

    const { data: newAuthUser, error: createErr } = await admin.auth.admin.createUser({
      email: syntheticEmail,
      password: newPin,
      email_confirm: true,
    });
    if (createErr) return { error: `Staff details saved but PIN update failed: ${createErr.message}` };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (service as any)
      .from("restaurant_users")
      .update({ auth_user_id: newAuthUser.user.id })
      .eq("id", staffId);

    await admin.auth.admin.deleteUser(authUserId);
  }

  revalidatePath(`/superadmin/restaurants/${restaurantId}`);
  return null;
}
