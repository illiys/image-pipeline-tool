import { DropTarget } from './DropTarget'
import { Spinner } from './Spinner'

type Props = {
  onFiles: (files: File[]) => void
  accept: string
  busy: boolean
  title: string
  hint: string
  /** Upload errors, shown inside the zone so it keeps its full-screen size */
  messages?: string[]
}

/** Full-screen drop area shown before anything is loaded. */
export function FileDropzone({ onFiles, accept, busy, title, hint, messages = [] }: Props) {
  return (
    <DropTarget
      onFiles={onFiles}
      accept={accept}
      className="rounded-xl border-2 border-dashed border-border bg-surface-elevated transition-colors hover:border-zinc-400 md:min-h-0 md:flex-1"
      activeClassName="!border-accent bg-accent/10"
    >
      {({ openFiles, openFolder }) => (
        <div
          role="button"
          tabIndex={0}
          onClick={openFiles}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') openFiles()
          }}
          className="flex min-h-[calc(100svh-6rem)] cursor-pointer md:h-full md:min-h-0 flex-col items-center justify-center gap-2 px-4 text-center"
        >
          {busy ? (
            <p className="flex items-center gap-2 text-sm">
              <Spinner size={16} /> Reading files…
            </p>
          ) : (
            <>
              <svg viewBox="0 0 48 48" className="size-12 text-muted" fill="none" aria-hidden>
                <path d="M24 30V8M15 17l9-9 9 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M8 30v8a2 2 0 0 0 2 2h28a2 2 0 0 0 2-2v-8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
              <p className="text-base font-medium">{title}</p>
              <p className="text-xs text-muted">{hint}</p>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  openFolder()
                }}
                className="mt-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-accent"
              >
                Choose a folder…
              </button>
            </>
          )}
          {messages.length > 0 ? (
            <ul className="mt-2 max-w-xl space-y-0.5 text-[11px] text-red-500" role="alert">
              {messages.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </DropTarget>
  )
}
