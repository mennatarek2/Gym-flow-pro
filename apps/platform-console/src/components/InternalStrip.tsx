export function InternalStrip() {
  return (
    <div
      role="banner"
      className="sticky top-0 z-50 flex items-center justify-between gap-3 border-b border-gray-200 bg-[var(--strip)] px-4 py-2 text-xs tracking-wide text-gray-700"
    >
      <span className="font-semibold text-blue-600">HyMotion Platform Console — Internal Tool</span>
      <span className="hidden sm:inline text-gray-500">Not the customer product · Cross-tenant billing visibility</span>
    </div>
  )
}
