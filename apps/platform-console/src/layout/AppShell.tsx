import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { ToastHost } from '@/components/ToastHost'
import { ImpersonationSessionBanner } from '@/components/ImpersonationSessionBanner'
import { InternalStrip } from '@/components/InternalStrip'
import { visibleNavItems } from '@/config/nav'
import { useAuthStore } from '@/stores/auth-store'
import { useUiStore } from '@/stores/ui-store'

function crumbKey(pathname: string): string {
  if (pathname.startsWith('/gyms')) return 'nav.gyms'
  if (pathname.startsWith('/sales')) return 'nav.gyms'
  if (pathname.startsWith('/support') || pathname.startsWith('/ops-playbooks')) return 'nav.inbox'
  if (pathname.startsWith('/settings') || pathname.startsWith('/platform-users') || pathname.startsWith('/plans') || pathname.startsWith('/metrics') || pathname.startsWith('/audit') || pathname.startsWith('/catalog')) {
    return 'nav.platformAdmin'
  }
  if (pathname.startsWith('/customers')) return 'nav.gyms'
  if (pathname.startsWith('/tenants')) return 'nav.gyms'
  if (pathname.startsWith('/local-licenses')) return 'nav.gyms'
  return 'nav.gyms'
}

export function AppShell() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const banner = useUiStore((s) => s.banner)
  const collapsed = useUiStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const locale = useUiStore((s) => s.locale)
  const toggleLocale = useUiStore((s) => s.toggleLocale)
  const applyDocumentDirection = useUiStore((s) => s.applyDocumentDirection)
  const t = useUiStore((s) => s.t)
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const items = visibleNavItems(user?.role)

  useEffect(() => {
    applyDocumentDirection()
  }, [locale, applyDocumentDirection])

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  const initials =
    (user?.fullName ?? 'P')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('') || 'P'

  const sidebarWidth = collapsed ? 'w-[4.25rem]' : 'w-[15.5rem]'

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--text)]">
      <InternalStrip />
      <ImpersonationSessionBanner />
      {banner ? (
        <div role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {banner}
        </div>
      ) : null}
      <div className="flex min-h-[calc(100vh-2.5rem)]">
        {mobileOpen ? (
          <button
            type="button"
            className="fixed inset-0 z-30 bg-black/40 md:hidden"
            aria-label={t('common.close')}
            onClick={() => setMobileOpen(false)}
          />
        ) : null}
        <aside
          className={`flex shrink-0 flex-col border-e border-[var(--sidebar-border)] bg-[var(--sidebar)] text-[var(--sidebar-text)] ${sidebarWidth} ${
            mobileOpen ? 'fixed inset-y-0 start-0 z-40 md:static' : 'hidden md:flex'
          } md:flex`}
        >
          <div className="flex items-center gap-3 border-b border-[var(--sidebar-border)] px-3 py-4">
            <div className="grid h-8 w-8 place-items-center rounded-[var(--radius)] bg-[var(--accent)] text-xs font-bold text-white">
              H
            </div>
            {!collapsed ? (
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-white">{t('shell.brand')}</div>
                <div className="text-[11px] text-slate-500">{t('shell.product')}</div>
              </div>
            ) : null}
            <button
              type="button"
              onClick={toggleSidebar}
              className="hidden rounded px-2 py-1 text-xs text-slate-400 hover:bg-white/5 hover:text-white md:inline"
              aria-label={collapsed ? t('common.expandSidebar') : t('common.collapseSidebar')}
            >
              {collapsed ? '»' : '«'}
            </button>
          </div>
          <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2" aria-label={t('shell.navAria')}>
            {items.map((item) => {
              const Icon = item.icon
              const label = t(item.labelKey)
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  title={label}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 rounded-[var(--radius)] px-2.5 py-2 text-[13.5px] font-semibold ${
                      isActive ? 'bg-[var(--accent)] text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'
                    }`
                  }
                >
                  <Icon size={16} aria-hidden />
                  {!collapsed ? <span className="truncate">{label}</span> : null}
                </NavLink>
              )
            })}
          </nav>
          <div className="flex flex-col gap-2 border-t border-[var(--sidebar-border)] p-3">
            <button
              type="button"
              onClick={toggleLocale}
              className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/5"
            >
              {locale === 'en' ? t('common.switchToAr') : t('common.switchToEn')}
            </button>
            <div className="flex items-center gap-2.5">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-800 text-[11px] font-bold text-white">
                {initials}
              </div>
              {!collapsed ? (
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold text-white">{user?.fullName}</div>
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
                {collapsed ? t('shell.signOutShort') : t('auth.logout')}
              </button>
            </div>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-[var(--border)] bg-white px-4 md:px-6">
            <button
              type="button"
              className="cp-btn cp-btn-ghost md:hidden"
              onClick={() => setMobileOpen(true)}
            >
              {t('common.menu')}
            </button>
            <nav className="flex flex-wrap items-center gap-1.5 text-[13px] text-[var(--text-muted)]" aria-label={t('shell.breadcrumb')}>
              <span className="font-semibold text-[var(--accent)]">{t('shell.product')}</span>
              <span className="text-[var(--text-faint)]">/</span>
              <span className="font-semibold text-[var(--text)]">{t(crumbKey(location.pathname))}</span>
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
