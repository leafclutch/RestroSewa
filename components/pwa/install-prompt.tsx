"use client";

import { useEffect, useState } from "react";
import { Download, Share, Plus, X } from "lucide-react";
import { useStandalone } from "@/lib/pwa/use-standalone";

// Chrome/Edge fire this instead of showing their own install bar, handing us the
// decision of when to ask. It is not in lib.dom, because it is not in any spec —
// Safari and Firefox have no equivalent.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISSED_KEY = "rs-install-dismissed";

/**
 * "Install this app" — shown on the login screen, which is the one moment a staff
 * member is both looking at the app and not yet mid-service.
 *
 * Two entirely different flows, because the platforms are not the same shape:
 *
 *   Android / desktop — the browser offers a real install, and we trigger it.
 *   iOS              — Apple provides no API. Installation is a manual trip through
 *                      the Share sheet, and the only thing we can do is TELL people.
 *                      Which matters more here than it looks: on iOS, web push does
 *                      not work at all until the app is on the Home Screen. For an
 *                      iPhone user this panel is not a nicety, it is the precondition
 *                      for ever being notified of anything.
 */
export function InstallPrompt() {
  const standalone = useStandalone();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [dismissed, setDismissed] = useState(true); // assume dismissed until localStorage says otherwise

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISSED_KEY) === "1");
    } catch {
      setDismissed(false); // private mode — just show it
    }

    // iPad has reported itself as a Mac since iPadOS 13, so the touch check is what
    // actually distinguishes it from a desktop.
    const ua = navigator.userAgent;
    setIsIOS(
      /iPad|iPhone|iPod/.test(ua) ||
        (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
    );

    const onPrompt = (e: Event) => {
      // Suppress the browser's own mini-infobar so ours is the only ask.
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDeferred(null);

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const close = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* private mode: it'll ask again next time, which is acceptable */
    }
  };

  // Already installed, already dismissed, or a browser with no install path at all
  // (desktop Firefox, Safari on macOS): say nothing.
  const iosNeedsInstructions = isIOS && !standalone;
  if (standalone || dismissed || (!deferred && !iosNeedsInstructions)) return null;

  return (
    <div
      className="relative rounded-xl border p-4 mb-6"
      style={{ background: "var(--color-canvas)", borderColor: "var(--color-hairline)" }}
    >
      <button
        type="button"
        onClick={close}
        aria-label="Dismiss"
        className="absolute top-2.5 right-2.5 w-8 h-8 flex items-center justify-center rounded-lg"
        style={{ color: "var(--color-ink-mute)" }}
      >
        <X size={15} />
      </button>

      <div className="flex items-start gap-3 pr-8">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: "var(--color-primary)" + "15" }}
        >
          <Download size={16} style={{ color: "var(--color-primary)" }} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
            Install HRestroSewa
          </p>

          {deferred ? (
            <>
              <p className="text-xs mt-1 leading-relaxed" style={{ color: "var(--color-ink-mute)" }}>
                Add it to your home screen for full-screen access and alerts that reach
                you when the app is closed.
              </p>
              <button
                type="button"
                onClick={async () => {
                  await deferred.prompt();
                  const { outcome } = await deferred.userChoice;
                  // The event is single-use; a second prompt() on it throws.
                  setDeferred(null);
                  if (outcome === "accepted") close();
                }}
                className="mt-3 inline-flex items-center justify-center gap-1.5 min-h-[40px] px-4 rounded-lg text-xs font-medium"
                style={{ background: "var(--color-primary)", color: "#fff" }}
              >
                <Download size={13} />
                Install
              </button>
            </>
          ) : (
            <>
              <p className="text-xs mt-1 leading-relaxed" style={{ color: "var(--color-ink-mute)" }}>
                On iPhone and iPad this is a manual step — and it is also the only way
                to receive alerts when the app is closed.
              </p>
              <ol
                className="mt-3 space-y-1.5 text-xs"
                style={{ color: "var(--color-ink-secondary)" }}
              >
                <li className="flex items-center gap-2">
                  <Share size={13} style={{ color: "var(--color-primary)" }} />
                  <span>
                    Tap <strong style={{ fontWeight: 500 }}>Share</strong> in the Safari
                    toolbar
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <Plus size={13} style={{ color: "var(--color-primary)" }} />
                  <span>
                    Choose <strong style={{ fontWeight: 500 }}>Add to Home Screen</strong>
                  </span>
                </li>
              </ol>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
