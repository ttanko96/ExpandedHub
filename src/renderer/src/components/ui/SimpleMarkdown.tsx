import type { ReactNode } from 'react'
import { toast } from '../../store/toast-store'

/**
 * Minimal, safe renderer for GitHub release notes: headings, bullet lists,
 * paragraphs, **bold**, `code` and [links](https://…). No HTML is ever injected;
 * links open in the system browser through the main-process allowlist.
 */
export function SimpleMarkdown({ source }: { source: string }) {
  const blocks: ReactNode[] = []
  let list: string[] = []
  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul key={blocks.length} className="my-2 list-disc space-y-1 pl-5 marker:text-tekken-500">
          {list.map((l, i) => (
            <li key={i}>{inline(l)}</li>
          ))}
        </ul>
      )
      list = []
    }
  }
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trimEnd()
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    if (bullet) {
      list.push(bullet[1])
      continue
    }
    flush()
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      blocks.push(
        <h4 key={blocks.length} className="mb-1 mt-4 font-display text-[16px] font-bold uppercase tracking-wide text-zinc-100 first:mt-0">
          {inline(h[2])}
        </h4>
      )
    } else if (line.trim()) {
      blocks.push(
        <p key={blocks.length} className="my-2">
          {inline(line)}
        </p>
      )
    }
  }
  flush()
  return <div className="selectable text-[14px] leading-relaxed text-zinc-400">{blocks}</div>
}

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|!?\[[^\]]*\]\([^)\s]+\))/g).map((part, i) => {
    const link = /^(!?)\[([^\]]*)\]\(([^)\s]+)\)$/.exec(part)
    if (link) {
      const [, img, label, url] = link
      if (img) return label ? <span key={i} className="text-zinc-500">[{label}]</span> : null
      return (
        <button
          key={i}
          onClick={() => window.hub.app.openExternal(url).catch(() => toast({ tone: 'info', title: 'Link not opened', body: url }))}
          className="text-tekken-400 underline decoration-tekken-500/40 underline-offset-2 hover:text-tekken-300"
        >
          {label || url}
        </button>
      )
    }
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i} className="text-zinc-200">{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`'))
      return (
        <code key={i} className="rounded bg-ink-700 px-1 py-0.5 text-[12.5px] text-zinc-200">
          {part.slice(1, -1)}
        </code>
      )
    return part
  })
}
