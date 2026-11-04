"use client";

import { useActionState, useEffect } from "react";
import { loginWithEmail } from "@/app/actions/auth";
import type { AuthResult } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AdminLoginForm() {
  const [state, action, pending] = useActionState<AuthResult, FormData>(
    loginWithEmail,
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
        <label htmlFor="email" className="text-sm font-medium text-[#0d1b33]">
          Email
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          className="h-11 rounded-xl border-[#d5dde8] px-3.5 focus-visible:border-[#22c55e] focus-visible:ring-[#22c55e]/20"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium text-[#0d1b33]">
          Password
        </label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
          className="h-11 rounded-xl border-[#d5dde8] px-3.5 focus-visible:border-[#22c55e] focus-visible:ring-[#22c55e]/20"
        />
      </div>

      {errorMsg && (
        <p
          className="text-sm rounded-xl px-3.5 py-2.5"
          style={{ color: "var(--color-ruby)", background: "#fff0f4" }}
        >
          {errorMsg}
        </p>
      )}

      <Button
        type="submit"
        variant="primary"
        className="mt-2 h-11 w-full rounded-full bg-[#22c55e] text-[15px] font-semibold text-[#052e16] hover:bg-[#4ade80] active:bg-[#16a34a] focus-visible:ring-[#22c55e]"
        disabled={pending || isNavigating}
      >
        {pending || isNavigating ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
