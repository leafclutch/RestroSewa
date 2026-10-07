import { NextResponse } from "next/server";
import { getMyTables, getMyWalkIns } from "@/app/actions/pos";
import { getRoomsOverview } from "@/app/actions/rooms";
import { getRestaurantUser } from "@/lib/auth/get-restaurant-user";
import { createServiceClient } from "@/lib/supabase/service";

// Live reads for the floor plan (tables / rooms / walk-ins grids) and the session rail.
//
// Why a GET route and not the server actions the grids used to call directly: Next runs
// server actions ONE AT A TIME through the same queue as client navigation. Every
// realtime event made all three grids fire one — and opening a walk-in fires an event —
// so the jump into the new walk-in waited behind three list refreshes (the "added W4 but
// it didn't open" bug). A plain fetch runs alongside navigation and never blocks it.
//
// Same functions, same permission and visibility filtering as before — this only
// changes how the browser asks.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const part = new URL(req.url).searchParams.get("part");
  try {
    switch (part) {
      case "tables":
        return json(await getMyTables());
      case "rooms":
        return json(await getRoomsOverview());
      case "walkins":
        return json(await getMyWalkIns());
      case "kind": {
        // Which list a session belongs to — for the session rail, when it lands on a
        // session it hasn't seen (a walk-in just added, a closed one, a fresh load).
        const id = new URL(req.url).searchParams.get("session");
        if (!id) return json({ kind: null });
        const ru = await getRestaurantUser();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (createServiceClient() as any)
          .from("sessions")
          .select("type")
          .eq("id", id)
          .eq("restaurant_id", ru.restaurant_id)
          .maybeSingle();
        return json({ kind: data ? (data.type === "walk_in" ? "walkins" : "tables") : null });
      }
      default:
        return NextResponse.json({ error: "Unknown part." }, { status: 400 });
    }
  } catch (e) {
    // getRestaurantUser redirects when signed out — let Next turn that into a response.
    if (e && typeof e === "object" && "digest" in e) throw e;
    return NextResponse.json({ error: "Could not load." }, { status: 500 });
  }
}

const json = (body: unknown) =>
  NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
