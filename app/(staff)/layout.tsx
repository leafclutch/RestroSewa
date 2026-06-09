import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAuthUser, hasPermission } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { SignOutButton } from '@/components/staff/sign-out-button'

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthUser()
  if (!user || (user.role !== 'restaurant_admin' && user.role !== 'restaurant_employee')) {
    redirect('/unauthorized')
  }

  let restaurantName = 'Restaurant'
  if (user.restaurantId) {
    const service = createServiceClient()
    const { data } = await service.from('restaurants').select('name').eq('id', user.restaurantId).single()
    if (data) restaurantName = (data as { name: string }).name
  }

  const isAdmin = user.role === 'restaurant_admin'
  const canManageTables = hasPermission(user, 'MANAGE_TABLES')
  const canManageMenu = hasPermission(user, 'MANAGE_MENU')

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-8">
            <span className="font-heading text-base font-semibold text-foreground">{restaurantName}</span>
            <nav className="flex items-center gap-1">
              <Link href="/operations" className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                Dashboard
              </Link>
              {canManageTables && (
                <Link href="/operations/admin/tables" className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  Tables
                </Link>
              )}
              {canManageMenu && (
                <Link href="/operations/admin/menu" className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  Menu
                </Link>
              )}
              {isAdmin && (
                <Link href="/operations/admin/settings" className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  Settings
                </Link>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">{isAdmin ? 'Admin' : user.restaurantUserId}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  )
}
