import { FolderOpen, Trash2, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useEffect, useState, type ReactNode } from 'react'
import type { ProjectStorage } from '@shared/install'
import type { ProjectDefinition } from '@shared/registry-schema'
import { cx, formatBytes } from '../../lib/format'
import { toast } from '../../store/toast-store'
import { ipcMessage } from '../mods/actions'
import { Button } from '../ui/Button'
import { ProjectTile } from '../ui/ProjectTile'

/**
 * Remove a project from this PC: the installed mod, the downloaded packages, or
 * both. Shows where each lives and how big it is before anything is deleted.
 */
export function UninstallDialog({
  project,
  storage,
  onClose,
  onDone
}: {
  project: ProjectDefinition
  storage: ProjectStorage
  onClose: () => void
  onDone: () => void
}) {
  const installed = storage.install !== null
  const hasDownloads = storage.downloads.bytes > 0
  const [files, setFiles] = useState(installed)
  const [downloads, setDownloads] = useState(hasDownloads)
  // Dependencies are kept unless the user picks Remove for them.
  const [removeDeps, setRemoveDeps] = useState<Record<string, boolean>>({})
  const depsToRemove = files ? storage.dependencies.filter((d) => removeDeps[d.id] && !d.neededBy.length) : []
  // A tool is free to remove when every other project using it is being removed too.
  const toolUsers = (t: ProjectStorage['tools'][number]) => t.neededBy.filter((n) => !depsToRemove.some((d) => d.id === n.id))
  const [removeTools, setRemoveTools] = useState<Record<string, boolean>>({})
  const toolsToRemove = files ? storage.tools.filter((t) => removeTools[t.id] && !toolUsers(t).length) : []
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const run = async () => {
    setBusy(true)
    try {
      const r = await window.hub.install.uninstall(project.id, {
        files,
        downloads,
        dependencies: depsToRemove.map((d) => d.id),
        tools: toolsToRemove.map((t) => t.id)
      })
      const parts = [
        files && (r.removedFiles ? 'mod files deleted' : 'removed from the hub (its folder was left in place)'),
        downloads && (r.removedDownloads ? 'downloaded package deleted' : 'no downloaded package found'),
        r.removedDependencies.length > 0 && `${r.removedDependencies.join(', ')} uninstalled too`,
        r.removedTools.length > 0 && `${r.removedTools.join(', ')} removed`
      ].filter(Boolean)
      toast({ tone: 'success', title: files ? `${project.name} uninstalled` : 'Downloads deleted', body: `${parts.join(', ')}.` })
      onDone()
    } catch (err) {
      toast({ tone: 'error', title: 'Could not uninstall', body: ipcMessage(err) })
      setBusy(false)
    }
  }

  const total =
    (files && storage.install?.removable ? storage.install.bytes : 0) +
    (downloads ? storage.downloads.bytes : 0) +
    depsToRemove.reduce((n, d) => n + (d.install.removable ? d.install.bytes : 0) + (downloads ? d.downloads.bytes : 0), 0) +
    toolsToRemove.reduce((n, t) => n + t.install.bytes + (downloads ? t.downloads.bytes : 0), 0)
  const hostRemoved = depsToRemove.some((d) => d.id === project.install?.installInto?.project)

  // In document.body: the page's entry animation leaves a transform that would anchor a fixed overlay to the page.
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 p-6 backdrop-blur-sm" onClick={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-label={`Uninstall ${project.name}`}
        className="flex w-full max-w-[620px] animate-fade-up flex-col overflow-hidden rounded-2xl border border-ink-600 bg-ink-850 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-4 border-b border-line/[0.06] px-6 py-5">
          <ProjectTile project={project} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="font-display text-[13px] font-bold uppercase tracking-[0.24em] text-tekken-500">Remove from this PC</div>
            <div className="truncate font-display text-[26px] font-bold uppercase leading-tight tracking-wide text-fg">{project.name}</div>
          </div>
          <button onClick={onClose} disabled={busy} className="text-zinc-500 hover:text-fg" aria-label="Close">
            <X size={20} />
          </button>
        </header>

        <div className="flex flex-col gap-3 px-6 py-5">
          <Choice
            checked={files}
            disabled={!installed}
            onChange={setFiles}
            title="The installed mod"
            size={storage.install?.bytes ?? 0}
            path={storage.install?.path ?? null}
          >
            {!installed
              ? 'Not installed.'
              : storage.install!.removable
                ? 'The whole install folder, including the build, saves and settings stored inside it.'
                : 'This folder was not created by ExpandedHub, so it is only removed from the hub and its files stay on disk.'}
          </Choice>
          <Choice
            checked={downloads}
            disabled={!hasDownloads}
            onChange={setDownloads}
            title="Downloaded package"
            size={storage.downloads.bytes}
            path={hasDownloads ? storage.downloads.path : null}
          >
            {hasDownloads
              ? 'The release ZIP and its extracted copy. A later install downloads it again.'
              : 'Nothing downloaded for this project.'}
          </Choice>
          {storage.dependencies.map((d) => (
            <KeepOrRemove
              key={d.id}
              name={d.name}
              kind="dependency"
              size={d.install.bytes + d.downloads.bytes}
              path={d.install.path}
              usedBy={d.neededBy}
              lockedBy={d.neededBy}
              enabled={files}
              remove={!!removeDeps[d.id]}
              onChange={(v) => setRemoveDeps((m) => ({ ...m, [d.id]: v }))}
            >
              {!d.install.removable
                ? 'Its folder was not created by ExpandedHub: removing only forgets it in the hub.'
                : 'Installed for this project. Keep it to go on playing it, or remove its install folder (and its downloaded package, if selected above) as well.'}
            </KeepOrRemove>
          ))}
          {storage.tools.map((t) => (
            <KeepOrRemove
              key={t.id}
              name={t.name}
              kind="tool"
              size={t.install.bytes + t.downloads.bytes}
              path={t.install.path}
              usedBy={t.neededBy.map((n) => n.name)}
              lockedBy={toolUsers(t).map((n) => n.name)}
              enabled={files}
              remove={!!removeTools[t.id]}
              onChange={(v) => setRemoveTools((m) => ({ ...m, [t.id]: v }))}
            >
              Downloaded and set up by ExpandedHub for this project. Keep it for later installs, or remove it (and its downloaded package, if
              selected above). Installing a project that needs it downloads it again.
            </KeepOrRemove>
          ))}
          <p className="text-[12.5px] leading-snug text-zinc-500">
            Your own game files (discs, ROMs) are never touched.
            {project.install?.installInto && files && installed && !hostRemoved
              ? ' The add-on stays in the game until it is built again: use Build again on its host afterwards.'
              : ''}
          </p>
        </div>

        <footer className="flex items-center justify-between gap-4 border-t border-line/[0.06] px-6 py-4">
          <div className="text-[12.5px] text-zinc-500">{total > 0 ? `Frees ${formatBytes(total)}` : ' '}</div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={<Trash2 size={15} />}
              disabled={busy || (!files && !downloads)}
              onClick={() => void run()}
              className="min-w-[140px]"
            >
              {busy ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </footer>
      </div>
    </div>,
    document.body
  )
}

/** Something installed for this project (a dependency or a hub-installed tool): keep it or remove it as well. */
function KeepOrRemove({
  name,
  kind,
  size,
  path,
  usedBy,
  lockedBy,
  enabled,
  remove,
  onChange,
  children
}: {
  name: string
  kind: 'dependency' | 'tool'
  size: number
  path: string
  /** Names of every other installed project that uses it, shown beside its name. */
  usedBy: string[]
  /** Those of them that are not being removed now; while there are any it is kept. */
  lockedBy: string[]
  enabled: boolean
  remove: boolean
  onChange: (remove: boolean) => void
  children: ReactNode
}) {
  const locked = lockedBy.length > 0
  const disabled = !enabled || locked
  const removing = remove && !disabled
  return (
    <div
      className={cx(
        'rounded-xl border p-4',
        disabled ? 'border-line/[0.04] opacity-50' : 'border-line/[0.08]',
        removing && 'border-tekken-500/40 bg-tekken-500/[0.05]'
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[14.5px] font-semibold text-zinc-100">
          {name} <span className="font-normal text-zinc-500">· {kind}</span>
        </span>
        {size > 0 && <span className="shrink-0 text-[12.5px] text-zinc-400">{formatBytes(size)}</span>}
      </div>
      <div className="mt-1 text-[12.5px] leading-snug">
        {usedBy.length > 0 ? (
          <span className="text-amber-300/90">
            Also used by: <span className="font-semibold">{usedBy.join(', ')}</span>
          </span>
        ) : (
          <span className="text-zinc-500">Not used by any other installed project.</span>
        )}
      </div>
      <div className="mt-0.5 text-[13px] leading-snug text-zinc-400">
        {locked
          ? `Kept: ${lockedBy.join(', ')} still ${kind === 'tool' ? 'uses' : 'needs'} it.`
          : !enabled
            ? 'Kept: it can only be removed together with the installed mod.'
            : children}
      </div>
      <code className="selectable mt-1.5 block truncate text-[12px] text-zinc-500" title={path}>
        {path}
      </code>
      <div className="mt-3 flex gap-2" role="radiogroup" aria-label={`${name}: keep or remove`}>
        {[
          { value: false, label: 'Keep' },
          { value: true, label: 'Remove too' }
        ].map((o) => {
          const active = o.value ? removing : !removing
          return (
            <button
              key={o.label}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(o.value)}
              className={cx(
                'rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors',
                active
                  ? o.value
                    ? 'border-tekken-500/60 bg-tekken-500/15 text-fg'
                    : 'border-line/20 bg-line/[0.08] text-fg'
                  : 'border-line/[0.08] text-zinc-400 enabled:hover:border-line/20 enabled:hover:text-zinc-200',
                disabled && 'cursor-default'
              )}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Choice(props: {
  checked: boolean
  disabled: boolean
  onChange: (v: boolean) => void
  title: string
  size: number
  path: string | null
  children: ReactNode
}) {
  return (
    <label
      className={cx(
        'flex items-start gap-3 rounded-xl border p-4',
        props.disabled ? 'cursor-default border-line/[0.04] opacity-50' : 'cursor-pointer border-line/[0.08] hover:border-line/[0.14]',
        props.checked && !props.disabled && 'border-tekken-500/40 bg-tekken-500/[0.05]'
      )}
    >
      <input
        type="checkbox"
        checked={props.checked && !props.disabled}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
        className="mt-1 size-4 accent-[#d81e34]"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-[14.5px] font-semibold text-zinc-100">{props.title}</span>
          {props.size > 0 && <span className="shrink-0 text-[12.5px] text-zinc-400">{formatBytes(props.size)}</span>}
        </span>
        <span className="mt-0.5 block text-[13px] leading-snug text-zinc-400">{props.children}</span>
        {props.path && (
          <span className="mt-1.5 flex items-center gap-2">
            <code className="selectable min-w-0 truncate text-[12px] text-zinc-500" title={props.path}>
              {props.path}
            </code>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                void window.hub.app.openPath(props.path!).catch(() => {})
              }}
              className="shrink-0 text-zinc-500 hover:text-zinc-200"
              title="Open folder"
            >
              <FolderOpen size={13} />
            </button>
          </span>
        )}
      </span>
    </label>
  )
}
