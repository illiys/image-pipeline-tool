import { useEffect, useRef, useState } from 'react'
import { DropTarget } from './DropTarget'
import { ScrollArea } from './ScrollArea'
import { Spinner } from './Spinner'

export type ListItem = {
  /** Unique key */
  name: string
  title: string
  /** Second line (e.g. the source file name), hidden when equal to title */
  subtitle?: string
}

type Props = {
  heading: string
  items: ListItem[]
  selectedName: string | null
  pendingNames: Set<string>
  errorNames: Set<string>
  /** item name → problem with its id/file name (shown red) */
  problems: Map<string, string>
  onSelect: (name: string) => void
  onRemove: (name: string) => void
  /** Files dropped on the list or picked with + */
  onFiles: (files: File[]) => void
  accept: string
  uploading: boolean
  onClear: () => void
}

export function SymbolList({
  heading,
  items,
  selectedName,
  pendingNames,
  errorNames,
  problems,
  onSelect,
  onRemove,
  onFiles,
  accept,
  uploading,
  onClear,
}: Props) {
  return (
    <DropTarget
      onFiles={onFiles}
      accept={accept}
      className="flex max-h-[45vh] min-h-0 flex-col gap-1 rounded-lg md:max-h-none md:min-h-32 md:flex-1 border border-border bg-surface-elevated p-1 transition-colors"
      activeClassName="!border-accent bg-accent/10"
    >
      {({ openFiles, openFolder }) => (
        <nav className="flex min-h-0 flex-1 flex-col gap-1" aria-label={heading}>
          <div className="flex shrink-0 items-center gap-1 px-1">
            <p className="flex-1 text-[10px] font-medium uppercase tracking-wide text-muted">
              {heading} · {items.length}
            </p>
            {uploading ? <Spinner size={10} /> : null}
            <AddMenu onFiles={openFiles} onFolder={openFolder} />
            <button
              type="button"
              onClick={onClear}
              title="Remove all"
              aria-label="Remove all"
              className="flex size-5 items-center justify-center rounded text-muted hover:bg-red-50 hover:text-red-600"
            >
              <svg viewBox="0 0 24 24" className="size-3.5" fill="none" aria-hidden>
                <path
                  d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
          <ScrollArea>
            <ul className="flex flex-col">
              {items.map((item) => {
                const active = item.name === selectedName
                const problem = problems.get(item.name)
                return (
                  <li key={item.name}>
                    <div
                      className={`group flex items-stretch rounded ${
                        active ? 'bg-accent/10' : 'hover:bg-surface'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelect(item.name)}
                        title={item.subtitle ?? item.title}
                        className={`flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-0.5 text-left font-mono text-[10px] leading-4 ${
                          active ? 'text-accent' : 'text-muted hover:text-foreground'
                        }`}
                      >
                        {pendingNames.has(item.name) ? <Spinner size={10} /> : null}
                        {errorNames.has(item.name) ? (
                          <span className="text-red-500" title="Render failed">
                            !
                          </span>
                        ) : null}
                        <span className={`shrink-0 ${problem ? 'text-red-500' : ''}`} title={problem}>
                          {item.title}
                        </span>
                        {item.subtitle && item.subtitle !== item.title ? (
                          <span className="min-w-0 truncate text-[9px] opacity-60">{item.subtitle}</span>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemove(item.name)}
                        aria-label={`Remove ${item.title}`}
                        title="Remove"
                        className="px-1.5 text-[10px] text-muted opacity-0 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </ScrollArea>
        </nav>
      )}
    </DropTarget>
  )
}

/**
 * One "+" for both pickers: the browser dialog can pick either files or a folder,
 * never both (drag-and-drop accepts both at once).
 */
function AddMenu({ onFiles, onFolder }: { onFiles: () => void; onFolder: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  const item = 'block w-full px-3 py-1 text-left text-[11px] hover:bg-accent/10 hover:text-accent'
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Add files or a folder (or drop them on this list)"
        aria-label="Add"
        aria-expanded={open}
        className="flex size-5 items-center justify-center rounded text-[15px] leading-none text-muted hover:bg-accent/10 hover:text-accent"
      >
        +
      </button>
      {open ? (
        <div className="absolute right-0 top-6 z-10 min-w-28 overflow-hidden rounded-md border border-border bg-surface-elevated py-1 shadow-md">
          <button
            type="button"
            className={item}
            onClick={() => {
              setOpen(false)
              onFiles()
            }}
          >
            Files…
          </button>
          <button
            type="button"
            className={item}
            onClick={() => {
              setOpen(false)
              onFolder()
            }}
          >
            Folder…
          </button>
        </div>
      ) : null}
    </div>
  )
}
