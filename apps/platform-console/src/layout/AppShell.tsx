import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { InternalStrip } from '@/components/InternalStrip'
import { ToastHost } from '@/components/ToastHost'
import { ImpersonationSessionBanner } from '@/components/ImpersonationSessionBanner'
import { NAV_GROUPS } from '@/config/nav'
import { useAuthStore } from '@/stores/auth-store'
import { useUiStore } from '@/stores/ui-store'

function crumbLabel(pathname: string): string {
  if (pathname.startsWith('/tenants/') && pathname !== '/tenants') return 'Tenant 360'
  if (pathname.startsWith('/tenants')) return 'Tenants'
  if (pathname.startsWith('/trials')) return 'Trials'
  if (pathname.startsWith('/subscriptions')) return 'Subscriptions'
  if (pathname.startsWith('/risk-queue')) return 'Risk Queue'
  if (pathname.startsWith('/usage')) return 'Usage'
  if (pathname.startsWith('/metrics')) return 'Metrics'
  if (pathname.startsWith('/audit')) return 'Audit Log'
  if (pathname.startsWith('/platform-users')) return 'Platform Users'
  if (pathname.startsWith('/plans')) return 'Plans & Pricing'
  if (pathname.startsWith('/overview')) return 'Dashboard'
  return 'Platform'
}

export function AppShell() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const banner = useUiStore((s) => s.banner)
  const collapsed = useUiStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const location = useLocation()
  const initials =
    (user?.fullName ?? 'P')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('') || 'P'

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--text)]">
      <InternalStrip />
      <ImpersonationSessionBanner />
      {banner ? (
        <div
          role="status"
          className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
        >
          {banner}
        </div>
      ) : null}
      <div className="flex min-h-[calc(100vh-2.5rem)]">
        <aside
          className={`flex shrink-0 flex-col border-r border-[var(--sidebar-border)] bg-gradient-to-b from-[var(--sidebar)] to-[var(--sidebar-2)] text-[var(--sidebar-text)] ${
            collapsed ? 'w-[4.25rem]' : 'w-[15.5rem]'
          }`}
        >
          <div className="flex items-center gap-3 border-b border-[var(--sidebar-border)] px-3 py-4">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--accent)] text-xs font-bold text-white">
              GP
            </div>
            {!collapsed ? (
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-white">GymFlow Platform</div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Tenant control plane
                </div>
              </div>
            ) : null}
            <button
              type="button"
              onClick={toggleSidebar}
              className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-white/5 hover:text-white"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? '»' : '«'}
            </button>
          </div>
          <nav className="flex flex-1 flex-col gap-3 overflow-y-auto p-2" aria-label="Primary">
            {NAV_GROUPS.map((group) => (
              <div key={group.label} className="flex flex-col gap-0.5">
                {!collapsed ? (
                  <div className="px-2.5 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    {group.label}
                  </div>
                ) : null}
                {group.items.map((item) => {
                  const Icon = item.icon
                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      title={item.proposed ? `${item.label} (Proposed)` : item.label}
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-[13.5px] font-semibold ${
                          isActive
                            ? 'bg-[var(--accent)] text-white'
                            : 'text-slate-400 hover:bg-white/5 hover:text-white'
                        }`
                      }
                    >
                      <Icon size={16} aria-hidden />
                      {!collapsed ? (
                        <>
                          <span className="truncate">{item.label}</span>
                          {item.proposed ? (
                            <span className="ml-auto rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-amber-300">
                              Soon
                            </span>
                          ) : null}
                        </>
                      ) : null}
                    </NavLink>
                  )
                })}
              </div>
            ))}
          </nav>
          <div className="flex items-center gap-2.5 border-t border-[var(--sidebar-border)] p-3">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-800 text-[11px] font-bold text-white">
              {initials}
            </div>
            {!collapsed ? (
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-bold text-white">{user?.fullName}</div>
                <div className="truncate text-[11px] text-slate-500">{user?.role}</div>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => {
                logout()
                window.location.assign('/login')
              }}
              className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/5"
            >
              {collapsed ? 'Out' : 'Log out'}
            </button>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-[var(--border)] bg-white px-4 md:px-6">
            <nav className="flex flex-wrap items-center gap-1.5 text-[13px] text-[var(--text-muted)]" aria-label="Breadcrumb">
              <span className="font-semibold text-[var(--accent)]">Platform</span>
              <span className="text-[var(--text-faint)]">/</span>
              <span className="font-bold text-[var(--text)]">{crumbLabel(location.pathname)}</span>
            </nav>
          </div>
          <main className="flex-1 overflow-auto p-4 md:p-6">
            <div className="mx-auto max-w-[1280px]">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
      <ToastHost />
    </div>
  )
}
