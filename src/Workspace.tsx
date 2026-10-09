import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { loadSettings, saveSettings } from './config/settings'
import type { GlobalSettings, SpineSymbol } from './core/types'
import { downloadBlob } from './lib/download'
import {
  openProject,
  PROJECT_EXT,
  projectFingerprint,
  saveProject,
  type ProjectData,
} from './lib/project'
import { SpineTool, type SpineToolApi } from './tools/SpineTool'

export const UNTITLED = 'Untitled'

/** What the tab bar needs to know about a project. */
export type WorkspaceMeta = { title: string; dirty: boolean; hasContent: boolean }

export type WorkspaceApi = {
  /** Load a .ssproj into this (empty) workspace */
  open: (file: File) => Promise<void>
  /** Rename the project (renamed in its tab); the next Save uses it as the file name */
  rename: (title: string) => void
}

/** Strip characters that are not allowed in file names. */
function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').trim() || UNTITLED
}

type Props = {
  /** Shown tab (and Spine mode); hidden workspaces stay mounted and keep their state */
  active: boolean
  /** Header slots (portals) for the project controls and the tool's export button */
  projectSlot: HTMLElement | null
  actionsSlot: HTMLElement | null
  apiRef: Ref<WorkspaceApi>
  onMetaChange: (meta: WorkspaceMeta) => void
  /** .ssproj files dropped into this workspace's Spine drop zone */
  onOpenProjects: (files: File[]) => void
}

/** One Spine project: its symbols, settings, title and save state. */
export function Workspace({
  active,
  projectSlot,
  actionsSlot,
  apiRef,
  onMetaChange,
  onOpenProjects,
}: Props) {
  const [settings, setSettings] = useState<GlobalSettings>(loadSettings)
  const spineApi = useRef<SpineToolApi>(null)
  /** Project title (file name without .ssproj); null until something is loaded/opened */
  const [projectTitle, setProjectTitle] = useState<string | null>(null)
  const [projectError, setProjectError] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  /** Mirror of the Spine tool's symbols (for Save visibility and change tracking) */
  const [spineSymbols, setSpineSymbols] = useState<SpineSymbol[]>([])

  const projectData = (): ProjectData => ({ settings, symbols: spineSymbols })
  const fingerprint = useMemo(
    () => projectFingerprint(projectData()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings, spineSymbols],
  )
  /** Fingerprint at the last save/open (start: the empty project) */
  const [savedFingerprint, setSavedFingerprint] = useState(fingerprint)
  const hasContent = spineSymbols.length > 0
  const dirty = hasContent && fingerprint !== savedFingerprint
  /** Nothing loaded and no project open → nothing to save */
  const canSave = hasContent || projectTitle != null
  /** New work starts as "Untitled" until renamed, saved or opened */
  const title = projectTitle ?? UNTITLED

  useEffect(() => {
    onMetaChange({ title, dirty, hasContent })
  }, [title, dirty, hasContent, onMetaChange])

  // The active project's settings become the defaults for new projects.
  useEffect(() => {
    if (active) saveSettings(settings)
  }, [active, settings])

  const saveCurrentProject = () => {
    downloadBlob(saveProject(projectData()), `${safeFileName(title)}${PROJECT_EXT}`)
    setProjectTitle(title)
    setSavedFingerprint(fingerprint)
  }

  const openProjectFile = async (file: File) => {
    setOpening(file.name)
    setProjectError(null)
    try {
      const project = await openProject(file)
      setSettings(project.settings)
      if (!spineApi.current) throw new Error('Spine tool is not ready')
      spineApi.current.load(project.symbols)
      setProjectTitle(file.name.replace(/\.ssproj$/i, '') || UNTITLED)
      // Same content as the file ⇒ clean (files are matched by name/size/mtime).
      setSavedFingerprint(projectFingerprint(project))
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : 'Could not open project')
    } finally {
      setOpening(null)
    }
  }

  // Latest open function behind a stable API object.
  const openRef = useRef(openProjectFile)
  useEffect(() => {
    openRef.current = openProjectFile
  })
  useImperativeHandle(
    apiRef,
    () => ({
      open: (file) => openRef.current(file),
      rename: (t) => setProjectTitle(t.trim() || UNTITLED),
    }),
    [],
  )

  const onSettingChange = (key: keyof GlobalSettings, value: number) =>
    setSettings((prev) => ({ ...prev, [key]: value }))

  const projectControls = (
    <>
      {canSave ? (
        <button
          type="button"
          onClick={saveCurrentProject}
          className={`rounded-md border px-2 py-1 ${
            dirty ? 'border-accent text-accent' : 'border-border text-muted'
          } hover:border-accent hover:text-accent`}
          title={`Save symbols, settings and Spine files as ${safeFileName(title)}${PROJECT_EXT}`}
        >
          Save
        </button>
      ) : null}
      {dirty ? (
        <span className="whitespace-nowrap text-[10px] text-amber-600" title="Not saved since the last Save/Open">
          ● unsaved
        </span>
      ) : null}
      {opening ? <span className="truncate text-muted">Opening {opening}…</span> : null}
      {projectError ? <span className="truncate text-red-500">{projectError}</span> : null}
    </>
  )

  return (
    <div className={active ? 'contents' : 'hidden'}>
      {active && projectSlot ? createPortal(projectControls, projectSlot) : null}
      <SpineTool
        settings={settings}
        onSettingChange={onSettingChange}
        hidden={!active}
        actionsSlot={actionsSlot}
        apiRef={spineApi}
        onSymbolsChange={setSpineSymbols}
        onOpenProjects={onOpenProjects}
      />
    </div>
  )
}
