"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getImageProps } from "next/image";
import { BookOpen, ChevronLeft, ChevronRight, Loader2, Minus, Plus, X, ZoomIn } from "lucide-react";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { IDENTITY, clampPan, zoomAt, type ZoomState } from "@/lib/zoom";
import type { MenuImage } from "@/app/actions/menu-images";

// The restaurant's printed menu card, for guests: a tab on the right edge opens a drawer
// from the right with every page; tapping a page opens it full screen to zoom and pan.
// The parent renders this only when the restaurant has uploaded at least one photo.

// The drawer shows phone-width copies, not the 2000px originals: Next's image optimizer
// resizes them to the screen, re-encodes them as WebP/AVIF and caches the result —
// typically a fifth of the bytes. The originals are only fetched by the zoom viewer,
// where the detail is actually needed.
const THUMB_SIZES = "(max-width: 480px) 92vw, 440px";

function thumbProps(url: string, alt: string) {
  // width/height only seed the aspect-ratio box before load; CSS sizes the image.
  return getImageProps({ src: url, alt, width: 880, height: 1240, sizes: THUMB_SIZES }).props;
}

/**
 * Warm the browser cache with the drawer's copies while the guest browses the menu,
 * so the drawer opens on images that are already there. Same srcset + sizes as the
 * real <img>, so the browser picks the same file and the later request is a cache hit.
 * Idle-time and sequential: it never competes with the menu itself for bandwidth.
 */
function usePrefetchThumbs(images: MenuImage[]) {
  useEffect(() => {
    if (images.length === 0) return;
    // Respect data-saver: a guest who asked for less data doesn't get speculative downloads.
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return;

    let cancelled = false;
    let i = 0;
    const next = () => {
      if (cancelled || i >= images.length) return;
      const p = thumbProps(images[i].url, "");
      i++;
      const pre = new window.Image();
      pre.sizes = THUMB_SIZES;
      if (p.srcSet) pre.srcset = p.srcSet;
      pre.src = p.src;
      pre.onload = pre.onerror = () => next();
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    const start = () => (w.requestIdleCallback ? w.requestIdleCallback(next) : setTimeout(next, 1500));
    // After the page has finished its own loading.
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", start);
    };
  }, [images]);
}

/** An image that shows a spinner on a tinted box until it has actually arrived. */
function Thumb({ url, alt }: { url: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  const p = thumbProps(url, alt);
  return (
    <span className="relative block" style={{ minHeight: loaded ? undefined : 260 }}>
      {!loaded && (
        <span className="absolute inset-0 flex items-center justify-center" style={{ color: "var(--color-ink-mute)" }}>
          <Loader2 size={22} className="animate-spin" />
        </span>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
      <img
        {...p}
        decoding="async"
        onLoad={() => setLoaded(true)}
        className="w-full h-auto block"
        style={{ opacity: loaded ? 1 : 0, transition: "opacity .2s ease" }}
      />
    </span>
  );
}

const STYLES = `
@keyframes rs-drawer-in { from { transform: translateX(100%) } to { transform: translateX(0) } }
.rs-drawer-in { animation: rs-drawer-in .3s cubic-bezier(.2,.85,.25,1) both }
`;

export function MenuPhotos({ images }: { images: MenuImage[] }) {
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);

  useBodyScrollLock(open);
  usePrefetchThumbs(images);

  useEffect(() => {
    if (!open || viewing !== null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, viewing]);

  return (
    <>
      <style>{STYLES}</style>

      {/* The tab. Vertically centred on the right edge, under every sheet (z-[70]). */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="View menu card photos"
        className="fixed right-0 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center gap-1.5 py-3 px-1.5 rounded-l-xl text-white rs-press"
        style={{
          background: "linear-gradient(180deg,var(--color-primary),var(--color-primary-deep))",
          boxShadow: "-4px 6px 18px rgba(8,145,178,0.28)",
        }}
      >
        <BookOpen size={16} />
        <span className="text-[11px] font-semibold tracking-wide" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
          Menu card
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Menu card"
          className="fixed inset-0 z-[70] flex justify-end rs-fade"
          style={{ background: "rgba(13,37,61,0.42)", backdropFilter: "blur(2px)" }}
          onClick={() => setOpen(false)}
        >
          <div
            className="h-full w-[min(440px,92vw)] flex flex-col rs-drawer-in rs-elev-lg"
            style={{ background: "var(--color-canvas)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--color-hairline)" }}>
              <div>
                <p className="text-base font-semibold" style={{ color: "var(--color-ink)" }}>Menu card</p>
                <p className="text-xs flex items-center gap-1" style={{ color: "var(--color-ink-mute)" }}>
                  <ZoomIn size={11} /> Tap a page to zoom in
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu card"
                className="w-9 h-9 rounded-xl flex items-center justify-center rs-press"
                style={{ background: "var(--color-canvas-soft)", color: "var(--color-ink)" }}
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-4">
              {images.map((img, i) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => setViewing(i)}
                  className="block w-full rounded-2xl overflow-hidden border text-left rs-press"
                  style={{ borderColor: "var(--color-hairline)", background: "var(--color-canvas-soft)" }}
                  aria-label={`Open page ${i + 1} of ${images.length}`}
                >
                  <Thumb url={img.url} alt={`Menu page ${i + 1}`} />
                  <span className="block px-3 py-1.5 text-xs" style={{ color: "var(--color-ink-mute)" }}>
                    Page {i + 1} of {images.length}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {viewing !== null && (
        <PhotoViewer images={images} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
      )}
    </>
  );
}

// ─── Full-screen zoom viewer ─────────────────────────────────────────────────────

function PhotoViewer({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: MenuImage[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [zoom, setZoomState] = useState<ZoomState>(IDENTITY);
  const zoomRef = useRef<ZoomState>(IDENTITY);
  // While a finger is down the transform follows it exactly; animated only otherwise.
  const [gesturing, setGesturing] = useState(false);
  // Originals that have finished downloading. Until then the (cached) drawer copy
  // stands in, so the viewer never opens on a blank screen.
  const [loadedFull, setLoadedFull] = useState<Set<string>>(() => new Set());
  const current = images[index];
  const fullReady = loadedFull.has(current.url);

  // Gesture bookkeeping lives in refs: it changes on every pointer move and must not
  // re-render anything but the transform.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchDist = useRef<number | null>(null);
  const gestureStart = useRef<{ x: number; y: number; t: number; multi: boolean } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);

  const count = images.length;
  const go = useCallback(
    (d: number) => {
      const next = index + d;
      if (next >= 0 && next < count) onIndex(next);
    },
    [index, count, onIndex]
  );

  const setZoom = useCallback((next: ZoomState) => {
    const box = boxRef.current;
    const img = imgRef.current;
    const clamped =
      box && img
        ? clampPan(next, { w: box.clientWidth, h: box.clientHeight }, { w: img.offsetWidth, h: img.offsetHeight })
        : next;
    zoomRef.current = clamped;
    setZoomState(clamped);
  }, []);

  // A new page always opens un-zoomed.
  useEffect(() => {
    zoomRef.current = IDENTITY;
    setZoomState(IDENTITY);
  }, [index]);

  /** Point relative to the box centre — the frame zoomAt works in. */
  const fromCentre = (clientX: number, clientY: number) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: clientX - (r.left + r.width / 2), y: clientY - (r.top + r.height / 2) };
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  // Wheel zoom needs a non-passive listener to stop the page behind from scrolling.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = fromCentre(e.clientX, e.clientY);
      const st = zoomRef.current;
      setZoom(zoomAt(st, st.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), p.x, p.y));
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, [setZoom]);

  function onPointerDown(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setGesturing(true);
    if (pointers.current.size === 1) {
      gestureStart.current = { x: e.clientX, y: e.clientY, t: Date.now(), multi: false };
    } else if (gestureStart.current) {
      gestureStart.current.multi = true;
    }
    pinchDist.current = null;
  }

  function onPointerMove(e: React.PointerEvent) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const now = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, now);
    const st = zoomRef.current;

    if (pointers.current.size >= 2) {
      const [a, b] = Array.from(pointers.current.values());
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = fromCentre((a.x + b.x) / 2, (a.y + b.y) / 2);
      if (pinchDist.current) setZoom(zoomAt(st, st.scale * (dist / pinchDist.current), mid.x, mid.y));
      pinchDist.current = dist;
      return;
    }
    if (st.scale > 1) {
      setZoom({ scale: st.scale, x: st.x + (now.x - prev.x), y: st.y + (now.y - prev.y) });
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    pinchDist.current = null;
    if (pointers.current.size > 0) return;
    setGesturing(false);

    const start = gestureStart.current;
    gestureStart.current = null;
    if (!start || start.multi) return;

    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const moved = Math.hypot(dx, dy);

    // Swipe between pages — only when not zoomed, where a drag means "pan".
    if (zoomRef.current.scale === 1 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      go(dx < 0 ? 1 : -1);
      lastTap.current = null;
      return;
    }

    // Double tap / double click: 1× ↔ 2.5× at that spot.
    if (moved < 10 && Date.now() - start.t < 300) {
      const t = Date.now();
      const last = lastTap.current;
      if (last && t - last.t < 320 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 30) {
        const p = fromCentre(e.clientX, e.clientY);
        setZoom(zoomRef.current.scale > 1 ? IDENTITY : zoomAt(zoomRef.current, 2.5, p.x, p.y));
        lastTap.current = null;
      } else {
        lastTap.current = { t, x: e.clientX, y: e.clientY };
      }
    }
  }

  const stepZoom = (k: number) => {
    const st = zoomRef.current;
    setZoom(zoomAt(st, st.scale * k, 0, 0));
  };

  const ctrl = "w-11 h-11 rounded-full flex items-center justify-center text-white disabled:opacity-30";
  const ctrlStyle = { background: "rgba(255,255,255,0.14)" };

  return (
    <div role="dialog" aria-modal="true" aria-label="Menu page" className="fixed inset-0 z-[80] flex flex-col rs-fade" style={{ background: "rgba(5,12,20,0.94)" }}>
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <span className="text-sm tabular-nums">Page {index + 1} of {count}</span>
        <button type="button" onClick={onClose} aria-label="Close" className={ctrl} style={ctrlStyle}>
          <X size={20} />
        </button>
      </div>

      <div
        ref={boxRef}
        className="relative flex-1 min-h-0 overflow-hidden flex items-center justify-center select-none"
        style={{ touchAction: "none", cursor: zoom.scale > 1 ? "grab" : "zoom-in" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {!fullReady && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
            <img
              {...thumbProps(current.url, "")}
              aria-hidden
              draggable={false}
              className="absolute inset-0 w-full h-full object-contain pointer-events-none"
            />
            <span
              className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 text-xs text-white rounded-full px-3 py-1.5 pointer-events-none"
              style={{ background: "rgba(0,0,0,0.5)" }}
            >
              <Loader2 size={13} className="animate-spin" /> Loading full quality…
            </span>
          </>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          key={current.id}
          src={current.url}
          alt={`Menu page ${index + 1}`}
          draggable={false}
          decoding="async"
          onLoad={() => setLoadedFull((s) => (s.has(current.url) ? s : new Set(s).add(current.url)))}
          className="max-w-full max-h-full object-contain"
          style={{
            transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
            transformOrigin: "center center",
            transition: gesturing ? "none" : "transform .18s ease-out",
            opacity: fullReady ? 1 : 0,
          }}
        />
      </div>

      <div className="flex items-center justify-center gap-3 px-4 py-4" style={{ paddingBottom: "calc(16px + env(safe-area-inset-bottom))" }}>
        <button type="button" onClick={() => go(-1)} disabled={index === 0} aria-label="Previous page" className={ctrl} style={ctrlStyle}>
          <ChevronLeft size={22} />
        </button>
        <button type="button" onClick={() => stepZoom(1 / 1.5)} disabled={zoom.scale <= 1} aria-label="Zoom out" className={ctrl} style={ctrlStyle}>
          <Minus size={20} />
        </button>
        <span className="w-12 text-center text-sm text-white tabular-nums">{Math.round(zoom.scale * 100)}%</span>
        <button type="button" onClick={() => stepZoom(1.5)} disabled={zoom.scale >= 5} aria-label="Zoom in" className={ctrl} style={ctrlStyle}>
          <Plus size={20} />
        </button>
        <button type="button" onClick={() => go(1)} disabled={index === count - 1} aria-label="Next page" className={ctrl} style={ctrlStyle}>
          <ChevronRight size={22} />
        </button>
      </div>
    </div>
  );
}
