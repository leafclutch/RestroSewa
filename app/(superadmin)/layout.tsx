import { requireSuperAdmin } from "@/lib/auth/guards";
import { SuperAdminSidebar } from "./superadmin/_components/sidebar";

export default async function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSuperAdmin();

  return (
    <div className="flex min-h-screen" style={{ background: "var(--color-canvas-soft)" }}>
      <SuperAdminSidebar />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
