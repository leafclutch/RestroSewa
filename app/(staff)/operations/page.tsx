import Link from 'next/link'
import { getAuthUser, hasPermission } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'

export default async function OperationsPage() {
  const user = await getAuthUser()
  if (!user) return null

  const service = createServiceClient()
  const { count: tableCount } = await service
    .from('restaurant_tables')
    .select('id', { count: 'exact', head: true })
    .eq('restaurant_id', user.restaurantId!)

  const isAdmin = user.role === 'restaurant_admin'
  const canManageTables = hasPermission(user, 'MANAGE_TABLES')
  const canManageMenu = hasPermission(user, 'MANAGE_MENU')

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Operations Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isAdmin ? 'Restaurant Admin' : 'Staff'} · {tableCount ?? 0} table{tableCount !== 1 ? 's' : ''} configured
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Placeholders — filled in later milestones */}
        <div className="rounded-lg border border-dashed border-border bg-card p-6">
          <p className="text-sm font-medium text-muted-foreground">Active Sessions</p>
          <p className="mt-2 font-heading text-3xl font-bold text-foreground">—</p>
          <p className="mt-1 text-xs text-muted-foreground">Session management in M8</p>
        </div>
        <div className="rounded-lg border border-dashed border-border bg-card p-6">
          <p className="text-sm font-medium text-muted-foreground">Pending Orders</p>
          <p className="mt-2 font-heading text-3xl font-bold text-foreground">—</p>
          <p className="mt-1 text-xs text-muted-foreground">Order management in M9</p>
        </div>
        <div className="rounded-lg border border-dashed border-border bg-card p-6">
          <p className="text-sm font-medium text-muted-foreground">Notifications</p>
          <p className="mt-2 font-heading text-3xl font-bold text-foreground">—</p>
          <p className="mt-1 text-xs text-muted-foreground">Realtime in M11</p>
        </div>
      </div>

      {(isAdmin || canManageTables || canManageMenu) && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Setup</h2>
          <div className="flex flex-wrap gap-3">
            {canManageTables && (
              <Link href="/operations/admin/tables" className="rounded-md border border-border bg-card px-4 py-2 text-sm text-foreground hover:border-primary/50">
                Manage Tables →
              </Link>
            )}
            {canManageMenu && (
              <Link href="/operations/admin/menu" className="rounded-md border border-border bg-card px-4 py-2 text-sm text-foreground hover:border-primary/50">
                Manage Menu →
              </Link>
            )}
            {isAdmin && (
              <Link href="/operations/admin/settings" className="rounded-md border border-border bg-card px-4 py-2 text-sm text-foreground hover:border-primary/50">
                Restaurant Settings →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
