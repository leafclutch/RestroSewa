"use client";

import { useActionState, useEffect } from "react";
import { loginWithEmailSuperAdmin } from "@/app/actions/auth";
import type { AuthResult } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SuperAdminLoginForm() {
  const [state, action, pending] = useActionState<AuthResult, FormData>(
    loginWithEmailSuperAdmin,
    null
  );

  useEffect(() => {
    if (state && "redirectTo" in state) {
      window.location.replace(state.redirectTo);
    }
  }, [state]);

  const isNavigating = !!(state && "redirectTo" in state);
  const errorMsg = state && "error" in state ? state.error : null;

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="email"
          className="text-xs font-medium tracking-wide uppercase"
          style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
        >
          Email
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="admin@example.com"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="password"
          className="text-xs font-medium tracking-wide uppercase"
          style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}
        >
          Password
        </label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
        />
      </div>

      {errorMsg && (
        <p
          className="text-sm rounded-md px-3 py-2"
          style={{ color: "var(--color-ruby)", background: "#fff0f4" }}
        >
          {errorMsg}
        </p>
      )}

      <Button
        type="submit"
        variant="primary"
        className="w-full mt-2"
        disabled={pending || isNavigating}
      >
        {pending || isNavigating ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
