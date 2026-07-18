import { redirect } from "next/navigation";

// Sales is a section of the dashboard now. Kept as a redirect so a "payment
// received" push, an app shortcut or an old bookmark lands on the dashboard
// scrolled to Sales rather than on a duplicate page. The dashboard renders the
// section only for staff with sales permission, so this needs no separate guard.
export default function SalesPage() {
  redirect("/employee/dashboard?focus=sales");
}
