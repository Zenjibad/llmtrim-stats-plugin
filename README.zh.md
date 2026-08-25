# llmtrim-stats-plugin · DSH 实时 llmtrim 压节省统计面板

> 在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) Web UI 内**实时展示** [llmtrim](https://github.com/fkiene/llmtrim) 的压节省统计：设置页完整仪表盘 + 输入区轮播统计条。
>
> English: [README.md](README.md) · LLM 索引: [llms.txt](llms.txt) · Agent 指南: [AGENTS.md](AGENTS.md)

![dsh-plugin](https://img.shields.io/badge/dsh--plugin-ready-4c8dff) ![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-✓-0f1115) ![license](https://img.shields.io/badge/license-MIT-green) ![install](https://img.shields.io/badge/dsh%20plugin%20add-✓-22c55e)

**关键词 / Keywords**: `dsh-plugin` · `deepseek-harness-plugin` · llmtrim · compression · tokens · savings · stats · dashboard · carousel

---

## 📑 目录

- [✨ 特性](#-特性)
- [🏗️ 工作原理](#️-工作原理)
- [🚀 快速开始](#-快速开始)
- [⚙️ 配置](#️-配置)
- [❓ 常见问题](#-常见问题)
- [⚠️ 安全须知](#️-安全须知)
- [📦 项目结构](#-项目结构)
- [🙏 致谢](#-致谢)

---

## ✨ 特性

| 特性 | 说明 |
| --- | --- |
| 📊 **设置页仪表盘** | 设置 → llmtrim Stats：KPI 卡片（**已支付 / 未压缩应付 / 今日节省 / 本周节省** + token 削减、请求数、按现价重估净节省）、守护进程健康徽章 + 版本号、按模型表格（模型 / 请求数 / 节省 % / USD） |
| 🎠 **可配置轮播条** | 聊天输入框下方统计条：选择 **轮播**（每次切换一个统计）或 **静态**（同时显示所有勾选统计、不轮转）——自由挑选展示哪些统计，每 5 秒刷新 |
| 💵 **四张金额卡片** | 已支付（`money.paid_usd`）、未压缩应付（`money.would_have_usd`）、今日节省（`money.saved_today_usd`）、本周节省（按本周（周一起）token 占比 × 累计 `money.saved_usd` 折算——llmtrim 不提供周度美元额） |
| 🔗 **与官方 CLI 一致** | Host 通过 `subprocess` 服务运行 `llmtrim status --json`（与 `llmtrim status` 相同命令）——不解析账本文件，始终与 CLI 一致 |
| 🩺 **守护进程健康一目了然** | 仪表盘显示绿/黄徽章（守护进程健康 / 已停止）与二进制版本号 |
| 🌗 **主题自适应** | 全部颜色使用 `--dsw-alias-*` 设计令牌，亮/暗色自动跟随 |
| ♨️ **重启常驻** | 真实 profile 打包插件：`dsh plugin add` 安装一次，每次 DSH 启动自动加载 —— 无需 cordis_define、无需每次重装 |

## 🏗️ 工作原理

```
llmtrim 拦截器（守护进程 :43117）──写入──> ~/.local/share/llmtrim/tracking.db
                                  │
Host 半区（DSH 进程内）            ▼
  └─ subprocess 服务：resolveExecutable('llmtrim') → spawn llmtrim status --json
  └─ 重塑 → { daemon, totals, money, cost, byModel }
  └─ settings 命名空间 `llmtrim-stats` { mode, staticStats }（轮播配置）
  └─ webServer 路由：GET /llmtrim-stats/api（快照含配置）
                     PUT /llmtrim-stats/config（持久化轮播选择）
                                  │
Client 半区（浏览器）              ▼
  └─ 单一 5s 轮询 fetch(/llmtrim-stats/api) → 快照分发到两个席位
       ├─ settings.section (id llmtrim-stats)      → 完整仪表盘 + 轮播配置
       └─ conversation.composer.dock (id llmtrim-carousel) → 轮播或静态条
```

- **纯拉取**：不解析账本、无事件、无文件监听；`llmtrim` 缺失或 `status --json` 失败 → `{ok:false,error}`，UI 显示不可用，轮询自动恢复。
- **只读**：插件从不写入 llmtrim 的目录或账本。
- **持久化**：随包声明 `dsh.bundle`（`cordis.patch.yml`）+ `dsh.client`（`exports["./client"]` 打包产物），作为真实 profile 插件安装，DSH client-modules 每次启动都会扫描加载。

## 🚀 快速开始

### 标准安装：`dsh plugin add`（重启常驻）

从本仓库安装：

```bash
# 本地目录（在本仓库父目录执行）：
dsh plugin --profile web add ./llmtrim-stats-plugin

# 或直接从 GitHub（任意 DSH 机器）：
dsh plugin --profile web add github:Zenjibad/llmtrim-stats-plugin
# 或：
dsh plugin --profile web add git+https://github.com/Zenjibad/llmtrim-stats-plugin.git
```

`dsh plugin add` = 向 profile 做 pnpm add + `dsh.profile.bundles` 协调：识别到本包的 `dsh.bundle` 声明后，把 `llmtrim-stats-plugin` 追加进 bundle 栈。**重启 DSH，然后硬刷新浏览器标签页**（`Ctrl+F5`）。启动时 client-modules 扫描器解析 `exports["./client"]`，仪表盘与轮播条出现。无需 cordis_define，重启后依旧。

> ⚠️ **注意**：安装（或更新）客户端插件后必须**硬刷新页面**（`Ctrl+F5`）——DSH 客户端 HMR 只会热替换已加载的 bundle，不会把*新增*的 bundle 注入已打开的标签页。

### 手动挂载（备选）

1. `git clone https://github.com/Zenjibad/llmtrim-stats-plugin.git`（任意位置）。
2. 在 `~/.dsh/profiles/web/package.json` 的 `dependencies` 加 `"llmtrim-stats-plugin": "link:<仓库路径>"`，然后在 profile 目录 `pnpm install`。
3. 重启 DSH。

### 使用前提

- 本机已安装 `llmtrim` 且在 PATH 上（`npm i -g @llmtrim/cli`——插件通过 `subprocess` 服务解析；路径特殊时可用 `LLMTRIM_BIN` 覆盖）。
- 实时数字需要 llmtrim 守护进程在运行；未运行时插件照常工作（显示已停止/零值）。

## ⚙️ 配置

轮播条可在设置页配置（持久化到 `llmtrim-stats` settings 命名空间，通过 `PUT /llmtrim-stats/config` 写入）：

| 设置项 | 取值 | 效果 |
| --- | --- | --- |
| **模式** | `rotating`（默认）/ `static` | 轮播：每 4 秒在所选统计中切换一个；静态：**同时显示所有勾选统计**、固定不轮转 |
| **统计项** | 9 个复选框（默认全选） | 轮播条显示哪些统计：今日节省、累计节省、已支付、未压缩应付、本周节省、token 削减、请求数、输入节省、往返节省 |

固定常量见源码：

| 可调项 | 位置 | 默认值 |
| --- | --- | --- |
| HTTP 路由 | `src/index.ts` | `GET /llmtrim-stats/api`、`PUT /llmtrim-stats/config` |
| 可执行文件解析 | `src/index.ts` 中的 `resolveLlmtrim` | `subprocess.resolveExecutable('llmtrim')`，回退 `LLMTRIM_BIN`，再回退 npm win32-x64 路径 |
| 轮询间隔 | `src/client/index.tsx` 中的 `POLL_MS` | 5 秒 |
| 轮播节奏 | `src/client/index.tsx` 中的 `CAROUSEL_MS` | 4 秒 |
| 设置页席位 | `src/client/index.tsx` | `settings.section` id `llmtrim-stats`，顺序 80 |
| 轮播席位 | `src/client/index.tsx` | `conversation.composer.dock` id `llmtrim-carousel`，顺序 15 |

## ❓ 常见问题

**Q: 仪表盘/轮播条不见了？**
A: 先重启 DSH（如果 Host 半区尚未挂载），再**硬刷新浏览器标签页**（`Ctrl+F5`）。新增的客户端 bundle 只有整页刷新才会加载——HMR 不会把新 bundle 加进已打开的标签页。

**Q: 显示「llmtrim stats 不可用」？**
A: Host 无法运行 `llmtrim status --json`。请在 shell 里确认 `llmtrim --version` 可用；若不在 PATH 上，设置 `LLMTRIM_BIN` 为绝对 exe 路径后重启 DSH。

**Q: 轮播条显示零 / 「守护进程已停止」？**
A: 守护进程未运行（`llmtrim start`），或账本为空。启动守护进程后，下一次 5 秒轮询即会填充数字。

**Q: 「代理账单节省」与「按现价重估净节省」为何不同？**
A: 两者都直接来自 `llmtrim status --json`——`money.saved_usd`（按每次对话冻结费率）与 `cost.net_saved_usd`（按当前列表价重估）。它们是同一批流量的不同视角；llmtrim 官方 CLI 也展示同样的区别。

**Q: 「本周节省」如何计算？**
A: llmtrim 只按生命周期（`money.saved_usd`）与今日（`money.saved_today_usd`）报告金额；其 `by_period` 行只带 token 不带 USD（默认为 `2026-08-19` 形式的按日键）。因此插件按比例折算：本周（周一起）输入 token ÷ 累计输入 token × 累计节省。随账本增长而更新。

**Q: 能不能让轮播条只显示一个统计、或停止轮播？**
A: 可以——设置 → llmtrim Stats → Carousel：把模式设为 **Static** 并勾选你想要的统计，静态模式会**同时显示所有勾选统计**（固定不轮转），只勾选一个即固定显示单条。轮播模式则每次切换一个勾选统计。每次修改后会出现绿色「Saved ✓」提示；选择会持久化并跨重启保留。

**Q: 如何彻底移除？**
A: `dsh plugin --profile web rm llmtrim-stats-plugin`（或删除 profile 依赖与 bundle 条目）后重启 DSH。

## ⚠️ 安全须知

- **只读**：插件只运行 `llmtrim status --json`，从不写入 llmtrim 的文件或账本。
- **同源路由**：客户端仅轮询 DSH 同源的 `/llmtrim-stats/api`。
- **不接触凭据**：插件不读取任何 API 密钥、token 或机密——只读取公开的节省快照。
- **小输出**：`status --json` 的 stdout 上限 512 KB。

## 📦 项目结构

```
llmtrim-stats-plugin/
├── src/
│   ├── index.ts            # host 半区：解析 llmtrim、spawn status --json、重塑、/llmtrim-stats/api 与 /llmtrim-stats/config 路由、settings 命名空间
│   └── client/index.tsx    # client 包：5s 轮询、设置页仪表盘、可配置轮播统计条
├── cordis.patch.yml        # dsh.bundle patch（启动时插入插件行）
├── tsdown.config.ts        # 打包 host（node ESM）+ client（CJS ModuleLoader）
├── package.json            # name、exports["./client"]、dsh.client + dsh.bundle
├── lib/                    # 构建产物（index.js、client.js）
├── AGENTS.md               # AI agent 仓库指南
├── llms.txt / llms-full.txt
├── README.md / README.zh.md
└── LICENSE
```

## 🙏 致谢

- [llmtrim](https://github.com/fkiene/llmtrim) — 压缩拦截器与 `llmtrim status --json` 数据源。
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — DSH 插件/动态运行时、Slots、主题、webServer、client-modules。
- [headroom-stats-plugin](https://github.com/Zenjibad/headroom-stats-plugin) — 打包式 client 插件构建模式参考（tsdown host/client 拆分、`cordis.patch.yml`、`dsh.client`、设置页 + 轮播席位）。

## 📄 License

[MIT](LICENSE)

## Repo

[![llmtrim-stats-plugin on GitHub](https://img.shields.io/badge/GitHub-Zenjibad%2Fllmtrim--stats--plugin-181717?logo=github)](https://github.com/Zenjibad/llmtrim-stats-plugin)

Requires DSH ≥ 0.1 with the web profile.
