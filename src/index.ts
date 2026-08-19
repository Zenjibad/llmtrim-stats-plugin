/**
 * llmtrim-stats-plugin — host half.
 *
 * Reads the llmtrim interceptor's live ledger by running `llmtrim status --json`
 * (the same command the CLI dashboard uses) through the `subprocess` service,
 * reshapes it into a clean snapshot, and serves it to the client bundle over an
 * HTTP route (`GET /llmtrim-stats/api`).
 *
 * Also owns the `llmtrim-stats` settings namespace (carousel mode + which stats
 * to show), exposed via `PUT /llmtrim-stats/config` and embedded in the
 * snapshot so the client gets it in one poll.
 *
 * Runtime note: packaged profile plugins are real Node modules, so Date works;
 * external commands go through the `subprocess` service (same pattern as
 * headroom-stats-plugin / deepseek-cost-usage-status-plugin).
 */
import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'llmtrim-stats-plugin'

// Hard dependencies: webServer (serves the routes), subprocess (runs
// `llmtrim status --json`), settings (persists the carousel config).
export const inject = ['webServer', 'subprocess', 'settings']

export const NAMESPACE = 'llmtrim-stats'

/** Carousel configuration persisted in the settings namespace. */
export interface LlmtrimConfig {
  mode: 'rotating' | 'static'
  staticStats: string[]
}

/** All carousel slide keys (also the static-mode stat list). */
export const STAT_KEYS = [
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

/** Default carousel config: rotating, all stats. */
const BASE_CONFIG: LlmtrimConfig = { mode: 'rotating', staticStats: [...STAT_KEYS] }

/** A plain JSON snapshot returned to the client. */
export interface LlmtrimSnapshot {
  ok: boolean
  error?: string
  command?: string
  config?: LlmtrimConfig
  daemon?: {
    running: boolean
    health: string | null
    version: string | null
    autostart: boolean
    uptimeSecs: number | null
  }
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
  money?: {
    savedUsd: number
    savedTodayUsd: number
    paidUsd: number
    wouldHaveUsd: number
    savedWeekUsd: number
    turns: number
  }
  cost?: {
    savedUsd: number
    spendUsd: number
    netSavedUsd: number
    roundTripPct: number
  }
  byModel?: Array<{
    model: string
    requests: number
    savedPct: number | null
    costSavedUsd: number
  }>
  meta?: {
    fetchedAt: string
    schemaVersion: number
  }
}

/** Minimal subprocess service surface (typed loosely to avoid a hard dep). */
interface SubprocessLike {
  resolveExecutable(command: string): Promise<string>
  spawn(spec: {
    argv: readonly string[]
    cwd: string
    stdio: { stdin: string; stdout: { maxBytes: number }; stderr: string }
    graceMs?: number
  }): {
    done: Promise<{ exitCode: number | null; signal: unknown }>
    collected: { stdout: { readFrom(offset: number): { text: string } } }
  }
}

interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: unknown, res: any) => void | Promise<void>
  }): () => void
}

interface SettingsLike {
  register(ns: string, schema: unknown, opts: { base: LlmtrimConfig }): unknown
  get(ns: string): LlmtrimConfig
  update(ns: string, patch: Partial<LlmtrimConfig>): Promise<void>
}

function json(res: any, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function num0(v: unknown): number {
  const n = num(v)
  return n === null ? 0 : n
}

/** Resolve the llmtrim executable via the subprocess service. */
async function resolveLlmtrim(sub: SubprocessLike): Promise<string> {
  try {
    // Resolve the real executable, NOT the bare name: on Windows, bare
    // `llmtrim` resolves to npm's `.cmd` shim (PATHEXT walks `.CMD` before
    // reaching `%LOCALAPPDATA%\llmtrim\bin\llmtrim.exe`), and spawning a `.cmd`
    // without a shell throws EINVAL. `llmtrim.exe` forces the exe extension.
    const name = process.platform === 'win32' ? 'llmtrim.exe' : 'llmtrim'
    return await sub.resolveExecutable(name)
  } catch {
    // Fall back to a known npm-managed location if PATH resolution failed.
    const candidates = [
      process.env.LLMTRIM_BIN,
      'C:\\Users\\Administrator\\AppData\\Roaming\\npm\\node_modules\\@llmtrim\\win32-x64\\bin\\llmtrim.exe',
    ]
    for (const c of candidates) if (c) return c
    throw new Error('llmtrim executable not found on PATH (run `npm i -g @llmtrim/cli`)')
  }
}

/** Run `llmtrim status --json` and capture stdout. */
async function fetchLlmtrimStatus(sub: SubprocessLike, exe: string): Promise<any> {
  const handle = sub.spawn({
    argv: [exe, 'status', '--json'],
    cwd: process.env.USERPROFILE ?? '.',
    stdio: { stdin: 'ignore', stdout: { maxBytes: 512 * 1024 }, stderr: 'ignore' },
    graceMs: 15000,
  })
  const result = await handle.done
  if (result.exitCode !== 0) throw new Error(`llmtrim status exited ${String(result.exitCode)}`)
  const out = handle.collected.stdout.readFrom(0).text
  return JSON.parse(out)
}

/** ISO week number (Monday-start) of a Date, matching llmtrim's `2026-W33` period keys. */
function isoWeekOf(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = (t.getUTCDay() + 6) % 7 // Mon=0
  t.setUTCDate(t.getUTCDate() - day + 3)
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4))
  const firstDay = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3)
  const week = 1 + Math.round((t.getTime() - firstThursday.getTime()) / (7 * 86400000))
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/**
 * llmtrim's `by_period` rows carry tokens but no money; `money` is always
 * lifetime. "Saved this week" is therefore prorated: the current-ISO-week
 * token share × lifetime saved. Mirrors llmtrim's own period math.
 */
function computeSavedWeekUsd(raw: any): number {
  const periods = Array.isArray(raw?.by_period) ? raw.by_period : []
  const totalInput = num0(raw?.input?.before)
  if (totalInput <= 0 || periods.length === 0) return 0
  const currentWeek = isoWeekOf(new Date())
  const weekInput = periods
    .filter((p: any) => String(p?.period ?? '').startsWith(currentWeek))
    .reduce((sum: number, p: any) => sum + num0(p?.input_before), 0)
  if (weekInput <= 0) return 0
  return (weekInput / totalInput) * num0(raw?.money?.saved_usd)
}

export function apply(ctx: Context): void {
  const webServer = (ctx as unknown as { webServer: WebServerLike }).webServer
  const sub = ctx.get('subprocess') as SubprocessLike | undefined
  const settings = ctx.get('settings') as SettingsLike | undefined

  // Settings namespace: mode + which stats the carousel shows.
  if (settings !== undefined) {
    const schema = z.object({
      mode: z.union([z.const('rotating'), z.const('static')]),
      staticStats: z.array(z.string()),
    })
    settings.register(NAMESPACE, schema, { base: BASE_CONFIG })
  }

  const getConfig = (): LlmtrimConfig => {
    const cfg = settings?.get(NAMESPACE)
    if (cfg && cfg.mode === 'static') {
      const valid = Array.isArray(cfg.staticStats)
        ? cfg.staticStats.filter((s) => (STAT_KEYS as readonly string[]).includes(s))
        : []
      return { mode: 'static', staticStats: valid.length > 0 ? valid : [...STAT_KEYS] }
    }
    return { mode: 'rotating', staticStats: [...STAT_KEYS] }
  }

  ctx.effect(() =>
    webServer.register({
      kind: 'exact',
      path: '/llmtrim-stats/api',
      handler: async (_req, res) => {
        try {
          if (sub === undefined) {
            json(res, 503, { ok: false, error: 'subprocess service unavailable' })
            return
          }
          const exe = await resolveLlmtrim(sub)
          const raw = await fetchLlmtrimStatus(sub, exe)
          const snapshot: Omit<LlmtrimSnapshot, 'ok' | 'error'> = {
            command: exe,
            config: getConfig(),
            daemon: {
              running: !!raw?.daemon?.running,
              health: typeof raw?.daemon?.health === 'string' ? raw.daemon.health : null,
              version: typeof raw?.daemon?.version === 'string' ? raw.daemon.version : null,
              autostart: !!raw?.daemon?.autostart,
              uptimeSecs: num(raw?.daemon?.uptime_secs),
            },
            totals: {
              requests: num0(raw?.requests),
              tokensTrimmed: Math.max(0, num0(raw?.input?.before) - num0(raw?.input?.after)),
              inputBefore: num0(raw?.input?.before),
              inputAfter: num0(raw?.input?.after),
              inputSavedPct: num(raw?.input?.saved_pct),
              outputBefore: num0(raw?.output?.before),
              outputAfter: num0(raw?.output?.after),
              outputSavedPct: num(raw?.output?.saved_pct),
              cacheReadTokens: num0(raw?.cache_read_tokens),
              addedLatencyMs: num(raw?.added_latency_ms),
            },
            money: {
              savedUsd: num0(raw?.money?.saved_usd),
              savedTodayUsd: num0(raw?.money?.saved_today_usd),
              paidUsd: num0(raw?.money?.paid_usd),
              wouldHaveUsd: num0(raw?.money?.would_have_usd),
              savedWeekUsd: computeSavedWeekUsd(raw),
              turns: num0(raw?.money?.turns),
            },
            cost: {
              savedUsd: num0(raw?.cost?.saved_usd),
              spendUsd: num0(raw?.cost?.spend_usd),
              netSavedUsd: num0(raw?.cost?.net_saved_usd),
              roundTripPct: num(raw?.cost?.round_trip_pct) ?? 0,
            },
            byModel: Array.isArray(raw?.by_model)
              ? raw.by_model.map((m: any) => ({
                  model: String(m?.model ?? 'unknown'),
                  requests: num0(m?.requests),
                  savedPct: num(m?.saved_pct),
                  costSavedUsd: num0(m?.cost_saved_usd),
                }))
              : [],
            meta: { fetchedAt: new Date().toISOString(), schemaVersion: 2 },
          }
          json(res, 200, { ok: true, ...snapshot })
        } catch (e) {
          json(res, 200, { ok: false, error: String((e as Error)?.message ?? e) })
        }
      },
    }),
  )

  // Config update route: PUT { mode, staticStats } → persisted via settings.
  ctx.effect(() =>
    webServer.register({
      kind: 'exact',
      path: '/llmtrim-stats/config',
      handler: async (req: any, res) => {
        try {
          if (settings === undefined) {
            json(res, 503, { ok: false, error: 'settings service unavailable' })
            return
          }
          const body = await new Promise<string>((resolve, reject) => {
            let data = ''
            req.on('data', (c: Buffer) => {
              data += c.toString('utf8')
              if (data.length > 65536) {
                reject(new Error('config payload too large'))
                req.destroy()
              }
            })
            req.on('end', () => resolve(data))
            req.on('error', reject)
          })
          const parsed = JSON.parse(body) as { mode?: string; staticStats?: unknown }
          const mode = parsed.mode === 'static' ? 'static' : 'rotating'
          const stats = Array.isArray(parsed.staticStats)
            ? parsed.staticStats.filter((s): s is string => typeof s === 'string' && (STAT_KEYS as readonly string[]).includes(s))
            : [...STAT_KEYS]
          await settings.update(NAMESPACE, { mode, staticStats: mode === 'static' ? stats : [...STAT_KEYS] })
          json(res, 200, { ok: true, config: getConfig() })
        } catch (e) {
          json(res, 400, { ok: false, error: String((e as Error)?.message ?? e) })
        }
      },
    }),
  )
}
