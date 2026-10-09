import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react'
import { ExportButton } from '../components/ExportButton'
import { FileDropzone } from '../components/FileDropzone'
import { OutputGrid } from '../components/OutputGrid'
import { SettingsPanel } from '../components/SettingsPanel'
import { SpinePreview } from '../components/SpinePreview'
import { SymbolInspector } from '../components/SymbolInspector'
import { SymbolList } from '../components/SymbolList'
import type {
  FrameSize,
  OutputKind,
  RootOffset,
  SpineSymbol,
  SymbolOutputs,
} from '../core/types'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { downloadPng, downloadZip } from '../lib/download'
import { buildExportBundle, symbolIdProblems } from '../lib/exportBundle'
import {
  Cancelled,
  forgetSymbolCache,
  OUTPUT_KINDS,
  outputKeys,
  suggestKey,
  outputPaths,
  outputsAreCurrent,
  renderSymbolOutputs,
  revokeOutputs,
  rootFor,
  sizeFor,
  symbolSlug,
} from '../lib/exportSymbol'
import { releaseSpineSource } from '../spine/renderer'
import { maxFrameIndex } from '../spine/skeletonData'
import { parseSpineUpload, SPINE_UPLOAD_ACCEPT } from '../spine/upload'

import { isProjectFile } from '../lib/project'
import { DEBOUNCE_MS, HeaderActions, ToolMessages, type ToolProps } from './shared'

type SymbolSettingsCopy = Pick<SpineSymbol, 'root' | 'animRoots' | 'size'> & { from: string }

const ZIP_NAME = 'spine-symbols.zip'

/** Revoke images of `next` that `prev` does not share (and vice versa when `next` replaces `prev`). */
function revokeUnshared(drop: SymbolOutputs | undefined, keep: SymbolOutputs | undefined) {
  if (!drop) return
  const kept = new Set(Object.values(keep?.images ?? {}).map((i) => i.url))
  for (const img of Object.values(drop.images)) {
    if (!kept.has(img.url)) URL.revokeObjectURL(img.url)
  }
}

function clampFrame(symbol: SpineSymbol, animationName: string, frame: number): number {
  const anim = symbol.source.animations.find((a) => a.name === animationName)
  if (!anim) return 0
  return Math.min(Math.max(0, Math.round(frame)), maxFrameIndex(anim.duration, symbol.source.fps))
}

/** Spine exports → static (big), blur and history per symbol, plus the animation files. */
/** Lets the app save/open projects without owning the tool's state. */
export type SpineToolApi = {
  snapshot: () => SpineSymbol[]
  load: (symbols: SpineSymbol[]) => void
}

export function SpineTool({
  settings,
  onSettingChange,
  hidden,
  actionsSlot,
  apiRef,
  onOpenProjects,
  onSymbolsChange,
}: ToolProps & {
  apiRef: Ref<SpineToolApi>
  /** Current symbols, for the app's Save button and unsaved-changes tracking */
  onSymbolsChange: (symbols: SpineSymbol[]) => void
  /** Dropped .ssproj files are opened as projects (in tabs) instead of imported */
  onOpenProjects: (files: File[]) => void
}) {
  const [symbols, setSymbolsState] = useState<SpineSymbol[]>([])
  const symbolsRef = useRef(symbols)
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [outputs, setOutputsState] = useState<Record<string, SymbolOutputs>>({})
  const outputsRef = useRef(outputs)
  const [uploading, setUploading] = useState(false)
  const [messages, setMessages] = useState<string[]>([])
  const [exportProgress, setExportProgress] = useState<string | null>(null)

  // Refs are the source of truth for async code; state mirrors them for rendering.
  const setSymbols = useCallback((next: SpineSymbol[]) => {
    symbolsRef.current = next
    setSymbolsState(next)
  }, [])
  const setOutputs = useCallback((next: Record<string, SymbolOutputs>) => {
    outputsRef.current = next
    setOutputsState(next)
  }, [])

  const selected = symbols.find((s) => s.name === selectedName) ?? symbols[0] ?? null
  const selectedRef = useRef<string | null>(null)
  useEffect(() => {
    selectedRef.current = selected?.name ?? null
  })

  const debouncedSymbols = useDebouncedValue(symbols, DEBOUNCE_MS)
  const debouncedSettings = useDebouncedValue(settings, DEBOUNCE_MS)

  // Render stale outputs; the selected symbol goes first. Any newer change cancels this pass.
  useEffect(() => {
    let cancelled = false
    const ordered = [...debouncedSymbols].sort(
      (a, b) => Number(b.name === selectedRef.current) - Number(a.name === selectedRef.current),
    )
    void (async () => {
      for (const symbol of ordered) {
        if (cancelled) return
        const prev = outputsRef.current[symbol.name]
        if (outputsAreCurrent(prev, outputKeys(symbol, debouncedSettings))) continue
        let next: SymbolOutputs
        try {
          next = await renderSymbolOutputs(symbol, debouncedSettings, prev, () => cancelled)
        } catch (e) {
          if (e instanceof Cancelled) return
          throw e
        }
        const stillLoaded = symbolsRef.current.some(
          (s) => s.name === symbol.name && s.source === symbol.source,
        )
        if (cancelled || !stillLoaded) {
          revokeUnshared(next, outputsRef.current[symbol.name])
          if (cancelled) return
          continue
        }
        const current = outputsRef.current[symbol.name]
        revokeUnshared(current, next)
        setOutputs({ ...outputsRef.current, [symbol.name]: next })
      }
    })().catch((e) => {
      setMessages([e instanceof Error ? e.message : String(e)])
    })
    return () => {
      cancelled = true
    }
  }, [debouncedSymbols, debouncedSettings, setOutputs])

  /** Which of a symbol's outputs are stale (e.g. only history while its scale changes). */
  const pendingKindsOf = (symbol: SpineSymbol): Set<OutputKind> => {
    const want = outputKeys(symbol, settings)
    const have = outputs[symbol.name]
    return new Set(OUTPUT_KINDS.filter((k) => have?.keys[k] !== want[k]))
  }

  /** Symbols whose outputs do not match their current settings (live, not debounced). */
  const pendingNames = useMemo(
    () =>
      new Set(
        symbols
          .filter((s) => !outputsAreCurrent(outputs[s.name], outputKeys(s, settings)))
          .map((s) => s.name),
      ),
    [symbols, outputs, settings],
  )
  const errorNames = useMemo(
    () => new Set(symbols.filter((s) => outputs[s.name]?.error).map((s) => s.name)),
    [symbols, outputs],
  )

  const dropSymbolResources = (symbol: SpineSymbol) => {
    releaseSpineSource(symbol.source)
    forgetSymbolCache(symbol.name)
  }

  const addFiles = useCallback(
    async (files: File[]) => {
      const projects = files.filter(isProjectFile)
      if (projects.length > 0) onOpenProjects(projects)
      files = files.filter((f) => !isProjectFile(f))
      if (files.length === 0) return
      setUploading(true)
      setMessages([])
      try {
        const { symbols: parsed, errors } = await parseSpineUpload(files)
        const byName = new Map(symbolsRef.current.map((s) => [s.name, s]))
        for (const p of parsed) {
          const old = byName.get(p.name)
          const animations = p.source.animations
          if (old) {
            // Re-upload: new source, keep the symbol's root/animation/frame where still valid.
            dropSymbolResources(old)
            const animationName = animations.some((a) => a.name === old.animationName)
              ? old.animationName
              : (animations[0]?.name ?? '')
            const animRoots = Object.fromEntries(
              Object.entries(old.animRoots).filter(([a]) => animations.some((x) => x.name === a)),
            )
            const updated = { ...old, source: p.source, animationName, animRoots }
            byName.set(p.name, { ...updated, frame: clampFrame(updated, animationName, old.frame) })
          } else {
            byName.set(p.name, {
              name: p.name,
              key: suggestKey(
                p.name,
                Array.from(byName.values(), (s) => s.key),
              ),
              historyIds: null,
              size: null,
              source: p.source,
              animationName: animations[0]?.name ?? '',
              frame: 0,
              root: { x: 0, y: 0 },
              animRoots: {},
            })
          }
        }
        setSymbols(Array.from(byName.values()))
        if (!selectedRef.current && parsed[0]) setSelectedName(parsed[0].name)
        setMessages(errors)
      } catch (e) {
        setMessages([e instanceof Error ? e.message : 'Upload failed'])
      } finally {
        setUploading(false)
      }
    },
    [setSymbols, onOpenProjects],
  )

  const updateSymbol = useCallback(
    (name: string, patch: (s: SpineSymbol) => SpineSymbol) => {
      setSymbols(symbolsRef.current.map((s) => (s.name === name ? patch(s) : s)))
    },
    [setSymbols],
  )

  const removeSymbols = useCallback(
    (names: Set<string>) => {
      const nextOutputs = { ...outputsRef.current }
      for (const s of symbolsRef.current) {
        if (!names.has(s.name)) continue
        dropSymbolResources(s)
        revokeOutputs(nextOutputs[s.name])
        delete nextOutputs[s.name]
      }
      setOutputs(nextOutputs)
      const remaining = symbolsRef.current.filter((s) => !names.has(s.name))
      const idx = symbolsRef.current.findIndex((s) => s.name === selectedRef.current)
      setSymbols(remaining)
      if (selectedRef.current && names.has(selectedRef.current)) {
        const next = remaining[Math.min(idx, remaining.length - 1)]
        setSelectedName(next?.name ?? null)
      }
    },
    [setOutputs, setSymbols],
  )

  useEffect(() => onSymbolsChange(symbols), [symbols, onSymbolsChange])

  useImperativeHandle(
    apiRef,
    () => ({
      snapshot: () => symbolsRef.current,
      load: (next) => {
        removeSymbols(new Set(symbolsRef.current.map((s) => s.name)))
        setSymbols(next)
        setSelectedName(next[0]?.name ?? null)
        setMessages([])
      },
    }),
    [removeSymbols, setSymbols],
  )

  const setAnimation = (animationName: string) => {
    if (!selected) return
    updateSymbol(selected.name, (s) => ({
      ...s,
      animationName,
      frame: clampFrame(s, animationName, s.frame),
    }))
  }

  /** Edits the current animation's own root if it has one, otherwise the shared root. */
  const setRoot = (root: RootOffset) => {
    if (!selected) return
    updateSymbol(selected.name, (s) =>
      s.animRoots[s.animationName]
        ? { ...s, animRoots: { ...s.animRoots, [s.animationName]: root } }
        : { ...s, root },
    )
  }

  /** Copied symbol settings (root, per-animation roots, own size) */
  const [clipboard, setClipboard] = useState<SymbolSettingsCopy | null>(null)

  const copySettings = () => {
    if (!selected) return
    setClipboard({
      from: selected.name,
      root: { ...selected.root },
      animRoots: structuredClone(selected.animRoots),
      size: selected.size && { ...selected.size },
    })
  }

  /** Per-animation roots are pasted only for animations the target has. */
  const pasteSettings = (names: string[]) => {
    if (!clipboard) return
    const targets = new Set(names)
    setSymbols(
      symbolsRef.current.map((s) => {
        if (!targets.has(s.name)) return s
        const animRoots = Object.fromEntries(
          Object.entries(clipboard.animRoots).filter(([a]) =>
            s.source.animations.some((x) => x.name === a),
          ),
        )
        return {
          ...s,
          root: { ...clipboard.root },
          animRoots,
          size: clipboard.size && { ...clipboard.size },
        }
      }),
    )
  }

  /** Own root for the current animation (starts from the shared root) or back to shared. */
  const setOwnRoot = (own: boolean) => {
    if (!selected) return
    updateSymbol(selected.name, (s) => {
      const animRoots = { ...s.animRoots }
      if (own) animRoots[s.animationName] = { ...s.root }
      else delete animRoots[s.animationName]
      return { ...s, animRoots }
    })
  }

  const exportZip = async () => {
    setExportProgress('0%')
    try {
      await downloadZip(buildExportBundle(symbols, outputs), ZIP_NAME, (done, total) =>
        setExportProgress(`${Math.round((done / total) * 100)}%`),
      )
    } catch (e) {
      setMessages([e instanceof Error ? e.message : 'Export failed'])
    } finally {
      setExportProgress(null)
    }
  }

  const downloadOne = (kind: OutputKind) => {
    const img = selected && outputs[selected.name]?.images[kind]
    if (!selected || !img) return
    for (const path of outputPaths(selected, kind)) {
      void downloadPng(img.blob, path.slice(path.lastIndexOf('/') + 1))
    }
  }

  const idProblems = useMemo(() => symbolIdProblems(symbols), [symbols])
  const exportBlocker =
    errorNames.size > 0
      ? 'Some symbols failed to render'
      : idProblems.size > 0
        ? 'Fix symbol ids (marked red)'
        : null

  /** Wide screens: symbol settings get their own right column; narrower: above the preview */
  const inspectorAside = useMediaQuery('(min-width: 1024px)')
  const inspector = selected ? (
    <SymbolInspector
      symbol={selected}
      onAnimationChange={setAnimation}
      onFrameChange={(frame) =>
        updateSymbol(selected.name, (s) => ({
          ...s,
          frame: clampFrame(s, s.animationName, frame),
        }))
      }
      onRootChange={setRoot}
      onOwnRootChange={setOwnRoot}
      clipboardFrom={clipboard?.from ?? null}
      onCopy={copySettings}
      onPaste={() => pasteSettings([selected.name])}
      onPasteAll={() => {
        if (window.confirm(`Paste ${clipboard?.from}'s root and size into all ${symbols.length} symbols?`)) {
          pasteSettings(symbols.map((s) => s.name))
        }
      }}
      idProblem={idProblems.get(selected.name) ?? null}
      onKeyChange={(key) => updateSymbol(selected.name, (s) => ({ ...s, key }))}
      onHistoryIdsChange={(historyIds) =>
        updateSymbol(selected.name, (s) => ({ ...s, historyIds }))
      }
      defaultSize={{ width: settings.staticWidth, height: settings.staticHeight }}
      onSizeChange={(size: FrameSize | null) =>
        updateSymbol(selected.name, (s) => ({ ...s, size }))
      }
    />
  ) : null

  /** General settings: under the symbol settings in the right column, else under the list */
  const settingsPanel = (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-1">
      <SettingsPanel settings={settings} onChange={onSettingChange} />
    </div>
  )

  return (
    <div className={hidden ? 'hidden' : 'md:flex md:min-h-0 md:flex-1 md:flex-col'}>

      {symbols.length === 0 ? (
        <FileDropzone
          onFiles={(files) => void addFiles(files)}
          accept={SPINE_UPLOAD_ACCEPT}
          busy={uploading}
          messages={messages}
          title="Drop Spine exports here or click to browse"
          hint="Folders, ZIPs or .json / .skel + .atlas + textures · several symbols at once"
        />
      ) : (
        <>
          <ToolMessages messages={messages} />
          <HeaderActions slot={actionsSlot} hidden={hidden}>
            <ExportButton
              countLabel={`${symbols.length} ${symbols.length === 1 ? 'symbol' : 'symbols'}`}
              pending={pendingNames.size}
              total={symbols.length}
              progress={exportProgress}
              blocker={exportBlocker}
              onClick={() => void exportZip()}
            />
          </HeaderActions>
          {/* Left: symbols, then general settings. Right: the selected symbol. */}
          <div className="grid gap-3 md:min-h-0 md:flex-1 md:grid-cols-[15rem_minmax(0,1fr)] lg:grid-cols-[15rem_minmax(0,1fr)_17rem]">
            <aside className="flex min-w-0 flex-col gap-2 md:min-h-0 md:overflow-y-auto [&>*:not(:first-child)]:shrink-0">
              <SymbolList
                heading="Symbols"
                items={symbols.map((s) => ({
                  name: s.name,
                  title: symbolSlug(s.key),
                  subtitle: s.name,
                }))}
                selectedName={selected?.name ?? null}
                pendingNames={pendingNames}
                errorNames={errorNames}
                problems={idProblems}
                onSelect={setSelectedName}
                onRemove={(name) => removeSymbols(new Set([name]))}
                onFiles={(files) => void addFiles(files)}
                accept={SPINE_UPLOAD_ACCEPT}
                uploading={uploading}
                onClear={() => {
                  if (window.confirm(`Remove all ${symbols.length} symbols?`)) {
                    removeSymbols(new Set(symbols.map((s) => s.name)))
                  }
                }}
              />
              {inspectorAside ? null : settingsPanel}
            </aside>
            {selected ? (
              <main className="flex min-w-0 flex-col gap-2 md:min-h-0 md:overflow-y-auto md:pr-1">
                {inspectorAside ? null : inspector}
                {/* Wide screens: skeleton and outputs side by side */}
                <div className="flex min-w-0 flex-col gap-2 2xl:grid 2xl:grid-cols-2 2xl:items-start">
                  <SpinePreview
                    key={selected.name}
                    symbol={selected}
                    root={rootFor(selected)}
                    frameSize={sizeFor(selected, settings)}
                    cellSize={{ width: settings.cellWidth, height: settings.cellHeight }}
                    onRootChange={setRoot}
                    onFrameChange={(frame) =>
                      updateSymbol(selected.name, (s) => ({
                        ...s,
                        frame: clampFrame(s, s.animationName, frame),
                      }))
                    }
                    onFrameSizeChange={(size) => {
                      // Own size → this symbol only; otherwise the shared default for all symbols.
                      if (selected.size) {
                        updateSymbol(selected.name, (s) => ({ ...s, size }))
                      } else {
                        onSettingChange('staticWidth', Math.min(2048, size.width))
                        onSettingChange('staticHeight', Math.min(2048, size.height))
                      }
                    }}
                  />
                  <OutputGrid
                    outputs={outputs[selected.name]}
                    pendingKinds={pendingKindsOf(selected)}
                    staticWidth={sizeFor(selected, settings).width}
                    staticHeight={sizeFor(selected, settings).height}
                    onDownload={downloadOne}
                  />
                </div>
              </main>
            ) : null}
            {inspectorAside ? (
              <aside className="flex min-w-0 flex-col gap-2 md:min-h-0 md:overflow-y-auto">
                {inspector}
                {settingsPanel}
              </aside>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
