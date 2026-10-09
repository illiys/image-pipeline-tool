import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { GlobalSettings } from '../core/types'

/** Wait after param changes before re-rendering. */
export const DEBOUNCE_MS = 250

export type ToolProps = {
  settings: GlobalSettings
  onSettingChange: (key: keyof GlobalSettings, value: number) => void
  /** Inactive tools stay mounted (keeping their files) but are hidden */
  hidden: boolean
  /** Header slot for the active tool's actions (export button) */
  actionsSlot: HTMLElement | null
}

/** Renders the active tool's actions into the app header. */
export function HeaderActions({
  slot,
  hidden,
  children,
}: {
  slot: HTMLElement | null
  hidden: boolean
  children: ReactNode
}) {
  return slot && !hidden ? createPortal(children, slot) : null
}

export function ToolMessages({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null
  return (
    <ul className="mb-2 shrink-0 space-y-0.5 text-[11px] text-red-500" role="alert">
      {messages.map((m) => (
        <li key={m}>{m}</li>
      ))}
    </ul>
  )
}
