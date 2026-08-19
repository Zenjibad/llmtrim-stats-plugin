/**
 * llmtrim-stats-plugin — host half.
 *
 * Reads the llmtrim interceptor's live ledger by running `llmtrim status --json`
 * (the same command the CLI dashboard uses) through the `subprocess` service,
 * reshapes it into a clean snapshot, and serves it to the client bundle over an
 * HTTP route (`GET /llmtrim-stats/api`).
 *
 * Runtime note: packaged profile plugins are real Node modules, so Date works;
 * external commands go through the `subprocess` service (same pattern as
 * headroom-stats-plugin / deepseek-cost-usage-status-plugin).
 */
import type { Context } from '@deepseek-ai/cordis'

export const name = 'llmtrim-stats-plugin'

// Hard dependencies: webServer (serves the stats route), subprocess (runs
// `llmtrim status --json`).
export const inject = ['webServer', 'subprocess']

/** A plain JSON snapshot returned to the client. */
export interface LlmtrimSnapshot {
  ok: boolean
  error?: string
  command?: string
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

export function apply(ctx: Context): void {
  const webServer = (ctx as unknown as { webServer: WebServerLike }).webServer
  const sub = ctx.get('subprocess') as SubprocessLike | undefined

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
            meta: { fetchedAt: new Date().toISOString(), schemaVersion: 1 },
          }
          json(res, 200, { ok: true, ...snapshot })
        } catch (e) {
          json(res, 200, { ok: false, error: String((e as Error)?.message ?? e) })
        }
      },
    }),
  )
}
