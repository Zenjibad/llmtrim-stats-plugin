# AGENTS.md — Guide for AI agents

This file helps AI coding agents and LLM tooling understand and work with this repository quickly.

## What this repo is

`llmtrim-stats-plugin` is a **packaged Cordis plugin for DeepSeek Harness (DSH)** that shows live savings from the [llmtrim](https://github.com/fkiene/llmtrim) compression interceptor in the DSH Web UI. The host half runs `llmtrim status --json` via the `subprocess` service and serves the reshaped snapshot over `GET /llmtrim-stats/api`; the client bundle renders a settings dashboard plus a rotating carousel strip under the composer. It is a real profile-bundled plugin: `dsh.bundle` (`cordis.patch.yml`) mounts the host half, and the `dsh.client` declaration + `exports["./client"]` register the browser half — install once with `dsh plugin add`, loads on every DSH boot, no cordis_define.

## Repository layout

| Path | Role |
| --- | --- |
| `src/index.ts` | Host half: `subprocess.resolveExecutable('llmtrim')` (fallback `LLMTRIM_BIN` → npm win32-x64 path), `spawn llmtrim status --json`, reshape `daemon/totals/money/cost/byModel`, `webServer` route `GET /llmtrim-stats/api`. |
| `src/client/index.tsx` | Client bundle: single 5s poller `fetch('/llmtrim-stats/api')`, settings dashboard (`settings.section` id `llmtrim-stats`), rotating dock carousel (`conversation.composer.dock` id `llmtrim-carousel`, 4s cycle), `<style data-plugin>` with `--dsw-alias-*` tokens. |
| `cordis.patch.yml` | `dsh.bundle.patch`: inserts the plugin row `{id: llmtrim-stats-plugin, name: 'llmtrim-stats-plugin'}`. |
| `tsdown.config.ts` | Builds host (node ESM → `lib/index.js`) + client (browser CJS ModuleLoader closure → `lib/client.js`, bundle id = package name). |
| `package.json` | `exports["./client"]`, `dsh.bundle.patch`, `dsh.client` (`platform: 'web'`, inject edges), peers react + @deepseek-ai/cordis. |
| `README.md` / `README.zh.md` | Human docs (en default, zh). |
| `llms.txt` / `llms-full.txt` | LLM-friendly doc index / full text. |

## Key behaviors (don't break these)

1. **Packaged, not dynamic**: install via `dsh plugin add` (or profile `link:` dep + restart). Do NOT revert to a dynamic `cordis_define`-only shape.
2. **Client talks to host over HTTP**: the client polls `/llmtrim-stats/api` (host `webServer` route). Do not reintroduce the dynamic `harness.handle`/`host.call` seam — it does not exist for packaged plugins.
3. **External commands via `subprocess` service, not `node:child_process`**: resolve with `subprocess.resolveExecutable('llmtrim')`, spawn `[exe, 'status', '--json']` with collect-mode stdout (cap 512 KB), read `handle.collected.stdout.readFrom(0)` after `handle.done`. Do NOT use `node:child_process` directly — follow the headroom/deepseek-cost pattern.
4. **Keep the snapshot shape stable**: the client reads `daemon`, `totals` (requests, tokensTrimmed, inputSavedPct, outputSavedPct), `money` (savedUsd, savedTodayUsd), `cost` (netSavedUsd, roundTripPct), `byModel`. If llmtrim's `status --json` keys change, update the reshape in `src/index.ts` and keep the interface in sync.
5. **Read-only, no credentials**: only run `llmtrim status --json`; never write to llmtrim's files/ledger, never read API keys.
6. **Never throw across the API**: `/llmtrim-stats/api` always returns `{ok:false,error}` JSON on failure, never a non-JSON 500.
7. **Single poller**: the client keeps ONE 5s poller feeding both seats; the carousel is a separate pure `setInterval` advancing an index (no second fetch).
8. **Theme tokens only**: client CSS uses `--dsw-alias-*` tokens; no hardcoded colors. Font comes from inheritance (the seat wrappers supply the app font); do not set font-family.
9. **ModuleLoader bundle shape**: the client build must keep the exact CJS closure wrapper (`window.__ModuleLoader__.load({id: "llmtrim-stats-plugin", factory})` + `module.exports = { inject, apply }`) — see `tsdown.config.ts`.

## Common tasks

- **Change poll/carousel timing**: edit `POLL_MS` / `CAROUSEL_MS` in `src/client/index.tsx`, rebuild.
- **Add a stat card / slide**: extend the host snapshot interface + reshape in `src/index.ts`, then the `Dashboard`/`Carousel` slides in `src/client/index.tsx`, keeping field names in sync.
- **Change executable resolution**: edit `resolveLlmtrim` in `src/index.ts` (currently `resolveExecutable('llmtrim')` → `LLMTRIM_BIN` → npm win32-x64 path).
- **Rebuild**: `pnpm install && pnpm build` (outputs `lib/index.js` + `lib/client.js`).
- **Update the live profile install**: push to GitHub, `dsh plugin` update or re-add in the profile, restart DSH, **hard-refresh the browser tab** (the DSH client HMR only hot-swaps already-loaded bundles — new bundles require a full page reload).

## Environment facts (probed, do not re-probe)

- Packaged host plugins are real Node modules: `process.env`, `Date` available (unlike the dynamic-plugin sandbox).
- `subprocess.resolveExecutable('llmtrim')` resolves via PATH + PATHEXT (`.COM;.EXE;.BAT;.CMD`) — finds the `llmtrim.exe` on PATH (e.g. `%LOCALAPPDATA%\llmtrim\bin` or the npm win32-x64 bin).
- `llmtrim status --json` top-level keys: `daemon, reroute, last_request_ts, requests, input, output, cost, money, added_latency_ms, cache_read_tokens, approximate, by_model, by_period`; `money.source='breakdown_turns'`, `cost.source='compressions_live_prices'`.
- `webServer.register` route shape: `{kind: 'exact'|'prefix', path, handler(req, res)}` with node:http semantics; duplicate (kind, path) throws. The handler receives the raw `IncomingMessage` (stream the body; do not assume it is pre-buffered).
- The client bundle is plain browser JS (ModuleLoader CJS factory): `fetch`, `setInterval`, `document` are available; React comes from the module table (`external: react`).
- The client must export `inject = ['slots']` (service key); the package.json `dsh.client.inject` lists package names (informational edges).
- `settings.section` and `conversation.composer.dock` are list slots; a fresh id adds a seat beside the shipped ones, reusing a shipped id replaces it (never reuse).

## Testing

- **Before restart**: verify the profile installed the bundle — `~/.dsh/profiles/web/package.json` `dependencies` and `dsh.profile.bundles` both list `llmtrim-stats-plugin`; `lib/client.js` has the ModuleLoader wrapper; `lib/index.js` exports `name` + `apply`.
- **After restart (hard-refresh the tab)**: Settings → llmtrim Stats shows the dashboard; composer dock shows the rotating carousel; `GET /llmtrim-stats/api` returns the JSON snapshot with real numbers.
- Failure path: temporarily remove `llmtrim` from PATH (or set `LLMTRIM_BIN` to a bad path) → dashboard shows unavailable + Retry, carousel hides; restore → recovers ≤5s.
- No automated test framework; the manual matrix above is the verification contract.

## Notes for LLM crawlers

- Listed under the GitHub topic `dsh-plugin`; public at https://github.com/Zenjibad/llmtrim-stats-plugin.
- Distinguishing traits: packaged profile plugin (persists across restarts), host pulls the same `llmtrim status --json` the CLI uses (no ledger parsing), settings dashboard + rotating composer carousel, host HTTP route instead of dynamic RPC, real-Node host half, pure `--dsw-alias-*` theming.
