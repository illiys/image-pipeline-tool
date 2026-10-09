import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react'
import { ExportButton } from '../components/ExportButton'
import { FileDropzone } from '../components/FileDropzone'
import { OutputGrid } from '../components/OutputGrid'
import { SettingsPanel } from '../components/SettingsPanel'
import { SpinePreview } from '../components/SpinePreview'
import { SymbolInspector } from '../components/SymbolInspector'
import { SymbolList } from '../components/SymbolList'
import type {
  OutputKind,
  RootOffset,
  SpineSource,
  SpineSymbol,
  SymbolOutputs,
} from '../core/types'
import { useConfirm } from '../hooks/useConfirm'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { downloadPng, downloadZip } from '../lib/download'
import { buildExportBundle, symbolIdProblems } from '../lib/exportBundle'
import {
  Cancelled,
  cellFor,
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

type SymbolSettingsCopy = Pick<SpineSymbol, 'root' | 'animRoots' | 'own'> & { from: string }

/** Revoke images of `next` that `prev` does not share (and vice versa when `next` replaces `prev`). */
function revokeUnshared(drop: SymbolOutputs | undefined, keep: SymbolOutputs | undefined) {
  if (!drop) return
  const kept = new Set(Object.values(keep?.images ?? {}).map((i) => i.url))
  for (const img of Object.values(drop.images)) {
    if (!kept.has(img.url)) URL.revokeObjectURL(img.url)
  }
}

/** The symbol on a new Spine source: root/animation/frame kept where still valid. */
function withSource(symbol: SpineSymbol, source: SpineSource): SpineSymbol {
  const animations = source.animations
  const animationName = animations.some((a) => a.name === symbol.animationName)
    ? symbol.animationName
    : (animations[0]?.name ?? '')
  const animRoots = Object.fromEntries(
    Object.entries(symbol.animRoots).filter(([a]) => animations.some((x) => x.name === a)),
  )
  const updated = { ...symbol, source, animationName, animRoots }
  return { ...updated, frame: clampFrame(updated, animationName, symbol.frame) }
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
  /** Frees GPU textures, cached frames and output URLs (the project tab is closing) */
  dispose: () => void
}

export function SpineTool({
  settings,
  onSettingChange,
  hidden,
  actionsSlot,
  apiRef,
  onOpenProjects,
  onSymbolsChange,
  exportName,
}: ToolProps & {
  apiRef: Ref<SpineToolApi>
  /** Current symbols, for the app's Save button and unsaved-changes tracking */
  onSymbolsChange: (symbols: SpineSymbol[]) => void
  /** Dropped .ssproj files are opened as projects (in tabs) instead of imported */
  onOpenProjects: (files: File[]) => void
  /** Export ZIP file name without .zip (the project's title) */
  exportName: string
}) {
  const [symbols, setSymbolsState] = useState<SpineSymbol[]>([])
  const symbolsRef = useRef(symbols)
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [outputs, setOutputsState] = useState<Record<string, SymbolOutputs>>({})
  const outputsRef = useRef(outputs)
  const [uploading, setUploading] = useState(false)
  const [messages, setMessages] = useState<string[]>([])
  const [exportProgress, setExportProgress] = useState<string | null>(null)
  const confirm = useConfirm()

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
        const isStillLoaded = () =>
          symbolsRef.current.some((s) => s.name === symbol.name && s.source === symbol.source)
        let next: SymbolOutputs
        try {
          next = await renderSymbolOutputs(symbol, debouncedSettings, prev, () => cancelled)
        } catch (e) {
          if (e instanceof Cancelled) return
          // Removed or re-uploaded mid-render: its source was released, which is not an error.
          if (!isStillLoaded()) continue
          throw e
        }
        const stillLoaded = isStillLoaded()
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

  /** Variants share their original's source; it is released with the original. */
  const dropSymbolResources = (symbol: SpineSymbol) => {
    if (symbol.variantOf == null) releaseSpineSource(symbol.source)
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
        let firstName: string | null = null
        for (const p of parsed) {
          let name = p.name
          // A variant's name ('x (2)') is not a re-upload: the skeleton is added under a free name.
          if (byName.get(name)?.variantOf != null) {
            let n = 2
            while (byName.has(`${p.name} (${n})`)) n++
            name = `${p.name} (${n})`
          }
          firstName ??= name
          const old = byName.get(name)
          const animations = p.source.animations
          if (old) {
            // Re-upload: new source for the symbol and its variants, settings kept where valid.
            dropSymbolResources(old)
            for (const s of byName.values()) {
              if (s.name === p.name || s.variantOf === p.name) byName.set(s.name, withSource(s, p.source))
            }
          } else {
            byName.set(name, {
              name,
              key: suggestKey(
                p.name,
                Array.from(byName.values(), (s) => s.key),
              ),
              historyIds: null,
              own: {},
              variantOf: null,
              source: p.source,
              animationName: animations[0]?.name ?? '',
              frame: 0,
              root: { x: 0, y: 0 },
              animRoots: {},
            })
          }
        }
        setSymbols(Array.from(byName.values()))
        if (!selectedRef.current && firstName) setSelectedName(firstName)
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

  /** Removing an original removes its variants too (they use its Spine files). */
  const removeSymbols = useCallback(
    (removed: Set<string>) => {
      const names = new Set(removed)
      for (const s of symbolsRef.current) {
        if (s.variantOf != null && names.has(s.variantOf)) names.add(s.name)
      }
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
      dispose: () => removeSymbols(new Set(symbolsRef.current.map((s) => s.name))),
    }),
    [removeSymbols, setSymbols],
  )

  /**
   * A copy of the symbol on the same Spine source, with all its settings. Placed after
   * the original and its other variants; history ids start empty.
   */
  const addVariant = (name: string) => {
    const all = symbolsRef.current
    const original = all.find((s) => s.name === name)
    if (!original) return
    const names = new Set(all.map((s) => s.name))
    const keys = new Set(all.map((s) => s.key.toLowerCase()))
    let n = 2
    while (names.has(`${name} (${n})`) || keys.has(`${original.key}_v${n}`.toLowerCase())) n++
    const variant: SpineSymbol = {
      ...structuredClone({ ...original, source: null }),
      source: original.source,
      name: `${name} (${n})`,
      key: `${original.key}_v${n}`,
      historyIds: null,
      variantOf: name,
    }
    let at = all.findIndex((s) => s.name === name) + 1
    while (all[at]?.variantOf === name) at++
    setSymbols([...all.slice(0, at), variant, ...all.slice(at)])
    setSelectedName(variant.name)
  }

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
      own: { ...selected.own },
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
          own: { ...clipboard.own },
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
      await downloadZip(buildExportBundle(symbols, outputs), `${exportName}.zip`, (done, total) =>
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

  const variantOfSlug = (s: SpineSymbol): string | null => {
    if (s.variantOf == null) return null
    const original = symbols.find((o) => o.name === s.variantOf)
    return original ? symbolSlug(original.key) : s.variantOf
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
        confirm.ask({
          title: `Paste into all ${symbols.length} symbols?`,
          message: `${clipboard?.from}'s root, per-animation roots and own settings replace theirs.`,
          confirmLabel: 'Paste to all',
          tone: 'default',
          onConfirm: () => pasteSettings(symbolsRef.current.map((s) => s.name)),
        })
      }}
      idProblem={idProblems.get(selected.name) ?? null}
      onKeyChange={(key) => updateSymbol(selected.name, (s) => ({ ...s, key }))}
      onHistoryIdsChange={(historyIds) =>
        updateSymbol(selected.name, (s) => ({ ...s, historyIds }))
      }
      variantOfSlug={variantOfSlug(selected)}
      onAddVariant={() => addVariant(selected.name)}
    />
  ) : null

  /** General settings: under the symbol settings in the right column, else under the list */
  const settingsPanel = (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-1">
      <SettingsPanel
        settings={settings}
        onChange={onSettingChange}
        own={
          selected
            ? {
                label: symbolSlug(selected.key),
                values: selected.own,
                onToggle: (section, on) =>
                  updateSymbol(selected.name, (s) => {
                    const own = { ...s.own }
                    for (const p of section.params) {
                      if (on) own[p.key] = settings[p.key]
                      else delete own[p.key]
                    }
                    return { ...s, own }
                  }),
                onChange: (key, value) =>
                  updateSymbol(selected.name, (s) => ({ ...s, own: { ...s.own, [key]: value } })),
              }
            : undefined
        }
      />
    </div>
  )

  return (
    <div className={hidden ? 'hidden' : 'md:flex md:min-h-0 md:flex-1 md:flex-col'}>
      {confirm.dialog}

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
                  indent: s.variantOf != null,
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
                  confirm.ask({
                    title: `Remove all ${symbols.length} symbols?`,
                    message: 'Their settings are lost unless the project is saved.',
                    confirmLabel: 'Remove all',
                    onConfirm: () => removeSymbols(new Set(symbolsRef.current.map((s) => s.name))),
                  })
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
                    cellSize={cellFor(selected, settings)}
                    onRootChange={setRoot}
                    onFrameChange={(frame) =>
                      updateSymbol(selected.name, (s) => ({
                        ...s,
                        frame: clampFrame(s, s.animationName, frame),
                      }))
                    }
                    onFrameSizeChange={(size) => {
                      // Same 2048 cap as the size fields.
                      const width = Math.min(2048, size.width)
                      const height = Math.min(2048, size.height)
                      // Own size → this symbol only; otherwise the project's size for all symbols.
                      if (selected.own.staticWidth != null) {
                        updateSymbol(selected.name, (s) => ({
                          ...s,
                          own: { ...s.own, staticWidth: width, staticHeight: height },
                        }))
                      } else {
                        onSettingChange('staticWidth', width)
                        onSettingChange('staticHeight', height)
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
