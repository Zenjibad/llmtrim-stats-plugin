/**
 * llmtrim-stats-plugin — client half (browser bundle).
 *
 * Polls the host's `/llmtrim-stats/api` route every 5s and renders the
 * snapshot into two DSH seats:
 *   - settings.section  (id `llmtrim-stats`) — full dashboard + carousel config
 *   - conversation.composer.dock (id `llmtrim-carousel`) — rotating or static stats strip
 *
 * Carousel behaviour is configurable (persisted via the host's settings
 * namespace, delivered inside the snapshot): `mode` rotating | static, and
 * `staticStats` (which stats to show when static / which to cycle when rotating).
 *
 * This bundle ships as `exports["./client"]` (CJS ModuleLoader factory),
 * discovered via the `dsh.client` declaration in package.json.
 */
import React from 'react'
import type { Context } from '@deepseek-ai/cordis'

export const inject = ['slots']

const API = '/llmtrim-stats/api'
const CONFIG_API = '/llmtrim-stats/config'
const POLL_MS = 5000
const CAROUSEL_MS = 4000

const STAT_KEYS = [
  'savedToday',
  'savedTotal',
  'youPaid',
  'wouldHave',
  'savedWeek',
  'tokensTrimmed',
  'requests',
  'inputSavedPct',
  'roundTripPct',
] as const

type StatKey = (typeof STAT_KEYS)[number]

interface Config {
  mode: 'rotating' | 'static'
  staticStats: string[]
}

interface Snapshot {
  ok: boolean
  error?: string
  command?: string
  config?: Config
  daemon?: { running: boolean; health: string | null; version: string | null; autostart: boolean; uptimeSecs: number | null }
  totals?: {
    requests: number
    tokensTrimmed: number
    inputBefore: number
    inputAfter: number
    inputSavedPct: number | null
    outputBefore: number
    outputAfter: number
    outputSavedPct: number | null
    cacheReadTokens: number
    addedLatencyMs: number | null
  }
  money?: { savedUsd: number; savedTodayUsd: number; paidUsd: number; wouldHaveUsd: number; savedWeekUsd: number; turns: number }
  cost?: { savedUsd: number; spendUsd: number; netSavedUsd: number; roundTripPct: number }
  byModel?: Array<{ model: string; requests: number; savedPct: number | null; costSavedUsd: number }>
  meta?: { fetchedAt: string; schemaVersion: number }
}

function fmtTokens(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(Math.round(n))
}
function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return '$' + n.toFixed(2)
}
function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return n.toFixed(1) + '%'
}

/** Build the ordered list of stat slides from a snapshot. */
function buildSlides(d: Snapshot): Array<{ key: StatKey; label: string; value: string }> {
  const m = d.money
  const t = d.totals
  const c = d.cost
  return [
    { key: 'savedToday', label: 'Saved today', value: fmtUsd(m?.savedTodayUsd) },
    { key: 'savedTotal', label: 'Saved total', value: fmtUsd(m?.savedUsd) },
    { key: 'youPaid', label: 'You paid', value: fmtUsd(m?.paidUsd) },
    { key: 'wouldHave', label: 'Would have cost', value: fmtUsd(m?.wouldHaveUsd) },
    { key: 'savedWeek', label: 'Saved this week', value: fmtUsd(m?.savedWeekUsd) },
    { key: 'tokensTrimmed', label: 'Tokens trimmed', value: fmtTokens(t?.tokensTrimmed ?? 0) },
    { key: 'requests', label: 'Requests', value: String(t?.requests ?? 0) },
    { key: 'inputSavedPct', label: 'Input saved', value: fmtPct(t?.inputSavedPct) },
    { key: 'roundTripPct', label: 'Round-trip', value: fmtPct(c?.roundTripPct) },
  ]
}

export function apply(ctx: Context): void {
  const slots = ctx.get('slots') as
    | {
        inject(name: string, callback: () => () => void): void
        register(
          options: { name: string; id: string; order?: number; label?: string | (() => string) },
          component: (props: unknown) => React.ReactNode,
        ): () => void
      }
    | undefined
  if (slots === undefined) return

  const style = document.createElement('style')
  style.dataset.plugin = 'llmtrim-stats-plugin'
  style.textContent = [
    '.lts-section{width:100%;max-width:760px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:14px;display:flex}',
    '.lts-status{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;margin:0}',
    '.lts-failure{color:var(--dsw-alias-state-error-primary);align-items:center;gap:10px;display:flex}',
    '.lts-failure p{margin:0}',
    '.lts-failure button{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;background:0 0;border-radius:6px;padding:4px 10px}',
    '.lts-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}',
    '.lts-card{padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:10px}',
    '.lts-card-label{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);text-transform:uppercase;letter-spacing:.04em}',
    '.lts-card-value{font-size:20px;font-weight:600;line-height:28px;margin-top:2px;font-variant-numeric:tabular-nums}',
    '.lts-card-sub{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);margin-top:2px}',
    '.lts-heading{display:flex;align-items:baseline;gap:7px;padding:0 2px}',
    '.lts-heading h3{font-size:13px;font-weight:600;line-height:20px;margin:0}',
    '.lts-heading span{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:12px;line-height:18px}',
    '.lts-badge{font-size:11px;line-height:16px;padding:0 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);display:inline-block}',
    '.lts-badge[data-ok="true"]{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}',
    '.lts-badge[data-ok="false"]{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}',
    '.lts-table{width:100%;border-collapse:collapse;font-size:13px}',
    '.lts-table th{text-align:left;font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary);text-transform:uppercase;letter-spacing:.04em;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l2)}',
    '.lts-table td{padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);font-variant-numeric:tabular-nums}',
    '.lts-config{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:10px}',
    '.lts-config-row{display:flex;align-items:center;gap:8px;font-size:13px}',
    '.lts-config-row label{display:flex;align-items:center;gap:6px;cursor:pointer}',
    '.lts-config-row input[type="radio"],.lts-config-row input[type="checkbox"]{accent-color:var(--dsw-alias-brand-primary)}',
    '.lts-config-stats{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:13px}',
    '.lts-config-stats label{display:flex;align-items:center;gap:6px;cursor:pointer}',
    '.lts-dock{display:flex;align-items:center;gap:8px;min-width:0}',
    '.lts-dock-key{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
    '.lts-dock-value{font-size:12px;line-height:20px;color:var(--dsw-alias-label-primary);white-space:nowrap;font-variant-numeric:tabular-nums}',
    '.lts-dock-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}',
    '.lts-dock-dot[data-ok="true"]{background:var(--dsw-alias-state-success-primary)}',
    '.lts-dock-dot[data-ok="false"]{background:var(--dsw-alias-state-warn-primary)}',
    '.lts-carousel-enter{animation:lts-fade .35s ease}',
    '@keyframes lts-fade{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}',
  ].join('')
  document.head.appendChild(style)
  ctx.effect(() => () => {
    style.remove()
  })

  /** Shared snapshot store + poller. */
  function useSnapshot(): { data: Snapshot | null; failed: boolean; reload: () => void } {
    const [data, setData] = React.useState<Snapshot | null>(null)
    const [failed, setFailed] = React.useState(false)
    const reload = React.useCallback(() => {
      void fetch(API, { cache: 'no-store' })
        .then((res) => res.json() as Promise<Snapshot>)
        .then((snap) => {
          setData(snap)
          setFailed(!snap.ok)
        })
        .catch(() => setFailed(true))
    }, [])
    React.useEffect(() => {
      reload()
      const t = setInterval(reload, POLL_MS)
      return () => clearInterval(t)
    }, [reload])
    return { data, failed, reload }
  }

  /** Persist the carousel config via the host. */
  function saveConfig(config: Config): Promise<void> {
    return fetch(CONFIG_API, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(config),
    }).then((res) => {
      if (!res.ok) throw new Error('config save failed')
    })
  }

  /** Settings dashboard. */
  function Dashboard(): React.ReactElement {
    const { data, failed, reload } = useSnapshot()
    const h = React.createElement
    if (failed && (data === null || !data.ok)) {
      return h('div', { className: 'lts-section' },
        h('div', { className: 'lts-failure' },
          h('p', { role: 'alert' }, 'llmtrim stats are unavailable.'),
          h('button', { type: 'button', onClick: reload }, 'Retry'),
        ),
      )
    }
    const d = data?.ok ? data : null
    const cfg: Config = d?.config ?? { mode: 'rotating', staticStats: [...STAT_KEYS] }
    const stats: Record<StatKey, string> = {
      savedToday: fmtUsd(d?.money?.savedTodayUsd),
      savedTotal: fmtUsd(d?.money?.savedUsd),
      youPaid: fmtUsd(d?.money?.paidUsd),
      wouldHave: fmtUsd(d?.money?.wouldHaveUsd),
      savedWeek: fmtUsd(d?.money?.savedWeekUsd),
      tokensTrimmed: d?.totals ? fmtTokens(d.totals.tokensTrimmed) : '—',
      requests: d?.totals ? String(d.totals.requests) : '—',
      inputSavedPct: fmtPct(d?.totals?.inputSavedPct),
      roundTripPct: fmtPct(d?.cost?.roundTripPct),
    }
    const statLabels: Record<StatKey, string> = {
      savedToday: 'Saved today',
      savedTotal: 'Saved total',
      youPaid: 'You paid',
      wouldHave: 'Would have cost',
      savedWeek: 'Saved this week',
      tokensTrimmed: 'Tokens trimmed',
      requests: 'Requests',
      inputSavedPct: 'Input saved',
      roundTripPct: 'Round-trip',
    }

    const onMode = (mode: Config['mode']) => {
      const next: Config = { mode, staticStats: cfg.staticStats.length > 0 ? cfg.staticStats : [...STAT_KEYS] }
      void saveConfig(next).then(reload).catch(() => undefined)
    }
    const onToggleStat = (key: StatKey) => {
      const has = cfg.staticStats.includes(key)
      const next: Config = {
        mode: cfg.mode,
        staticStats: has ? cfg.staticStats.filter((s) => s !== key) : [...cfg.staticStats, key],
      }
      void saveConfig(next).then(reload).catch(() => undefined)
    }

    return h('div', { className: 'lts-section' },
      h('div', { className: 'lts-heading' },
        h('h3', null, 'llmtrim savings'),
        d?.daemon
          ? h('span', { className: 'lts-badge', 'data-ok': String(d.daemon.running) },
              d.daemon.running ? 'daemon healthy' : 'daemon stopped')
          : null,
        h('span', null, d?.daemon?.version ?? ''),
      ),
      h('div', { className: 'lts-cards' },
        h('div', { className: 'lts-card' }, h('div', { className: 'lts-card-label' }, 'You paid'),
          h('div', { className: 'lts-card-value' }, stats.youPaid),
          h('div', { className: 'lts-card-sub' }, 'total billed')),
        h('div', { className: 'lts-card' }, h('div', { className: 'lts-card-label' }, 'Would have cost'),
          h('div', { className: 'lts-card-value' }, stats.wouldHave),
          h('div', { className: 'lts-card-sub' }, 'uncompressed')),
        h('div', { className: 'lts-card' }, h('div', { className: 'lts-card-label' }, 'Saved today'),
          h('div', { className: 'lts-card-value' }, stats.savedToday),
          h('div', { className: 'lts-card-sub' }, 'per-turn ledger')),
        h('div', { className: 'lts-card' }, h('div', { className: 'lts-card-label' }, 'Saved this week'),
          h('div', { className: 'lts-card-value' }, stats.savedWeek),
          h('div', { className: 'lts-card-sub' }, 'prorated by tokens')),
        h('div', { className: 'lts-card' }, h('div', { className: 'lts-card-label' }, 'Tokens trimmed'),
          h('div', { className: 'lts-card-value' }, stats.tokensTrimmed),
          h('div', { className: 'lts-card-sub' }, fmtPct(d?.totals?.inputSavedPct) + ' input')),
        h('div', { className: 'lts-card' }, h('div', { className: 'lts-card-label' }, 'Requests'),
          h('div', { className: 'lts-card-value' }, stats.requests),
          h('div', { className: 'lts-card-sub' }, fmtPct(d?.totals?.outputSavedPct) + ' output')),
        h('div', { className: 'lts-card' }, h('div', { className: 'lts-card-label' }, 'Net saved (re-priced)'),
          h('div', { className: 'lts-card-value' }, fmtUsd(d?.cost?.netSavedUsd)),
          h('div', { className: 'lts-card-sub' }, fmtPct(d?.cost?.roundTripPct) + ' round-trip')),
      ),
      h('div', { className: 'lts-heading' }, h('h3', null, 'Carousel')),
      h('div', { className: 'lts-config' },
        h('div', { className: 'lts-config-row' },
          h('label', null, h('input', { type: 'radio', name: 'lts-mode', checked: cfg.mode === 'rotating', onChange: () => onMode('rotating') }), 'Rotating'),
          h('label', null, h('input', { type: 'radio', name: 'lts-mode', checked: cfg.mode === 'static', onChange: () => onMode('static') }), 'Static'),
        ),
        h('div', { className: 'lts-config-stats' },
          STAT_KEYS.map((key) =>
            h('label', { key },
              h('input', { type: 'checkbox', checked: cfg.staticStats.includes(key), onChange: () => onToggleStat(key) }),
              statLabels[key],
            ),
          ),
        ),
      ),
      h('div', { className: 'lts-heading' }, h('h3', null, 'Per model'), h('span', null, String(d?.byModel?.length ?? 0))),
      h('table', { className: 'lts-table' },
        h('thead', null, h('tr', null,
          h('th', null, 'Model'), h('th', null, 'Requests'), h('th', null, 'Saved'), h('th', null, 'USD'))),
        h('tbody', null,
          (d?.byModel ?? []).length === 0
            ? h('tr', null, h('td', { colSpan: 4 }, 'No model data yet.'))
            : (d?.byModel ?? []).map((m) =>
                h('tr', { key: m.model },
                  h('td', null, m.model),
                  h('td', null, String(m.requests)),
                  h('td', null, fmtPct(m.savedPct)),
                  h('td', null, fmtUsd(m.costSavedUsd)),
                ),
              ),
        ),
      ),
    )
  }

  /** Composer dock: rotating or static stats strip. */
  function Carousel(): React.ReactElement | null {
    const { data, failed } = useSnapshot()
    const [idx, setIdx] = React.useState(0)
    React.useEffect(() => {
      const t = setInterval(() => setIdx((i) => i + 1), CAROUSEL_MS)
      return () => clearInterval(t)
    }, [])

    if (failed && (data === null || !data.ok)) return null
    const d = data?.ok ? data : null
    if (d === null) return null

    const all = buildSlides(d)
    const cfg: Config = d.config ?? { mode: 'rotating', staticStats: [...STAT_KEYS] }
    // In static mode only the selected stats show; in rotating mode cycle all.
    const pool =
      cfg.mode === 'static' && cfg.staticStats.length > 0
        ? all.filter((s) => cfg.staticStats.includes(s.key))
        : all
    if (pool.length === 0) return null
    const slide = pool[idx % pool.length] ?? pool[0]
    if (slide === undefined) return null

    return React.createElement(
      'div',
      { className: 'lts-dock', key: slide.key + String(idx) },
      React.createElement('span', { className: 'lts-dock-dot', 'data-ok': String(d.daemon?.running ?? false) }),
      React.createElement('span', { className: 'lts-dock-key' }, slide.label),
      React.createElement('span', { className: 'lts-dock-value lts-carousel-enter' }, slide.value),
    )
  }

  slots.inject('settings.section', () =>
    slots.register(
      { name: 'settings.section', id: 'llmtrim-stats', order: 80, label: () => 'llmtrim Stats' },
      () => React.createElement(Dashboard),
    ),
  )
  slots.inject('conversation.composer.dock', () =>
    slots.register(
      { name: 'conversation.composer.dock', id: 'llmtrim-carousel', order: 15 },
      () => React.createElement(Carousel),
    ),
  )
}
