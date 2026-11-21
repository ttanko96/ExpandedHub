import { FolderOpen, KeyRound, Moon, RotateCw, Sun } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { AppInfo, AppSettings, TokenValidation } from '@shared/types'
import { GameFilesList } from '../components/install/GameFilesList'
import { PageHeader } from '../components/layout/PageHeader'
import { Button } from '../components/ui/Button'
import { Segmented } from '../components/ui/Segmented'
import { cx, relativeTime } from '../lib/format'
import { useHub } from '../store/hub-store'
import { toast } from '../store/toast-store'

const SECTIONS = [
  { id: 'general', label: 'General' },
  { id: 'directories', label: 'Directories' },
  { id: 'iso', label: 'ISO Management' },
  { id: 'github', label: 'GitHub' },
  { id: 'advanced', label: 'Advanced' }
] as const

type SectionId = (typeof SECTIONS)[number]['id']

export function SettingsPage() {
  const { settings, updateSettings } = useHub()
  const [section, setSection] = useState<SectionId>('general')

  if (!settings) return null
  const save = (patch: Parameters<typeof updateSettings>[0]) =>
    updateSettings(patch).catch((e) => toast({ tone: 'error', title: 'Could not save settings', body: String(e) }))

  return (
    <div className="mx-auto max-w-[1280px] px-8 pb-16 pt-8">
      <PageHeader eyebrow="Configuration" title="Settings" />
      <div className="mt-8 grid grid-cols-[220px_1fr] gap-8">
        <nav className="flex flex-col gap-1">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={cx(
                'h-10 rounded-lg px-4 text-left font-display text-[15px] font-bold uppercase tracking-[0.1em] transition-colors',
                section === s.id ? 'bg-ink-700 text-fg' : 'text-zinc-500 hover:bg-ink-850 hover:text-zinc-200'
              )}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div key={section} className="animate-fade-up">
          {section === 'general' && <General s={settings} save={save} />}
          {section === 'directories' && <Directories s={settings} save={save} />}
          {section === 'iso' && <Iso />}
          {section === 'github' && <GitHub />}
          {section === 'advanced' && <Advanced s={settings} save={save} />}
        </div>
      </div>
    </div>
  )
}

type SectionProps = { s: AppSettings; save: (p: Parameters<ReturnType<typeof useHub.getState>['updateSettings']>[0]) => void }

function General({ s, save }: SectionProps) {
  return (
    <Card title="General">
      <Row label="Theme">
        <Segmented
          label="Theme"
          value={s.general.theme}
          onChange={(theme) => save({ general: { theme } })}
          options={[
            { id: 'dark', label: <><Moon size={14} /> Dark</> },
            { id: 'light', label: <><Sun size={14} /> Light</> }
          ]}
        />
      </Row>
      <Row label="Start with system" hint="Launch ExpandedHub when you sign in.">
        <Toggle checked={s.general.launchOnStartup} onChange={(v) => save({ general: { launchOnStartup: v } })} />
      </Row>
      <Row label="Check for updates automatically" hint="On startup and in the background.">
        <Toggle checked={s.general.autoCheckUpdates} onChange={(v) => save({ general: { autoCheckUpdates: v } })} />
      </Row>
      <Row label="Check frequency">
        <select
          value={s.general.checkIntervalMinutes}
          disabled={!s.general.autoCheckUpdates}
          onChange={(e) => save({ general: { checkIntervalMinutes: Number(e.target.value) } })}
          className="h-9 rounded-lg border border-ink-600 bg-ink-800 px-3 text-[14px] text-zinc-200 disabled:opacity-40"
        >
          {[15, 30, 60, 180, 360, 720, 1440].map((m) => (
            <option key={m} value={m}>
              {m < 60 ? `Every ${m} minutes` : m === 60 ? 'Every hour' : m === 1440 ? 'Once a day' : `Every ${m / 60} hours`}
            </option>
          ))}
        </select>
      </Row>
    </Card>
  )
}

function Directories({ s, save }: SectionProps) {
  const rows: [keyof AppSettings['directories'], string, string][] = [
    ['downloads', 'Downloads', 'Release archives and their extracted files'],
    ['installs', 'Installations', 'Where installed projects live'],
    ['temp', 'Temporary files', 'Scratch space during installation'],
    ['buildEnv', 'Build environment', 'Tools provisioned for source builds']
  ]
  const pick = async (key: keyof AppSettings['directories']) => {
    const chosen = await window.hub.app.pickFolder(s.directories[key])
    if (chosen) save({ directories: { [key]: chosen } })
  }
  return (
    <Card title="Directories" note="Changes apply to new operations; running downloads keep their folder.">
      {rows.map(([key, label, hint]) => {
        const path = s.directories[key]
        return (
          <Row key={key} label={label} hint={hint}>
            <div className="flex items-center gap-2">
              <code className="selectable max-w-[380px] truncate rounded-md bg-ink-800 px-2.5 py-1.5 text-[12.5px] text-zinc-300" title={path}>
                {path}
              </code>
              <Button size="sm" variant="secondary" onClick={() => void pick(key)}>
                Change
              </Button>
              <button
                title="Open folder"
                onClick={() => window.hub.app.openPath(path).catch(() => toast({ tone: 'info', title: 'Folder does not exist yet', body: path }))}
                className="text-zinc-500 hover:text-zinc-200"
              >
                <FolderOpen size={16} />
              </button>
            </div>
          </Row>
        )
      })}
    </Card>
  )
}

function Iso() {
  return (
    <Card
      title="ISO Management"
      note="Your own, legally obtained game files. Selected once, checked against known good dumps, reused by every project. ExpandedHub never uploads or distributes them."
    >
      <GameFilesList />
    </Card>
  )
}

function GitHub() {
  const { summary, setToken } = useHub()
  const [token, setTokenInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<TokenValidation | null>(null)

  const apply = async (value: string | null) => {
    setBusy(true)
    setResult(null)
    try {
      const r = await setToken(value)
      setResult(r)
      if (r.ok) setTokenInput('')
    } catch (e) {
      setResult({ ok: false, message: String(e) })
    } finally {
      setBusy(false)
    }
  }

  const rl = summary?.rateLimit
  return (
    <Card title="GitHub" note="Release information is read from the public GitHub API. Unchanged repositories are answered from cache.">
      <Row
        label="Personal access token"
        hint="Optional. Raises the limit from 60 to 5,000 requests per hour. A fine-grained token with public, read-only access is enough. Stored encrypted by your OS."
      >
        <div className="flex flex-col items-end gap-2">
          {summary?.hasToken && (
            <div className="flex items-center gap-2 text-[13px] text-emerald-300">
              <KeyRound size={14} /> Token stored
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void apply(null)}>
                Remove
              </Button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={token}
              onChange={(e) => setTokenInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && token.trim() && void apply(token)}
              placeholder={summary?.hasToken ? 'Replace token…' : 'github_pat_… or ghp_…'}
              autoComplete="off"
              spellCheck={false}
              className="selectable h-9 w-[280px] rounded-lg border border-ink-600 bg-ink-800 px-3 text-[14px] text-zinc-200 outline-none focus:border-tekken-500/60"
            />
            <Button size="sm" variant="secondary" disabled={busy || !token.trim()} onClick={() => void apply(token)}>
              {busy ? 'Checking…' : 'Verify & save'}
            </Button>
          </div>
          {result && (
            <div className={cx('max-w-[420px] text-right text-[12.5px]', result.ok ? 'text-emerald-300' : 'text-tekken-400')}>
              {result.message}
            </div>
          )}
        </div>
      </Row>
      <Row label="Rate limit" hint={rl ? (rl.authenticated ? 'Authenticated' : 'Anonymous') : undefined}>
        <span className="text-[14px] text-zinc-400">
          {summary?.source === 'mock'
            ? 'Not used (demo mode)'
            : rl
              ? `${rl.remaining} / ${rl.limit} left · resets at ${new Date(rl.resetAt).toLocaleTimeString()}`
              : 'Known after the first check'}
        </span>
      </Row>
      <Row label="Last successful check">
        <span className="text-[14px] text-zinc-400">{relativeTime(summary?.lastSuccessAt)}</span>
      </Row>
    </Card>
  )
}

function Advanced({ s, save }: SectionProps) {
  const { reloadRegistry, issues, projects } = useHub()
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => {
    void window.hub.app.info().then(setInfo)
  }, [])

  return (
    <Card title="Advanced">
      {import.meta.env.DEV && (
        <Row label="Demo mode" hint="Show bundled sample versions and installs instead of GitHub data (offline UI work). Development builds only.">
          <Toggle checked={s.advanced.demoMode} onChange={(v) => save({ advanced: { demoMode: v } })} />
        </Row>
      )}
      <Row label="Logs" hint="The app log and one log per download or installation.">
        <Button size="sm" variant="secondary" icon={<FolderOpen size={14} />} onClick={() => void window.hub.app.openLogs()}>
          Open logs folder
        </Button>
      </Row>
      <Row label="Debug mode" hint="More detail in the app log; F12 opens the developer tools.">
        <Toggle checked={s.advanced.debug} onChange={(v) => save({ advanced: { debug: v } })} />
      </Row>
      <Row label="Project registry" hint={`${projects.length} projects loaded${issues.length ? `, ${issues.length} issues` : ''}.`}>
        <Button
          size="sm"
          variant="secondary"
          icon={<RotateCw size={14} />}
          onClick={() => void reloadRegistry().then(() => toast({ tone: 'success', title: 'Registry reloaded' }))}
        >
          Reload
        </Button>
      </Row>
      <Row label="App data">
        {info && (
          <button onClick={() => void window.hub.app.openPath(info.userDataPath)} className="inline-flex items-center gap-2 text-[13px] text-zinc-400 hover:text-zinc-100">
            <FolderOpen size={15} /> Open folder
          </button>
        )}
      </Row>
      <Row label="Version">
        <span className="text-[14px] text-zinc-400">
          {info ? `${info.name} ${info.version} · Electron ${info.electron} · ${info.platform}` : '…'}
        </span>
      </Row>
    </Card>
  )
}

function Card({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line/[0.06] bg-ink-850">
      <div className="border-b border-line/[0.05] px-6 py-4">
        <h2 className="font-display text-[18px] font-bold uppercase tracking-[0.12em] text-fg">{title}</h2>
        {note && <p className="mt-1 text-[13px] text-zinc-500">{note}</p>}
      </div>
      <div className="divide-y divide-line/[0.04] px-6">{children}</div>
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-4">
      <div className="min-w-0">
        <div className="text-[14px] text-zinc-200">{label}</div>
        {hint && <div className="mt-0.5 text-[12.5px] text-zinc-500">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cx('relative h-6 w-11 rounded-full transition-colors', checked ? 'bg-tekken-500' : 'bg-ink-600')}
    >
      <span className={cx('absolute left-0 top-0.5 size-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} />
    </button>
  )
}
