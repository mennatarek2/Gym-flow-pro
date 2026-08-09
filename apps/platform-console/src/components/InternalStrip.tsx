export function InternalStrip() {
  return (
    <div
      role="banner"
      className="sticky top-0 z-50 flex items-center justify-between gap-3 border-b border-slate-800 bg-[var(--strip)] px-4 py-2 text-xs tracking-wide text-slate-300"
    >
      <span className="font-semibold text-sky-300">GymFlow Platform Console — Internal Tool</span>
      <span className="hidden sm:inline text-slate-500">Not the customer product · Cross-tenant billing visibility</span>
    </div>
  )
}
