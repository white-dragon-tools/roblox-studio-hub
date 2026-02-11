# 🐉 Roblox Studio Hub

一个用于管理多个 Roblox Studio 实例的 WebSocket Hub，支持远程代码执行和实时监控。

## ✨ 功能特性

- **多 Studio 管理** - 同时连接和管理多个 Roblox Studio 实例
- **远程代码执行** - 支持三种执行模式：
  - `eval` - 直接在 Studio 中执行 Lua 代码（使用 loadstring）
  - `run` - 通过 StudioTestService 运行服务端测试
  - `play` - 完整的 Play 模式测试（包含服务端和客户端）
- **实时状态监控** - 通过 Web UI 实时查看所有连接的 Studio 状态
- **HTTP 长轮询** - 稳定可靠的通信机制，无需 WebSocket
- **自动重连** - Studio 插件支持断线自动重连


## 🤖 AI READY

本项目提供 `claude code` 兼容技能

- **安装** - `npx skills add white-dragon-tools/roblox-studio-hub`
- **初始化 (ask ai)** - ` install studio hub`
  - 注意, 初始化将:
  - 1. 设置 hub 为服务
  - 2. 安装 studio plugin

## 🏗️ 架构概览

```
┌─────────────────┐     HTTP Long Polling     ┌─────────────────┐
│  Roblox Studio  │ ◄──────────────────────► │   Studio Hub    │
│    (Plugin)     │                           │    (Server)     │
└─────────────────┘                           └────────┬────────┘
                                                       │
┌─────────────────┐     HTTP Long Polling     ┌────────▼────────┐
│  Roblox Studio  │ ◄──────────────────────► │    REST API     │
│    (Plugin)     │                           └────────┬────────┘
└─────────────────┘                                    │
                                              ┌────────▼────────┐
                                              │     Web UI      │
                                              │  (Browser)      │
                                              └─────────────────┘
```

## 📦 项目结构

```
roblox-studio-hub/
├── src/                          # 服务端源码 (TypeScript)
│   ├── index.ts                  # 入口文件
│   ├── types.ts                  # 类型定义
│   ├── hub/
│   │   └── StudioManager.ts      # Studio 实例管理器
│   └── server/
│       └── httpServer.ts         # HTTP 服务器 & API
├── public/                       # Web UI 静态文件
│   ├── index.html
│   ├── style.css
│   └── app.js
├── studio-plugin/                # Roblox Studio 插件
│   ├── default.project.json      # Rojo 项目配置
│   └── src/
│       ├── init.server.lua       # 插件主逻辑
│       └── templates/
│           ├── server-runner.lua # 服务端测试模板
│           └── client-runner.lua # 客户端测试模板
├── package.json
└── tsconfig.json
```

## 🚀 快速开始

### 前置要求

- Node.js 18+
- [Aftman](https://github.com/LPGhatguy/aftman) (用于安装 Rojo)
- Roblox Studio

### 安装步骤

1. **安装 Hub（从 GitHub npm 源）**

```bash
# 配置 GitHub npm 源
npm config set @white-dragon-tools:registry https://npm.pkg.github.com

# 全局安装
npm install -g @white-dragon-tools/roblox-studio-hub
```

2. **注册为系统服务（推荐）**

```bash
# 查看帮助
roblox-studio-hub

# 注册为系统服务（开机自启）
# Windows 需要管理员权限，Mac/Linux 需要 sudo
roblox-studio-hub install

# 查看服务状态
roblox-studio-hub status
```

其他服务管理命令：
```bash
roblox-studio-hub start      # 启动服务
roblox-studio-hub stop       # 停止服务
roblox-studio-hub uninstall  # 卸载服务
roblox-studio-hub serve      # 前台运行（调试用）
```

4. **执行 Lua 脚本**

```bash
# 基本用法
roblox-studio-hub exec place:123456 script.lua

# 指定执行模式
roblox-studio-hub exec local:MyGame test.lua -m run
roblox-studio-hub exec place:123456 test.lua --mode play
```

执行模式：
- `eval` - 直接执行（默认）
- `run` - 服务端测试模式
- `play` - 完整 Play 模式

5. **安装 Studio 插件**

```bash
roblox-studio-hub install-plugin
```

插件会自动安装到：
- Windows: `%LOCALAPPDATA%\Roblox\Plugins\`
- macOS: `~/Documents/Roblox/Plugins/`

### 使用方法

1. 确保 Hub 服务正在运行（`roblox-studio-hub status`）
2. 打开 Roblox Studio，插件会自动连接到 Hub
3. 打开浏览器访问 `http://localhost:35888` 查看 Web UI
4. 在 Web UI 中选择目标 Studio，输入 Lua 代码并执行

## 📡 API 参考

### Studio API（供插件使用）

#### `GET /api/studio/poll`

Studio 长轮询接口，用于注册、心跳和获取命令。

**Query 参数:**
- `studioInfo` (string, required) - JSON 编码的 Studio 信息
- `timeout` (number, optional) - 轮询超时时间，默认 30 秒

**响应:**
```json
{
  "studioId": "place:123456",
  "commands": [
    {
      "id": "uuid",
      "type": "execute",
      "payload": {
        "code": "print('Hello')",
        "mode": "eval",
        "timeout": 30
      }
    }
  ]
}
```

#### `POST /api/studio/result`

Studio 返回执行结果。

**请求体:**
```json
{
  "id": "command-uuid",
  "payload": {
    "success": true,
    "result": "返回值",
    "logs": { "server": ["log1", "log2"] },
    "errors": {}
  }
}
```

### Client API（供 Web UI 和外部调用）

#### `GET /api/studios`

获取所有已连接的 Studio 列表。

**响应:**
```json
{
  "studios": [
    {
      "id": "place:123456",
      "type": "place",
      "placeId": 123456,
      "placeName": "My Game",
      "connectedAt": "2024-01-01T00:00:00.000Z",
      "clientCount": 0
    }
  ]
}
```

#### `GET /api/studios/:id`

获取单个 Studio 详情。

#### `GET /api/studios/:id/logs`

获取 Studio 日志。

**Query 参数:**
- `limit` (number, optional) - 返回日志条数，默认 100

#### `POST /api/execute`

向指定 Studio 执行代码。

**请求体:**
```json
{
  "studioId": "place:123456",
  "code": "return 1 + 1",
  "mode": "eval",
  "timeout": 30
}
```

**执行模式:**
- `eval` - 直接执行，适合简单脚本
- `run` - 服务端测试模式
- `play` - 完整 Play 模式（服务端 + 客户端）

**响应:**
```json
{
  "success": true,
  "result": 2,
  "logs": { "server": [] },
  "errors": {}
}
```

### UI API

#### `GET /api/ui/init`

获取 UI 初始化数据。

#### `GET /api/ui/poll`

UI 长轮询接口，获取实时事件更新。

**Query 参数:**
- `since` (number, optional) - 上次事件时间戳
- `timeout` (number, optional) - 轮询超时时间

## ⚙️ 配置

### 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `STUDIO_HUB_PORT` | `35888` | 服务器监听端口 |

### Studio 插件配置

在 Studio 插件 UI 中可以配置：
- **Port** - Hub 服务器端口（默认 35888）
- **Debug Mode** - 启用调试日志输出

## 🔧 开发

### 可用脚本

```bash
npm run dev          # 开发模式运行（使用 tsx）
npm run build        # 编译 TypeScript
npm start            # 运行编译后的代码
npm run rojo:build:plugin  # 构建 Studio 插件
```

### Studio ID 格式

- 云场景: `place:{placeId}` (例: `place:123456`)
- 本地文件（自定义路径）: `path:{localPath}` (例: `path:D:/Projects/MyGame`)
- 本地文件（默认）: `local:{placeName}` (例: `local:MyGame`)

### 本地模式识别（LocalPlacePath）

在本地模式下（placeId 为 0），插件会尝试读取 `Workspace` 的 `LocalPlacePath` Attribute 作为唯一识别符。

外部工具可以通过以下方式设置此属性来识别特定的 Studio 实例：

```lua
-- 设置 Workspace 的 LocalPlacePath 属性
workspace:SetAttribute("LocalPlacePath", "D:/Projects/MyGame")
```

当 `LocalPlacePath` 存在时：
- Studio ID 格式变为 `path:{localPath}`
- 上报的 `studioInfo` 中会包含 `localPath` 字段
- 可通过 `path:xxx` 格式的 ID 来定位该 Studio

## 📝 注意事项

1. **HTTP 请求权限** - 确保 Roblox Studio 已启用 HTTP 请求（Studio Settings → Security → Allow HTTP Requests）

2. **防火墙** - 如果连接失败，请检查防火墙是否阻止了本地端口

3. **心跳超时** - Studio 超过 35 秒无心跳会被自动移除

4. **Play 模式** - Play 模式会实际启动游戏测试，执行完成后自动停止

## 开发流程

```bash
# 1. 停止服务
roblox-studio-hub stop

# 2. 启动开发模式
npm run dev

# 3. 测试完成后，构建并发布
npm run build
npm publish

# 4. 更新本地版本并启动服务
npm update -g @white-dragon-tools/roblox-studio-hub
roblox-studio-hub start

# 5. 更新插件（如果插件有改动）
roblox-studio-hub install-plugin
```

### 更新服务

```bash
# 停止服务
roblox-studio-hub stop

# 更新 npm 包
npm update -g @white-dragon-tools/roblox-studio-hub

# 启动服务
roblox-studio-hub start

# 更新插件（如果插件有改动）
roblox-studio-hub install-plugin
```

如果服务配置有变化，需要重新安装服务：

```bash
roblox-studio-hub uninstall
roblox-studio-hub install
```

## 📄 License

MIT License
