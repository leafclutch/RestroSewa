import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { redirect } from "next/navigation";

export type RestaurantUserCtx = {
  id: string;
  restaurant_id: string;
  role: string;
  permissions: string[];
};

export async function getRestaurantUser(): Promise<RestaurantUserCtx> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const service = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ru } = await (service as any)
    .from("restaurant_users")
    .select("id, restaurant_id, role, permissions")
    .eq("auth_user_id", user.id)
    .eq("is_active", true)
    .is("deleted_at", null)
    .maybeSingle();

  if (!ru) redirect("/login");
  const ctx = ru as RestaurantUserCtx;
  if (!Array.isArray(ctx.permissions)) ctx.permissions = [];
  return ctx;
}
