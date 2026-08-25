# llmtrim-stats-plugin · Live llmtrim Savings Dashboard for DeepSeek Harness (DSH)

> Show **real-time llmtrim savings** inside the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) Web UI: a full dashboard in Settings plus a rotating carousel stats strip under the composer. 在 DSH 内实时展示 llmtrim 压节省统计：设置页完整仪表盘 + 输入区轮播统计条。
>
> 中文文档: [README.zh.md](README.zh.md) · LLM index: [llms.txt](llms.txt) · Agent guide: [AGENTS.md](AGENTS.md)

![dsh-plugin](https://img.shields.io/badge/dsh--plugin-ready-4c8dff) ![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-✓-0f1115) ![license](https://img.shields.io/badge/license-MIT-green) ![install](https://img.shields.io/badge/dsh%20plugin%20add-✓-22c55e)

**Keywords**: `dsh-plugin` · `deepseek-harness-plugin` · llmtrim · compression · tokens · savings · stats · dashboard · carousel

---

## 📑 Table of Contents

- [✨ Features](#-features)
- [🏗️ How it works](#️-how-it-works)
- [🚀 Quick start](#-quick-start)
- [⚙️ Configuration](#️-configuration)
- [❓ FAQ](#-faq)
- [⚠️ Security notes](#️-security-notes)
- [📦 Project structure](#-project-structure)
- [🙏 Credits](#-credits)

---

## ✨ Features

| Feature | Description |
| --- | --- |
| 📊 **Settings dashboard** | Settings → llmtrim Stats: KPI cards (**You paid / Would have cost / Saved today / Saved this week** + tokens trimmed, requests, net saved re-priced), daemon health badge + version, per-model table (model / requests / saved % / USD) |
| 🎠 **Configurable carousel** | Composer strip under the chat input: choose **Rotating** (cycle one stat at a time) or **Static** (show every selected stat at once, fixed) — pick exactly which stats appear; refreshed every 5s |
| 💵 **Four money cards** | You paid (`money.paid_usd`), Would have cost (`money.would_have_usd`), Saved today (`money.saved_today_usd`), Saved this week (prorated: current-week (Monday-start) token share × lifetime `money.saved_usd` — llmtrim reports no weekly USD) |
| 🔗 **Lives off the real CLI** | The host runs `llmtrim status --json` (the same command as `llmtrim status`) via the `subprocess` service — no ledger-file parsing, always consistent with the CLI |
| 🩺 **Daemon health at a glance** | The dashboard shows a green/amber badge (daemon healthy / stopped) plus the binary version |
| 🌗 **Theme-aware** | All colors use `--dsw-alias-*` design tokens; follows light/dark automatically |
| ♨️ **Survives restarts** | Real profile-bundled plugin: install once with `dsh plugin add`, auto-loads on every DSH boot — no per-session define, no cordis_define |

## 🏗️ How it works

```
llmtrim interceptor (daemon :43117) ──writes──> ~/.local/share/llmtrim/tracking.db
                                  │
Host half (DSH process)           ▼
  └─ subprocess service: resolveExecutable('llmtrim') → spawn llmtrim status --json
  └─ reshape → { daemon, totals, money, cost, byModel }
  └─ settings namespace `llmtrim-stats` { mode, staticStats } (carousel config)
  └─ webServer routes: GET /llmtrim-stats/api (snapshot incl. config)
                       PUT /llmtrim-stats/config (persist carousel choice)
                                  │
Client bundle (browser)           ▼
  └─ single 5s poller → fetch(/llmtrim-stats/api) → snapshot fan-out to two seats
       ├─ settings.section (id llmtrim-stats)      → full dashboard + carousel config
       └─ conversation.composer.dock (id llmtrim-carousel) → rotating or static strip
```

- **Pure pull from the CLI**: no ledger parsing, no events, no file watching; `llmtrim` missing or `status --json` failing → `{ok:false,error}`, UI shows unavailable, polling self-recovers.
- **Read-only**: the plugin never writes to llmtrim's directory or ledger.
- **Persistence**: ships `dsh.bundle` (`cordis.patch.yml`) + `dsh.client` (`exports["./client"]`, bundled) so it installs as a real profile plugin that the DSH client-modules scanner loads on every boot.

## 🚀 Quick start

### Standard install: `dsh plugin add` (persists across restarts)

Install the package from this GitHub repo:

```bash
# local directory (from the parent of this repo):
dsh plugin --profile web add ./llmtrim-stats-plugin

# or directly from GitHub (any DSH machine):
dsh plugin --profile web add github:Zenjibad/llmtrim-stats-plugin
# or:
dsh plugin --profile web add git+https://github.com/Zenjibad/llmtrim-stats-plugin.git
```

`dsh plugin add` is a pnpm add into the profile plus a `dsh.profile.bundles` reconcile: seeing this package's `dsh.bundle` declaration, it appends `llmtrim-stats-plugin` to the bundle stack. **Restart DSH, then hard-refresh the browser tab** (`Ctrl+F5`). On boot the client-modules scanner resolves `exports["./client"]` and the dashboard + carousel appear. No per-session define, survives restarts.

> ⚠️ **Important**: after installing (or updating) a client plugin, a **hard page refresh** (`Ctrl+F5`) is required — the DSH client HMR only hot-swaps already-loaded bundles and does not pull in *new* bundles into an open tab.

### Manual profile mount (alternative)

1. `git clone https://github.com/Zenjibad/llmtrim-stats-plugin.git` (any location).
2. Add to `~/.dsh/profiles/web/package.json` `dependencies`: `"llmtrim-stats-plugin": "link:<repo-path>"`, then `pnpm install` in the profile dir.
3. Restart DSH.

### Requirements

- `llmtrim` installed and on PATH (`npm i -g @llmtrim/cli` — the plugin resolves it via the `subprocess` service; override with `LLMTRIM_BIN` if it's somewhere unusual).
- The llmtrim daemon should be running for live numbers; the plugin works (showing stopped/zero) without it.

## ⚙️ Configuration

The carousel is configurable from the Settings page (persisted in the `llmtrim-stats` settings namespace, written via `PUT /llmtrim-stats/config`):

| Setting | Values | Effect |
| --- | --- | --- |
| **Mode** | `rotating` (default) / `static` | Rotating cycles one stat at a time through the selected stats every 4 s; Static shows **every selected stat at once**, fixed (no rotation) |
| **Stats** | 9 checkboxes (all on by default) | Which stats appear in the carousel: Saved today, Saved total, You paid, Would have cost, Saved this week, Tokens trimmed, Requests, Input saved, Round-trip |

Fixed constants in source:

| Knob | Location | Default |
| --- | --- | --- |
| HTTP routes | `src/index.ts` | `GET /llmtrim-stats/api`, `PUT /llmtrim-stats/config` |
| Executable resolution | `resolveLlmtrim` in `src/index.ts` | `subprocess.resolveExecutable('llmtrim')`, fallback `LLMTRIM_BIN`, then the npm win32-x64 path |
| Poll interval | `POLL_MS` in `src/client/index.tsx` | 5 s |
| Carousel cadence | `CAROUSEL_MS` in `src/client/index.tsx` | 4 s |
| Settings seat | `src/client/index.tsx` | `settings.section` id `llmtrim-stats`, order 80 |
| Dock seat | `src/client/index.tsx` | `conversation.composer.dock` id `llmtrim-carousel`, order 15 |

## ❓ FAQ

**Q: The dashboard/carousel is missing?**
A: Restart DSH (if the host half isn't mounted yet), then **hard-refresh the browser tab** (`Ctrl+F5`). New client bundles only appear on a full page reload — the HMR client does not add new bundles to an already-open tab.

**Q: It says "llmtrim stats are unavailable"?**
A: The host couldn't run `llmtrim status --json`. Check `llmtrim --version` works in a shell; if it's not on PATH, set `LLMTRIM_BIN` to the absolute exe path and restart DSH.

**Q: The carousel shows zeros / "daemon stopped"?**
A: The daemon isn't running (`llmtrim start`), or the ledger is empty. Start the daemon and the numbers populate on the next 5s poll.

**Q: "Saved (proxy bills)" vs "Net saved (re-priced)" differ?**
A: Both come straight from `llmtrim status --json` — `money.saved_usd` (per-turn frozen rates) vs `cost.net_saved_usd` (re-priced at current list rates). They're different views of the same traffic; llmtrim's own CLI shows the same distinction.

**Q: How is "Saved this week" computed?**
A: llmtrim reports money only for the lifetime (`money.saved_usd`) and today (`money.saved_today_usd`); its `by_period` rows carry tokens but no USD (daily `2026-08-19` keys by default). The plugin therefore prorates: input tokens this week (Monday-start) ÷ lifetime input tokens × lifetime saved. It updates as the ledger grows.

**Q: Can I make the carousel show only one stat, or stop it rotating?**
A: Yes — Settings → llmtrim Stats → Carousel: set Mode to **Static** and tick exactly the stats you want. Static shows every selected stat at once (fixed, no rotation); a single tick pins it to that one stat. Rotating mode cycles one stat at a time through the ticked stats. A green "Saved ✓" appears after each change; the choice is persisted and survives restarts.

**Q: How do I remove it?**
A: `dsh plugin --profile web rm llmtrim-stats-plugin` (or delete the profile dependency + bundle entry) and restart DSH.

## ⚠️ Security notes

- **Read-only**: the plugin only runs `llmtrim status --json` and never writes to llmtrim's files or ledger.
- **Same-origin route**: the client polls `/llmtrim-stats/api` on the DSH origin only.
- **No credentials**: the plugin reads no API keys, tokens, or secrets — only the public savings snapshot.
- **Small outputs**: `status --json` stdout is capped at 512 KB.

## 📦 Project structure

```
llmtrim-stats-plugin/
├── src/
│   ├── index.ts            # host half: resolve llmtrim, spawn status --json, reshape, /llmtrim-stats/api + /llmtrim-stats/config routes, settings namespace
│   └── client/index.tsx    # client bundle: 5s poller, settings dashboard, configurable dock carousel
├── cordis.patch.yml        # dsh.bundle patch (inserts the plugin row on boot)
├── tsdown.config.ts        # bundles host (node ESM) + client (CJS ModuleLoader)
├── package.json            # name, exports["./client"], dsh.client + dsh.bundle
├── lib/                    # build output (index.js, client.js)
├── AGENTS.md               # repository guide for AI agents
├── llms.txt / llms-full.txt
├── README.md / README.zh.md
└── LICENSE
```

## 🙏 Credits

- [llmtrim](https://github.com/fkiene/llmtrim) — the compression interceptor and `llmtrim status --json` data source.
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — the DSH plugin/dynamic runtime, Slots, theme, webServer, client-modules.
- [headroom-stats-plugin](https://github.com/Zenjibad/headroom-stats-plugin) — reference for the packaged client-plugin build pattern (tsdown host/client split, `cordis.patch.yml`, `dsh.client`, settings + dock seats).

## 📄 License

[MIT](LICENSE)

## Repo

[![llmtrim-stats-plugin on GitHub](https://img.shields.io/badge/GitHub-Zenjibad%2Fllmtrim--stats--plugin-181717?logo=github)](https://github.com/Zenjibad/llmtrim-stats-plugin)

Requires DSH ≥ 0.1 with the web profile.
