import { redirect } from "next/navigation";

// The notifications list, its actions and the alert settings all live in the bell
// dropdown on the dashboard now — this standalone page only ever duplicated them,
// and staff reach notifications by tapping the bell, not by visiting a URL.
//
// The route is kept (rather than deleted) purely as a redirect: a push notification
// already sitting in someone's tray, an installed-app shortcut, or an old bookmark
// can still point here, and all of them should land on the one workspace with the
// panel open instead of hitting a 404.
export default function NotificationsPage() {
  redirect("/employee/dashboard?focus=notifications");
}
