/**
 * llmtrim-stats-plugin — client half (browser bundle).
 *
 * Polls the host's `/llmtrim-stats/api` route every 5s and renders the
 * snapshot into two DSH seats:
 *   - settings.section  (id `llmtrim-stats`) — full dashboard
 *   - conversation.composer.dock (id `llmtrim-carousel`) — rotating stats strip
 *
 * This bundle ships as `exports["./client"]` (CJS ModuleLoader factory),
 * discovered via the `dsh.client` declaration in package.json.
 */
import React from 'react'
import type { Context } from '@deepseek-ai/cordis'

export const inject = ['slots']

const API = '/llmtrim-stats/api'
const POLL_MS = 5000
const CAROUSEL_MS = 4000

interface Snapshot {
  ok: boolean
  error?: string
  command?: string
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
  money?: { savedUsd: number; savedTodayUsd: number; paidUsd: number; wouldHaveUsd: number; turns: number }
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
function fmtUsd(n: number): string {
  return '$' + n.toFixed(2)
}
function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return n.toFixed(1) + '%'
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
    '.lts-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}',
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
        h('div', { className: 'lts-card' }, h('div', { className: 'lts-card-label' }, 'Saved (proxy bills)'),
          h('div', { className: 'lts-card-value' }, d?.money ? fmtUsd(d.money.savedUsd) : '—'),
          h('div', { className: 'lts-card-sub' }, d?.money ? 'today ' + fmtUsd(d.money.savedTodayUsd) : '')),
        h('div', { className: 'lts-card' }, h('div', { className: 'lts-card-label' }, 'Tokens trimmed'),
          h('div', { className: 'lts-card-value' }, d?.totals ? fmtTokens(d.totals.tokensTrimmed) : '—'),
          h('div', { className: 'lts-card-sub' }, d?.totals ? fmtPct(d.totals.inputSavedPct) + ' input' : '')),
        h('div', { className: 'lts-card' }, h('div', { className: 'lts-card-label' }, 'Requests'),
          h('div', { className: 'lts-card-value' }, d?.totals ? String(d.totals.requests) : '—'),
          h('div', { className: 'lts-card-sub' }, d?.totals ? fmtPct(d.totals.outputSavedPct) + ' output' : '')),
        h('div', { className: 'lts-card' }, h('div', { className: 'lts-card-label' }, 'Net saved (re-priced)'),
          h('div', { className: 'lts-card-value' }, d?.cost ? fmtUsd(d.cost.netSavedUsd) : '—'),
          h('div', { className: 'lts-card-sub' }, d?.cost ? fmtPct(d.cost.roundTripPct) + ' round-trip' : '')),
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

  /** Rotating composer dock carousel. */
  function Carousel(): React.ReactElement | null {
    const { data, failed } = useSnapshot()
    const [idx, setIdx] = React.useState(0)
    React.useEffect(() => {
      const t = setInterval(() => setIdx((i) => i + 1), CAROUSEL_MS)
      return () => clearInterval(t)
    }, [])

    if (failed && (data === null || !data.ok)) return null
    const d = data?.ok ? data : null
    if (d === null || d.totals === undefined || d.money === undefined) return null

    const slides: Array<{ key: string; value: string }> = [
      { key: 'Saved today', value: fmtUsd(d.money.savedTodayUsd) },
      { key: 'Saved total', value: fmtUsd(d.money.savedUsd) },
      { key: 'Tokens trimmed', value: fmtTokens(d.totals.tokensTrimmed) },
      { key: 'Requests', value: String(d.totals.requests) },
      { key: 'Input saved', value: fmtPct(d.totals.inputSavedPct) },
      { key: 'Round-trip', value: fmtPct(d.cost?.roundTripPct) },
    ]
    const slide = slides[idx % slides.length] ?? slides[0]
    if (slide === undefined) return null

    return React.createElement(
      'div',
      { className: 'lts-dock', key: slide.key + String(idx) },
      React.createElement('span', { className: 'lts-dock-dot', 'data-ok': String(d.daemon?.running ?? false) }),
      React.createElement('span', { className: 'lts-dock-key' }, slide.key),
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
