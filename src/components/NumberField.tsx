import { useState } from 'react'
import type { ParamDef } from '../core/types'

type Props = {
  def: ParamDef
  value: number
  onChange: (value: number) => void
  /** Narrow input without the unit suffix (unit shown by the caller) */
  compact?: boolean
}

function clamp(def: ParamDef, n: number): number {
  return Math.min(def.max, Math.max(def.min, n))
}

/**
 * Text-style number input. Keeps the typed text while editing ("-", "0.") and
 * commits only valid in-range values; out-of-range input is clamped on blur/Enter.
 */
export function NumberField({ def, value, onChange, compact = false }: Props) {
  /**
   * Raw text while typing ("-", "1."), plus the value this field expects to see: what it
   * last sent up, or the value when typing started. A different value means it was
   * changed from outside (paste, project open) and the stale text is dropped.
   */
  const [draft, setDraft] = useState<{ text: string; expected: number } | null>(null)
  const shown = draft && draft.expected === value ? draft.text : String(value)

  const commit = (text: string) => {
    const n = Number(text)
    if (text.trim() !== '' && Number.isFinite(n)) onChange(clamp(def, n))
    setDraft(null)
  }

  return (
    <span className={`flex items-center gap-1 ${compact ? 'min-w-0' : 'shrink-0'}`}>
      <input
        type="number"
        inputMode="decimal"
        min={def.min}
        max={def.max}
        step={def.step}
        value={shown}
        onChange={(e) => {
          const text = e.target.value
          const n = Number(text)
          const valid = text !== '' && Number.isFinite(n) && n >= def.min && n <= def.max
          setDraft({ text, expected: valid ? n : value })
          if (valid) onChange(n)
        }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(e.currentTarget.value)
        }}
        className={`rounded border border-border bg-surface px-1.5 py-0.5 text-right font-mono text-[11px] tabular-nums ${
          compact ? 'w-full min-w-0' : 'w-20'
        }`}
      />
      {compact ? null : (
        <span className="w-4 font-mono text-[10px] text-muted">{def.unit ?? ''}</span>
      )}
    </span>
  )
}
