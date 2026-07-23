/* Small shared building blocks used across pages, so every form field and button
 * looks identical without repeating long Tailwind class strings. */

export function Card({ title, children, action }) {
  return (
    <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between">
          {title && <h2 className="text-lg font-bold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function Button({ children, variant = 'primary', ...props }) {
  const styles = {
    primary:
      'bg-pine text-white hover:bg-pine-dark disabled:bg-line disabled:text-ink-soft',
    subtle:
      'border border-line bg-white text-ink hover:bg-parchment disabled:text-ink-soft',
    danger:
      'bg-ludo-red text-white hover:bg-ludo-red/90 disabled:bg-line disabled:text-ink-soft',
  }
  return (
    <button
      className={`rounded-xl px-4 py-2.5 text-sm font-bold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 ${styles[variant]}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function Field({ label, ...props }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-ink-soft">{label}</span>
      <input
        className="w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-ink outline-none transition-[border-color,box-shadow] focus:border-pine focus:ring-2 focus:ring-pine/15"
        {...props}
      />
    </label>
  )
}

/* Native <select>, restyled to match Field instead of the browser's default
 * dropdown look — appearance-none strips the OS chrome so our border/focus
 * ring/chevron render consistently, while staying a real <select> for
 * accessibility and keyboard/mobile picker support. */
export function Select({ label, children, ...props }) {
  const select = (
    <div className="relative">
      <select
        className="w-full appearance-none rounded-xl border border-line bg-white px-3.5 py-2.5 pr-9 text-sm text-ink outline-none transition-[border-color,box-shadow] focus:border-pine focus:ring-2 focus:ring-pine/15"
        {...props}
      >
        {children}
      </select>
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        aria-hidden="true"
        className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-ink-soft"
      >
        <path d="M2 5l5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
  if (!label) return select
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-ink-soft">{label}</span>
      {select}
    </label>
  )
}

/* Inline destructive-action confirmation — the app-wide pattern for anything
 * irreversible (delete a member, reject a game, end a room, quit a game): no
 * modal, just a red strip appearing in place with an explicit yes/cancel. */
export function ConfirmBar({ message, confirmLabel, onConfirm, onCancel, busy, className = '' }) {
  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-xl border border-ludo-red/30 bg-ludo-red/5 px-4 py-3 ${className}`}
    >
      <p className="text-sm font-semibold text-ink">{message}</p>
      <div className="ml-auto flex gap-2">
        <Button variant="subtle" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="danger" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  )
}

export function Loading() {
  return <p className="text-sm text-ink-soft">Loading…</p>
}

export function ErrorNote({ children }) {
  if (!children) return null
  return (
    <p className="rounded-xl border border-ludo-red/30 bg-ludo-red/5 px-3.5 py-2.5 text-sm font-semibold text-ludo-red">
      {children}
    </p>
  )
}

export function SuccessNote({ children }) {
  if (!children) return null
  return (
    <p className="rounded-xl border border-ludo-green/30 bg-ludo-green/5 px-3.5 py-2.5 text-sm font-semibold text-ludo-green">
      {children}
    </p>
  )
}

export function EmptyState({ children }) {
  return (
    <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-soft">
      {children}
    </p>
  )
}

/* The app mark: a die showing five, its pips in the four Ludo colors around a
 * white center, on warm dark ink. Deliberately not pine-colored — the old green
 * square camouflaged against the app's own green accent. Mirrors
 * public/favicon.svg; change both together. */
export function Logo({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="8" className="fill-ink" />
      <circle cx="9.5" cy="9.5" r="3.2" fill="#e64545" />
      <circle cx="22.5" cy="9.5" r="3.2" fill="#2f9e44" />
      <circle cx="9.5" cy="22.5" r="3.2" fill="#f2b705" />
      <circle cx="22.5" cy="22.5" r="3.2" fill="#2e6fd8" />
      <circle cx="16" cy="16" r="3.2" className="fill-ivory" />
    </svg>
  )
}
