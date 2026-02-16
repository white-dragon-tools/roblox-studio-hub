# Monorepo 重构 + WebSocket 协议迁移 - 实施计划

## 概述

将 Roblox Studio Hub 从扁平结构重构为 monorepo，并将 Studio-Hub 通信从 HTTP 短轮询（2s 间隔）迁移到 WebSocket 全双工通信。共 9 个 Phase（0-8），每个 Phase 可独立 commit 并验证。

## 关键决策

- runtime init.lua 不拆分，不做依赖注入
- mock-studio 用 Lune 完整模拟 Studio 环境，加载真实 init.lua
- WS 优先、HTTP 降级（向后兼容）
- 每个 Phase 独立 commit + 验证

## 依赖关系图

```
Phase 0 (Monorepo 搬家)
    ├→ Phase 1 (WS 协议) ─→ Phase 2 (WS Server) ─┐
    └→ Phase 3 (StudioManager) ───────────────────┘
                        ↓
                  Phase 4 (整合 callStudio)
                        ↓
         ┌──────────────┼──────────────┐
    Phase 5          Phase 6         Phase 7
  (Runtime WS)   (Mock Studio)   (TS E2E Tests)
                        ↓
                  Phase 8 (Plugin UI)
```

---

## Phase 0: Monorepo 重构（纯搬家，不改逻辑）

### 目标

将扁平结构重组为 `packages/` monorepo，npm workspaces 管理，所有现有测试仍通过。

### 目标结构

```
root/
  packages/
    hub/              # @white-dragon-tools/roblox-studio-hub (npm)
      src/server/, src/hub/, src/commands/, src/utils/, src/types.ts, src/index.ts
      public/, commands/, skills/, .claude-plugin/
      package.json, tsconfig.json, vitest.config.ts
    runtime/          # Lua runtime (Rojo project)
      src/init.lua, src/builtins/
      default.project.json
    studio-plugin/    # Lua Studio UI (Rojo project)
      src/init.server.lua
      default.project.json
    mock-studio/      # Lune 模拟完整 Studio 环境
      src/
  scripts/            # 跨包脚本
  tests/              # 共享 fixtures (game.rbxl)
  package.json        # root workspaces 配置
```

### 移动映射

| 源路径 | 目标路径 |
|--------|----------|
| `src/` | `packages/hub/src/` |
| `public/` | `packages/hub/public/` |
| `commands/`, `skills/`, `.claude-plugin/` | `packages/hub/` 下 |
| `tsconfig.json`, `vitest.config.ts` | `packages/hub/` |
| `package.json` | 拆为 root + `packages/hub/package.json` |
| `runtime/` | `packages/runtime/` |
| `studio-plugin/` | `packages/studio-plugin/` |
| `tests/`, `scripts/` | 保留 root |

### 步骤

1. 创建 root `package.json`（workspaces 配置）
2. 创建 `packages/hub/` 并迁移 TS 源码 + 配套文件
3. 创建 `packages/hub/package.json`（从原 package.json 提取）
4. 修复 Hub 内部路径引用（关键: `injectRuntime.ts` 中的 `PROJECT_ROOT`）
5. 迁移 `runtime/` → `packages/runtime/`
6. 迁移 `studio-plugin/` → `packages/studio-plugin/`
7. 保留 root 级别共享资源（tests/, scripts/, aftman.toml, .gitignore）
8. 创建 `packages/mock-studio/` 空骨架
9. 更新 build 脚本中的路径
10. 验证: `npm install` + `npm run build` + `npm run test`

### 风险

- **高**: `injectRuntime.ts` 中多处硬编码相对路径，需系统性修复
- **中**: `package.json` 拆分后 bin/files 字段需调整

### 变更文件

| 操作 | 文件 |
|------|------|
| 改写 | `package.json` (root, workspace config) |
| 新建 | `packages/hub/package.json` |
| 移动 | `src/` → `packages/hub/src/` |
| 移动 | `public/` → `packages/hub/public/` |
| 移动 | `commands/` → `packages/hub/commands/` |
| 移动 | `skills/` → `packages/hub/skills/` |
| 移动 | `.claude-plugin/` → `packages/hub/.claude-plugin/` |
| 移动 | `tsconfig.json` → `packages/hub/tsconfig.json` |
| 移动 | `vitest.config.ts` → `packages/hub/vitest.config.ts` |
| 移动 | `runtime/` → `packages/runtime/` |
| 移动 | `studio-plugin/` → `packages/studio-plugin/` |
| 修改 | `packages/hub/src/utils/injectRuntime.ts` (路径修复) |
| 修改 | `.gitignore` |

---

## Phase 1: WS 协议定义（TDD）

### 目标

定义 WebSocket 通信协议的类型系统和消息解析/序列化工具函数。100% 纯类型 + 纯函数，零副作用。

### 消息类型

| 方向 | 消息 | 用途 |
|------|------|------|
| Studio→Hub | `hello` | 连接后发送，携带 studioInfo + methods |
| Studio→Hub | `result` | 命令执行结果 |
| Studio→Hub | `state` | gameState 变化 (edit↔play) |
| Studio→Hub | `notify` | 订阅事件的通知推送 |
| Studio→Hub | `pong` | 心跳响应 |
| Hub→Studio | `welcome` | 确认连接，返回 studioId |
| Hub→Studio | `command` | 调用方法 |
| Hub→Studio | `subscribe` | 订阅事件 |
| Hub→Studio | `unsubscribe` | 取消订阅 |
| Hub→Studio | `ping` | 心跳检测 |

### 类型扩展

- `MethodDescriptor` 加 `context?: "edit" | "play" | "both"`
- `StudioInstance` 加 `gameState: "edit" | "play"`

### 工具函数

- `parseUpstreamMessage(raw: string): UpstreamMessage`
- `serializeDownstreamMessage(msg: DownstreamMessage): string`
- `isMethodAllowedForState(method, gameState): boolean`

### 变更文件

| 操作 | 文件 |
|------|------|
| 修改 | `packages/hub/src/types.ts` |
| 新建 | `packages/hub/src/server/wsProtocol.ts` |
| 新建 | `packages/hub/src/server/wsProtocol.test.ts` |

---

## Phase 2: WebSocket Server（TDD）

### 目标

创建 WebSocket 服务器，处理 Studio 的 WS 连接生命周期。

### 接口

```typescript
export function createWsServer(deps: {
  httpServer: HttpServer;
  studioManager: StudioManager;
  pendingResults: Map<string, PendingResult>;
}): WebSocketServer;
```

### 核心逻辑

1. `new WebSocketServer({ server: httpServer })` 挂载到现有 HTTP 服务器
2. 连接时进入 `"awaiting_hello"` 状态
3. 收到 hello → 注册 Studio → 发 welcome → 进入 `"ready"`
4. ready 状态处理 result, state, notify, pong
5. 30s ping/pong 心跳
6. 断开时清理 StudioInstance

### 测试用例

1. 客户端连接后发送 hello，收到 welcome
2. hello 中的 studioInfo 正确注册到 StudioManager
3. 客户端断开后 Studio 注销
4. ping/pong 心跳正常
5. 无效消息不崩溃
6. 未发送 hello 就发消息时拒绝
7. sendCommand 通过 WS 发送
8. 收到 result 后 resolve pendingResult
9. 收到 state 后更新 gameState

### 变更文件

| 操作 | 文件 |
|------|------|
| 新建 | `packages/hub/src/server/wsServer.ts` |
| 新建 | `packages/hub/src/server/wsServer.test.ts` |

---

## Phase 3: StudioManager 适配

### 目标

扩展 StudioManager 支持 WebSocket 连接状态和 gameState 管理。

### 新增方法

- `updateGameState(studioId, state): boolean`
- `setWs(studioId, ws): void`
- `getWs(studioId): WebSocket | undefined`
- `hasWs(studioId): boolean`
- `register()` 默认 `gameState: "edit"`
- `unregisterById()` 清除 ws 引用

### 变更文件

| 操作 | 文件 |
|------|------|
| 新建 | `packages/hub/src/hub/StudioManager.test.ts` |
| 修改 | `packages/hub/src/hub/StudioManager.ts` |

---

## Phase 4: 整合 callStudio（WS 优先，HTTP 降级）

### 目标

将 httpServer.ts 中的 `callStudio` 升级为 WS 优先模式。

### 逻辑

```
callStudio(studioId, method, params):
  1. 检查 method.context 匹配 studio.gameState
  2. 如果 studio 有 WS → ws.send(command) → 等待 result
  3. 否则回退到 HTTP pendingCommands 队列
```

### 变更

- `AppOptions` 新增 `sendWsCommand` 回调
- `createHttpServer` 同时创建 WS 服务器
- `/api/studios/:id/call` 新增 context 校验
- 清理逻辑区分 WS/HTTP Studio
- HTTP poll 端点完全保留

### 变更文件

| 操作 | 文件 |
|------|------|
| 修改 | `packages/hub/src/server/httpServer.ts` |
| 修改 | `packages/hub/src/server/httpServer.test.ts` |

---

## Phase 5: Runtime WS 改造

### 目标

将 Runtime 的 `_pollLoop` 替换为 `_wsConnect`，使用 Roblox Studio WebSocket API。init.lua 保持单文件。

### 核心改动

- `Runtime:connect(port)` → 启动 `_wsConnect` 替代 `_pollLoop`
- 新增 `Runtime:_wsConnect()` — `HttpService:CreateWebStreamClient`
- 新增 `Runtime:_handleWsMessage(msg)` — 处理 welcome/command/ping
- `Runtime:_sendResult()` — WS 模式通过 `ws:Send()` 发送
- 新增 `Runtime:_handleWsClose()` — 断开处理 + 自动重连
- gameState 检测: `RunService:IsEdit()` 变化时发送 state 消息
- 删除 `_pollLoop` 及相关字段

### 变更文件

| 操作 | 文件 |
|------|------|
| 修改 | `packages/runtime/src/init.lua` (大改: HTTP poll → WS) |

### 风险

- **高**: `CreateWebStreamClient` 是 2025.10+ 新 API，行为不确定
- 缓解: 保留 HTTP 降级路径（Phase 4），Phase 6 mock-studio 可先验证协议

---

## Phase 6: Mock Studio（Lune 模拟）

### 目标

用 Lune 构建完整 Roblox Studio 模拟环境，加载并运行真实 `runtime/src/init.lua`，与 Hub WS 服务器通信。

### 目录结构

```
packages/mock-studio/
  mock-studio.luau          # 主入口
  lib/
    mock-roblox.luau        # 模拟 game、Services
    mock-transport.luau     # net.socket 包装成 Roblox WS 事件接口
  test-scenarios/
    test-connect.luau       # 连接 + hello/welcome 握手
    test-command.luau       # 接收命令 + 返回结果
    test-reconnect.luau     # 断开重连
    test-state.luau         # gameState 变化上报
```

### 模拟内容

1. `Instance.new("DataModel")` 创建 game
2. `implementMethod("HttpService", "JSONEncode/JSONDecode", ...)` → `serde.encode/decode`
3. `implementMethod("HttpService", "CreateWebStreamClient", ...)` → `net.socket` 包装成 Roblox 事件接口
4. 构建 ReplicatedStorage Instance 树（`__HubRuntime__` + plugins）
5. `require` 真实 `runtime/src/init.lua`

### 集成到 vitest

`packages/hub/src/server/mockStudio.integration.test.ts`:
- vitest 启动 Hub WS server
- `child_process` 运行 `lune run packages/mock-studio/test-scenarios/test-*.luau`
- 断言 exit code + stdout

### 变更文件

| 操作 | 文件 |
|------|------|
| 新建 | `packages/mock-studio/mock-studio.luau` |
| 新建 | `packages/mock-studio/lib/mock-roblox.luau` |
| 新建 | `packages/mock-studio/lib/mock-transport.luau` |
| 新建 | `packages/mock-studio/test-scenarios/test-connect.luau` |
| 新建 | `packages/mock-studio/test-scenarios/test-command.luau` |
| 新建 | `packages/mock-studio/test-scenarios/test-reconnect.luau` |
| 新建 | `packages/mock-studio/test-scenarios/test-state.luau` |
| 新建 | `packages/hub/src/server/mockStudio.integration.test.ts` |

### 风险

- **高**: Lune `implementMethod` 模拟 Roblox API 的完整性
- 缓解: 只模拟 Runtime 使用的最小 API 子集

---

## Phase 7: TS Mock Client + E2E 测试

### 目标

纯 TypeScript WebSocket 客户端模拟 Studio，测试 Hub 侧完整 WS 逻辑，无需 Lune。

### MockStudioClient 接口

```typescript
export class MockStudioClient {
  async connect(options): Promise<string>;
  async waitForMessage(type, timeout?): Promise<unknown>;
  async sendResult(id, payload): Promise<void>;
  async sendState(gameState): Promise<void>;
  async disconnect(): Promise<void>;
}
```

### E2E 测试用例

1. 完整握手: connect → hello → welcome → 注册
2. 命令分发: POST /call → WS command → WS result → HTTP 200
3. 多 Studio 并发: 2 个 MockStudio，命令路由正确
4. gameState 更新: sendState("play") → 验证 StudioInstance.gameState
5. context 过滤: method.context="edit", gameState="play" → 400
6. 断开重连: disconnect → reconnect → 仍可用
7. 超时处理: 命令无 result → 超时
8. 并发命令: 同时多个命令
9. 心跳: 30s 无 pong → 断开

### 变更文件

| 操作 | 文件 |
|------|------|
| 新建 | `packages/hub/src/server/mockStudioClient.ts` |
| 新建 | `packages/hub/src/server/wsServer.e2e.test.ts` |

---

## Phase 8: Studio Plugin UI 更新

### 目标

更新 Studio Plugin UI 适配 WS 通信，显示 gameState 状态。

### 改动

1. 新增 `gameStateLabel` UI 元素（Edit Mode / Play Mode）
2. 监听 `RunService` 状态变化更新 UI
3. `connectButton` 检查从 `_pollEnabled` 改为 `_wsEnabled`
4. 状态显示 "Connected (WS)"

### 变更文件

| 操作 | 文件 |
|------|------|
| 修改 | `packages/studio-plugin/src/init.server.lua` |

---

## 风险总览

| 级别 | 风险 | 缓解 |
|------|------|------|
| 高 | Roblox `CreateWebStreamClient` 行为不确定 | 保留 HTTP 降级; mock-studio 先验证 |
| 高 | Lune 模拟 Roblox 环境完整性 | 只模拟最小子集 |
| 高 | Monorepo 路径断裂 (`injectRuntime.ts`) | 系统性检查所有 `path.join(__dirname, ...)` |
| 中 | WS/HTTP 并存并发问题 | 明确优先级规则，ws 字段作判据 |
| 中 | Play 模式双连接 | 协议 hello 包含 gameState，Hub 区分上下文 |
| 低 | npm workspace 配置 | 成熟特性，遵循标准配置 |
| 低 | 现有测试回归 | 每个 Phase 结束跑完整测试 |

## 验证标准

- [ ] Monorepo: `npm install` + `npm run build` + `npm run test` 通过
- [ ] WS 协议: 覆盖所有上行/下行消息类型
- [ ] WS 生命周期: connect → hello → welcome → command → result → disconnect
- [ ] callStudio: WS 优先，HTTP 降级
- [ ] Runtime: HTTP poll 替换为 WS connect
- [ ] Mock Studio: 加载真实 Runtime 并完成握手
- [ ] TS E2E: 覆盖 9+ 场景
- [ ] Studio Plugin: 显示 gameState，适配 WS API
- [ ] 测试覆盖率 >= 80%
- [ ] HTTP poll 路径保留向后兼容
