
//#region src/index.ts
const name = "llmtrim-stats-plugin";
const inject = ["webServer", "subprocess"];
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
function apply(ctx) {
	const webServer = ctx.webServer;
	const sub = ctx.get("subprocess");
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
						schemaVersion: 1
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
}

//#endregion
export { apply, inject, name };