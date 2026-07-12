"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { uploadRestaurantLogo, removeRestaurantLogo } from "@/app/actions/branding";
import type { ActionResult } from "@/app/actions/branding";
import { RestaurantLogo } from "@/components/branding/restaurant-logo";
import { Button } from "@/components/ui/button";
import { Upload, Trash2 } from "lucide-react";
import { useTransition } from "react";

// Mirrors the server action and the bucket's own allow-list. Passed to the file
// picker too, so the OS dialog greys out anything we'd only reject later.
const ACCEPT = "image/png,image/jpeg,image/svg+xml,image/webp";
const MAX_BYTES = 2 * 1024 * 1024;

export function LogoUploader({
  restaurantId,
  restaurantName,
  logoUrl,
}: {
  restaurantId: string;
  restaurantName: string;
  logoUrl: string | null;
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(
    uploadRestaurantLogo,
    null
  );
  const [removing, startRemove] = useTransition();
  const [preview, setPreview] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // An object URL is a live handle into memory — revoke it or the blob leaks for
  // the lifetime of the tab.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  // The upload succeeded (null state, no longer pending): the saved logo is now
  // the real one, so drop the local preview and let the server value take over.
  useEffect(() => {
    if (!pending && state === null) {
      setPreview(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [state, pending]);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    setLocalError(null);
    const file = e.target.files?.[0];
    if (!file) {
      setPreview(null);
      return;
    }

    // Validate before the round trip, so a wrong file fails instantly.
    if (!ACCEPT.split(",").includes(file.type)) {
      setLocalError("Unsupported format. Use PNG, JPG, SVG or WebP.");
      e.target.value = "";
      setPreview(null);
      return;
    }
    if (file.size > MAX_BYTES) {
      setLocalError("That image is over 2 MB. Use a smaller file.");
      e.target.value = "";
      setPreview(null);
      return;
    }

    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(file);
    });
  }

  const error = localError ?? (state && "error" in state ? state.error : null);
  const shown = preview ?? logoUrl;

  return (
    <form action={action} className="flex items-start gap-4">
      <input type="hidden" name="restaurant_id" value={restaurantId} />

      {/* What it will actually look like. `preview` is the not-yet-saved pick;
          otherwise it's the live logo — and with neither, the initials fallback
          the rest of the app would show. */}
      <div className="shrink-0">
        {preview ? (
          // A local blob: URL, so it bypasses next/image (which only trusts the
          // Supabase host) — a plain img is the only thing that can render it.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt="New logo preview"
            className="object-contain"
            style={{
              width: 64,
              height: 64,
              borderRadius: 18,
              background: "#fff",
              border: "1px solid var(--color-hairline)",
            }}
          />
        ) : (
          <RestaurantLogo name={restaurantName} logoUrl={logoUrl} size={64} />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className={"text-xs uppercase tracking-wide font-medium"} style={{ color: "var(--color-ink-mute)", letterSpacing: "0.06em" }}>
          Restaurant Logo
        </p>
        <p className="text-xs mt-1" style={{ color: "var(--color-ink-mute)" }}>
          {shown
            ? "Shown across the admin, staff and customer screens."
            : "No logo yet — the initials above are used everywhere instead."}
          {" "}PNG, JPG, SVG or WebP · up to 2 MB.
        </p>

        <input
          ref={inputRef}
          type="file"
          name="logo"
          accept={ACCEPT}
          onChange={onPick}
          className="block mt-2.5 text-xs w-full"
          style={{ color: "var(--color-ink-mute)" }}
        />

        <div className="flex items-center gap-2 mt-3">
          <Button
            type="submit"
            variant="primary"
            disabled={!preview || pending}
            className="flex items-center gap-1.5"
          >
            <Upload size={14} strokeWidth={1.8} />
            {pending ? "Uploading…" : logoUrl ? "Replace logo" : "Upload logo"}
          </Button>

          {logoUrl && !preview && (
            <Button
              type="button"
              variant="secondary"
              disabled={removing}
              className="flex items-center gap-1.5"
              onClick={() => {
                if (!confirm("Remove this logo? The restaurant falls back to its initials.")) return;
                startRemove(async () => {
                  await removeRestaurantLogo(restaurantId);
                });
              }}
            >
              <Trash2 size={14} strokeWidth={1.8} />
              {removing ? "Removing…" : "Remove"}
            </Button>
          )}
        </div>

        {error && (
          <p className="text-xs mt-2" style={{ color: "#dc2626" }}>
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
