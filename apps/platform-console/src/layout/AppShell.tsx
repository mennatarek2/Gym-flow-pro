import { NavLink, Outlet } from 'react-router-dom'
import { InternalStrip } from '@/components/InternalStrip'
import { ToastHost } from '@/components/ToastHost'
import { ImpersonationSessionBanner } from '@/components/ImpersonationSessionBanner'
import { NAV_ITEMS } from '@/config/nav'
import { useAuthStore } from '@/stores/auth-store'
import { useUiStore } from '@/stores/ui-store'

export function AppShell() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const banner = useUiStore((s) => s.banner)
  const collapsed = useUiStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)

  return (
    <div className="min-h-screen">
      <InternalStrip />
      <ImpersonationSessionBanner />
      {banner ? (
        <div role="status" className="border-b border-amber-800 bg-amber-950/80 px-4 py-2 text-sm text-amber-100">
          {banner}
        </div>
      ) : null}
      <div className="flex min-h-[calc(100vh-2.5rem)]">
        <aside
          className={`flex shrink-0 flex-col border-r border-slate-800 bg-slate-950/80 ${
            collapsed ? 'w-16' : 'w-56'
          }`}
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-3">
            {!collapsed ? (
              <span className="text-sm font-semibold text-sky-300">Platform</span>
            ) : (
              <span className="text-sm font-semibold text-sky-300">P</span>
            )}
            <button
              type="button"
              onClick={toggleSidebar}
              className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-800"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? '»' : '«'}
            </button>
          </div>
          <nav className="flex flex-1 flex-col gap-1 p-2" aria-label="Primary">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) =>
                    `flex items-center gap-2 rounded-[var(--radius)] px-3 py-2 text-sm ${
                      isActive ? 'bg-slate-800 text-sky-300' : 'text-slate-300 hover:bg-slate-900'
                    }`
                  }
                >
                  <Icon size={18} aria-hidden />
                  {!collapsed ? item.label : null}
                </NavLink>
              )
            })}
          </nav>
          <div className="border-t border-slate-800 p-3 text-xs text-slate-400">
            {!collapsed ? (
              <>
                <div className="font-medium text-slate-200">{user?.fullName}</div>
                <div className="mt-0.5">{user?.role}</div>
              </>
            ) : null}
            <button
              type="button"
              onClick={() => {
                logout()
                window.location.assign('/login')
              }}
              className="mt-2 w-full rounded-[var(--radius)] border border-slate-700 px-2 py-1.5 text-left hover:bg-slate-900"
            >
              {collapsed ? 'Out' : 'Log out'}
            </button>
          </div>
        </aside>
        <main className="flex-1 overflow-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
      <ToastHost />
    </div>
  )
}
