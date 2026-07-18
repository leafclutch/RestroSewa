import { redirect } from "next/navigation";

// The menu editor is a section of the dashboard now (for staff with Manage Menu).
// Kept as a redirect so any old link lands on the dashboard scrolled to Menu rather
// than on a duplicate page. Admins keep their own richer editor at /admin/menu.
export default function EmployeeMenuPage() {
  redirect("/employee/dashboard?focus=menu");
}
