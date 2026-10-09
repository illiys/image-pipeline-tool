import { useState } from 'react'

/**
 * Shows the generated history ids as editable text. Editing makes them manual;
 * clearing the field goes back to ids generated from the symbol id.
 * Keeps the raw text while typing (so "9, " survives).
 */
export function HistoryIdsInput({
  ids,
  manual,
  onChange,
}: {
  ids: string[]
  manual: boolean
  onChange: (ids: string[] | null) => void
}) {
  const [text, setText] = useState(ids.join(', '))
  return (
    <input
      value={text}
      placeholder="none"
      onChange={(e) => {
        setText(e.target.value)
        const next = e.target.value.split(/[\s,]+/).filter(Boolean)
        onChange(next.length === 0 ? null : next)
      }}
      title={
        manual
          ? 'Edited by hand; clear the field to generate from the id again'
          : 'Generated from the id (09_14 → 9, 14); edit to override'
      }
      className={`h-6 w-full min-w-0 rounded border px-1.5 font-mono text-[11px] text-foreground ${
        manual ? 'border-accent/60' : 'border-border'
      }`}
    />
  )
}
