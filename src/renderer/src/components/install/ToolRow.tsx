import { CheckCircle2, FolderOpen, Wrench, X, XCircle } from 'lucide-react'
import { useState } from 'react'
import type { ToolStatus } from '@shared/install'
import { toast } from '../../store/toast-store'
import { ipcMessage } from '../mods/actions'

/**
 * One required tool: detected, missing, or (for tools the registry lets the
 * user choose, like a portable PPSSPP) a Browse button and the chosen path.
 */
export function ToolRow({ tool, onChanged }: { tool: ToolStatus; onChanged?: () => void }) {
  const [busy, setBusy] = useState(false)

  const browse = async () => {
    setBusy(true)
    try {
      const path = await window.hub.tools.pick(tool.id)
      if (path) {
        toast({ tone: 'success', title: `${tool.name} set`, body: path })
        onChanged?.()
      }
    } catch (err) {
      toast({ tone: 'error', title: `That is not ${tool.name}`, body: ipcMessage(err) })
    } finally {
      setBusy(false)
    }
  }
  const clear = async () => {
    await window.hub.tools.clear(tool.id).catch(() => {})
    onChanged?.()
  }

  const status = tool.found
    ? `found${tool.version ? ` · ${tool.version}` : ''}`
    : tool.found === null
      ? 'checked by the project setup'
      : tool.optional
        ? tool.pick
          ? 'not chosen (optional)'
          : 'not found (optional)'
        : 'not found'

  return (
    <li className="flex items-start gap-3 text-[13.5px]">
      <span className="mt-0.5">
        {tool.found ? (
          <CheckCircle2 size={16} className="text-emerald-400" />
        ) : tool.found === null ? (
          <Wrench size={16} className="text-zinc-500" />
        ) : (
          <XCircle size={16} className={tool.optional ? 'text-zinc-500' : 'text-tekken-400'} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-3">
          <span className="text-zinc-200">{tool.name}</span>
          <span className="ml-auto shrink-0 text-[12px] text-zinc-500">{status}</span>
        </span>
        {tool.pick && (
          <span className="mt-0.5 block text-[12px] leading-snug">
            {tool.path ? (
              <span className="flex items-center gap-2">
                <code className="selectable min-w-0 truncate text-zinc-400" title={tool.path}>
                  {tool.path}
                </code>
                <button onClick={() => void clear()} className="shrink-0 text-zinc-500 hover:text-zinc-200" title="Forget this folder">
                  <X size={12} />
                </button>
              </span>
            ) : (
              tool.pick.hint && <span className="text-zinc-500">Choose {tool.pick.hint}</span>
            )}
            {tool.problem && <span className="block text-amber-300/90">{tool.problem}</span>}
          </span>
        )}
        {!tool.pick && tool.problem && <span className="mt-0.5 block text-[12px] leading-snug text-amber-300/90">{tool.problem}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {tool.pick && (
          <button
            onClick={() => void browse()}
            disabled={busy}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-ink-600 bg-ink-800 px-2.5 font-display text-[12px] font-bold uppercase tracking-wider text-zinc-200 hover:border-zinc-500 disabled:opacity-60"
          >
            <FolderOpen size={12} />
            {tool.path ? 'Change' : 'Browse'}
          </button>
        )}
        {tool.found === false && tool.url && (
          <button onClick={() => void window.hub.app.openExternal(tool.url!).catch(() => {})} className="text-[12px] text-tekken-400 hover:underline">
            Get it
          </button>
        )}
      </span>
    </li>
  )
}
