# Roblox Studio Hub — PRD

让 AI 代理和外部工具能像操作本地 API 一样操控多个 Roblox Studio 实例。

## 1. 问题

Roblox Studio 是封闭的桌面应用，没有外部可编程接口。开发者无法从外部执行代码、查询状态、调用自定义能力。AI 代理和自动化工具无法与 Studio 交互。

## 2. 方案概述

在 Studio 和外部世界之间架一层 Hub。Studio 侧注入一个轻量 Runtime 框架，Runtime 加载插件来声明能力；Hub 侧暴露 HTTP API 和 MCP 工具，自动映射插件声明的能力。新增能力只需安装新插件，Runtime 框架和 Hub 均不需要改动。

## 3. 用户与场景

| 用户 | 场景 |
|------|------|
| AI 代理（Claude Code、MCP client） | 通过 MCP tool 远程执行 Lua、读取 Studio 状态、调用自定义能力 |
| 自动化脚本 | CI/CD 中批量测试、热更新验证、数据采集 |
| Roblox 开发者 | CLI 快速执行代码片段、管理多个 Studio 实例 |
| 插件开发者 | 编写并发布自定义能力，供社区使用 |

## 4. 用户旅程

### 旅程 A：首次使用 — 交互模式

```bash
npm install -g @white-dragon-tools/roblox-studio-hub
hub install-plugin                               # 安装 Studio Plugin（UI Shell）
hub plugin install execute                       # 安装 Hub 插件
hub serve
hub open MyGame.rbxl                             # 注入 Runtime + 插件，打开 Studio
# Studio Plugin 自动连接到 Hub
hub exec local:MyGame execute '{"code":"return 1+1"}'                # 调用 execute 插件
hub exec local:MyGame execute '{"code":"file:///path/to/script.lua"}' # 文件参数
# ...持续交互
```

### 旅程 B：一次性执行 — run 模式

```bash
# 参数结构与 exec 一致，目标是 rbxl 文件而非 studioId
hub run MyGame.rbxl execute '{"code":"return workspace:GetChildren()"}'

# 或从 stdin 传参
echo '{"code":"file:///path/to/script.lua"}' | hub run MyGame.rbxl execute

# → 打开 Studio → 等待连接 → 调用插件方法 → 输出结果 → 退出
```

### 旅程 C：AI 代理调用

```
1. MCP client 连接 Hub（独立 MCP server 进程）
2. MCP server 读取已安装插件的 plugin.json → 暴露 tools
3. AI 代理看到可用工具：execute, getStudioInfo, ...
4. AI 代理调用 execute tool → Hub 转发到 Studio → 返回结果
5. 用户安装新插件 → MCP tools 列表自动更新
```

### 旅程 D：AI READY — Claude Code 集成

```
1. npx skills add white-dragon-tools/roblox-studio-hub
2. 告诉 AI: "install studio hub"
   → AI 自动执行:
     - hub install（注册为系统服务）
     - hub install-plugin（安装 Studio Plugin）
```

### 旅程 E：编写并发布 Hub 插件

```
1. 创建插件目录：plugin.json + default.project.json + init.lua
2. 本地测试：
   - 放到项目 ./.roblox-studio-hub/plugins/（自动发现），或
   - hub open MyGame.rbxl --plugin-dir ./my-plugin
3. 发布：推送到 GitHub 仓库，提交到任意 marketplace
4. 其他用户：hub plugin install my-plugin
```

## 5. 产品能力

### 5.1 可扩展的能力体系

Hub 的能力不是硬编码的。每个 Hub 插件声明自己提供哪些操作，Hub 自动发现并暴露给外部工具。

- 开发者编写插件来增加新操作，无需修改 Hub 或 Runtime
- 每个操作自带描述和参数说明，AI 代理可直接理解并使用
- 插件之间可以互相调用，组合出更复杂的能力
- 不同用户可以安装不同的插件集

### 5.2 Hub 插件分发与本地发现

采用和 Claude Code 插件相同的分发模型：

- **Marketplace**：任何人可以创建 marketplace（一个 Git 仓库 + `marketplace.json`）
  - 插件可以内联在 marketplace 仓库中，也可以指向外部 GitHub 仓库
  - 用户可添加多个 marketplace：`hub marketplace add owner/repo`
- **安装方式**：
  - `hub plugin install <name>` → 从已添加的 marketplace 中搜索并安装
  - `hub plugin install owner/repo` → 跳过 marketplace，直接从 GitHub 仓库安装
  - 安装目录：`~/.roblox-studio-hub/plugins/`
- **本地发现**（开发用）：
  - `hub open MyGame.rbxl --plugin-dir ./my-plugin` 命令行指定
  - `./.roblox-studio-hub/plugins/` 项目目录自动发现
- **合并规则**：全局 + 本地，本地同名覆盖全局
- 版本管理和依赖自动解析
- 本地修改检测（content hash），防止意外覆盖

### 5.3 两种运行模式

- **open（交互模式）**：打开 Studio，保持运行，之后用 `hub exec <studioId> <method> [paramsJSON]` 多次调用
- **run（一次性模式）**：`hub run <place.rbxl> <method> [paramsJSON]`，打开 Studio → 调用 → 输出结果 → 退出
- **前提**：两者都要求 Hub 服务已在运行（`hub serve` 或系统服务）
- **参数传递**：paramsJSON 为单个 JSON 字符串；省略时从 stdin 读取

### 5.4 统一的文件参数处理

插件的参数可能是文件内容。Hub 统一处理：

- 插件在 inputSchema 中标记 `x-file: true` 的字段
- 参数值以 `file://` 开头时，Hub 自动读取文件内容替换
- 所有入口（CLI / API / MCP）走同一处理逻辑

### 5.5 多 Studio 实例管理

- 同时管理多个 Studio 实例
- 每个实例独立识别，三种 Studio ID 格式：
  - `place:<placeId>` — 云场景（例: `place:123456`）
  - `path:<localPath>` — 本地文件，自定义路径（例: `path:/Users/kk/MyGame`）
  - `local:<placeName>` — 本地文件，默认按文件名（例: `local:MyGame`）
- LocalPlacePath Attribute：外部工具可设置 `Workspace:SetAttribute("LocalPlacePath", path)` 来唯一标识 Studio 实例
- 自动注册（首次 poll）、心跳保活、超时清理（35 秒无心跳移除）

### 5.6 MCP 集成

- 独立 MCP server 进程
- 已安装 Hub 插件的能力自动映射为 MCP 工具
- 工具列表静态可用，不依赖 Studio 是否在线
- AI 代理启动即可看到完整能力描述

### 5.7 AI READY

提供 Claude Code 兼容技能：

- 安装：`npx skills add white-dragon-tools/roblox-studio-hub`
- 初始化：告诉 AI "install studio hub"，自动完成服务注册和 Studio Plugin 安装
- 提供 Hub 插件开发技能

### 5.8 Studio Plugin（UI Shell）

独立于 Hub 插件的 Roblox Studio 本地插件：

- 安装到 Roblox Plugins 目录（`hub install-plugin`）
  - Windows: `%LOCALAPPDATA%\Roblox\Plugins\`
  - macOS: `~/Documents/Roblox/Plugins/`
- 功能：连接/断开按钮、端口配置、状态显示、Debug 模式
- 自动连接到 Hub，断线自动重连
- UI Shell 只做展示，所有业务逻辑由 Runtime 处理

### 5.9 CLI

| 命令 | 说明 |
|------|------|
| `hub serve` | 启动 Hub 服务（前台运行） |
| `hub open <place.rbxl>` | 交互模式：注入并打开 Studio，等待命令 |
| `hub run <place.rbxl> <method> [paramsJSON]` | 一次性模式：打开 Studio → 调用 → 输出 → 退出 |
| `hub exec <studioId> <method> [paramsJSON]` | 调用已连接 Studio 的插件方法（需先 open） |
| `hub list` | 列出所有连接的 Studio |
| `hub info <id>` | 查看 Studio 详情 |
| `hub logs <id> [-n limit]` | 查看 Studio 日志 |
| `hub status` | 查看 Hub 服务状态 |
| `hub plugin install <name>` | 从市场安装 Hub 插件 |
| `hub plugin install owner/repo` | 从 GitHub 直接安装 Hub 插件 |
| `hub plugin uninstall <name>` | 卸载 Hub 插件 |
| `hub plugin list` | 列出已安装 Hub 插件 |
| `hub plugin search [query]` | 从已添加的 marketplace 搜索插件 |
| `hub plugin update [name]` | 更新 Hub 插件 |
| `hub marketplace add owner/repo` | 添加 marketplace |
| `hub marketplace remove owner/repo` | 移除 marketplace |
| `hub marketplace list` | 列出已添加的 marketplace |
| `hub install-plugin` | 安装 Studio Plugin（UI Shell）到 Roblox Plugins 目录 |
| `hub install` | 注册为系统服务（开机自启） |
| `hub uninstall` | 卸载系统服务 |
| `hub start` | 启动系统服务 |
| `hub stop` | 停止系统服务 |
| `hub update` | 更新到最新版本（自动停止/重启服务） |

### 5.10 调试 Web UI

面向开发者的调试工具：

- 实时查看所有连接的 Studio 状态
- 长轮询获取事件更新
- 查看已注册方法、日志等

### 5.11 配置

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `STUDIO_HUB_PORT` | `35888` | Hub 服务监听端口 |

Studio Plugin 侧可配置：端口、Debug 模式。

## 6. 架构

### 6.1 总览

```
                 ~/.roblox-studio-hub/
                 (一个 Rojo 项目)
                ┌─────────────────────────────┐
                │  default.project.json        │
                │  runtime/init.lua  (框架)    │
                │  plugins/                    │
                │    execute/                  │
                │    get-studio-info/          │
                │  plugins.lock.json           │
                └──────────┬──────────────────┘
                           │
                    rojo build → .rbxm
                           │
                    inject into .rbxl
                           │
┌──────────────────────────┼──────────────────────────┐
│              Roblox Studio 进程                       │
│                                                      │
│  ReplicatedStorage                                   │
│    .roblox-studio-hub                                │
│      runtime (ModuleScript)   ← 框架：注册、轮询、分发│
│      plugins (Folder)         ← Rojo 自动发现        │
│        execute                                       │
│        get-studio-info                               │
│                                                      │
│  Studio Plugin (UI Shell)     ← 独立安装到 Plugins 目录│
│    require(.roblox-studio-hub.runtime)               │
│    连接/断开/状态/Debug                               │
└──────────────────────────┼──────────────────────────┘
                           │
                HTTP (localhost:35888)
                长轮询 (poll/result)
                           │
┌──────────────────────────┼──────────────────────────┐
│              Hub Server (Node.js)                     │
│                                                      │
│  StudioManager    ← 注册/心跳/索引/日志/35s超时清理   │
│  命令队列         ← 下发等待/结果等待/长轮询          │
│  File Resolver    ← x-file 字段统一读取 file:// URI  │
│  Plugin Discovery ← 读 plugin.json → MCP tools       │
│                                                      │
│  HTTP API (Studio 侧 + Client 侧 + UI 侧)           │
│  CLI (open/run/exec/plugin/install-plugin/...)       │
│  调试 Web UI                                         │
└──────────────────────────────────────────────────────┘
          │                        │
          ▼                        ▼
    MCP Server (独立进程)       REST API / 脚本
   读 plugin.json → tools
```

### 6.2 关键设计原则

- **接口反转**：插件定义能力，Hub 只透传
- **Runtime 是纯框架**：零业务逻辑，所有能力来自插件
- **Rojo 原生**：`~/.roblox-studio-hub/` 整个目录是一个 Rojo 项目，一次 build 出 .rbxm
- **MCP 静态发现**：已安装 Hub 插件的 plugin.json 决定 MCP tools，不依赖 Studio 在线
- **文件参数统一**：`x-file` + `file://` 协议，Hub 层统一处理
- **两类插件不混淆**：Hub Plugin（能力扩展，Lua）vs Studio Plugin（UI Shell，独立安装）

### 6.3 通信协议

```
调用方                Hub Server              Runtime (Studio)
  │                      │                         │
  │  POST /call          │                         │
  │  {method, params}    │                         │
  │─────────────────────▶│                         │
  │                      │                         │
  │              File Resolver:                    │
  │              x-file 字段 file:// → 读内容       │
  │                      │                         │
  │                      │  响应 poll，携带 command │
  │                      │────────────────────────▶│
  │                      │                         │ handler 执行
  │                      │  POST /result           │
  │                      │◀────────────────────────│
  │  响应 {result}       │                         │
  │◀─────────────────────│                         │
```

### 6.4 插件加载

```
Runtime 启动
  ├─ 扫描 .roblox-studio-hub.plugins 下所有 ModuleScript
  ├─ 读取依赖关系 → 拓扑排序
  ├─ 按序 require(mod)(self)
  │    └─ 插件调用 runtime:registerHandler(descriptor, handler)
  └─ 开始 poll 循环
```

插件间互调：`runtime:call(method, params)` — 本地函数调用，不走 HTTP。

### 6.5 Hub 插件安装流程

```
hub plugin install execute
  ├─ 遍历已添加的 marketplace（按优先级）
  │    ├─ clone/pull marketplace 仓库（缓存到 ~/.roblox-studio-hub/cache/marketplaces/）
  │    └─ 读 marketplace.json → 在 plugins[] 中查找 "execute"
  ├─ 找到 source（内联路径 / GitHub 仓库 / Git URL）
  ├─ 如果是外部仓库 → clone 到缓存
  ├─ 读 plugin.json，校验 dependencies
  ├─ 复制到 ~/.roblox-studio-hub/plugins/execute/
  └─ 更新 plugins.lock.json

hub plugin install owner/repo
  ├─ 直接 clone GitHub 仓库（跳过 marketplace）
  ├─ 读 plugin.json，校验 dependencies
  ├─ 复制到 ~/.roblox-studio-hub/plugins/{name}/
  └─ 更新 plugins.lock.json
```

### 6.6 Build 流程（hub open）

```
hub open MyGame.rbxl [--plugin-dir ./dev-plugin]
  ├─ 如有 --plugin-dir 或 ./.roblox-studio-hub/plugins/，合并到全局（本地优先）
  ├─ rojo build ~/.roblox-studio-hub/ --output /tmp/runtime.rbxm
  ├─ inject .rbxm into MyGame.rbxl → ReplicatedStorage/.roblox-studio-hub
  └─ 打开 Studio
```

## 7. 接口设计

### 7.1 HTTP API

**Studio 侧（Runtime 调用）：**

| 端点 | 说明 |
|------|------|
| `POST /api/studio/poll` | 注册/心跳/接收命令。Body: `{studioInfo, timeout}` |
| `POST /api/studio/result` | 返回命令执行结果。Body: `{id, payload}` |

**Client 侧（外部调用）：**

| 端点 | 说明 |
|------|------|
| `GET /api/studios` | 列出所有 Studio |
| `GET /api/studios/:id` | Studio 详情 |
| `GET /api/studios/:id/methods` | 可用方法列表 |
| `POST /api/studios/:id/call` | 调用方法。Body: `{method, params, timeout}` |
| `GET /api/studios/:id/logs` | Studio 日志。Query: `?limit=100` |

**UI 侧：**

| 端点 | 说明 |
|------|------|
| `GET /api/ui/init` | UI 初始化数据（所有 Studio 状态） |
| `GET /api/ui/poll` | UI 事件长轮询。Query: `?since=timestamp&timeout=30` |
| `GET /api/status` | Hub 服务状态（版本、端口、运行时间、服务状态） |

### 7.2 plugin.json（Hub 插件）

```json
{
  "name": "execute",
  "version": "1.0.0",
  "description": "Execute Lua code in Roblox Studio",
  "author": "white-dragon-tools",
  "entry": "init.lua",
  "license": "MIT",
  "keywords": ["execute", "lua"],
  "dependencies": ["get-studio-info"],
  "tools": [
    {
      "name": "execute",
      "description": "Execute Lua code in a connected Studio",
      "inputSchema": {
        "type": "object",
        "properties": {
          "code": {
            "type": "string",
            "description": "Lua code to execute",
            "x-file": true
          },
          "mode": {
            "type": "string",
            "enum": ["eval", "run", "play"],
            "default": "eval"
          }
        },
        "required": ["code"]
      }
    }
  ]
}
```

### 7.3 marketplace.json（Marketplace 仓库）

Marketplace 是一个 Git 仓库，根目录包含 `marketplace.json`。分发模型与 Claude Code 插件一致。

```json
{
  "name": "Roblox Studio Hub Community Plugins",
  "plugins": [
    {
      "name": "execute",
      "description": "Execute Lua code in Roblox Studio",
      "source": "white-dragon-tools/hub-plugin-execute"
    },
    {
      "name": "get-studio-info",
      "description": "Get Studio instance information",
      "source": "./plugins/get-studio-info"
    },
    {
      "name": "scene-explorer",
      "description": "Explore and query the Studio scene tree",
      "source": "https://github.com/someone/hub-plugin-scene-explorer.git"
    }
  ]
}
```

**source 格式：**
- `"./relative/path"` — 插件内联在 marketplace 仓库中
- `"owner/repo"` — GitHub 仓库
- `"https://...git"` — 任意 Git URL

**Marketplace 管理：**
- 用户可添加多个 marketplace：`hub marketplace add owner/repo`
- 搜索时按添加顺序遍历，先匹配先返回
- 版本信息从插件仓库的 Git tag / GitHub Release 获取

### 7.4 plugins.lock.json

```json
{
  "plugins": {
    "execute": {
      "version": "1.0.0",
      "source": "white-dragon-tools/hub-plugin-execute",
      "marketplace": "white-dragon-tools/hub-plugins",
      "installedAt": "2026-02-16T12:00:00Z",
      "hash": "sha256:abc123..."
    }
  }
}
```

`marketplace` 字段记录来源 marketplace，直接安装（`hub plugin install owner/repo`）时为 `null`。

### 7.5 Rojo 配置

**~/.roblox-studio-hub/default.project.json：**

```json
{
  "name": ".roblox-studio-hub",
  "tree": {
    "$path": "runtime",
    "plugins": {
      "$path": "plugins"
    }
  }
}
```

**Hub 插件的 default.project.json：**

```json
{
  "name": "execute",
  "tree": {
    "$className": "ModuleScript",
    "$path": "src"
  }
}
```

## 8. 非功能需求

| 维度 | 要求 |
|------|------|
| 可靠性 | Hub 重启后 Runtime 自动重连；poll 超时自动重试；35s 无心跳自动清理 |
| 延迟 | 命令下发到结果返回 < 1s（eval 模式） |
| 兼容性 | macOS + Windows；Node.js >= 18 |
| 安全 | 仅监听 localhost；无远程访问 |
| 前置条件 | Roblox Studio 需启用 HTTP 请求（Studio Settings → Security → Allow HTTP Requests） |

## 9. 不支持

- Windows WSL 跨环境通信
- Hub 插件热加载（需重新 `hub open`）

## License

MIT
