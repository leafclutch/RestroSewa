import type { Metadata } from "next";
import { OfflineScreen } from "./offline-screen";

export const metadata: Metadata = { title: "Offline — RestroSewa" };

// Precached by the service worker at install, and served whenever a navigation
// can't reach the network.
//
// It therefore has to be renderable with NO network and NO session: nothing here
// may fetch, and nothing may read the signed-in user. It is deliberately the one
// page in the app that knows nothing about the restaurant.
export const dynamic = "force-static";

export default function OfflinePage() {
  return <OfflineScreen />;
}
