"use client";

import { useEffect, useState } from "react";

/**
 * Is the device connected?
 *
 * Starts as `true` and is corrected in an effect — `navigator.onLine` cannot be read
 * during render (the server has no such thing, and reading it in the first client pass
 * would disagree with the server's HTML). Optimistic by default, because flashing an
 * offline banner on every page load of a perfectly healthy connection would train
 * everyone to ignore it.
 *
 * A caveat worth stating plainly: `navigator.onLine` only knows whether a network
 * INTERFACE exists. A captive portal, a dead uplink, or a restaurant wifi that has
 * stopped routing all still report "online". So this is a reliable NEGATIVE — false
 * really does mean disconnected — and only a hint when true. Everything that depends
 * on the answer being right (the mutation gate, the reconnect) therefore treats
 * `false` as authoritative and `true` as "worth trying", which is the only way round
 * that fails safe.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();

    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  return online;
}
