import z from "@deepseek-ai/schemastery";

//#region src/index.ts
const name = "llmtrim-stats-plugin";
const inject = [
	"webServer",
	"subprocess",
	"settings"
];
const NAMESPACE = "llmtrim-stats";
const STAT_KEYS = [
	"savedToday",
	"savedTotal",
	"youPaid",
	"wouldHave",
	"savedWeek",
	"tokensTrimmed",
	"requests",
	"inputSavedPct",
	"roundTripPct"
];
/** Default carousel config: rotating, all stats. */
const BASE_CONFIG = {
	mode: "rotating",
	staticStats: [...STAT_KEYS]
};
function json(res, status, body) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(JSON.stringify(body));
}
function num(v) {
	return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function num0(v) {
	const n = num(v);
	return n === null ? 0 : n;
}
/** Resolve the llmtrim executable via the subprocess service. */
async function resolveLlmtrim(sub) {
	try {
		const name$1 = process.platform === "win32" ? "llmtrim.exe" : "llmtrim";
		return await sub.resolveExecutable(name$1);
	} catch {
		const candidates = [process.env.LLMTRIM_BIN, "C:\\Users\\Administrator\\AppData\\Roaming\\npm\\node_modules\\@llmtrim\\win32-x64\\bin\\llmtrim.exe"];
		for (const c of candidates) if (c) return c;
		throw new Error("llmtrim executable not found on PATH (run `npm i -g @llmtrim/cli`)");
	}
}
/** Run `llmtrim status --json` and capture stdout. */
async function fetchLlmtrimStatus(sub, exe) {
	const handle = sub.spawn({
		argv: [
			exe,
			"status",
			"--json"
		],
		cwd: process.env.USERPROFILE ?? ".",
		stdio: {
			stdin: "ignore",
			stdout: { maxBytes: 524288 },
			stderr: "ignore"
		},
		graceMs: 15e3
	});
	const result = await handle.done;
	if (result.exitCode !== 0) throw new Error(`llmtrim status exited ${String(result.exitCode)}`);
	const out = handle.collected.stdout.readFrom(0).text;
	return JSON.parse(out);
}
/** ISO week number (Monday-start) of a Date, matching llmtrim's `2026-W33` period keys. */
function isoWeekOf(d) {
	const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
	const day = (t.getUTCDay() + 6) % 7;
	t.setUTCDate(t.getUTCDate() - day + 3);
	const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
	const firstDay = (firstThursday.getUTCDay() + 6) % 7;
	firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
	const week = 1 + Math.round((t.getTime() - firstThursday.getTime()) / 6048e5);
	return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
/**
* llmtrim's `by_period` rows carry tokens but no money; `money` is always
* lifetime. "Saved this week" is therefore prorated: the current-ISO-week
* token share × lifetime saved. Mirrors llmtrim's own period math.
*/
function computeSavedWeekUsd(raw) {
	const periods = Array.isArray(raw?.by_period) ? raw.by_period : [];
	const totalInput = num0(raw?.input?.before);
	if (totalInput <= 0 || periods.length === 0) return 0;
	const currentWeek = isoWeekOf(new Date());
	const weekInput = periods.filter((p) => String(p?.period ?? "").startsWith(currentWeek)).reduce((sum, p) => sum + num0(p?.input_before), 0);
	if (weekInput <= 0) return 0;
	return weekInput / totalInput * num0(raw?.money?.saved_usd);
}
function apply(ctx) {
	const webServer = ctx.webServer;
	const sub = ctx.get("subprocess");
	const settings = ctx.get("settings");
	if (settings !== undefined) {
		const schema = z.object({
			mode: z.union([z.const("rotating"), z.const("static")]),
			staticStats: z.array(z.string())
		});
		settings.register(NAMESPACE, schema, { base: BASE_CONFIG });
	}
	const getConfig = () => {
		const cfg = settings?.get(NAMESPACE);
		if (cfg && cfg.mode === "static") {
			const valid = Array.isArray(cfg.staticStats) ? cfg.staticStats.filter((s) => STAT_KEYS.includes(s)) : [];
			return {
				mode: "static",
				staticStats: valid.length > 0 ? valid : [...STAT_KEYS]
			};
		}
		return {
			mode: "rotating",
			staticStats: [...STAT_KEYS]
		};
	};
	ctx.effect(() => webServer.register({
		kind: "exact",
		path: "/llmtrim-stats/api",
		handler: async (_req, res) => {
			try {
				if (sub === undefined) {
					json(res, 503, {
						ok: false,
						error: "subprocess service unavailable"
					});
					return;
				}
				const exe = await resolveLlmtrim(sub);
				const raw = await fetchLlmtrimStatus(sub, exe);
				const snapshot = {
					command: exe,
					config: getConfig(),
					daemon: {
						running: !!raw?.daemon?.running,
						health: typeof raw?.daemon?.health === "string" ? raw.daemon.health : null,
						version: typeof raw?.daemon?.version === "string" ? raw.daemon.version : null,
						autostart: !!raw?.daemon?.autostart,
						uptimeSecs: num(raw?.daemon?.uptime_secs)
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
						addedLatencyMs: num(raw?.added_latency_ms)
					},
					money: {
						savedUsd: num0(raw?.money?.saved_usd),
						savedTodayUsd: num0(raw?.money?.saved_today_usd),
						paidUsd: num0(raw?.money?.paid_usd),
						wouldHaveUsd: num0(raw?.money?.would_have_usd),
						savedWeekUsd: computeSavedWeekUsd(raw),
						turns: num0(raw?.money?.turns)
					},
					cost: {
						savedUsd: num0(raw?.cost?.saved_usd),
						spendUsd: num0(raw?.cost?.spend_usd),
						netSavedUsd: num0(raw?.cost?.net_saved_usd),
						roundTripPct: num(raw?.cost?.round_trip_pct) ?? 0
					},
					byModel: Array.isArray(raw?.by_model) ? raw.by_model.map((m) => ({
						model: String(m?.model ?? "unknown"),
						requests: num0(m?.requests),
						savedPct: num(m?.saved_pct),
						costSavedUsd: num0(m?.cost_saved_usd)
					})) : [],
					meta: {
						fetchedAt: new Date().toISOString(),
						schemaVersion: 2
					}
				};
				json(res, 200, {
					ok: true,
					...snapshot
				});
			} catch (e) {
				json(res, 200, {
					ok: false,
					error: String(e?.message ?? e)
				});
			}
		}
	}));
	ctx.effect(() => webServer.register({
		kind: "exact",
		path: "/llmtrim-stats/config",
		handler: async (req, res) => {
			try {
				if (settings === undefined) {
					json(res, 503, {
						ok: false,
						error: "settings service unavailable"
					});
					return;
				}
				const body = await new Promise((resolve, reject) => {
					let data = "";
					req.on("data", (c) => {
						data += c.toString("utf8");
						if (data.length > 65536) {
							reject(new Error("config payload too large"));
							req.destroy();
						}
					});
					req.on("end", () => resolve(data));
					req.on("error", reject);
				});
				const parsed = JSON.parse(body);
				const mode = parsed.mode === "static" ? "static" : "rotating";
				const stats = Array.isArray(parsed.staticStats) ? parsed.staticStats.filter((s) => typeof s === "string" && STAT_KEYS.includes(s)) : [...STAT_KEYS];
				await settings.update(NAMESPACE, {
					mode,
					staticStats: mode === "static" ? stats : [...STAT_KEYS]
				});
				json(res, 200, {
					ok: true,
					config: getConfig()
				});
			} catch (e) {
				json(res, 400, {
					ok: false,
					error: String(e?.message ?? e)
				});
			}
		}
	}));
}

//#endregion
export { NAMESPACE, STAT_KEYS, apply, inject, name };