import { useCallback, useRef, useState } from 'react'

type Props = {
  onFiles: (files: File[]) => void
  accept?: string
  fileCount?: number
  onClear?: () => void
}

function UploadImagesIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      {/* upload arrow above frame, centered */}
      <path
        d="M24 6v10"
        className="stroke-current"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M18 12l6-6 6 6"
        className="stroke-current"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="8"
        y="18"
        width="32"
        height="24"
        rx="4"
        className="stroke-current"
        strokeWidth="2"
      />
      <circle cx="17" cy="28" r="2.5" className="fill-current opacity-55" />
      <path
        d="M8 38l9-7 7 5 6-4 10 8"
        className="stroke-current"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function FileDropzone({
  onFiles,
  accept = 'image/*',
  fileCount = 0,
  onClear,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const pick = useCallback(
    (list: FileList | null) => {
      if (!list?.length) return
      const files = Array.from(list).filter((f) => f.type.startsWith('image/'))
      if (files.length) onFiles(files)
    },
    [onFiles],
  )

  const hasFiles = fileCount > 0

  return (
    <div
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
      }}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        pick(e.dataTransfer.files)
      }}
      onClick={() => inputRef.current?.click()}
      className={`group relative flex min-h-[132px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
        dragOver
          ? 'border-accent bg-accent/10'
          : 'border-border bg-surface-elevated hover:border-zinc-400 hover:shadow-sm'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        className="hidden"
        onChange={(e) => {
          pick(e.target.files)
          e.target.value = ''
        }}
      />

      <UploadImagesIcon
        className={`h-11 w-11 transition-colors ${
          dragOver ? 'text-accent' : 'text-muted group-hover:text-accent'
        }`}
      />

      {hasFiles ? (
        <>
          <p className="text-sm text-foreground">
            <span className="font-mono text-accent">{fileCount}</span> files loaded
          </p>
          <p className="text-xs text-muted">Drop more or click to browse</p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-foreground">
            Drop images here or click to browse
          </p>
          <p className="text-xs text-muted">PNG, WebP · multiple files supported</p>
        </>
      )}

      {hasFiles && onClear ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onClear()
          }}
          className="absolute right-2 top-2 rounded-md px-2 py-0.5 text-[10px] text-red-400/90 hover:bg-red-400/10 hover:text-red-300"
        >
          clear
        </button>
      ) : null}
    </div>
  )
}
