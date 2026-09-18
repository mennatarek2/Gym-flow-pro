import { Link } from 'react-router-dom'

export function InternalStrip() {
  return (
    <div
      role="banner"
      className="sticky top-0 z-50 flex items-center justify-between gap-3 border-b border-slate-800 bg-[var(--strip)] px-4 py-2 text-xs tracking-wide text-slate-300"
    >
      <span className="font-semibold text-white">HyMotion Platform — internal</span>
      <span className="flex items-center gap-3">
        <span className="hidden sm:inline text-slate-400">Not the gym product</span>
        <Link to="/oc" className="font-semibold text-white underline-offset-2 hover:underline">
          Operation Center
        </Link>
        <Link to="/gyms" className="text-slate-300 underline-offset-2 hover:underline">
          Admin
        </Link>
        <a href="/design-system.html" className="text-slate-300 underline-offset-2 hover:underline">
          Design System
        </a>
      </span>
    </div>
  )
}
