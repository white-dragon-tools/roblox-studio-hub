# Hub 集成 studio-physical：open + Runtime 接口反转

## Context

Hub 的 Studio 插件目前将所有业务逻辑内嵌在 plugin `.rbxm` 中，修改后需要重新编译 + 安装，开发迭代慢。

**目标**：将核心业务逻辑抽取到 `runtime` ModuleScript，注入到 place 文件中。plugin 仅保留 UI 壳 + require runtime。

## 核心设计：接口反转

**旧架构**：Hub 定义 API（`/api/execute` 等），Runtime 只是执行者。新增能力需同时改 Hub + Runtime。

**新架构**：Runtime 是纯框架（零业务逻辑），所有能力由插件提供，Hub 只做透传。

```
Runtime 启动（纯框架）
  ├─ 加载 builtins/ → 内置插件注册 handler（execute, getStudioInfo）
  ├─ 加载 plugins/  → 用户插件注册更多 handler
  └─ poll 时上报完整 methods 描述给 Hub

Hub（纯传输层）
  ├─ 存储每个 Studio 的 methods（含 description + inputSchema）
  ├─ POST /api/studios/:id/call { method, params }  → 转发给 Runtime
  └─ GET  /api/studios/:id/methods                   → 返回 MCP tool 描述

HTTP Client / MCP Server
  └─ 查询 methods → 映射为 MCP tools → 调用 /call → Hub 转发 → 插件处理 → 结果返回
```

**没有"内置 handler"，只有内置插件**。Runtime 本身不包含任何业务逻辑，execute、getStudioInfo 都是 `builtins/` 目录下的插件，与用户插件遵循完全相同的 `function(runtime)` 约定。

## 通信协议

### 1. Runtime → Hub：注册 + 心跳（poll）

Runtime 使用 **POST** 长轮询，`studioInfo`（含完整 `methods` 描述符）放在 request body 中。每个 method 是完整的接口描述符（name + description + inputSchema），Hub 存储后可直接作为 MCP tool 定义暴露给 client。

> **为什么用 POST？** methods 描述符包含 description 和 inputSchema，序列化后体积较大。GET query string 有 URL 长度限制风险，POST body 无此问题。同时 Runtime 无法可靠判断 Hub 是否已缓存 methods（Hub 可能重启），因此每次 poll 都携带完整 methods，简单可靠，零状态依赖。

```
POST /api/studio/poll
Content-Type: application/json
```

```json
{
  "studioInfo": {
    "placeId": 0,
    "placeName": "MyGame",
    "gameId": 0,
    "userId": 12345,
    "localPath": "/Users/me/MyGame",
    "methods": [
      {
        "name": "execute",
        "description": "Execute Lua code in Roblox Studio. Supports three modes: eval (direct loadstring), run (server-side via StudioTestService), play (full client+server test).",
        "inputSchema": {
          "type": "object",
          "properties": {
            "code": {
              "type": "string",
              "description": "Lua source code to execute"
            },
            "mode": {
              "type": "string",
              "enum": ["eval", "run", "play"],
              "description": "Execution mode. eval: direct loadstring, run: server test via StudioTestService, play: full Play mode test"
            },
            "timeout": {
              "type": "number",
              "description": "Execution timeout in seconds",
              "default": 30
            }
          },
          "required": ["code"]
        }
      },
      {
        "name": "getStudioInfo",
        "description": "Get current Roblox Studio environment information including place ID, place name, creator info, and local path.",
        "inputSchema": {
          "type": "object",
          "properties": {}
        }
      }
    ]
  },
  "timeout": 30
}
```

Hub 将 `methods` 原样存储在 `StudioInstance` 上，每次 poll 更新。`GET /api/studios/:id/methods` 原样返回此数组，client（如 MCP server）可直接映射为 tool 定义。

### 2. Hub → Runtime：下发命令（poll 响应）

```json
{
  "studioId": "path:/Users/me/MyGame",
  "commands": [
    {
      "id": "uuid-xxx",
      "type": "execute",
      "params": { "code": "return 1+1", "mode": "eval" }
    }
  ]
}
```

- `type` 对应插件注册的 handler name
- `params` 透传给 handler
- `id` 用于关联结果

### 3. Runtime → Hub：返回结果

```
POST /api/studio/result
```

```json
{
  "id": "uuid-xxx",
  "payload": { "success": true, "result": 2 }
}
```

payload 内容完全由 handler 决定，Hub 原样转发给调用方。

### 4. Client → Hub：调用接口

```
POST /api/studios/:id/call
```

```json
{
  "method": "execute",
  "params": { "code": "return 1+1", "mode": "eval" },
  "timeout": 30
}
```

响应：handler 返回的 payload 原样透传。

Hub 在转发前校验 `method` 是否在 Studio 上报的 `methods` 中（按 name 匹配）。

## Runtime 框架

### registerHandler

```lua
function Runtime:registerHandler(descriptor, handler)
```

- `descriptor` — 接口描述 table（name + description + inputSchema）
- `handler` — `function(params) -> result_table`

descriptor 格式：

```lua
{
    name = "方法名",
    description = "自然语言描述，会成为 MCP tool description",
    inputSchema = {
        type = "object",
        properties = {
            paramName = { type = "string", description = "参数描述" },
        },
        required = { "paramName" },
    },
}
```

- `name` — 方法标识符，用于 command dispatch 和 `/call` 调用
- `description` — 自然语言描述，Hub 原样透传给 client
- `inputSchema` — JSON Schema 格式，Hub 原样透传给 client
- Runtime 框架负责：task.spawn 调用、pcall 包裹、sendResult 回传
- handler 无需关心 HTTP 通信，只负责业务逻辑 + 返回结果

内部存储：

```lua
Runtime._handlers = {}   -- name -> handler function
Runtime._methods = {}    -- name -> { name, description, inputSchema }（不含 handler）
```

### getAvailableMethods

```lua
function Runtime:getAvailableMethods() -> { MethodDescriptor }
```

返回 `_methods` 的 values 数组，用于 poll 上报。序列化后即为 studioInfo.methods。

### 命令分发

```lua
function Runtime:_dispatchCommand(command)
    local handler = self._handlers[command.type]
    if not handler then
        if command.type ~= "disconnect" then
            warn("[HubRuntime] Unknown method: " .. tostring(command.type))
        end
        return
    end
    task.spawn(function()
        local ok, result = pcall(handler, command.params or {})
        if command.id then
            if ok then
                self:_sendResult(command.id, result or { success = true })
            else
                self:_sendResult(command.id, { success = false, error = tostring(result) })
            end
        end
    end)
end
```

### 插件加载

```lua
function Runtime:_loadPlugins()
    -- 1. 加载内置插件 (runtime/src/builtins/)
    local builtins = script:FindFirstChild("builtins")
    if builtins then
        for _, mod in builtins:GetChildren() do
            if mod:IsA("ModuleScript") then
                require(mod)(self)
            end
        end
    end

    -- 2. 加载用户插件 (~/.roblox-studio-hub/plugins/)
    local plugins = script:FindFirstChild("plugins")
    if plugins then
        for _, mod in plugins:GetChildren() do
            if mod:IsA("ModuleScript") then
                local ok, init = pcall(require, mod)
                if ok and type(init) == "function" then
                    init(self)
                elseif not ok then
                    warn("[HubRuntime] Failed to load plugin:", mod.Name, init)
                end
            end
        end
    end
end
```

`_loadPlugins()` 在 `connect()` 时调用（首次连接前加载一次）。builtins 与 user plugins 遵循完全相同的接口：导出 `function(runtime)`。

## 改动清单

### 1. `package.json` — 修改

- 添加依赖：`"@white-dragon-tools/roblox-studio-physical-operation": "^0.7.0"`
- `files` 数组加 `"runtime"`

### 2. `runtime/src/init.lua` — 新建

**纯框架**，不含任何业务逻辑：

```lua
local HttpService = game:GetService("HttpService")

local Runtime = {}
Runtime._handlers = {}       -- name -> handler function
Runtime._methods = {}        -- name -> { name, description, inputSchema }
Runtime._pollEnabled = false
Runtime._pollThread = nil
Runtime._baseUrl = ""
Runtime._pluginsLoaded = false
Runtime.isConnected = false
Runtime.studioId = nil
Runtime.debugMode = false

-- 事件回调（由 plugin UI 设置）
Runtime.onConnected = nil      -- function(studioId)
Runtime.onDisconnected = nil   -- function()
Runtime.onStatusChange = nil   -- function(status: string, color: Color3?)

-- === 公开 API ===

function Runtime:registerHandler(descriptor, handler) ... end
function Runtime:getAvailableMethods() ... end
function Runtime:connect(port) ... end
function Runtime:disconnect() ... end

-- === 内部方法 ===

function Runtime:_sendResult(id, payload) ... end
function Runtime:_dispatchCommand(command) ... end
function Runtime:_pollLoop() ... end
function Runtime:_loadPlugins() ... end

return Runtime
```

关键点：
- **零业务代码**，所有业务逻辑在 builtins/ 插件中
- 所有 UI 操作通过回调（`onStatusChange`、`onConnected`、`onDisconnected`）
- `_pollLoop` 使用 `HttpService:PostAsync` 发送 poll 请求，body 为 `{ studioInfo = { ..., methods = self:getAvailableMethods() }, timeout = 30 }`
- `_loadPlugins()` 在 `connect()` 首次调用时执行，先 builtins 后 plugins
- command 结构：`{ id, type, params }`

### 3. `runtime/src/builtins/execute.lua` — 新建（内置插件）

从 `studio-plugin/src/init.server.lua` 第 228-397 行提取，封装为插件格式：

```lua
return function(runtime)
    runtime:registerHandler({
        name = "execute",
        description = "Execute Lua code in Roblox Studio. Supports three modes: eval (direct loadstring), run (server-side via StudioTestService), play (full client+server test).",
        inputSchema = {
            type = "object",
            properties = {
                code = { type = "string", description = "Lua source code to execute" },
                mode = {
                    type = "string",
                    enum = { "eval", "run", "play" },
                    description = "Execution mode. eval: direct loadstring, run: server test via StudioTestService, play: full Play mode test",
                },
                timeout = { type = "number", description = "Execution timeout in seconds", default = 30 },
            },
            required = { "code" },
        },
    }, function(params)
        -- params.code, params.mode, params.timeout
        -- 使用 script.Parent:FindFirstChild("templates") 获取模板
        -- 返回 { success, result?, logs?, errors? }
    end)
end
```

模板引用路径：`script.Parent` 是 `builtins/`，`script.Parent.Parent` 是 `__HubRuntime__`，模板在 `script.Parent.Parent:FindFirstChild("templates")`。

### 4. `runtime/src/builtins/get-studio-info.lua` — 新建（内置插件）

从 `studio-plugin/src/init.server.lua` 第 165-209 行提取：

```lua
return function(runtime)
    runtime:registerHandler({
        name = "getStudioInfo",
        description = "Get current Roblox Studio environment information including place ID, place name, creator info, and local path.",
        inputSchema = {
            type = "object",
            properties = {},
        },
    }, function(params)
        local StudioService = game:GetService("StudioService")
        -- ... 收集 placeId, placeName, creatorName, gameId, userId, localPath
        return { success = true, ... }
    end)
end
```

### 5. `runtime/src/templates/` — 移动

将 `studio-plugin/src/templates/` 移动到 `runtime/src/templates/`：
- `server-runner.lua`
- `client-runner.lua`

execute 插件通过 `script.Parent.Parent:FindFirstChild("templates")` 访问。

### 6. `studio-plugin/src/init.server.lua` — 修改

精简为 UI 壳：
- 保留全部 UI 代码（toolbar、widget、buttons、port input、debug checkbox）
- 删除 templates 目录引用（已移至 runtime）
- 启动时 `require(game.ReplicatedStorage:WaitForChild("__HubRuntime__", 5))`
- 若成功：
  - 设置回调：`Runtime.onConnected`, `Runtime.onDisconnected`, `Runtime.onStatusChange`
  - 同步 debug mode：`Runtime.debugMode = debugMode`
  - connect/disconnect 按钮委托给 `Runtime:connect(port)` / `Runtime:disconnect()`
- 若失败：显示 `"Runtime not found. Use 'hub open' to inject."`，不启动
- 删除全部业务逻辑（getStudioInfo / sendResult / executeCode / handleCommand / pollLoop）

### 7. `src/types.ts` — 修改

新增 `MethodDescriptor` 类型：

```typescript
// Runtime 上报的方法描述符，直接对应 MCP tool 定义
export interface MethodDescriptor {
  name: string;                  // 方法标识符
  description: string;           // 自然语言描述（→ MCP tool description）
  inputSchema: {                 // JSON Schema（→ MCP tool inputSchema）
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface StudioInfo {
  // ... 现有字段不变
  methods?: MethodDescriptor[];  // 新增
}

export interface StudioInstance {
  // ... 现有字段不变
  methods: MethodDescriptor[];   // 新增
}
```

### 8. `src/hub/StudioManager.ts` — 修改

register 时初始化 methods，heartbeat 时更新：

```typescript
register(info: StudioInfo): StudioInstance | null {
  const instance: StudioInstance = {
    // ... 现有字段
    methods: info.methods || [],
  };
}

heartbeat(studioId: string, info?: StudioInfo): boolean {
  const studio = this.studios.get(studioId);
  if (!studio) return false;
  studio.lastHeartbeat = Date.now();
  if (info?.methods) {
    studio.methods = info.methods;
  }
  return true;
}
```

### 9. `src/server/httpServer.ts` — 修改

**poll 端点从 GET 改为 POST**：studioInfo 从 query string 移到 request body

```typescript
// 原来: app.get('/api/studio/poll', ...)  从 req.query.studioInfo 读取
// 改为: app.post('/api/studio/poll', ...) 从 req.body.studioInfo 读取
//       timeout 也从 req.body.timeout 读取

app.post('/api/studio/poll', (req, res) => {
  const { studioInfo, timeout = 30 } = req.body;
  // ... 其余逻辑不变，仅数据源从 query string 变为 body
});
```

heartbeat 时传入 studioInfo 以更新 methods：

```typescript
// 原来: studioManager.heartbeat(studioId);
// 改为: studioManager.heartbeat(studioId, studioInfo);
```

**修改 command 结构**：`payload` → `params`

**抽取 `resolveStudio` 辅助函数**（去重 ID 解析逻辑）：

```typescript
function resolveStudio(id: string): StudioInstance | undefined {
  if (id.startsWith('place:')) return studioManager.getByPlaceId(parseInt(id.slice(6), 10));
  if (id.startsWith('local:')) return studioManager.getByPlaceName(id.slice(6));
  return studioManager.get(id);
}
```

**重构 `callStudio` 通用函数**（从 `executeOnStudio` 泛化）：

```typescript
function callStudio(studioId: string, method: string, params: unknown, timeout: number) {
  return new Promise((resolve) => {
    const id = uuidv4();
    const command = { id, type: method, params, createdAt: Date.now() };
    // 设置超时、注册 pendingResult、发送命令
    // 逻辑与原 executeOnStudio 一致，仅字段名变化
  });
}
```

**新增 `GET /api/studios/:id/methods`**：

```typescript
app.get('/api/studios/:id/methods', (req, res) => {
  const studio = resolveStudio(req.params.id);
  if (!studio) return res.status(404).json({ error: 'Studio not found' });
  res.json({ methods: studio.methods });
});
```

返回的 `methods` 数组中每个元素包含 `name`, `description`, `inputSchema`，可直接作为 MCP tool 定义。

**新增 `POST /api/studios/:id/call`**：

```typescript
app.post('/api/studios/:id/call', async (req, res) => {
  const { method, params, timeout = 30 } = req.body;
  const studio = resolveStudio(req.params.id);
  if (!studio) return res.status(404).json({ error: 'Studio not found' });
  if (!studio.methods.some(m => m.name === method)) {
    return res.status(400).json({ error: `Method not available: ${method}` });
  }
  const result = await callStudio(studio.id, method, params, timeout);
  res.json(result);
});
```

**保留 `POST /api/execute`**（向后兼容），委托给 callStudio：

```typescript
app.post('/api/execute', async (req, res) => {
  const { studioId, code, mode = 'eval', timeout = 30 } = req.body;
  const studio = resolveStudio(studioId);
  if (!studio) return res.status(404).json({ error: `Studio not found: ${studioId}` });
  const result = await callStudio(studio.id, 'execute', { code, mode, timeout }, timeout);
  res.json(result);
});
```

### 10. `src/index.ts` — 修改

新增 `case 'open':` + `openStudio()` + `showOpenHelp()`。

`openStudio()` 逻辑：
1. `path.resolve(process.argv[3])` 解析 place 路径
2. 计算绝对路径：
   - `runtimeSrcPath = path.join(__dirname, '..', 'runtime', 'src')`
   - `pluginsPath = path.join(os.homedir(), '.roblox-studio-hub', 'plugins')`
3. `mkdirSync(pluginsPath, { recursive: true })`
4. 动态生成 project.json 写入 `os.tmpdir()`
5. `await injectIntoPlace(placePath, tmpProjectJson)`
6. `await openPlace(placePath)`
7. 清理临时文件

动态生成的 project.json：

```json
{
  "name": "StudioHubRuntime",
  "tree": {
    "$className": "DataModel",
    "ReplicatedStorage": {
      "$className": "ReplicatedStorage",
      "__HubRuntime__": {
        "$path": "<runtimeSrcPath>",
        "plugins": {
          "$path": "<pluginsPath>"
        }
      }
    }
  }
}
```

注入后的 DataModel 结构：

```
ReplicatedStorage
└── __HubRuntime__ (ModuleScript)      ← runtime/src/init.lua
    ├── builtins/ (Folder)             ← runtime/src/builtins/
    │   ├── execute (ModuleScript)
    │   └── get-studio-info (ModuleScript)
    ├── templates/ (Folder)            ← runtime/src/templates/
    │   ├── server-runner (ModuleScript)
    │   └── client-runner (ModuleScript)
    └── plugins/ (Folder)             ← ~/.roblox-studio-hub/plugins/
        └── (用户自定义插件)
```

import 语句：

```typescript
import { injectIntoPlace } from '@white-dragon-tools/roblox-studio-physical-operation/rojo-inject';
import { openPlace } from '@white-dragon-tools/roblox-studio-physical-operation/studio-manager';
import os from 'os';
```

## 涉及文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `package.json` | 修改 | 加依赖 + files |
| `runtime/src/init.lua` | 新建 | 纯框架：handler 注册 + 通信 + 插件加载 |
| `runtime/src/builtins/execute.lua` | 新建 | 内置插件：代码执行 |
| `runtime/src/builtins/get-studio-info.lua` | 新建 | 内置插件：Studio 环境信息 |
| `runtime/src/templates/server-runner.lua` | 移动 | 从 studio-plugin 移过来 |
| `runtime/src/templates/client-runner.lua` | 移动 | 从 studio-plugin 移过来 |
| `studio-plugin/src/init.server.lua` | 修改 | 精简为 UI 壳 + require runtime |
| `studio-plugin/src/templates/` | 删除 | 已移至 runtime |
| `src/types.ts` | 修改 | 新增 MethodDescriptor，StudioInfo/Instance 加 methods |
| `src/hub/StudioManager.ts` | 修改 | register/heartbeat 处理 methods |
| `src/server/httpServer.ts` | 修改 | 新增 /call + /methods，重构 callStudio + resolveStudio |
| `src/index.ts` | 修改 | 新增 open 命令 |

## API 总览（改动后）

### Studio API（Runtime 调用）

| 端点 | 说明 |
|------|------|
| `POST /api/studio/poll` | 长轮询：注册/心跳/接收命令。studioInfo（含 methods 描述符）在 body 中 |
| `POST /api/studio/result` | 返回 handler 执行结果 |

### Client API（外部调用）

| 端点 | 说明 |
|------|------|
| `GET /api/studios` | 列出所有 Studio |
| `GET /api/studios/:id` | Studio 详情 |
| `GET /api/studios/:id/methods` | **新增**：查询可用接口（返回 MCP tool 描述符数组） |
| `POST /api/studios/:id/call` | **新增**：调用 Runtime 接口（通用入口） |
| `GET /api/studios/:id/logs` | Studio 日志 |
| `POST /api/execute` | 保留（向后兼容），内部委托 callStudio |

### CLI 命令

| 命令 | 说明 |
|------|------|
| `roblox-studio-hub open <place>` | **新增**：注入 Runtime 并打开 Studio |
| 其他命令 | 不变 |

## 验证

1. `npm run build` 通过
2. `roblox-studio-hub open test.rbxl` — 注入成功 + Studio 打开
3. Studio `ReplicatedStorage.__HubRuntime__` 存在，含 builtins + templates + plugins 子节点
4. Plugin 加载时成功 require runtime，UI 正常
5. 连接 Hub 后，`GET /api/studios/:id/methods` 返回完整描述符数组：
   ```json
   {
     "methods": [
       {
         "name": "execute",
         "description": "Execute Lua code in Roblox Studio...",
         "inputSchema": { "type": "object", "properties": { "code": {...}, "mode": {...} }, "required": ["code"] }
       },
       {
         "name": "getStudioInfo",
         "description": "Get current Roblox Studio environment...",
         "inputSchema": { "type": "object", "properties": {} }
       }
     ]
   }
   ```
6. `POST /api/studios/:id/call { method: "execute", params: { code: "return 1+1", mode: "eval" } }` → `{ success: true, result: 2 }`
7. `roblox-studio-hub exec <studioId> -c "return 1+1"` 通过（向后兼容）
8. 用户插件放入 `~/.roblox-studio-hub/plugins/`，重新 `hub open` 后新 method 及其描述出现在 methods 列表
