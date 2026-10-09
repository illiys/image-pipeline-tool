import { useCallback, useState, type ReactNode } from 'react'
import { filesFromDrop, filesFromInput } from '../lib/dropFiles'

export type Pickers = {
  /** Open the file dialog */
  openFiles: () => void
  /** Open the folder dialog (every file inside, with its path) */
  openFolder: () => void
}

type Props = {
  onFiles: (files: File[]) => void
  accept: string
  className?: string
  /** Extra classes while files are dragged over */
  activeClassName?: string
  children: (pickers: Pickers) => ReactNode
}

/** Accepts dropped files and folders anywhere inside. */
export function DropTarget({ onFiles, accept, className = '', activeClassName = '', children }: Props) {
  const [fileInput, setFileInput] = useState<HTMLInputElement | null>(null)
  const [folderInput, setFolderInput] = useState<HTMLInputElement | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const folderRef = useCallback((el: HTMLInputElement | null) => {
    // Not a typed React prop; lets the dialog pick a whole folder.
    el?.setAttribute('webkitdirectory', '')
    setFolderInput(el)
  }, [])

  const deliver = (files: File[]) => {
    if (files.length) onFiles(files)
  }

  return (
    <div
      className={`${className} ${dragOver ? activeClassName : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        // Read synchronously: DataTransfer items are only available during the event.
        void filesFromDrop(e.dataTransfer).then(deliver)
      }}
    >
      <input
        ref={setFileInput}
        type="file"
        accept={accept}
        multiple
        className="hidden"
        onChange={(e) => {
          deliver(filesFromInput(e.target.files))
          e.target.value = ''
        }}
      />
      <input
        ref={folderRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          deliver(filesFromInput(e.target.files))
          e.target.value = ''
        }}
      />
      {children({ openFiles: () => fileInput?.click(), openFolder: () => folderInput?.click() })}
    </div>
  )
}
