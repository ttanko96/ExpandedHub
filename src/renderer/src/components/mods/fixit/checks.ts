import { isActive } from '@shared/operations'
import { hostProjectId } from '@shared/registry-schema'
import { projectActions } from '../actions'
import type { Area, Finding, FixContext } from './types'

const pick = (gameId: string) => ({ label: 'Choose file…', run: () => void window.hub.sources.pick(gameId) })

/** The checks every project gets, each limited to that project. */
export function commonChecks(ctx: FixContext): Record<Area, Finding[]> {
  return { install: installChecks(ctx), files: fileChecks(ctx), tools: toolChecks(ctx), downloads: downloadChecks(ctx) }
}

function installChecks({ project, state, projects, navigate, openInstall }: FixContext): Finding[] {
  const st = state
  const rec = st?.installed
  const hostId = hostProjectId(project)
  const host = hostId ? projects.find((p) => p.id === hostId) : undefined
  const hasBuild = project.install?.steps.some((s) => s.type === 'run' || s.type === 'pythonVenv' || s.type === 'buildHost') ?? false
  if (!st || !rec) {
    return [{ key: 'none', level: 'info', title: 'Not installed yet', detail: 'Install it, or link the copy you already have.', action: { label: 'Install', run: () => openInstall(project.id) } }]
  }
  if (st.missing) {
    return [
      {
        key: 'missing',
        level: 'fail',
        title: 'Its folder is not there',
        detail: `Moved, deleted, or on a drive that is not connected.\n${rec.installPath}`,
        action: host ? { label: `Open ${host.name}`, run: () => navigate(`/mods/${host.id}`) } : { label: 'Find it…', run: () => void projectActions.adopt(project) }
      }
    ]
  }
  const out: Finding[] = []
  if (project.install?.output.executable && !rec.executable) {
    out.push({
      key: 'exe',
      level: 'warn',
      title: 'The game’s program was not found in its folder',
      detail: rec.installPath,
      action: hasBuild ? { label: 'Build again', run: () => openInstall(project.id, 'build') } : { label: 'Reinstall', run: () => openInstall(project.id) }
    })
  }
  if (st.rebuild.length > 0) {
    out.push({ key: 'rebuild', level: 'warn', title: 'Needs Build again', detail: `Changed since its last build: ${st.rebuild.join(', ')}.`, action: { label: 'Build again', run: () => openInstall(project.id, 'build') } })
  }
  if (st.status === 'update-available') {
    out.push({ key: 'update', level: 'info', title: 'An update is available', detail: st.latest ? `Version ${st.latest.version}` : undefined, action: { label: 'Update', run: () => openInstall(project.id) } })
  }
  if (st.error) out.push({ key: 'check', level: 'warn', title: 'The last update check failed', detail: st.error })
  if (out.length === 0) out.push({ key: 'ok', level: 'ok', title: 'Installed and up to date', detail: rec.installPath })
  return out
}

function fileChecks({ project, games, sources }: FixContext): Finding[] {
  const needs = project.install?.sources ?? []
  if (needs.length === 0) return [{ key: 'none', level: 'ok', title: 'It needs no game files' }]
  return needs.map((req): Finding => {
    const name = games.find((g) => g.id === req.gameId)?.name ?? req.gameId
    const s = sources[req.gameId]
    const v = s?.validation
    if (!s) {
      return req.required
        ? { key: req.gameId, level: 'fail', title: `${name}: not set up`, detail: `Needed. ${req.purpose ?? ''}`.trim(), action: pick(req.gameId) }
        : { key: req.gameId, level: 'info', title: `${name}: not set up (optional)`, detail: req.purpose ? `Without it: no ${lower(req.purpose)}.` : undefined, action: pick(req.gameId) }
    }
    const recheck = { label: 'Check again', run: () => void window.hub.sources.validate(req.gameId) }
    if (s.validating) return { key: req.gameId, level: 'info', title: `${name}: being checked…` }
    if (!v) return { key: req.gameId, level: 'info', title: `${name}: not checked yet`, action: recheck }
    if (v.verdict === 'verified') return { key: req.gameId, level: 'ok', title: `${name}: verified`, detail: v.matched }
    if (v.verdict === 'identified' || v.verdict === 'unverified') return { key: req.gameId, level: 'info', title: `${name}: accepted`, detail: v.message }
    const why = v.verdict === 'missing' ? 'the file is gone' : v.verdict === 'mismatch' ? 'not the expected version' : 'cannot be read'
    return { key: req.gameId, level: req.required ? 'fail' : 'warn', title: `${name}: ${why}`, detail: `${v.message}\n${s.path}`, action: v.verdict === 'missing' ? pick(req.gameId) : recheck }
  })
}

function toolChecks({ project, preflight: pf, navigate }: FixContext): Finding[] {
  if (!pf) return [{ key: 'unknown', level: 'info', title: 'Could not be checked', detail: 'Install or Build again shows what it needs.' }]
  const out: Finding[] = []
  for (const d of pf.dependencies.filter((d) => !d.installed)) {
    out.push({ key: `dep:${d.id}`, level: 'fail', title: `Needs ${d.name}`, detail: `${d.name} is not installed.`, action: { label: `Open ${d.name}`, run: () => navigate(`/mods/${d.id}`) } })
  }
  for (const t of pf.tools) {
    if (t.problem) {
      out.push({ key: `tool:${t.id}`, level: 'warn', title: `${t.name}: the chosen one does not work`, detail: `${t.problem}${t.path ? `\n${t.path}` : ''}`, action: { label: 'Locate…', run: () => void window.hub.tools.pick(t.id) } })
      continue
    }
    if (t.found !== false) continue
    const fetched = pf.provisions.some((x) => x.toolId === t.id)
    out.push({
      key: `tool:${t.id}`,
      level: t.optional || fetched ? 'info' : 'warn',
      title: `${t.name} not found${t.optional ? ' (optional)' : ''}`,
      detail: fetched ? 'The hub downloads it on the next install or build.' : 'Install it, or show the hub where it is.',
      action: fetched ? undefined : { label: 'Locate…', run: () => void window.hub.tools.pick(t.id) }
    })
  }
  if (out.length === 0) out.push({ key: 'ok', level: 'ok', title: pf.tools.length + pf.dependencies.length > 0 ? 'Everything it needs is there' : `${project.name} needs no other tools` })
  return out
}

function downloadChecks({ project, operations, navigate }: FixContext): Finding[] {
  const ops = operations.filter((o) => o.projectId === project.id)
  const out: Finding[] = []
  const running = ops.find(isActive)
  if (running) out.push({ key: 'running', level: 'info', title: `A ${running.kind} is running`, action: { label: 'Downloads', run: () => navigate('/downloads') } })
  // Only the newest finished operation matters: an older failure was retried or replaced since.
  const last = [...ops].filter((o) => !isActive(o)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  for (const o of last?.status === 'failed' ? [last] : []) {
    out.push({
      key: o.id,
      level: 'fail',
      title: `The last ${o.kind === 'tool' ? 'tool download' : o.kind} failed`,
      detail: [o.error, o.hint].filter(Boolean).join('\n') || undefined,
      action: { label: 'Retry', run: () => void window.hub.operations.retry(o.id) }
    })
  }
  const paused = ops.filter((o) => o.status === 'paused')
  if (paused.length > 0) out.push({ key: 'paused', level: 'info', title: `${paused.length} paused`, action: { label: 'Downloads', run: () => navigate('/downloads') } })
  if (out.length === 0) out.push({ key: 'ok', level: 'ok', title: 'No failed or stuck downloads' })
  return out
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

/** The file name's extension, lowercase, without the dot. */
export const ext = (path: string | undefined) => (path?.match(/\.([^.\\/]+)$/)?.[1] ?? '').toLowerCase()
