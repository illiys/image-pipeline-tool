import type { ModuleParamDef } from '../core/types'

type Props = {
  def: ModuleParamDef
  value: number | boolean | string
  onChange: (value: number | boolean | string) => void
  disabled?: boolean
}

export function ParamControl({ def, value, onChange, disabled }: Props) {
  if (def.kind === 'number') {
    const num = Number(value)
    const min = def.min ?? 0
    const max = def.max ?? 100
    return (
      <div className="space-y-0.5">
        <div className="flex items-baseline justify-between gap-1">
          <label className="text-[11px] text-muted truncate" title={def.hint ?? def.label}>
            {def.label}
          </label>
          <span className="text-[10px] font-mono text-accent tabular-nums shrink-0">
            {num}{def.unit ?? ''}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <input
            type="range"
            min={min}
            max={max}
            step={def.step ?? 1}
            value={num}
            disabled={disabled}
            onChange={(e) => onChange(Number(e.target.value))}
            className="min-w-0 flex-1 accent-accent-dim disabled:opacity-40"
          />
          <input
            type="number"
            min={min}
            max={max}
            step={def.step ?? 1}
            value={num}
            disabled={disabled}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-14 shrink-0 rounded border border-border bg-surface px-1 py-0.5 text-[10px] font-mono disabled:opacity-40"
          />
        </div>
      </div>
    )
  }

  return null
}
