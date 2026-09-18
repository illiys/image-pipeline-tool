import type { LoadedImageItem } from '../core/types'
import { assetBaseName } from '../lib/assetName'
import { ScrollArea } from './ScrollArea'

type Props = {
  items: LoadedImageItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  onRemove: (id: string) => void
}

function TrashIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className="block shrink-0"
    >
      <path
        d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 11v6M14 11v6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function AssetRow({
  item,
  active,
  onSelect,
  onRemove,
  layout,
}: {
  item: LoadedImageItem
  active: boolean
  onSelect: () => void
  onRemove: () => void
  layout: 'row' | 'column'
}) {
  const label = assetBaseName(item.name)

  const shellClass = active
    ? 'border-accent/60 bg-accent/10'
    : 'border-border bg-surface-elevated'

  const selectClass = active
    ? 'text-accent'
    : 'text-muted hover:text-foreground'

  return (
    <li className={layout === 'row' ? 'shrink-0' : 'w-full'}>
      <div
        className={`flex items-stretch rounded-md border ${layout === 'row' ? 'w-max' : 'w-full'} ${shellClass}`}
      >
        <button
          type="button"
          onClick={onSelect}
          title={item.name}
          className={`whitespace-nowrap px-2.5 py-2 text-left text-[10px] font-mono leading-tight transition-colors ${layout === 'column' ? 'min-w-0 flex-1' : ''} ${selectClass} hover:bg-black/[0.03]`}
        >
          {label}
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${item.name}`}
          title="Remove"
          className="flex shrink-0 items-center justify-center border-l border-border/90 px-1.5 text-muted transition-colors hover:bg-red-50 hover:text-red-600"
        >
          <TrashIcon size={11} />
        </button>
      </div>
    </li>
  )
}

export function AssetList({ items, selectedId, onSelect, onRemove }: Props) {
  if (items.length === 0) return null

  return (
    <nav
      className="flex w-full flex-col gap-1 overflow-hidden rounded-lg border border-border bg-surface-elevated p-1.5 max-md:h-auto md:h-full md:min-h-0"
      aria-label="Loaded assets"
    >
      <p className="shrink-0 px-1 text-[10px] font-medium uppercase tracking-wide text-muted">
        Assets
      </p>

      <div className="scrollbar-none overflow-x-auto overscroll-x-contain md:hidden">
        <ul className="flex w-max min-w-full flex-row flex-nowrap gap-1">
          {items.map((item) => (
            <AssetRow
              key={item.id}
              item={item}
              active={selectedId === item.id}
              layout="row"
              onSelect={() => onSelect(item.id)}
              onRemove={() => onRemove(item.id)}
            />
          ))}
        </ul>
      </div>

      <ScrollArea className="hidden min-h-0 flex-1 md:flex">
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => (
            <AssetRow
              key={item.id}
              item={item}
              active={selectedId === item.id}
              layout="column"
              onSelect={() => onSelect(item.id)}
              onRemove={() => onRemove(item.id)}
            />
          ))}
        </ul>
      </ScrollArea>
    </nav>
  )
}
