import { DEFAULT_SETTINGS, SETTINGS_SECTIONS } from '../config/settings'
import type { GlobalSettings } from '../core/types'
import { NumberField } from './NumberField'

type Props = {
  settings: GlobalSettings
  onChange: (key: keyof GlobalSettings, value: number) => void
  /** Section titles to show (default: all) */
  only?: string[]
}

/** Compact cards: title row, then the section's fields side by side. */
export function SettingsPanel({ settings, onChange, only }: Props) {
  return (
    <>
      {SETTINGS_SECTIONS.filter((s) => !only || only.includes(s.title)).map((section) => (
        <section
          key={section.title}
          className="min-w-0 rounded-lg border border-border bg-surface-elevated px-2 py-1.5"
        >
          <header className="mb-1 flex items-center justify-between gap-2">
            <h3
              className="truncate text-[10px] font-medium uppercase tracking-wide text-muted"
              title={section.description}
            >
              {section.title}
            </h3>
            <button
              type="button"
              onClick={() => {
                for (const p of section.params) onChange(p.key, DEFAULT_SETTINGS[p.key])
              }}
              className="text-[10px] text-muted hover:text-accent"
              title="Reset to defaults"
            >
              ↺
            </button>
          </header>
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `repeat(${section.params.length}, minmax(0, 1fr))` }}
          >
            {section.params.map((def) => (
              <label key={def.key} className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-[9px] text-muted" title={def.hint ?? def.label}>
                  {def.label}
                  {def.unit ? `, ${def.unit}` : ''}
                </span>
                <NumberField
                  def={def}
                  value={settings[def.key]}
                  onChange={(v) => onChange(def.key, v)}
                  compact
                />
              </label>
            ))}
          </div>
        </section>
      ))}
    </>
  )
}
