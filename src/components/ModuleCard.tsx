import type { ImagePipelineModule } from '../core/types'
import type { ModuleRuntimeState } from '../core/pipeline'
import { ParamControl } from './ParamControl'

type Props = {
  module: ImagePipelineModule
  state: ModuleRuntimeState
  onToggle: (enabled: boolean) => void
  onParam: (key: string, value: number | boolean | string) => void
  onReset: () => void
}

export function ModuleCard({
  module,
  state,
  onToggle,
  onParam,
  onReset,
}: Props) {
  return (
    <section className="rounded-lg border border-border bg-surface-elevated/80 p-2.5">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-foreground truncate" title={module.description}>
          {module.name}
        </h3>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onReset}
            className="text-[10px] text-muted hover:text-accent"
            title="Reset to preset"
          >
            ↺
          </button>
          <input
            type="checkbox"
            checked={state.enabled}
            onChange={(e) => onToggle(e.target.checked)}
            className="size-3.5 rounded border-border accent-accent-dim"
            title="Enable module"
          />
        </div>
      </header>

      <div
        className={`space-y-2 ${state.enabled ? '' : 'pointer-events-none opacity-40'}`}
      >
        {module.paramDefs.map((def) => (
          <ParamControl
            key={def.key}
            def={def}
            value={state.params[def.key] ?? module.defaultParams[def.key]}
            onChange={(v) => onParam(def.key, v)}
            disabled={!state.enabled}
          />
        ))}
      </div>
    </section>
  )
}
