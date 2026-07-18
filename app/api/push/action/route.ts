import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/auth/current-user";
import { approveTableActivation, rejectTableActivation } from "@/app/actions/pos";
import { acknowledgeNotification, completeNotification } from "@/app/actions/notifications";

// Acting on a notification writes to the database and needs the caller's session.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The endpoint behind the [Approve] / [Reject] buttons on a system notification.
 *
 * WHY A ROUTE AND NOT A SERVER ACTION: the buttons are pressed inside the SERVICE
 * WORKER, when the app is closed. There is no React, no page, no client bundle — so
 * there is nothing to call a server action from. A plain fetch is the only thing a
 * worker has, and this is what it fetches.
 *
 * SECURITY. This is a bare id arriving over HTTP from a context we do not control, so
 * it is treated as exactly that: untrusted. It re-runs the SAME server actions the
 * in-app buttons use — which each re-derive the caller from the session cookie and
 * re-check table-group visibility before touching anything. Nothing here is trusted
 * because "it came from our notification"; a push payload is not a capability.
 */

const ACTIONS = {
  approve: approveTableActivation,
  reject: rejectTableActivation,
  // "I've seen it, I'm going" — new → acknowledged.
  acknowledge: acknowledgeNotification,
  // "Dealt with" — clears it from the panel and the badge.
  complete: completeNotification,
} as const;

type ActionName = keyof typeof ACTIONS;

export async function POST(request: Request) {
  // The service worker's fetch carries the session cookie (same-origin), so the
  // caller resolves exactly as it would in-app. If it doesn't, the staff member's
  // session has expired since the push was sent — which is a 401, not a redirect to
  // an HTML login page the worker could do nothing with.
  const staff = await getCurrentStaff();
  if (!staff) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  let body: { notificationId?: unknown; action?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const { notificationId, action } = body;

  if (typeof notificationId !== "string" || typeof action !== "string") {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  if (!Object.hasOwn(ACTIONS, action)) {
    return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
  }

  const run = ACTIONS[action as ActionName];
  const result = await run(notificationId);

  // acknowledge/complete return void; approve/reject return { error? }. A caller who
  // is not allowed to act on this notification gets "Not allowed." from the action
  // itself — and the notification actions silently no-op, which is the existing
  // behaviour and is deliberate: a staff member poking at ids they don't own learns
  // nothing from the response.
  const error = result && typeof result === "object" && "error" in result ? result.error : undefined;

  if (error) {
    return NextResponse.json({ ok: false, error }, { status: 200 });
  }

  return NextResponse.json({ ok: true });
}
