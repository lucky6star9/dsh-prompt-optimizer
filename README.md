# Prompt Optimizer

**A [DeepSeek Harness](https://github.com/deepseek-ai) (DSH) plugin that upgrades a prompt against the current project's stack, structure, and conventions.**

Manually triggered via a composer icon button and an agent tool — it never auto-rewrites anything.

---

[English](#english) | [中文](#中文)

---

## English

### What it does

Click the **light bulb** icon next to the send button. The plugin reads your workspace's file structure, key config files (`package.json`, `tsconfig.json`, etc.), and source code conventions, sends them together with your draft prompt to the LLM, and writes back an optimized version. The optimization notes appear in a panel above the input box.

### Features

| Feature | Description |
|---------|-------------|
| **Icon button** | Sits left of the send button in the composer toolbar — a yellow circular button with a light bulb icon |
| **Agent tool** | `optimize_prompt` is available to any agent in the session |
| **Slash command** | `/optimize <text>` for direct use |
| **Notes panel** | Shows above the input box with optimization rationale; auto-dismisses when you clear the draft |
| **Bilingual** | English and Chinese UI strings |
| **Theme-aware** | Uses DSH's CSS variable tokens, works in both light and dark themes |

### How it works

No background service, no separate process. The plugin registers callbacks into DSH's Cordis runtime:

| Half | File | Runs in | Registers |
|------|------|---------|-----------|
| Host | `index.js` | DSH backend | `optimize_prompt` tool + `/optimize` slash command |
| Client | `client.js` | DSH web UI | composer button + notes panel + locale dictionaries |

When you click the button, the client sends the draft to the host via DSH's existing remote-command channel. The host gathers project context (working directory + code structure + key file contents, capped at ~6000 chars), calls the LLM through `ctx.llm.stream()`, parses the reply, and returns the optimized prompt + notes.

### Project context gathering

The host scans the working directory for:

- **Stack markers** — `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, etc.
- **Config docs** — `README.md`, `CONTRIBUTING.md`, `.editorconfig`, etc.
- **Toolchain files** — `tsconfig.json`, `.eslintrc`, `prettier.config.js`, etc.
- **Source files** — sampled up to a character budget, skipping `node_modules`, `.git`, `dist`, etc.

### Install

#### Option A: Local symlink (development)

Place the bundle directory in your workspace, then add a symlink in your DSH profile:

```bash
cd ~/.dsh/profiles/desktop
npm link /path/to/prompt-optimizer-bundle
```

Add to your profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: prompt-optimizer
      name: '@luckystar6/prompt-optimizer'
      config: {}
```

#### Option B: npm install (once published)

```bash
npm install @luckystar6/prompt-optimizer
```

Then enable the bundle in your DSH profile via the Plugin Manager.

### Tests

```bash
npm test
```

94 checks across three suites:

| Suite | File | Checks |
|-------|------|--------|
| Reply parser | `test/parse-reply.test.mjs` | 8 |
| Composer layout contract | `test/layout.mjs` | ~50 |
| Client render smoke test | `test/render.mjs` | ~36 |

### File structure

```
prompt-optimizer-bundle/
├── index.js              # Host half: tool + slash command + project context + LLM call
├── client.js             # Client half: icon button + notes panel + locale dicts
├── cordis.patch.yml      # Cordis Loader patch declaration
├── package.json          # npm package manifest
├── icon.svg              # Plugin display icon (Plugin Manager)
├── LICENSE               # MIT
├── README.md             # This file
├── locale/
│   ├── en.json           # Plugin Manager display metadata (English)
│   └── zh.json           # Plugin Manager display metadata (Chinese)
└── test/
    ├── parse-reply.test.mjs   # Parser tests + chained runner
    ├── layout.mjs             # Layout contract checks
    └── render.mjs             # Render smoke test (catches runtime crashes without a browser)
```

---

## 中文

### 这个插件做什么

点击发送按钮旁边的**灯泡**图标，插件会读取你工作目录的文件结构、关键配置文件（`package.json`、`tsconfig.json` 等）和代码约定，连同你的草稿一起发给 LLM，然后把优化后的提示词写回输入框。优化说明显示在输入框上方的面板里。

### 功能

| 功能 | 说明 |
|------|------|
| **图标按钮** | 位于输入框工具栏，发送按钮左侧——黄色圆形按钮，灯泡图标 |
| **Agent 工具** | `optimize_prompt`，会话中的 Agent 可以调用 |
| **斜杠命令** | `/optimize <文本>`，直接使用 |
| **说明面板** | 在输入框上方显示优化说明；输入框清空后自动关闭 |
| **双语界面** | 支持中英文 |
| **主题适配** | 使用 DSH 的 CSS 变量，明暗主题通用 |

### 工作原理

没有后台服务，没有独立进程。插件向 DSH 的 Cordis 运行时注册回调：

| 部分 | 文件 | 运行在 | 注册内容 |
|------|------|--------|----------|
| Host | `index.js` | DSH 后端 | `optimize_prompt` 工具 + `/optimize` 斜杠命令 |
| Client | `client.js` | DSH 前端页面 | 输入框按钮 + 说明面板 + 多语言字典 |

点击按钮时，客户端通过 DSH 已有的远程命令通道把草稿发给后端。后端收集项目上下文（工作目录 + 代码结构 + 关键文件内容，上限约 6000 字符），通过 `ctx.llm.stream()` 调用 LLM，解析返回结果，把优化后的提示词和说明交回去。

### 项目上下文收集

后端扫描工作目录，收集：

- **技术栈标记** — `package.json`、`Cargo.toml`、`go.mod`、`pyproject.toml` 等
- **配置文档** — `README.md`、`CONTRIBUTING.md`、`.editorconfig` 等
- **工具链文件** — `tsconfig.json`、`.eslintrc`、`prettier.config.js` 等
- **源代码文件** — 在字符预算内采样，跳过 `node_modules`、`.git`、`dist` 等目录

### 安装

#### 方式一：本地符号链接（开发用）

把 bundle 目录放到工作目录，在 DSH profile 里建立符号链接：

```bash
cd ~/.dsh/profiles/desktop
npm link /path/to/prompt-optimizer-bundle
```

在 profile 的 `cordis.patch.yml` 里添加：

```yaml
- insert:
    - id: prompt-optimizer
      name: '@luckystar6/prompt-optimizer'
      config: {}
```

#### 方式二：npm 安装（发布后）

```bash
npm install @luckystar6/prompt-optimizer
```

然后在 DSH 的插件管理器里启用这个 bundle。

### 测试

```bash
npm test
```

94 项检查，分三个测试套件：

| 套件 | 文件 | 检查项 |
|------|------|--------|
| 返回解析器 | `test/parse-reply.test.mjs` | 8 |
| 布局契约 | `test/layout.mjs` | ~50 |
| 渲染冒烟测试 | `test/render.mjs` | ~36 |

### 目录结构

```
prompt-optimizer-bundle/
├── index.js              # Host 半：工具 + 斜杠命令 + 项目上下文 + LLM 调用
├── client.js             # Client 半：图标按钮 + 说明面板 + 多语言字典
├── cordis.patch.yml      # Cordis Loader 补丁声明
├── package.json          # npm 包清单
├── icon.svg              # 插件显示图标（插件管理器用）
├── LICENSE               # MIT 许可证
├── README.md             # 本文件
├── locale/
│   ├── en.json           # 插件管理器显示元数据（英文）
│   └── zh.json           # 插件管理器显示元数据（中文）
└── test/
    ├── parse-reply.test.mjs   # 解析器测试 + 链式运行器
    ├── layout.mjs             # 布局契约检查
    └── render.mjs             # 渲染冒烟测试（无需浏览器即可捕获运行时崩溃）
```

---

## License / 许可证

MIT © luckystar6
