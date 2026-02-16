# Roblox Studio Hub

Roblox Studio 的外部编程接口。从命令行、HTTP API 或 AI 代理（MCP）控制 Roblox Studio。

```bash
# 一次性模式：打开 Studio → 执行 → 输出结果 → 退出
roblox-studio-hub run MyGame.rbxl execute '{"code":"return workspace:GetChildren()"}'

# 交互模式：先启动服务 + 打开 Studio，然后反复调用
roblox-studio-hub serve &
roblox-studio-hub open MyGame.rbxl
roblox-studio-hub exec execute '{"code":"return 1+1"}'

# 通过 HTTP API 调用任意方法
curl -X POST http://localhost:35888/api/studios/local:MyGame/call \
  -H "Content-Type: application/json" \
  -d '{"method":"execute","params":{"code":"return 1+1"}}'
```

## 它解决什么问题

Roblox Studio 是一个封闭的桌面应用，没有官方的外部编程接口。你无法从终端、脚本或 AI 工具直接操作 Studio 里的内容。

Roblox Studio Hub 在 Studio 内部注入一个轻量 Runtime 框架，通过 WebSocket 与外部的 Hub 服务通信。Hub 将 Studio 的能力暴露为三种接口：

- **CLI** — 命令行直接操作
- **HTTP API** — 任何语言/工具都可以调用
- **MCP** — AI 代理（如 Claude Code）原生集成

## 架构

```
┌──────────────┐   WebSocket    ┌──────────────────────────────────────┐
│   Hub 服务    │◄──────────────►│          Roblox Studio               │
│  (Node.js)   │               │                                      │
│              │               │  Studio Plugin ←→ Runtime ←→ 插件     │
├──────────────┤               └──────────────────────────────────────┘
│ CLI          │
│ HTTP API     │
│ MCP Server   │
└──────────────┘
```

- **Hub**（TypeScript）— 中央服务，管理多个 Studio 实例，暴露 CLI / HTTP / MCP 接口
- **Studio Plugin**（Lua）— Studio 内的 UI 插件，持有 WebSocket 连接
- **Runtime**（Lua）— 纯框架，零业务逻辑，加载插件并执行命令
- **插件**（Lua）— 定义具体能力（执行代码、获取信息等），Hub 只做透传

---

## 安装

### 前置条件

| 工具 | 版本 | 用途 |
|------|------|------|
| [Node.js](https://nodejs.org/) | >= 18 | 运行 Hub 服务 |
| [Roblox Studio](https://www.roblox.com/create) | 最新版 | 目标 IDE |
| [Rojo](https://rojo.space/) | >= 7 | 编译 Lua 项目为 .rbxm |
| [Lune](https://lune-org.github.io/docs) | >= 0.8 | 运行注入脚本 |

安装 Rojo 和 Lune（推荐使用 [Aftman](https://github.com/LPGhatguy/aftman)）：

```bash
aftman add rojo-rbx/rojo
aftman add lune-org/lune
```

### 第一步：安装 Hub

```bash
npm install -g @white-dragon-tools/roblox-studio-hub
```

验证安装：

```bash
roblox-studio-hub --help
```

### 第二步：安装 Studio Plugin

Studio Plugin 是运行在 Roblox Studio 内部的 UI 插件，负责与 Hub 建立 WebSocket 连接。

```bash
roblox-studio-hub install-plugin
```

这会将 `StudioHubPlugin.rbxm` 复制到你的 Roblox Studio 插件目录：

- **macOS**: `~/Documents/Roblox/Plugins/`
- **Windows**: `%LOCALAPPDATA%\Roblox\Plugins\`

安装后重启 Roblox Studio，你会在顶栏看到 **"Hub"** 按钮。

### 第三步：安装内置插件

Hub 的能力由插件提供。内置插件包含两个核心功能：执行 Lua 代码和获取 Studio 信息。

```bash
# 添加官方 Marketplace
roblox-studio-hub marketplace add white-dragon-tools/roblox-studio-hub

# 安装内置插件
roblox-studio-hub plugin install execute
roblox-studio-hub plugin install get-studio-info
```

确认已安装：

```bash
roblox-studio-hub plugin list
```

输出：

```
已安装的插件:
  execute       0.1.0  Execute Lua code in Roblox Studio
  get-studio-info 0.1.0  Get current Studio environment information
```

---

## 快速开始

### 方式一：交互模式（推荐日常开发）

交互模式启动 Hub 服务并打开 Studio，之后你可以反复执行命令，无需重新打开。

**终端 1** — 启动 Hub 服务：

```bash
roblox-studio-hub serve
```

输出：

```
🐉 Roblox Studio Hub running at http://localhost:35888
   Studio API:
   - POST /api/studio/poll (HTTP)
   - WebSocket ws://localhost:35888
```

**终端 2** — 注入 Runtime 并打开 Studio：

```bash
roblox-studio-hub open MyGame.rbxl
```

这个命令会：

1. 将 Runtime + 已安装插件编译为 .rbxm
2. 注入到 place 文件的 `ReplicatedStorage.__HubRuntime__`
3. 打开 Roblox Studio

Studio 启动后，Plugin 会自动通过 WebSocket 连接到 Hub。在 Studio 中点击顶栏 **"Hub"** 按钮可以看到连接状态。

**终端 2** — 调用方法：

```bash
# 执行 Lua 代码（execute 是插件提供的工具名）
roblox-studio-hub exec execute '{"code":"return 1 + 1"}'

# 执行 Lua 文件（通过 x-file 协议）
roblox-studio-hub exec execute '{"code":"file:///path/to/script.lua"}'

# 获取 Studio 信息（getStudioInfo 是另一个插件工具）
roblox-studio-hub exec getStudioInfo
```

### 方式二：一次性模式（适合自动化脚本）

一次性模式自动完成完整流程：打开 Studio → 等待连接 → 调用方法 → 输出结果 → 退出。

```bash
roblox-studio-hub run MyGame.rbxl execute '{"code":"return 1+1"}'
```

状态信息输出到 stderr，结果输出到 stdout，便于管道组合：

```bash
# 将结果保存到文件
roblox-studio-hub run MyGame.rbxl execute '{"code":"return workspace:GetChildren()"}' > result.json

# 从 stdin 传参
echo '{"code":"return game.PlaceId"}' | roblox-studio-hub run MyGame.rbxl execute

# 执行文件（配合 x-file 协议）
roblox-studio-hub run MyGame.rbxl execute '{"code":"file:///path/to/script.lua"}'
```

### 方式三：开机自启（后台服务）

如果你希望 Hub 始终在后台运行：

```bash
# 注册为系统服务并启动
sudo roblox-studio-hub install
roblox-studio-hub start

# 查看状态
roblox-studio-hub status

# 停止 / 卸载
roblox-studio-hub stop
sudo roblox-studio-hub uninstall
```

平台支持：

| 平台 | 服务管理 |
|------|---------|
| macOS | launchd |
| Windows | sc（Windows 服务） |
| Linux | systemd |

---

## CLI 命令参考

### hub serve

启动 Hub 服务（前台运行）。

```bash
roblox-studio-hub serve
```

Hub 启动后监听 HTTP + WebSocket 请求，等待 Studio 连接。

### hub open

注入 Runtime 并打开 Roblox Studio。

```bash
roblox-studio-hub open <place.rbxl> [options]
```

**选项：**

| 选项 | 缩写 | 说明 |
|------|------|------|
| `--plugin-dir <dir>` | `-p` | 加载额外的本地插件目录（可多次使用） |
| `--port <number>` | | 指定 Hub 端口（覆盖环境变量） |

**示例：**

```bash
# 基本用法
roblox-studio-hub open MyGame.rbxl

# 加载本地开发插件
roblox-studio-hub open MyGame.rbxl --plugin-dir ./my-plugin

# 加载多个插件目录
roblox-studio-hub open MyGame.rbxl -p ./plugin-a -p ./plugin-b

# 指定端口
roblox-studio-hub open MyGame.rbxl --port 35999
```

**注入过程说明：**

`open` 命令在打开 Studio 前会修改 place 文件，注入以下内容到 `ReplicatedStorage`：

```
ReplicatedStorage
└── __HubRuntime__ (ModuleScript)
    ├── builtins/         (内置插件: execute, get-studio-info)
    └── plugins/          (已安装的用户插件)
```

### hub run

一次性模式：打开 Studio → 等待连接 → 调用方法 → 输出结果 → 退出。

```bash
roblox-studio-hub run <place.rbxl> <method> [paramsJSON]
```

**参数：**

| 参数 | 说明 |
|------|------|
| `place.rbxl` | 目标 .rbxl 文件路径 |
| `method` | 要调用的插件方法名 |
| `paramsJSON` | 方法参数（JSON 字符串），省略时从 stdin 读取 |

如果 Hub 服务未运行，`run` 会自动启动一个临时服务并在完成后关闭。

**示例：**

```bash
# 执行代码
roblox-studio-hub run MyGame.rbxl execute '{"code":"return 1+1"}'

# 获取 Studio 信息
roblox-studio-hub run MyGame.rbxl getStudioInfo '{}'

# 从 stdin 传参
cat params.json | roblox-studio-hub run MyGame.rbxl execute

# 执行文件
roblox-studio-hub run MyGame.rbxl execute '{"code":"file:///path/to/script.lua"}'
```

### hub exec

调用已连接 Studio 的插件方法。需要先通过 `hub open` 打开 Studio。

参数与 `hub run` 对齐，区别是 `exec` 不需要指定 place 文件（Studio 已打开）。

```bash
roblox-studio-hub exec <method> [paramsJSON] [options]
```

**参数：**

| 参数 | 说明 |
|------|------|
| `method` | 插件提供的工具名称（如 `execute`、`getStudioInfo`） |
| `paramsJSON` | 方法参数（JSON 字符串），省略时从 stdin 读取 |

**选项：**

| 选项 | 说明 |
|------|------|
| `--target <env>` | 执行环境：`server` / `client`（play 模式必填，edit 模式忽略） |
| `--studio <id>` | 目标 Studio ID（多个 Studio 连接时指定） |

**Studio ID 格式：**

| 格式 | 说明 | 示例 |
|------|------|------|
| `place:<placeId>` | 云场景（有 PlaceId） | `place:123456789` |
| `local:<placeName>` | 本地 .rbxl 文件（文件名） | `local:MyGame.rbxl` |
| `path:<absolutePath>` | 本地 .rbxl 文件（绝对路径） | `path:/Users/me/MyGame.rbxl` |

使用 `roblox-studio-hub list` 可以查看当前所有已连接 Studio 的 ID。

**示例：**

```bash
# edit 模式 — 执行 Lua 代码
roblox-studio-hub exec execute '{"code":"return 1+1"}'

# edit 模式 — 执行本地文件（x-file 协议，Hub 自动读取文件内容）
roblox-studio-hub exec execute '{"code":"file:///path/to/script.lua"}'

# edit 模式 — 获取 Studio 环境信息
roblox-studio-hub exec getStudioInfo

# play 模式 — 在服务端执行
roblox-studio-hub exec execute '{"code":"return game.ServerStorage:GetChildren()"}' --target server

# play 模式 — 在客户端执行
roblox-studio-hub exec execute '{"code":"return game.Players.LocalPlayer.Name"}' --target client

# 从 stdin 传参
echo '{"code":"return game.PlaceId"}' | roblox-studio-hub exec execute

# 多 Studio 场景：指定目标
roblox-studio-hub exec execute '{"code":"return 1+1"}' --studio local:MyGame.rbxl
```

**`run` 与 `exec` 对比：**

| | `run` | `exec` |
|--|-------|--------|
| 用法 | `run <place> <method> [params]` | `exec <method> [params]` |
| 前置条件 | 无（自动打开 Studio） | 需先 `open <place>` |
| 完成后 | 自动退出 | 保持运行 |
| 适用场景 | 自动化脚本、CI | 日常开发、反复调试 |

### hub status / list / info / logs

查看 Hub 和 Studio 状态。

```bash
# Hub 服务状态（版本、运行时间、平台信息）
roblox-studio-hub status

# 列出所有已连接的 Studio
roblox-studio-hub list

# 查看单个 Studio 详情（方法列表、gameState 等）
roblox-studio-hub info local:MyGame

# 查看 Studio 日志（默认 100 条）
roblox-studio-hub logs local:MyGame

# 查看最近 50 条日志
roblox-studio-hub logs local:MyGame -n 50
```

### hub plugin

管理 Hub 插件。

```bash
# 列出已安装插件
roblox-studio-hub plugin list

# 从 Marketplace 搜索插件
roblox-studio-hub plugin search
roblox-studio-hub plugin search execute

# 从 Marketplace 安装
roblox-studio-hub plugin install execute

# 从 GitHub 仓库安装
roblox-studio-hub plugin install owner/repo

# 卸载
roblox-studio-hub plugin uninstall execute

# 更新全部插件
roblox-studio-hub plugin update

# 更新指定插件
roblox-studio-hub plugin update execute
```

插件安装到 `~/.roblox-studio-hub/plugins/` 目录，并记录在 `plugins.lock.json` 中。

### hub marketplace

管理插件市场源。Marketplace 是一个包含 `.roblox-studio-hub-plugin/marketplace.json` 的 Git 仓库。

```bash
# 添加 Marketplace
roblox-studio-hub marketplace add white-dragon-tools/roblox-studio-hub

# 列出已添加的 Marketplace
roblox-studio-hub marketplace list

# 移除 Marketplace
roblox-studio-hub marketplace remove white-dragon-tools/roblox-studio-hub
```

### hub mcp

启动 MCP Server（stdio 传输），供 Claude Code 等 AI 工具使用。详见 [MCP 集成](#mcp-集成ai-代理) 章节。

```bash
roblox-studio-hub mcp
```

### hub update

更新 Hub 到最新版本。如果 Hub 正在以系统服务运行，会自动重启。

```bash
roblox-studio-hub update
```

---

## HTTP API 参考

Hub 服务默认监听 `http://localhost:35888`。以下所有示例使用 curl，你可以用任何语言的 HTTP 客户端调用。

### 获取 Hub 状态

```bash
curl http://localhost:35888/api/status
```

响应：

```json
{
  "version": "0.4.0",
  "uptime": 3600.5,
  "installedAsService": false,
  "serviceRunning": true,
  "runningAsService": false,
  "platform": "darwin",
  "nodeVersion": "v22.22.0"
}
```

### 列出所有 Studio

```bash
curl http://localhost:35888/api/studios
```

响应：

```json
{
  "studios": [
    {
      "id": "local:MyGame.rbxl",
      "type": "local",
      "placeName": "MyGame.rbxl",
      "connectedAt": "2026-02-17T10:30:00.000Z",
      "clientCount": 0
    },
    {
      "id": "place:123456789",
      "type": "place",
      "placeId": 123456789,
      "placeName": "My Cloud Game",
      "connectedAt": "2026-02-17T11:00:00.000Z",
      "clientCount": 0
    }
  ]
}
```

### 获取 Studio 详情

```bash
curl http://localhost:35888/api/studios/local:MyGame.rbxl
```

响应：

```json
{
  "id": "local:MyGame.rbxl",
  "type": "local",
  "placeName": "MyGame.rbxl",
  "gameState": "edit",
  "connectedAt": "2026-02-17T10:30:00.000Z",
  "clientCount": 0
}
```

`gameState` 值：`"edit"`（编辑模式）或 `"play"`（运行模式）。

### 获取可用方法

返回当前 Studio 注册的所有方法描述符，包含完整的 `inputSchema`（可直接映射为 MCP 工具）。

```bash
curl http://localhost:35888/api/studios/local:MyGame.rbxl/methods
```

响应：

```json
{
  "methods": [
    {
      "name": "execute",
      "description": "Execute Lua code in Roblox Studio...",
      "inputSchema": {
        "type": "object",
        "properties": {
          "code": {
            "type": "string",
            "description": "Lua source code to execute",
            "x-file": true
          },
          "mode": {
            "type": "string",
            "enum": ["eval", "run", "play"],
            "description": "Execution mode..."
          },
          "timeout": {
            "type": "number",
            "description": "Execution timeout in seconds",
            "default": 30
          }
        },
        "required": ["code"]
      },
      "context": "edit"
    },
    {
      "name": "getStudioInfo",
      "description": "Get current Roblox Studio environment information...",
      "inputSchema": {
        "type": "object",
        "properties": {}
      }
    }
  ]
}
```

### 调用方法

通用方法调用接口。Hub 将请求转发给 Studio，等待执行结果后返回。

```bash
curl -X POST http://localhost:35888/api/studios/local:MyGame.rbxl/call \
  -H "Content-Type: application/json" \
  -d '{
    "method": "execute",
    "params": { "code": "return 1 + 1" },
    "timeout": 30
  }'
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `method` | string | 是 | 方法名（必须是 Studio 已注册的方法） |
| `params` | object | 否 | 方法参数（透传给工具，不含框架参数） |
| `target` | string | play 模式必填 | 执行环境：`server` / `client` |
| `timeout` | number | 否 | 超时时间，单位秒（默认 30） |

`target` 和 `timeout` 是框架级参数，Hub 提取后不转发给工具。

**成功响应（execute）：**

```json
{
  "success": true,
  "result": 2,
  "logs": {
    "server": []
  }
}
```

**失败响应：**

```json
{
  "success": false,
  "error": "Execution timeout"
}
```

**context 校验：**

每个方法声明了可用的上下文（`context: "edit" | "play" | "both"`）。如果 Studio 当前处于 Play 模式，而方法要求 edit 上下文，调用会返回 400 错误：

```json
{
  "error": "Method \"execute\" requires context \"edit\", but studio is in \"play\" state"
}
```

**x-file 参数：**

如果方法的 `inputSchema` 中某字段标记了 `"x-file": true`，Hub 会自动处理 `file://` URI — 读取本地文件内容并替换参数值：

```bash
curl -X POST http://localhost:35888/api/studios/local:MyGame.rbxl/call \
  -H "Content-Type: application/json" \
  -d '{
    "method": "execute",
    "params": { "code": "file:///Users/me/scripts/test.lua" }
  }'
```

Hub 在转发前将 `file:///Users/me/scripts/test.lua` 替换为该文件的实际内容。

### 获取日志

```bash
# 默认返回最近 100 条
curl http://localhost:35888/api/studios/local:MyGame.rbxl/logs

# 指定条数
curl http://localhost:35888/api/studios/local:MyGame.rbxl/logs?limit=20
```

响应：

```json
{
  "logs": [
    {
      "timestamp": 1708171200000,
      "source": "runtime",
      "level": "info",
      "message": "Runtime loaded, 2 handlers registered"
    }
  ]
}
```

### 订阅/取消订阅事件

订阅 Studio 事件通知。首次订阅某事件时，Hub 会通知 Studio 开始监听该事件。

```bash
# 订阅
curl -X POST http://localhost:35888/api/studios/local:MyGame.rbxl/subscribe \
  -H "Content-Type: application/json" \
  -d '{"event": "selectionChanged", "subscriberId": "my-app"}'

# 取消订阅
curl -X POST http://localhost:35888/api/studios/local:MyGame.rbxl/unsubscribe \
  -H "Content-Type: application/json" \
  -d '{"event": "selectionChanged", "subscriberId": "my-app"}'
```

---

## MCP 集成（AI 代理）

Hub 内置 MCP（Model Context Protocol）Server，可以让 Claude Code 等 AI 工具直接操作 Roblox Studio。

### 配置 Claude Code

在你的项目根目录创建或编辑 `.claude-plugin/plugin.json`：

```json
{
  "name": "roblox-studio-hub",
  "version": "0.4.0",
  "mcp": {
    "command": "roblox-studio-hub",
    "args": ["mcp"]
  }
}
```

配置后，Claude Code 会自动发现 Hub 暴露的工具。

### 工作原理

1. MCP Server 启动时从已安装插件的 `plugin.json` **静态发现**所有工具描述符
2. 不依赖 Studio 在线即可列出可用工具
3. 工具调用时通过 Hub HTTP API 转发到连接的 Studio
4. 结果返回给 AI 代理

### 每项目工具发现

MCP Server 启动时会使用与 `hub open` 相同的三级插件发现机制。在不同项目目录下启动 MCP，暴露的工具集不同：

```
项目 A（RPG 游戏）
  .roblox-studio-hub/plugins/
    quest-editor/      → MCP 暴露 questEditor 工具
    npc-inspector/     → MCP 暴露 inspectNPC 工具

项目 B（赛车游戏）
  .roblox-studio-hub/plugins/
    track-builder/     → MCP 暴露 buildTrack 工具
    physics-debug/     → MCP 暴露 debugPhysics 工具
```

AI 代理（如 Claude Code）在项目 A 中看到的工具和项目 B 完全不同，每个项目只暴露与自己相关的能力。

全局插件（`execute`、`getStudioInfo` 等）始终可用，项目插件在此基础上叠加。

### 框架参数

MCP 调用中有两个特殊参数，Hub 提取后不转发给工具：

| 参数 | 说明 |
|------|------|
| `_studioId` | 目标 Studio ID（多个 Studio 连接时指定，单个时自动选择） |
| `_target` | 执行环境：`server` / `client`（play 模式必填） |

```json
{
  "code": "return game.ServerStorage:GetChildren()",
  "_studioId": "local:MyGame.rbxl",
  "_target": "server"
}
```

### 手动测试 MCP Server

```bash
roblox-studio-hub mcp
```

这会启动一个 stdio 传输的 MCP Server，你可以用任何 MCP 客户端连接。

---

## 插件系统

Hub 的所有 Studio 能力都由插件提供。Runtime 本身是纯框架（零业务逻辑），execute 和 getStudioInfo 也是标准插件。

### 内置插件

#### execute

在 Studio 中执行 Lua 代码。根据当前状态自适应执行方式。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `code` | string | 是 | Lua 源码（支持 `x-file`） |
| `target` | string | play 模式必填 | `server` / `client` |
| `timeout` | number | 否 | 超时秒数（默认 30） |

context: `both`，target: `["server", "client"]`

- **edit 模式**：通过 `loadstring()` 直接执行，无需 target
- **play 模式**：通过脚本注入到指定环境，必须指定 target

```bash
# edit 模式 — 直接执行，无需 target
roblox-studio-hub exec execute '{"code":"return workspace:GetChildren()"}'
roblox-studio-hub exec execute '{"code":"game.Lighting.ClockTime = 12"}'

# play 模式 — 通过 --target 指定执行环境
roblox-studio-hub exec execute '{"code":"return game.ServerStorage:GetChildren()"}' --target server
roblox-studio-hub exec execute '{"code":"return game.Players.LocalPlayer.Name"}' --target client
```

#### startGame

启动游戏（类似 F5）。调用后 Studio 进入 play 状态，游戏持续运行直到调用 stopGame。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `mode` | string | 否 | `play`（客户端+服务端，默认）/ `run`（仅服务端） |

context: `edit` — 从编辑模式启动游戏。

```bash
roblox-studio-hub exec startGame
roblox-studio-hub exec startGame '{"mode":"run"}'
```

#### stopGame

停止游戏（类似 Shift+F5）。Studio 回到 edit 状态。

context: `play` — 游戏运行时才能停止。

```bash
roblox-studio-hub exec stopGame
```

#### getStudioInfo

返回当前 Studio 环境信息。无参数。

context: `both` — 任何状态下都可调用。

返回值：

```json
{
  "success": true,
  "placeId": 0,
  "placeName": "MyGame.rbxl",
  "creatorName": "",
  "creatorType": "",
  "gameId": 0,
  "userId": 12345,
  "localPath": "/Users/me/MyGame.rbxl"
}
```

### 游戏生命周期

大多数工具在编辑模式（默认状态）下工作。如果需要分析运行时状态，使用 startGame / stopGame 控制游戏生命周期：

```bash
# 1. 打开 Studio
roblox-studio-hub open MyGame.rbxl

# 2. 编辑模式 — 直接操作，无需 target
roblox-studio-hub exec execute '{"code":"return workspace:GetChildren()"}'
roblox-studio-hub exec getStudioInfo

# 3. 启动游戏（server + client）
roblox-studio-hub exec startGame

# 4. 游戏运行中 — 通过 --target 指定执行环境
roblox-studio-hub exec execute '{"code":"return game.Stats.DataReceiveKbps"}' --target server
roblox-studio-hub exec execute '{"code":"return game.Players.LocalPlayer.Name"}' --target client

# 5. 停止游戏，回到编辑模式
roblox-studio-hub exec stopGame

# 6. 再次在编辑模式操作（无需 target）
roblox-studio-hub exec execute '{"code":"return workspace:GetChildren()"}'
```

**工具有两个维度的约束：**

**context** — 工具在哪种状态下可用（工具声明）：

| context | 含义 | 示例 |
|---------|------|------|
| `"edit"` | 编辑模式下可用 | startGame |
| `"play"` | 游戏运行时可用 | stopGame, 运行时分析工具 |
| `"both"` | 始终可用 | execute, getStudioInfo |

**target** — 工具在哪个环境执行（调用时指定）：

| target | 含义 | 何时需要 |
|--------|------|---------|
| `"server"` | 在服务端执行 | play 模式 |
| `"client"` | 在客户端执行 | play 模式（需 `startGame` 以 `play` 模式启动） |
| 不指定 | 在 Studio Plugin 上下文执行 | edit 模式 |

startGame 的启动模式决定可用的 target：

| startGame mode | 可用 target | 等同于 |
|----------------|------------|--------|
| `play`（默认） | server, client | F5 |
| `run` | server | F8（无客户端） |

如果在错误的状态或 target 下调用工具，Hub 返回明确的错误提示。

### 插件结构

一个 Hub 插件的目录结构：

```
my-plugin/
├── .roblox-studio-hub-plugin/
│   └── plugin.json         # 分发元数据 + MCP 工具描述
├── default.project.json    # Rojo 构建配置
├── src/
│   └── init.lua            # Lua 入口
└── web/                    # 可选：Web UI（前端项目）
    ├── package.json
    ├── src/
    └── dist/               # 构建产物，Hub 直接 serve
```

`.roblox-studio-hub-plugin/` 是插件的分发标识，类似 Claude Code 的 `.claude-plugin/`。Hub 通过这个目录识别一个仓库/目录是 Hub 插件。

#### .roblox-studio-hub-plugin/plugin.json

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "插件功能说明",
  "author": "your-name",
  "entry": "src/init.lua",
  "license": "MIT",
  "keywords": ["my", "plugin"],
  "dependencies": ["execute"],
  "tools": [
    {
      "name": "myMethod",
      "description": "这个方法做什么",
      "context": "play",
      "target": ["server"],
      "inputSchema": {
        "type": "object",
        "properties": {
          "param1": {
            "type": "string",
            "description": "参数说明"
          },
          "fileContent": {
            "type": "string",
            "description": "文件内容",
            "x-file": true
          }
        },
        "required": ["param1"]
      }
    }
  ]
}
```

字段说明：

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | 是 | 插件名称（唯一标识） |
| `version` | 是 | 语义化版本号 |
| `description` | 是 | 插件功能描述 |
| `author` | 否 | 作者 |
| `entry` | 否 | Lua 入口文件（默认 `src/init.lua`） |
| `license` | 否 | 许可证 |
| `keywords` | 否 | 搜索关键词 |
| `dependencies` | 否 | 依赖的其他插件名称 |
| `tools` | 否 | MCP 工具描述符（用于静态发现） |
| `web` | 否 | Web UI 目录路径（如 `"./web/dist"`），Hub 会在 `/plugins/<name>/` 下 serve |

`tools[]` 额外字段：

| 字段 | 说明 |
|------|------|
| `context` | 工具可用的状态：`"edit"` / `"play"` / `"both"`（默认 `"both"`） |
| `target` | 工具支持的执行环境：`["server"]` / `["client"]` / `["server", "client"]`。仅 play 模式有效。省略表示不需要 target |
| `inputSchema` 中 `"x-file": true` | 标记该参数支持 `file://` URI，Hub 自动读取文件内容替换 |

#### default.project.json

```json
{
  "name": "my-plugin",
  "tree": { "$path": "src" }
}
```

#### src/init.lua

```lua
return function(runtime)
    runtime:registerHandler({
        name = "myMethod",
        description = "这个方法做什么",
        inputSchema = {
            type = "object",
            properties = {
                param1 = { type = "string", description = "参数说明" },
            },
            required = { "param1" },
        },
        context = "edit", -- "edit" | "play" | "both"
    }, function(params)
        -- 你的业务逻辑
        local result = doSomething(params.param1)

        return {
            success = true,
            result = result,
        }
    end)
end
```

`context` 字段声明工具在哪种状态下可用（需与 `plugin.json` 中的 `tools[].context` 一致）：

| 值 | 含义 | 示例场景 |
|----|------|---------|
| `"edit"` | 编辑模式下可用 | 修改场景、执行代码、启动游戏 |
| `"play"` | 游戏运行时可用 | 分析运行时状态、停止游戏 |
| `"both"` | 始终可用 | 查询 Studio 信息 |

### 插件间调用

插件可以调用其他已注册的方法：

```lua
return function(runtime)
    runtime:registerHandler({
        name = "myAdvancedMethod",
        description = "...",
        inputSchema = { type = "object", properties = {} },
    }, function(params)
        -- 调用 execute 插件
        local result = runtime:call("execute", {
            code = "return workspace:GetChildren()",
            mode = "eval",
        })
        return result
    end)
end
```

需要在 `plugin.json` 中声明依赖：

```json
{
  "dependencies": ["execute"]
}
```

Runtime 会按拓扑排序加载插件，确保依赖先于被依赖者加载。

### 通知 API

插件可以注册事件通知，供外部客户端订阅：

```lua
return function(runtime)
    runtime:registerNotification("selectionChanged", function()
        -- setup: 当有人订阅时调用
        local connection = game:GetService("Selection").SelectionChanged:Connect(function()
            local selected = game:GetService("Selection"):Get()
            runtime:notify("selectionChanged", {
                count = #selected,
                names = {},  -- 填充选中对象名
            })
        end)

        -- 返回 cleanup 函数：当最后一个订阅者取消时调用
        return function()
            connection:Disconnect()
        end
    end)
end
```

- `registerNotification(event, setupFn)` — 注册可订阅事件
- `runtime:notify(event, data)` — 触发通知（发送给所有订阅者）
- setup 函数在首个订阅者出现时调用，返回的 cleanup 函数在最后一个订阅者离开时调用

### 插件 Web UI

插件可以提供 Web 界面，Hub 在自己的端口上直接 serve，无需额外端口，同源访问 Hub API 无 CORS 问题。

**典型场景：**

- UI 原型开发 — Web 页面消费 Studio 服务端真实数据，AI 快速构建原型，策划确认后再生成 Roblox UI
- ECS 可视化 — 实时展示 jecs 等 ECS 框架的实体/组件状态
- 性能面板、场景树浏览器等调试工具

**配置：** 在 plugin.json 中声明 `web` 字段：

```json
{
  "name": "ui-bridge",
  "version": "0.1.0",
  "web": "./web/dist",
  "tools": [...]
}
```

Hub 自动在 `/plugins/<name>/` 路径下 serve 该目录的内容：

```
GET /plugins/ui-bridge/          → ui-bridge 的 Web 页面
GET /plugins/jecs-inspector/     → jecs-inspector 的可视化面板
POST /api/studios/:id/call       → API（同源，零 CORS 配置）
```

**Web 页面调用 Hub API：**

```js
// 同源，直接 fetch
const res = await fetch("/api/studios/local:MyGame.rbxl/call", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ method: "getShopItems" }),
});
const data = await res.json();
```

**开发模式：**

生产环境下 Hub 直接 serve `web/dist/` 静态文件。开发时，Hub 检测到插件 `web/` 目录含 `package.json`，自动启动 dev server（端口随机），将 `/plugins/<name>/*` 反代过去：

```
浏览器 → localhost:35888/plugins/ui-bridge/
             ↓
Hub 判断 dev mode？
  ├─ yes → 反代到 localhost:随机端口（Vite / 其他 dev server）
  └─ no  → 返回 web/dist/ 静态文件
```

Hub 不依赖 Vite — 插件可以用任何前端框架（React、Vue、Svelte、纯 HTML），Hub 只负责 spawn dev server 和反代。

### 插件发现机制

Hub 采用三级插件发现，灵感来自 Claude Code 的多级配置发现。三级按优先级从低到高排列：

```
全局插件（最低优先级）
  ~/.roblox-studio-hub/plugins/
    ↓ 被覆盖
项目插件
  <project>/.roblox-studio-hub/plugins/
    ↓ 被覆盖
CLI 插件（最高优先级）
  --plugin-dir ./path
```

同名插件按优先级覆盖：CLI > 项目 > 全局。

#### 全局插件

通过 `hub plugin install` 安装到 `~/.roblox-studio-hub/plugins/`，所有项目共享。

```bash
roblox-studio-hub plugin install execute
roblox-studio-hub plugin install get-studio-info
```

#### 项目插件

在项目根目录创建 `.roblox-studio-hub/` 目录，放置项目专属插件和配置：

```
my-roblox-game/
├── .roblox-studio-hub/
│   ├── hub.json               # 项目级 Hub 配置
│   └── plugins/
│       ├── game-inspector/    # 项目专属插件
│       │   ├── plugin.json
│       │   ├── default.project.json
│       │   └── src/init.lua
│       └── debug-tools/
│           └── ...
├── src/
├── default.project.json
└── MyGame.rbxl
```

**hub.json** — 项目级配置：

```json
{
  "plugins": {
    "dependencies": [
      "execute",
      "get-studio-info",
      "owner/custom-plugin"
    ]
  }
}
```

`hub.json` 的 `plugins.dependencies` 声明项目需要的全局/远程插件。`hub open` 时自动检查这些依赖是否已安装，未安装则提示用户安装。

**自动检测**：`hub open` 会自动在 place 文件所在目录及其祖先目录中查找 `.roblox-studio-hub/`，类似 `.git` 的查找机制：

```bash
# 假设项目结构：/Users/me/projects/my-game/.roblox-studio-hub/
cd /Users/me/projects/my-game/levels
roblox-studio-hub open level1.rbxl
# → 自动发现 ../.roblox-studio-hub/，加载项目插件
```

#### CLI 插件

通过 `--plugin-dir` 临时加载，优先级最高，适合开发调试：

```bash
roblox-studio-hub open MyGame.rbxl --plugin-dir ./my-plugin-dev
```

#### 合并规则

`hub open` 执行时的完整合并流程：

1. 加载全局插件（`~/.roblox-studio-hub/plugins/`）
2. 向上查找 `.roblox-studio-hub/`，加载项目插件
3. 加载 `--plugin-dir` 指定的插件
4. 按名称去重，后加载的覆盖先加载的
5. 编译合并后的插件集并注入到 place 文件

### 发布插件

1. 创建 GitHub 仓库，包含 `.roblox-studio-hub-plugin/plugin.json` + Rojo 项目 + Lua 源码
2. 将仓库添加到 Marketplace（见下节），或直接通过 `hub plugin install owner/repo` 安装
3. 其他用户通过 `hub plugin install your-name/your-repo` 安装

发布的仓库结构：

```
my-plugin/                           ← 仓库根目录
├── .roblox-studio-hub-plugin/
│   └── plugin.json                  # Hub 通过此文件识别这是一个插件
├── default.project.json
└── src/
    └── init.lua
```

---

## Marketplace

Marketplace 是一个 Git 仓库，通过 `.roblox-studio-hub-plugin/marketplace.json` 索引和分发插件。

**两个约定路径**（类似 Claude Code 的 `.claude-plugin/`）：

| 文件 | 含义 |
|------|------|
| `.roblox-studio-hub-plugin/plugin.json` | 这个仓库是一个插件 |
| `.roblox-studio-hub-plugin/marketplace.json` | 这个仓库是一个市场 |

一个仓库可以同时是插件和市场（两个文件都有）。

### marketplace.json 格式

```json
{
  "name": "My Plugin Marketplace",
  "description": "插件市场描述",
  "plugins": [
    {
      "name": "plugin-a",
      "description": "插件 A 的功能说明",
      "source": "./plugin-a"
    },
    {
      "name": "plugin-b",
      "description": "插件 B 的功能说明",
      "source": "owner/repo"
    },
    {
      "name": "plugin-c",
      "description": "插件 C 的功能说明",
      "source": "https://github.com/owner/repo.git"
    }
  ]
}
```

`source` 相对路径基于 **marketplace.json 所在目录** 解析。

`source` 支持三种格式：

| 格式 | 说明 | 示例 |
|------|------|------|
| 相对路径 | 插件源码在 Marketplace 仓库内 | `./plugin-a` |
| `owner/repo` | GitHub 仓库 | `white-dragon-tools/my-plugin` |
| Git URL | 任意 Git 仓库 | `https://github.com/...` |

### 官方 Marketplace

Hub 仓库本身就是官方 Marketplace：

```
white-dragon-tools/roblox-studio-hub/
├── .roblox-studio-hub-plugin/
│   └── marketplace.json              # 官方市场索引
├── packages/
│   ├── plugins/
│   │   ├── execute/                  # source: "../packages/plugins/execute"
│   │   │   ├── .roblox-studio-hub-plugin/
│   │   │   │   └── plugin.json
│   │   │   ├── default.project.json
│   │   │   └── src/
│   │   └── get-studio-info/
│   │       └── ...
│   ├── hub/
│   └── ...
```

### 创建自己的 Marketplace

1. 创建 Git 仓库
2. 添加 `.roblox-studio-hub-plugin/marketplace.json`
3. 内联插件放在仓库中，用相对路径引用；外部插件用 `owner/repo` 引用
4. 推送到 GitHub
5. 用户通过 `hub marketplace add owner/repo` 添加

### 管理 Marketplace

```bash
# 添加
roblox-studio-hub marketplace add white-dragon-tools/roblox-studio-hub

# 列出
roblox-studio-hub marketplace list

# 移除
roblox-studio-hub marketplace remove white-dragon-tools/roblox-studio-hub
```

---

## WebSocket 协议

Studio Plugin 通过 WebSocket 与 Hub 通信。协议基于 JSON 消息。

### 上行消息（Studio → Hub）

| 类型 | 用途 | 关键字段 |
|------|------|---------|
| `hello` | 初始握手 | `studioInfo`, `methods`, `gameState` |
| `result` | 方法执行结果 | `id`, `payload` |
| `state` | 游戏状态变化 | `gameState: "edit" \| "play"` |
| `notify` | 事件通知 | `event`, `data` |
| `pong` | 心跳响应 | — |

### 下行消息（Hub → Studio）

| 类型 | 用途 | 关键字段 |
|------|------|---------|
| `welcome` | 握手确认 | `studioId` |
| `command` | 方法调用 | `id`, `method`, `params` |
| `subscribe` | 订阅事件 | `event` |
| `unsubscribe` | 取消订阅 | `event` |
| `ping` | 心跳请求 | — |

### 连接生命周期

```
Studio Plugin 启动
  │
  ├─ ws.connect("ws://localhost:35888")
  │
  ├─ Runtime:loadPlugins()
  │
  ├─ ws.send({ type: "hello", studioInfo, methods, gameState })
  │
  ├─ 收到 { type: "welcome", studioId }
  │
  ├─ 就绪，等待 command
  │
  │  ┌── Hub 发 command ──────────────────────┐
  │  │ { type: "command", id, method, params } │
  │  └────────────────────────────────────────┘
  │          │
  │          ▼
  │  Runtime:executeHandler(method, params)
  │          │
  │          ▼
  │  ┌── Studio 发 result ──────────┐
  │  │ { type: "result", id, payload } │
  │  └──────────────────────────────┘
  │
  ├─ F5 Play: ws.send({ type: "state", gameState: "play" })
  ├─ Shift+F5 Stop: ws.send({ type: "state", gameState: "edit" })
  │
  └─ 断开连接: Hub 自动清理 Studio 注册
```

---

## 项目结构

```
roblox-studio-hub/
├── .roblox-studio-hub-plugin/
│   └── marketplace.json              # 官方 Marketplace 索引
├── packages/
│   ├── hub/                  # Hub 服务（TypeScript，npm 发布）
│   │   ├── src/
│   │   │   ├── index.ts              # CLI 入口
│   │   │   ├── server/
│   │   │   │   ├── httpServer.ts     # HTTP API
│   │   │   │   ├── wsServer.ts       # WebSocket 服务
│   │   │   │   └── wsProtocol.ts     # 协议定义
│   │   │   ├── hub/
│   │   │   │   ├── StudioManager.ts  # Studio 实例管理
│   │   │   │   ├── hubPaths.ts       # 目录路径
│   │   │   │   ├── lockFile.ts       # 插件锁文件
│   │   │   │   ├── pluginDiscovery.ts # 插件发现
│   │   │   │   ├── pluginTypes.ts    # 类型定义
│   │   │   │   └── subscriptionManager.ts # 事件订阅
│   │   │   ├── commands/             # CLI 命令实现
│   │   │   ├── mcp/                  # MCP Server
│   │   │   └── utils/                # 工具函数
│   │   ├── public/                   # Web UI（调试用）
│   │   └── package.json
│   ├── runtime/              # Lua Runtime 框架
│   │   ├── src/init.lua              # 核心框架
│   │   ├── src/builtins/             # 内置插件
│   │   └── default.project.json      # Rojo 配置
│   ├── studio-plugin/        # Studio UI Plugin
│   │   ├── src/init.server.lua       # Plugin 源码
│   │   └── default.project.json
│   ├── plugins/              # 官方插件
│   │   ├── execute/
│   │   │   ├── .roblox-studio-hub-plugin/
│   │   │   │   └── plugin.json
│   │   │   ├── default.project.json
│   │   │   └── src/
│   │   └── get-studio-info/
│   │       ├── .roblox-studio-hub-plugin/
│   │       │   └── plugin.json
│   │       ├── default.project.json
│   │       └── src/
│   └── mock-studio/          # Lune 模拟 Studio（集成测试）
├── scripts/
│   └── inject-runtime.luau   # Runtime 注入脚本（Lune）
├── tests/
│   └── game.rbxl             # 测试用 place 文件
├── package.json              # Monorepo 根配置
└── pnpm-workspace.yaml       # pnpm 工作区
```

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `STUDIO_HUB_PORT` | `35888` | Hub 服务监听端口 |

---

## 故障排查

### Studio 未连接到 Hub

1. 确认 Hub 服务正在运行：`roblox-studio-hub status`
2. 在 Studio 中点击 "Hub" 按钮查看连接状态
3. 检查端口号是否一致（Studio Plugin 默认连接 35888）
4. 如果使用了 `--port`，确保 Studio Plugin 中的端口匹配

### 端口被占用 (EADDRINUSE)

```bash
# 查看占用端口的进程
lsof -ti:35888

# 终止进程
kill $(lsof -ti:35888)

# 或使用其他端口
STUDIO_HUB_PORT=35999 roblox-studio-hub serve
```

### Plugin 加载失败

1. 确认已安装插件：`roblox-studio-hub plugin list`
2. 重新注入 Runtime：`roblox-studio-hub open MyGame.rbxl`
3. 检查 Studio 输出窗口的错误日志

### Play 模式下方法不可用

Play 模式下 `loadstring()` 不可用，因此 execute 的 `eval` 模式无法工作。使用 `run` 或 `play` 模式替代：

```bash
roblox-studio-hub exec execute '{"code":"return 1+1","mode":"run"}'
```

### 方法返回 context 错误

每个方法声明了可用的上下文。如果 Studio 处于 Play 模式而方法要求 edit 上下文，需要先停止 Play 再调用。查看方法的 context 声明：

```bash
roblox-studio-hub info local:MyGame
```

---

## 许可证

MIT
