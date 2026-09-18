import { useCallback, useEffect, useMemo, useState } from 'react'
import { AssetList } from './components/AssetList'
import { FileDropzone } from './components/FileDropzone'
import { ModuleCard } from './components/ModuleCard'
import { PreviewPanel } from './components/PreviewPanel'
import { presets } from './config/presets'
import { useDebouncedValue } from './hooks/useDebouncedValue'
import { usePipelineState } from './hooks/usePipelineState'
import { downloadAllAsZip, downloadBlob } from './lib/download'
import {
  loadFilesAsItems,
  processOne,
  revokeLoaded,
  revokeLoadedItem,
  revokeProcessed,
  revokeProcessedItem,
} from './lib/processQueue'
import type { LoadedImageItem, ProcessedItem } from './core/types'

function App() {
  const {
    modules,
    release,
    presetId,
    applyPreset,
    runtime,
    setModuleEnabled,
    setModuleParam,
    resetModuleToPreset,
  } = usePipelineState()

  const [loaded, setLoaded] = useState<LoadedImageItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [processed, setProcessed] = useState<ProcessedItem[]>([])
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const debouncedRuntime = useDebouncedValue(runtime, 120)

  const selected = useMemo(
    () => loaded.find((i) => i.id === selectedId) ?? loaded[0] ?? null,
    [loaded, selectedId],
  )

  const selectedProcessed = useMemo(
    () => processed.find((p) => p.id === selected?.id) ?? null,
    [processed, selected],
  )

  const addFiles = useCallback((files: File[]) => {
    setError(null)
    void loadFilesAsItems(files).then((items) => {
      setLoaded((prev) => {
        const map = new Map(prev.map((i) => [i.id, i]))
        for (const item of items) map.set(item.id, item)
        return Array.from(map.values())
      })
      if (!selectedId && items[0]) setSelectedId(items[0].id)
    })
  }, [selectedId])

  const clearAll = useCallback(() => {
    revokeLoaded(loaded)
    revokeProcessed(processed)
    setLoaded([])
    setProcessed([])
    setSelectedId(null)
  }, [loaded, processed])

  const removeAsset = useCallback(
    (id: string) => {
      const item = loaded.find((i) => i.id === id)
      const proc = processed.find((p) => p.id === id)
      if (item) revokeLoadedItem(item)
      if (proc) revokeProcessedItem(proc)

      const nextLoaded = loaded.filter((i) => i.id !== id)
      setLoaded(nextLoaded)
      setProcessed((prev) => prev.filter((p) => p.id !== id))

      if (selectedId === id) {
        const idx = loaded.findIndex((i) => i.id === id)
        const next = nextLoaded[idx] ?? nextLoaded[idx - 1] ?? null
        setSelectedId(next?.id ?? null)
      }
    },
    [loaded, processed, selectedId],
  )

  useEffect(() => {
    if (!loaded.length) {
      setProcessed([])
      return
    }

    let cancelled = false
    setProcessing(true)
    setError(null)

    void (async () => {
      try {
        const next: ProcessedItem[] = []
        for (const item of loaded) {
          if (cancelled) return
          const result = await processOne(item, modules, debouncedRuntime)
          next.push(result)
        }
        if (cancelled) {
          revokeProcessed(next)
          return
        }
        setProcessed((prev) => {
          revokeProcessed(prev)
          return next
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Processing failed')
      } finally {
        if (!cancelled) setProcessing(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [loaded, modules, debouncedRuntime])

  useEffect(() => {
    return () => {
      revokeLoaded(loaded)
      revokeProcessed(processed)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup on unmount only
  }, [])

  return (
    <div className="mx-auto max-w-6xl px-3 py-4 sm:px-4">
      <header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-base font-semibold text-foreground">Image Pipeline</h1>
        <span className="text-[10px] font-mono text-muted">v{release.version}</span>
        <select
          value={presetId}
          onChange={(e) => applyPreset(e.target.value)}
          className="ml-auto max-w-[200px] rounded-md border border-border bg-surface-elevated px-2 py-1 text-xs text-foreground"
          title={presets.find((p) => p.id === presetId)?.description}
        >
          {presets.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button
          type="button"
          disabled={!selectedProcessed || processing}
          onClick={() => {
            if (!selectedProcessed) return
            downloadBlob(selectedProcessed.blob, selectedProcessed.name)
          }}
          className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40 hover:bg-accent-dim"
        >
          Download
        </button>
        <button
          type="button"
          disabled={processed.length === 0 || processing}
          onClick={() => void downloadAllAsZip(processed)}
          className="rounded-md border border-border bg-surface-elevated px-2.5 py-1 text-xs text-foreground disabled:opacity-40 hover:bg-surface"
        >
          ZIP
        </button>
      </header>

      <div className="grid gap-3 lg:grid-cols-[1fr_240px]">
        <div className="space-y-2 min-w-0">
          <FileDropzone
            onFiles={addFiles}
            fileCount={loaded.length}
            onClear={clearAll}
          />

          {loaded.length > 0 && selected ? (
            <div className="flex min-w-0 flex-col gap-2 md:relative md:pl-[13rem]">
              <div className="w-full shrink-0 md:absolute md:inset-y-0 md:left-0 md:w-[12.5rem]">
                <AssetList
                  items={loaded}
                  selectedId={selected.id}
                  onSelect={setSelectedId}
                  onRemove={removeAsset}
                />
              </div>
              <PreviewPanel
                beforeUrl={selected.objectUrl}
                afterUrl={selectedProcessed?.previewUrl ?? null}
                fileName={selected.name}
                width={selected.width}
                height={selected.height}
                processing={processing}
              />
            </div>
          ) : null}

          {error ? (
            <p className="text-[11px] text-red-400" role="alert">{error}</p>
          ) : null}
        </div>

        <aside className="space-y-2 lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto">
          {modules.map((mod) => {
            const state = runtime.find((r) => r.moduleId === mod.id)
            if (!state) return null
            return (
              <ModuleCard
                key={mod.id}
                module={mod}
                state={state}
                onToggle={(en) => setModuleEnabled(mod.id, en)}
                onParam={(key, v) => setModuleParam(mod.id, key, v)}
                onReset={() => resetModuleToPreset(mod.id)}
              />
            )
          })}
        </aside>
      </div>
    </div>
  )
}

export default App
