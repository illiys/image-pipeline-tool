import { DEFAULT_SETTINGS, isOwnSection, SETTINGS_SECTIONS, type SettingsSection } from '../config/settings'
import type { GlobalSettings } from '../core/types'
import { NumberField } from './NumberField'

/** The selected symbol's own values: each section gets an "own" checkbox. */
export type OwnSettings = {
  /** e.g. symbol_09_14, for titles */
  label: string
  values: Partial<GlobalSettings>
  onToggle: (section: SettingsSection, own: boolean) => void
  onChange: (key: keyof GlobalSettings, value: number) => void
}

type Props = {
  settings: GlobalSettings
  onChange: (key: keyof GlobalSettings, value: number) => void
  /** Section titles to show (default: all) */
  only?: string[]
  own?: OwnSettings
}

/** Compact cards: title row, then the section's fields side by side. */
export function SettingsPanel({ settings, onChange, only, own }: Props) {
  return (
    <>
      {SETTINGS_SECTIONS.filter((s) => !only || only.includes(s.title)).map((section) => {
        const isOwn = own != null && isOwnSection(own.values, section)
        const value = (key: keyof GlobalSettings) => (isOwn ? own.values[key]! : settings[key])
        const change = isOwn ? own.onChange : onChange
        return (
          <section
            key={section.title}
            className={`min-w-0 rounded-lg border bg-surface-elevated px-2 py-1.5 ${
              isOwn ? 'border-accent/60' : 'border-border'
            }`}
          >
            <header className="mb-1 flex items-center gap-2">
              <h3
                className="mr-auto truncate text-[10px] font-medium uppercase tracking-wide text-muted"
                title={section.description}
              >
                {section.title}
              </h3>
              {own ? (
                <label
                  className={`flex items-center gap-1 text-[10px] ${isOwn ? 'text-accent' : 'text-muted'}`}
                  title={
                    isOwn
                      ? `${own.label} uses its own values; uncheck to use the project's`
                      : `Own values for ${own.label} only`
                  }
                >
                  <input
                    type="checkbox"
                    checked={isOwn}
                    onChange={(e) => own.onToggle(section, e.target.checked)}
                    className="accent-accent-dim"
                  />
                  own
                </label>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  for (const p of section.params) change(p.key, DEFAULT_SETTINGS[p.key])
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
                    value={value(def.key)}
                    onChange={(v) => change(def.key, v)}
                    compact
                  />
                </label>
              ))}
            </div>
          </section>
        )
      })}
    </>
  )
}
