import { Spinner } from './Spinner'

type Props = {
  /** e.g. "2 symbols" */
  countLabel: string
  /** Items still rendering (0 = all ready) */
  pending: number
  total: number
  /** "40%" while zipping/optimizing */
  progress: string | null
  /** Why export is not possible right now (shown next to the button) */
  blocker: string | null
  onClick: () => void
}

/** Export button that shows its own state: rendering → ready → optimizing. */
export function ExportButton({ countLabel, pending, total, progress, blocker, onClick }: Props) {
  const busy = pending > 0
  return (
    <div className="flex items-center gap-2">
      {blocker && !busy ? <span className="text-[10px] text-red-500">{blocker}</span> : null}
      <button
        type="button"
        disabled={busy || !!progress || !!blocker}
        onClick={onClick}
        className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-accent-dim disabled:cursor-default disabled:bg-accent/70 disabled:shadow-none"
      >
        {progress ? (
          <>
            <Spinner size={12} className="!border-white/40 !border-t-white" />
            Optimizing {progress}
          </>
        ) : busy ? (
          <>
            <Spinner size={12} className="!border-white/40 !border-t-white" />
            Rendering {total - pending}/{total}
          </>
        ) : (
          <>
            <svg viewBox="0 0 24 24" className="size-3.5" fill="none" aria-hidden>
              <path
                d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Download ZIP
            {/* Narrow screens: keep it on the row with the project controls */}
            <span className="hidden sm:inline">· {countLabel}</span>
          </>
        )}
      </button>
    </div>
  )
}
