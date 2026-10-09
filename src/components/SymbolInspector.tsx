import type { FrameSize, ParamDef, RootOffset, SpineSymbol } from '../core/types'
import { historyIdsFor, rootFor, symbolSlug } from '../lib/exportSymbol'
import { maxFrameIndex } from '../spine/skeletonData'
import { HistoryIdsInput } from './HistoryIdsInput'
import { NumberField } from './NumberField'

const ROOT_X: ParamDef = {
  key: 'rootX',
  label: 'Root X',
  min: -2048,
  max: 2048,
  step: 1,
  unit: 'px',
  hint: 'Export root (canvas 0,0) relative to the skeleton root bone, px to the right',
}
const ROOT_Y: ParamDef = {
  key: 'rootY',
  label: 'Root Y',
  min: -2048,
  max: 2048,
  step: 1,
  unit: 'px',
  hint: 'Export root (canvas 0,0) relative to the skeleton root bone, px down',
}

const SIZE_W: ParamDef = { key: 'width', label: 'Width', min: 1, max: 2048, step: 1, unit: 'px' }
const SIZE_H: ParamDef = { key: 'height', label: 'Height', min: 1, max: 2048, step: 1, unit: 'px' }

type Props = {
  symbol: SpineSymbol
  idProblem: string | null
  onKeyChange: (key: string) => void
  /** null = derive from the key */
  onHistoryIdsChange: (ids: string[] | null) => void
  defaultSize: FrameSize
  /** null = use the default size */
  onSizeChange: (size: FrameSize | null) => void
  onAnimationChange: (animationName: string) => void
  onFrameChange: (frame: number) => void
  onRootChange: (root: RootOffset) => void
  /** true = the current animation gets its own root; false = it uses the shared one */
  onOwnRootChange: (own: boolean) => void
  /** Name of the symbol whose settings are copied (null = nothing copied) */
  clipboardFrom: string | null
  onCopy: () => void
  onPaste: () => void
  onPasteAll: () => void
}

export function SymbolInspector({
  symbol,
  idProblem,
  onKeyChange,
  onHistoryIdsChange,
  defaultSize,
  onSizeChange,
  onAnimationChange,
  onFrameChange,
  onRootChange,
  onOwnRootChange,
  clipboardFrom,
  onCopy,
  onPaste,
  onPasteAll,
}: Props) {
  const { animations, fps } = symbol.source
  const anim = animations.find((a) => a.name === symbol.animationName)
  const maxFrame = anim ? maxFrameIndex(anim.duration, fps) : 0
  const root = rootFor(symbol)
  const ownRoot = symbol.animRoots[symbol.animationName] != null
  const ownRootCount = Object.keys(symbol.animRoots).length

  const row = 'grid grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-x-2'
  const smallBtn =
    'rounded border border-border px-1.5 py-0.5 hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-40'
  const label = 'text-[9px] font-medium uppercase tracking-wide text-muted'

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-elevated px-2.5 py-2 text-[11px] text-muted">
      <div className={row}>
        <span className={label}>Id</span>
        <span
          className={`flex h-6 min-w-0 items-center rounded border font-mono ${idProblem ? 'border-red-500' : 'border-border'}`}
          title={`${symbolSlug(symbol.key)}.png`}
        >
          <span className="pl-1.5 text-muted">symbol_</span>
          <input
            value={symbol.key}
            onChange={(e) => onKeyChange(e.target.value.trim())}
            className={`min-w-0 flex-1 bg-transparent pr-1.5 text-foreground outline-none ${idProblem ? 'text-red-600' : ''}`}
            placeholder="09_14"
          />
        </span>
      </div>
      <div className={row}>
        <span className={label}>History</span>
        <HistoryIdsInput
          key={`${symbol.name}\t${symbol.historyIds ? 'manual' : symbol.key}`}
          ids={historyIdsFor(symbol)}
          manual={symbol.historyIds != null}
          onChange={onHistoryIdsChange}
        />
      </div>
      {idProblem ? <p className="text-[10px] text-red-500">{idProblem}</p> : null}

      <div className="border-t border-border" />

      {animations.length > 0 ? (
        <div className={row}>
          <span className={label}>Anim</span>
          <select
            value={symbol.animationName}
            onChange={(e) => onAnimationChange(e.target.value)}
            className="h-6 min-w-0 rounded border border-border bg-surface-elevated px-1 font-mono text-[11px] text-foreground"
          >
            {animations.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name}
                {symbol.animRoots[a.name] ? ' · own root' : ''}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="font-mono text-[10px]">No animations · setup pose</p>
      )}
      {anim ? (
        <div className={row}>
          <span className={label}>Frame</span>
          <div className="flex min-w-0 items-center gap-1.5">
            <input
              type="range"
              min={0}
              max={maxFrame}
              step={1}
              value={Math.min(symbol.frame, maxFrame)}
              onChange={(e) => onFrameChange(Number(e.target.value))}
              aria-label="Frame"
              className="min-w-0 flex-1 accent-accent"
            />
            <span className="w-10 shrink-0">
              <NumberField
                key={symbol.name + symbol.animationName}
                def={{ key: 'frame', label: 'Frame', min: 0, max: maxFrame, step: 1 }}
                value={Math.min(symbol.frame, maxFrame)}
                onChange={onFrameChange}
                compact
              />
            </span>
            <span className="shrink-0 font-mono text-[10px]" title={`${fps} fps`}>
              /{maxFrame}
            </span>
          </div>
        </div>
      ) : null}

      <div className="border-t border-border" />

      <div className={row}>
        <span
          className={label}
          title="Export root: canvas 0,0 and skeleton origin in the exported JSON (px from the root bone)"
        >
          Root
        </span>
        <div className="flex min-w-0 items-center gap-2">
          {/* keyed by animation: a half-typed value must not carry over to another animation's root */}
          <InlineField
            key={`x\t${symbol.animationName}`}
            prefix="x"
            def={ROOT_X}
            value={root.x}
            onChange={(x) => onRootChange({ ...root, x })}
          />
          <InlineField
            key={`y\t${symbol.animationName}`}
            prefix="y"
            def={ROOT_Y}
            value={root.y}
            onChange={(y) => onRootChange({ ...root, y })}
          />
        </div>
      </div>
      {animations.length > 1 && symbol.animationName ? (
        <label
          className="flex items-center gap-1 pl-[3.75rem] text-[10px]"
          title={`Off: uses the shared root (${ownRootCount} of ${animations.length} animations have their own)`}
        >
          <input
            type="checkbox"
            checked={ownRoot}
            onChange={(e) => onOwnRootChange(e.target.checked)}
            className="accent-accent-dim"
          />
          <span className="truncate">own for {symbol.animationName}</span>
        </label>
      ) : null}
      <div className={row}>
        <label className="flex items-center gap-1" title="Own static size for this symbol">
          <input
            type="checkbox"
            checked={symbol.size != null}
            onChange={(e) => onSizeChange(e.target.checked ? { ...defaultSize } : null)}
            className="accent-accent-dim"
          />
          <span className={label}>Size</span>
        </label>
        {symbol.size ? (
          <div className="flex min-w-0 items-center gap-2">
            <InlineField
              prefix="w"
              def={SIZE_W}
              value={symbol.size.width}
              onChange={(width) => onSizeChange({ ...symbol.size!, width })}
            />
            <InlineField
              prefix="h"
              def={SIZE_H}
              value={symbol.size.height}
              onChange={(height) => onSizeChange({ ...symbol.size!, height })}
            />
          </div>
        ) : (
          <span className="font-mono text-[10px]">
            default {defaultSize.width}×{defaultSize.height}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 border-t border-border pt-2 text-[10px]">
        <span className="mr-auto" title="Root, per-animation roots and own size">
          Settings
        </span>
        <button type="button" onClick={onCopy} className={smallBtn}>
          Copy
        </button>
        <button
          type="button"
          onClick={onPaste}
          disabled={!clipboardFrom || clipboardFrom === symbol.name}
          title={clipboardFrom ? `Paste from ${clipboardFrom}` : 'Copy a symbol first'}
          className={smallBtn}
        >
          Paste
        </button>
        <button
          type="button"
          onClick={onPasteAll}
          disabled={!clipboardFrom}
          title={clipboardFrom ? `Paste from ${clipboardFrom} into every symbol` : 'Copy a symbol first'}
          className={smallBtn}
        >
          Paste to all
        </button>
      </div>
      {symbol.source.skeletonJson == null ? (
        <p className="text-[10px] text-amber-600" title="Export JSON from Spine to write the root into the skeleton">
          .skel: root applies to images only
        </p>
      ) : null}
    </div>
  )
}

/** Compact "x [  12 ]" field used for root and size. */
function InlineField({
  prefix,
  def,
  value,
  onChange,
}: {
  prefix: string
  def: ParamDef
  value: number
  onChange: (v: number) => void
}) {
  return (
    <label className="flex min-w-0 flex-1 items-center gap-1" title={def.hint ?? def.label}>
      <span className="font-mono text-[10px] text-muted">{prefix}</span>
      <span className="min-w-0 flex-1">
        <NumberField def={def} value={value} onChange={onChange} compact />
      </span>
    </label>
  )
}
