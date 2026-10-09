import { useCallback, useEffect, useRef, useState } from 'react'
import { ConfirmDialog, type ConfirmRequest } from './components/ConfirmDialog'
import { APP_VERSION } from './config/release'
import { loadSettings, RASTER_SETTINGS_KEY, saveSettings } from './config/settings'
import type { GlobalSettings } from './core/types'
import { PROJECT_EXT } from './lib/project'
import { RasterTool } from './tools/RasterTool'
import { useRasterImages } from './tools/useRasterImages'
import { cleanTitleTyping } from './lib/projectTitle'
import { Workspace, type WorkspaceApi, type WorkspaceMeta } from './Workspace'

type Mode = 'spine' | 'blur' | 'history'

const MODES: { id: Mode; label: string; title: string }[] = [
  { id: 'spine', label: 'Spine → all', title: 'Spine exports → animations, static, blur, history' },
  { id: 'blur', label: 'Static → Blur', title: 'Static images → blur versions' },
  { id: 'history', label: 'Static → History', title: 'Static images → history symbols' },
]

const MODE_KEY = 'spine-symbol-export.mode'

function loadMode(): Mode {
  try {
    const m = localStorage.getItem(MODE_KEY)
    if (MODES.some((x) => x.id === m)) return m as Mode
  } catch {
    /* storage unavailable */
  }
  return 'spine'
}

/** Binds a tab id into stable callbacks for its Workspace. */
function WorkspaceTab({
  id,
  onApi,
  onMeta,
  ...rest
}: Omit<Parameters<typeof Workspace>[0], 'apiRef' | 'onMetaChange'> & {
  id: TabId
  onApi: (id: TabId, api: WorkspaceApi | null) => void
  onMeta: (id: TabId, meta: WorkspaceMeta) => void
}) {
  const apiRef = useCallback((api: WorkspaceApi | null) => onApi(id, api), [id, onApi])
  const onMetaChange = useCallback((meta: WorkspaceMeta) => onMeta(id, meta), [id, onMeta])
  return <Workspace {...rest} apiRef={apiRef} onMetaChange={onMetaChange} />
}

/** Inline tab rename: Enter/blur saves, Escape cancels (onDone(null)). */
function TabTitleInput({ value, onDone }: { value: string; onDone: (title: string | null) => void }) {
  const [text, setText] = useState(value)
  // Escape unmounts the input, which can still fire blur: only the first finish counts.
  const finished = useRef(false)
  const finish = (t: string | null) => {
    if (finished.current) return
    finished.current = true
    onDone(t)
  }
  return (
    <input
      autoFocus
      value={text}
      onChange={(e) => setText(cleanTitleTyping(e.target.value))}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish(text)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(text)
        if (e.key === 'Escape') finish(null)
      }}
      size={Math.max(8, text.length + 1)}
      className="rounded border border-accent bg-surface-elevated px-1 font-mono text-[11px] text-foreground outline-none"
    />
  )
}

/** Tab ids are random: a module-level counter restarts on hot reload and would reuse live ids. */
type TabId = string
const newId = (): TabId => crypto.randomUUID()

/**
 * Spine mode: project tabs, each an independent Workspace (kept mounted while hidden).
 * Static → Blur / History: one shared, project-less tool.
 */
function App() {
  const [mode, setMode] = useState<Mode>(loadMode)
  const [tabs, setTabs] = useState<TabId[]>(() => [newId()])
  const [activeId, setActiveId] = useState(tabs[0])
  const [metas, setMetas] = useState<Record<TabId, WorkspaceMeta>>({})
  const [projectSlot, setProjectSlot] = useState<HTMLDivElement | null>(null)
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  /** Tab whose title is being edited */
  const [renaming, setRenaming] = useState<TabId | null>(null)
  const apis = useRef(new Map<TabId, WorkspaceApi>())
  /** Files to open once a freshly added workspace has mounted */
  const pendingOpen = useRef(new Map<TabId, File>())
  const openInput = useRef<HTMLInputElement>(null)
  /** Static → Blur / History: one shared, project-less image list with its own settings */
  const rasterImages = useRasterImages()
  const [rasterSettings, setRasterSettings] = useState<GlobalSettings>(() => loadSettings(RASTER_SETTINGS_KEY))
  useEffect(() => saveSettings(rasterSettings, RASTER_SETTINGS_KEY), [rasterSettings])
  const onRasterSettingChange = (key: keyof GlobalSettings, value: number) =>
    setRasterSettings((prev) => ({ ...prev, [key]: value }))
  const spineMode = mode === 'spine'

  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode)
    } catch {
      /* storage unavailable */
    }
  }, [mode])

  // Closing/reloading the page asks first while something would be lost: unsaved
  // changes in a project, or static images (they are never saved).
  const anyDirty =
    Object.values(metas).some((m) => m.dirty) || rasterImages.items.length > 0
  /** Set once the user confirmed a reload in our dialog, so the browser does not ask again */
  const unloadConfirmed = useRef(false)
  useEffect(() => {
    if (!anyDirty) return
    // The browser's own prompt: the only option for its reload button and for closing the tab.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (unloadConfirmed.current) return
      e.preventDefault()
      // Safari and older Chrome show the prompt only when returnValue is set.
      e.returnValue = ''
    }
    // Reload shortcuts can be intercepted, so they get the in-page dialog instead.
    const onKeyDown = (e: KeyboardEvent) => {
      const reload = e.key === 'F5' || (e.code === 'KeyR' && (e.metaKey || e.ctrlKey) && !e.altKey)
      if (!reload) return
      e.preventDefault()
      if (e.repeat) return
      setConfirm({
        title: 'Reload the page?',
        message: 'Unsaved project changes and loaded static images will be lost.',
        confirmLabel: 'Discard and reload',
        onConfirm: () => {
          unloadConfirmed.current = true
          window.location.reload()
        },
      })
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [anyDirty])

  const onMeta = useCallback((id: TabId, meta: WorkspaceMeta) => {
    setMetas((prev) => {
      const old = prev[id]
      if (old && old.title === meta.title && old.dirty === meta.dirty && old.hasContent === meta.hasContent) {
        return prev
      }
      return { ...prev, [id]: meta }
    })
  }, [])

  const onApi = useCallback((id: TabId, api: WorkspaceApi | null) => {
    if (!api) {
      apis.current.delete(id)
      return
    }
    apis.current.set(id, api)
    const file = pendingOpen.current.get(id)
    if (file) {
      pendingOpen.current.delete(id)
      void api.open(file)
    }
  }, [])

  /** Each project opens in its own tab; an empty, untouched active tab is reused first. */
  const openProjects = useCallback(
    (files: File[]) => {
      if (files.length === 0) return
      const queue = [...files]
      const active = metas[activeId]
      if (active && !active.hasContent && !active.dirty && active.title === 'Untitled') {
        void apis.current.get(activeId)?.open(queue.shift()!)
      }
      if (queue.length === 0) return
      const ids = queue.map((file) => {
        const id = newId()
        pendingOpen.current.set(id, file)
        return id
      })
      setTabs((prev) => [...prev, ...ids])
      setActiveId(ids[ids.length - 1])
    },
    [metas, activeId],
  )

  const newTab = () => {
    const id = newId()
    setTabs((prev) => [...prev, id])
    setActiveId(id)
  }

  const closeTab = (id: TabId) => {
    const doClose = () => {
      apis.current.get(id)?.dispose()
      // Computed outside state updaters: they must stay pure (StrictMode runs them twice).
      const idx = tabs.indexOf(id)
      const rest = tabs.filter((t) => t !== id)
      if (rest.length === 0) {
        const fresh = newId()
        setTabs([fresh])
        setActiveId(fresh)
      } else {
        setTabs(rest)
        if (id === activeId) setActiveId(rest[Math.min(idx, rest.length - 1)])
      }
      setMetas((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
    const meta = metas[id]
    if (!meta?.dirty) return doClose()
    setConfirm({
      title: `Close "${meta.title}"?`,
      message: 'Its unsaved changes will be lost. Save first if you need them.',
      confirmLabel: 'Discard and close',
      onConfirm: doClose,
    })
  }

  return (
    <div className="mx-auto max-w-[2400px] px-3 py-4 sm:px-4 md:flex md:h-svh md:flex-col">
      {/*
        Below lg: row 1 = title + modes, row 2 = project controls + export (fixed height,
        so the export button appearing/disappearing moves nothing). lg+: one row.
      */}
      <header className="mb-2 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="order-1 text-base font-semibold">Spine Symbol Export</h1>
        <span className="order-1 font-mono text-[10px] text-muted">v{APP_VERSION}</span>
        <div className="order-3 basis-full lg:hidden" aria-hidden />
        <button
          type="button"
          onClick={() => openInput.current?.click()}
          className={`order-4 rounded-md border border-border px-2 py-1 text-[11px] text-muted hover:border-accent hover:text-accent lg:order-2 ${
            spineMode ? '' : 'hidden'
          }`}
          title={`Open ${PROJECT_EXT} projects — each in its own tab (or drop them on the Spine drop zone)`}
        >
          Open…
        </button>
        <input
          ref={openInput}
          type="file"
          accept={PROJECT_EXT}
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            e.target.value = ''
            openProjects(files)
          }}
        />
        {/* The active project puts its title / Save / status here */}
        <div
          ref={setProjectSlot}
          className={`order-4 flex min-w-0 items-center gap-1.5 text-[11px] lg:order-2 ${spineMode ? '' : 'hidden'}`}
        />
        {/* The active tool puts its export button here */}
        <div ref={setActionsSlot} className="order-5 ml-auto flex min-h-7 items-center lg:order-3" />
        <nav
          className="order-2 flex w-full rounded-lg border border-border bg-surface-elevated p-0.5 sm:ml-auto sm:w-auto lg:order-4 lg:ml-0"
          aria-label="Mode"
        >
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              title={m.title}
              onClick={() => setMode(m.id)}
              className={`flex-1 whitespace-nowrap rounded-md px-2.5 py-1 text-xs sm:flex-none ${
                mode === m.id ? 'bg-accent text-white' : 'text-muted hover:text-foreground'
              }`}
            >
              {m.label}
            </button>
          ))}
        </nav>
      </header>

      <nav
        className={`mb-3 flex shrink-0 items-end gap-0.5 overflow-x-auto border-b border-border ${
          spineMode ? '' : 'hidden'
        }`}
        aria-label="Projects"
      >
        {tabs.map((id) => {
          const meta = metas[id]
          const isActive = id === activeId
          return (
            <div
              key={id}
              className={`group flex h-[26px] max-w-56 shrink-0 items-center gap-1 rounded-t-md border border-b-0 px-2 text-[11px] ${
                isActive
                  ? '-mb-px border-border bg-surface-elevated text-foreground'
                  : 'border-transparent text-muted hover:text-foreground'
              }`}
            >
              {renaming === id ? (
                <TabTitleInput
                  value={meta?.title ?? 'Untitled'}
                  onDone={(t) => {
                    if (t != null) apis.current.get(id)?.rename(t)
                    setRenaming(null)
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setActiveId(id)}
                  onDoubleClick={() => {
                    setActiveId(id)
                    setRenaming(id)
                  }}
                  title="Double-click to rename (the name is used when saving)"
                  className="flex min-w-0 items-center gap-1"
                >
                  <span className="truncate font-mono">{meta?.title ?? 'Untitled'}</span>
                  {meta?.dirty ? (
                    <span className="text-amber-600" title="Unsaved changes">
                      ●
                    </span>
                  ) : null}
                </button>
              )}
              <button
                type="button"
                onClick={() => closeTab(id)}
                aria-label={`Close ${meta?.title ?? 'project'}`}
                title="Close project"
                className={`rounded px-0.5 leading-none hover:bg-red-50 hover:text-red-600 ${
                  isActive ? '' : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                ×
              </button>
            </div>
          )
        })}
        <button
          type="button"
          onClick={newTab}
          title="New project"
          aria-label="New project"
          className="flex h-[26px] w-7 shrink-0 items-center justify-center rounded-t-md text-muted hover:bg-surface-elevated/70 hover:text-foreground"
        >
          <svg viewBox="0 0 16 16" className="size-3" fill="none" aria-hidden>
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </nav>

      {tabs.map((id) => (
        <WorkspaceTab
          key={id}
          id={id}
          active={spineMode && id === activeId}
          projectSlot={projectSlot}
          actionsSlot={actionsSlot}
          onApi={onApi}
          onMeta={onMeta}
          onOpenProjects={openProjects}
        />
      ))}
      <RasterTool
        kind="blur"
        images={rasterImages}
        settings={rasterSettings}
        onSettingChange={onRasterSettingChange}
        hidden={mode !== 'blur'}
        actionsSlot={actionsSlot}
      />
      <RasterTool
        kind="history"
        images={rasterImages}
        settings={rasterSettings}
        onSettingChange={onRasterSettingChange}
        hidden={mode !== 'history'}
        actionsSlot={actionsSlot}
      />
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  )
}

export default App
