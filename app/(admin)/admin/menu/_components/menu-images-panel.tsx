"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, ImagePlus, Images, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  deleteMenuImage,
  moveMenuImage,
  uploadMenuImage,
  type MenuImage,
} from "@/app/actions/menu-images";
import { shrinkImage } from "@/lib/image-resize";

/**
 * Photos of the printed menu card. Guests open them from the "Menu card" button on the
 * right edge of the QR menu — a button that only exists once at least one photo is here.
 */
export function MenuImagesPanel({ images }: { images: MenuImage[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const failed: string[] = [];
    setErrors([]);

    // One at a time: each upload is its own server action, well under the 3 MB body
    // limit once shrunk, and a single bad file doesn't sink the rest.
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      setProgress(list.length > 1 ? `Uploading ${i + 1} of ${list.length}…` : "Uploading…");
      try {
        if (!f.type.startsWith("image/")) throw new Error("not an image");
        const small = await shrinkImage(f);
        const fd = new FormData();
        fd.append("image", small);
        const r = await uploadMenuImage(fd);
        if (r?.error) failed.push(`${f.name}: ${r.error}`);
      } catch {
        failed.push(`${f.name}: couldn't read this file as a photo.`);
      }
    }

    setProgress(null);
    setErrors(failed);
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  function run(id: string, fn: () => Promise<{ error: string } | null>) {
    setBusyId(id);
    startTransition(async () => {
      const r = await fn();
      if (r?.error) setErrors([r.error]);
      setBusyId(null);
      router.refresh();
    });
  }

  return (
    <div
      className="rounded-xl border px-4 py-4"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-medium flex items-center gap-2" style={{ color: "var(--color-ink)" }}>
            <Images size={15} /> Menu card photos
            <span className="text-xs font-normal" style={{ color: "var(--color-ink-mute)" }}>
              {images.length > 0 ? `· ${images.length}` : ""}
            </span>
          </p>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-mute)" }}>
            Shown to customers on the QR menu. Add a clear photo of each page — they can zoom
            in to read it.
          </p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <Button
          type="button"
          variant="secondary"
          disabled={progress !== null}
          onClick={() => fileRef.current?.click()}
        >
          {progress ? (
            <><Loader2 size={14} className="mr-1.5 animate-spin" /> {progress}</>
          ) : (
            <><ImagePlus size={14} className="mr-1.5" /> Add photos</>
          )}
        </Button>
      </div>

      {errors.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {errors.map((e) => (
            <li key={e} className="text-xs" style={{ color: "var(--color-ruby)" }}>{e}</li>
          ))}
        </ul>
      )}

      {images.length > 0 && (
        <div className="mt-4 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))" }}>
          {images.map((img, i) => (
            <div
              key={img.id}
              className="rounded-lg border overflow-hidden flex flex-col"
              style={{ borderColor: "var(--color-hairline)", opacity: busyId === img.id ? 0.5 : 1 }}
            >
              <a href={img.url} target="_blank" rel="noreferrer" className="block aspect-[3/4]" style={{ background: "var(--color-canvas-soft)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={`Menu page ${i + 1}`} loading="lazy" className="w-full h-full object-cover" />
              </a>
              <div className="flex items-center justify-between px-1.5 py-1">
                <span className="text-xs tabular-nums" style={{ color: "var(--color-ink-mute)" }}>{i + 1}</span>
                <div className="flex items-center">
                  <button
                    type="button"
                    title="Move earlier"
                    aria-label={`Move page ${i + 1} earlier`}
                    disabled={i === 0 || busyId !== null}
                    onClick={() => run(img.id, () => moveMenuImage(img.id, "up"))}
                    className="p-1 rounded disabled:opacity-25"
                    style={{ color: "var(--color-ink-mute)" }}
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    type="button"
                    title="Move later"
                    aria-label={`Move page ${i + 1} later`}
                    disabled={i === images.length - 1 || busyId !== null}
                    onClick={() => run(img.id, () => moveMenuImage(img.id, "down"))}
                    className="p-1 rounded disabled:opacity-25"
                    style={{ color: "var(--color-ink-mute)" }}
                  >
                    <ChevronRight size={14} />
                  </button>
                  <button
                    type="button"
                    title="Delete photo"
                    aria-label={`Delete page ${i + 1}`}
                    disabled={busyId !== null}
                    onClick={() => {
                      if (confirm("Delete this menu photo?")) run(img.id, () => deleteMenuImage(img.id));
                    }}
                    className="p-1 rounded disabled:opacity-25"
                    style={{ color: "var(--color-ruby)" }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
