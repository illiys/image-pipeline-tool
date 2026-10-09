import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ExportButton } from '../components/ExportButton'
import { FileDropzone } from '../components/FileDropzone'
import { HistoryIdsInput } from '../components/HistoryIdsInput'
import { pixelStyle } from '../components/frameStyles'
import { Tile } from '../components/OutputGrid'
import { SettingsPanel } from '../components/SettingsPanel'
import { SymbolList } from '../components/SymbolList'
import { canvasToBlob } from '../core/canvas'
import type { GlobalSettings, OutputImage } from '../core/types'
import { historyThumbnail } from '../effects/history'
import { motionBlur } from '../effects/motionBlur'
import { verticalCenterSqueeze } from '../effects/squeeze'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { downloadPng, downloadZip } from '../lib/download'
import {
  historyFolderExtras,
  isValidHistoryId,
  type BundleFile,
} from '../lib/exportBundle'
import { historyIdsFromKey } from '../lib/exportSymbol'
import { DEBOUNCE_MS, HeaderActions, ToolMessages, type ToolProps } from './shared'
import { RASTER_ACCEPT, sourceCanvas, type RasterImages, type RasterItem } from './useRasterImages'

export type RasterKind = 'blur' | 'history'

/** `file` = the source it was rendered from (to drop outputs of replaced images) */
type RasterOutput = { key: string; file: File; image: OutputImage | null; error: string | null }

const KIND_TEXT: Record<RasterKind, { section: string; zip: string; title: string }> = {
  blur: { section: 'Blur', zip: 'blur.zip', title: 'Blur' },
  history: { section: 'History', zip: 'history.zip', title: 'History' },
}

/** UUID per uploaded file (a counter would restart on hot reload and reuse ids in cache keys). */
const fileIds = new WeakMap<File, string>()
function fileId(file: File): string {
  let id = fileIds.get(file)
  if (id == null) {
    id = crypto.randomUUID()
    fileIds.set(file, id)
  }
  return id
}

function outputKey(kind: RasterKind, item: RasterItem, s: GlobalSettings): string {
  const params =
    kind === 'blur'
      ? [s.squeezePixels, s.blurAngle, s.blurDistance]
      : [s.historyMaxSide, s.historyScale]
  return JSON.stringify([fileId(item.file), ...params])
}

function historyIdsOf(item: RasterItem): string[] {
  return item.historyIds ?? historyIdsFromKey(item.name.replace(/^symbol_/i, ''))
}

function outputPaths(kind: RasterKind, item: RasterItem): string[] {
  if (kind === 'blur') return [`symbols/blur/${item.name}.png`]
  return historyIdsOf(item).map((id) => `assets/history/symbols/${id}.png`)
}

function historyProblems(items: RasterItem[]): Map<string, string> {
  const problems = new Map<string, string>()
  const owner = new Map<string, string>()
  for (const item of items) {
    const ids = historyIdsOf(item)
    if (ids.length === 0) problems.set(item.name, 'no history id — set it on the right')
    for (const id of ids) {
      if (!isValidHistoryId(id)) {
        problems.set(item.name, problems.get(item.name) ?? `bad history id "${id}"`)
        continue
      }
      const other = owner.get(id)
      if (other != null && other !== item.name) {
        problems.set(item.name, problems.get(item.name) ?? `${id}.png also used by ${other}`)
        problems.set(other, problems.get(other) ?? `${id}.png also used by ${item.name}`)
      } else owner.set(id, item.name)
    }
  }
  return problems
}

/**
 * Ready-made static images → blur (symbols/blur/<name>.png) or
 * history (assets/history/symbols/<id>.png). Same effects/settings as the Spine tool.
 */
export function RasterTool({
  kind,
  settings,
  onSettingChange,
  hidden,
  actionsSlot,
  images,
}: ToolProps & { kind: RasterKind; images: RasterImages }) {
  const text = KIND_TEXT[kind]
  const { items, itemsRef, uploading, messages, setMessages, removeItems } = images
  const [outputs, setOutputsState] = useState<Record<string, RasterOutput>>({})
  const outputsRef = useRef(outputs)
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [exportProgress, setExportProgress] = useState<string | null>(null)

  const setOutputs = useCallback((next: Record<string, RasterOutput>) => {
    outputsRef.current = next
    setOutputsState(next)
  }, [])

  const selected = items.find((i) => i.name === selectedName) ?? items[0] ?? null
  const debouncedItems = useDebouncedValue(items, DEBOUNCE_MS)
  const debouncedSettings = useDebouncedValue(settings, DEBOUNCE_MS)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      for (const item of debouncedItems) {
        if (cancelled) return
        const key = outputKey(kind, item, debouncedSettings)
        if (outputsRef.current[item.name]?.key === key) continue
        let next: RasterOutput
        try {
          const src = await sourceCanvas(item.file)
          if (cancelled) return
          const canvas =
            kind === 'blur'
              ? motionBlur(
                  verticalCenterSqueeze(src, debouncedSettings.squeezePixels),
                  debouncedSettings.blurAngle,
                  debouncedSettings.blurDistance,
                )
              : historyThumbnail(src, debouncedSettings.historyMaxSide, debouncedSettings.historyScale)
          const blob = await canvasToBlob(canvas, 'image/png')
          next = {
            key,
            file: item.file,
            image: { blob, url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height },
            error: null,
          }
        } catch (e) {
          next = { key, file: item.file, image: null, error: e instanceof Error ? e.message : String(e) }
        }
        const stillLoaded = itemsRef.current.some((i) => i.file === item.file)
        if (cancelled || !stillLoaded) {
          if (next.image) URL.revokeObjectURL(next.image.url)
          if (cancelled) return
          continue
        }
        const old = outputsRef.current[item.name]?.image
        if (old) URL.revokeObjectURL(old.url)
        setOutputs({ ...outputsRef.current, [item.name]: next })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [debouncedItems, debouncedSettings, kind, setOutputs, itemsRef])

  const pendingNames = useMemo(
    () =>
      new Set(
        items
          .filter((i) => outputs[i.name]?.key !== outputKey(kind, i, settings))
          .map((i) => i.name),
      ),
    [items, outputs, settings, kind],
  )
  const errorNames = useMemo(
    () => new Set(items.filter((i) => outputs[i.name]?.error).map((i) => i.name)),
    [items, outputs],
  )
  const problems = useMemo(
    () => (kind === 'history' ? historyProblems(items) : new Map<string, string>()),
    [items, kind],
  )

  const addFiles = async (files: File[]) => {
    const first = await images.addFiles(files)
    if (!selectedName && first) setSelectedName(first)
  }

  // Images are shared with the other raster tool: drop outputs of removed/replaced ones.
  useEffect(() => {
    const live = new Map(items.map((i) => [i.name, i]))
    let changed = false
    const next = { ...outputsRef.current }
    for (const [name, out] of Object.entries(next)) {
      const item = live.get(name)
      if (item?.file === out.file) continue
      if (out.image) URL.revokeObjectURL(out.image.url)
      delete next[name]
      changed = true
    }
    if (changed) setOutputs(next)
  }, [items, setOutputs])

  const exportZip = async () => {
    const files: BundleFile[] = []
    for (const item of items) {
      const img = outputs[item.name]?.image
      if (!img) continue
      for (const path of outputPaths(kind, item)) files.push({ path, blob: img.blob, optimizePng: true })
    }
    if (kind === 'history') files.push(...historyFolderExtras())
    setExportProgress('0%')
    try {
      await downloadZip(files, text.zip, (done, total) =>
        setExportProgress(`${Math.round((done / total) * 100)}%`),
      )
    } catch (e) {
      setMessages([e instanceof Error ? e.message : 'Export failed'])
    } finally {
      setExportProgress(null)
    }
  }

  const blocker =
    errorNames.size > 0
      ? 'Some images failed'
      : problems.size > 0
        ? 'Fix history ids (marked red)'
        : null
  const out = selected ? outputs[selected.name] : undefined

  return (
    <div className={hidden ? 'hidden' : 'md:flex md:min-h-0 md:flex-1 md:flex-col'}>
      {items.length === 0 ? (
        <FileDropzone
          onFiles={(files) => void addFiles(files)}
          accept={RASTER_ACCEPT}
          busy={uploading}
          messages={messages}
          title={`Drop static images here to make ${text.title.toLowerCase()} versions`}
          hint={
            kind === 'blur'
              ? 'PNG / JPEG / WebP files or folders · symbol_XX.png → symbols/blur/symbol_XX.png'
              : 'PNG / JPEG / WebP files or folders · symbol_09_14.png → history 9.png and 14.png'
          }
        />
      ) : (
        <>
          <ToolMessages messages={messages} />
          <HeaderActions slot={actionsSlot} hidden={hidden}>
            <ExportButton
              countLabel={`${items.length} ${items.length === 1 ? 'image' : 'images'}`}
              pending={pendingNames.size}
              total={items.length}
              progress={exportProgress}
              blocker={blocker}
              onClick={() => void exportZip()}
            />
          </HeaderActions>
          {/* Left: images, then settings. Right: the selected image. */}
          <div className="grid gap-3 md:min-h-0 md:flex-1 md:grid-cols-[15rem_minmax(0,1fr)]">
            <aside className="flex min-w-0 flex-col gap-2 md:min-h-0 md:overflow-y-auto [&>*:not(:first-child)]:shrink-0">
              <SymbolList
                heading="Images"
                items={items.map((i) => ({ name: i.name, title: i.name }))}
                selectedName={selected?.name ?? null}
                pendingNames={pendingNames}
                errorNames={errorNames}
                problems={problems}
                onSelect={setSelectedName}
                onRemove={(name) => removeItems(new Set([name]))}
                onFiles={(files) => void addFiles(files)}
                accept={RASTER_ACCEPT}
                uploading={uploading}
                onClear={() => {
                  if (window.confirm(`Remove all ${items.length} images?`)) {
                    removeItems(new Set(items.map((i) => i.name)))
                  }
                }}
              />
              <SettingsPanel settings={settings} onChange={onSettingChange} only={[text.section]} />
            </aside>
            {selected ? (
              <main className="flex min-w-0 flex-col gap-2 md:min-h-0 md:overflow-y-auto md:pr-1">
                {kind === 'history' ? (
                  <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface-elevated p-2.5">
                    <label className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-[9px] font-medium uppercase tracking-wide text-muted">
                        History ids
                      </span>
                      <HistoryIdsInput
                        key={`${selected.name}\t${selected.historyIds ? 'manual' : 'auto'}`}
                        ids={historyIdsOf(selected)}
                        manual={selected.historyIds != null}
                        onChange={(historyIds) => images.setHistoryIds(selected.name, historyIds)}
                      />
                    </label>
                    <span className="pb-1 font-mono text-[10px] text-muted">
                      {problems.get(selected.name) ? (
                        <span className="text-red-500">{problems.get(selected.name)}</span>
                      ) : (
                        `→ ${historyIdsOf(selected).map((h) => `${h}.png`).join(', ')}`
                      )}
                    </span>
                  </div>
                ) : null}
                <div className="space-y-2 rounded-lg border border-border bg-surface-elevated/60 p-2">
                  {out?.error ? <p className="text-[11px] text-red-500">{out.error}</p> : null}
                  <div className="flex flex-wrap items-start gap-4">
                    <Tile
                      label="Source"
                      image={{
                        blob: selected.file,
                        url: selected.url,
                        width: selected.width,
                        height: selected.height,
                      }}
                      frame={pixelStyle(selected.width, selected.height)}
                      pending={false}
                      onDownload={null}
                      sizeOf="file"
                    />
                    <Tile
                      label={text.title}
                      image={out?.image ?? undefined}
                      frame={
                        out?.image
                          ? pixelStyle(out.image.width, out.image.height)
                          : kind === 'blur'
                            ? pixelStyle(selected.width, selected.height)
                            : pixelStyle(100, 80)
                      }
                      pending={pendingNames.has(selected.name)}
                      onDownload={
                        out?.image && !pendingNames.has(selected.name)
                          ? () => {
                              for (const path of outputPaths(kind, selected)) {
                                void downloadPng(out.image!.blob, path.slice(path.lastIndexOf('/') + 1))
                              }
                            }
                          : null
                      }
                    />
                  </div>
                </div>
              </main>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
