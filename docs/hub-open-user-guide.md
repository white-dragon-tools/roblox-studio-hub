# `hub open` 用户手册

## 概述

`roblox-studio-hub open` 命令用于将 Hub Runtime 注入到 `.rbxl` 文件并打开 Roblox Studio。

注入后，Studio 插件将通过 `ReplicatedStorage.__HubRuntime__` 加载核心业务逻辑，无需重编译插件即可更新运行时行为。

## 前置要求

- 已全局安装 `@white-dragon-tools/roblox-studio-hub`
- 已安装 Studio 插件：`roblox-studio-hub install-plugin`
- 已有一个 `.rbxl` 场景文件

## 用法

```bash
roblox-studio-hub open <place_path>
```

**参数：**

| 参数 | 必填 | 说明 |
|------|------|------|
| `place_path` | 是 | `.rbxl` 场景文件的路径（支持相对路径和绝对路径） |

**示例：**

```bash
# 使用相对路径
roblox-studio-hub open MyGame.rbxl

# 使用绝对路径
roblox-studio-hub open /Users/me/Projects/MyGame.rbxl

# Windows
roblox-studio-hub open D:\Projects\MyGame.rbxl
```

## 执行流程

命令执行时会依次完成以下步骤：

1. **解析路径** — 将 `place_path` 转为绝对路径
2. **准备插件目录** — 创建 `~/.roblox-studio-hub/plugins/`（如不存在）
3. **生成注入配置** — 在临时目录生成 `project.json`
4. **注入 Runtime** — 将 `__HubRuntime__` ModuleScript 注入到 `.rbxl` 的 `ReplicatedStorage` 中
5. **打开 Studio** — 启动 Roblox Studio 并加载该场景
6. **清理** — 删除临时配置文件

## 注入结构

注入后，场景的 DataModel 中会出现以下结构：

```
game
└── ReplicatedStorage
    └── __HubRuntime__ (ModuleScript)
        └── plugins (Folder)
            └── ... (用户自定义插件)
```

- `__HubRuntime__` — 核心运行时模块，包含连接管理、代码执行等逻辑
- `plugins` — 映射自 `~/.roblox-studio-hub/plugins/` 目录，用于加载扩展插件

## 工作原理

Studio 插件启动时会执行：

```lua
local Runtime = require(game.ReplicatedStorage:WaitForChild("__HubRuntime__", 5))
```

- **成功**：插件将 UI 回调绑定到 Runtime，并委托 Runtime 处理连接和命令执行
- **失败**：插件显示提示信息 `"Runtime not found. Use hub open to inject."`，不启动连接逻辑

## 扩展插件

`~/.roblox-studio-hub/plugins/` 目录用于放置自定义扩展模块。Runtime 启动时会自动加载该目录下的所有 ModuleScript。

### 创建扩展插件

1. 在 `~/.roblox-studio-hub/plugins/` 下创建 `.lua` 文件
2. 文件需返回一个 ModuleScript 格式的模块
3. 使用 `hub open` 重新注入后生效

```lua
-- ~/.roblox-studio-hub/plugins/my-extension.lua
local Extension = {}

function Extension.init(runtime)
    -- 注册自定义 command handler
    -- runtime 提供注册接口
end

return Extension
```

### 更新扩展插件

修改 `~/.roblox-studio-hub/plugins/` 下的文件后，重新执行 `hub open` 即可将更新注入到场景中。

## 开发工作流

```bash
# 1. 确保 Hub 服务运行中
roblox-studio-hub status

# 2. 注入 Runtime 并打开 Studio
roblox-studio-hub open MyGame.rbxl

# 3. 修改 runtime 或扩展插件后，重新注入
#    （需先关闭 Studio 或保存/关闭当前场景）
roblox-studio-hub open MyGame.rbxl

# 4. 在另一个终端执行代码测试
roblox-studio-hub exec local:MyGame -c "return 1+1"
```

## 常见问题

### Q: 执行 `hub open` 后 Studio 中看不到 `__HubRuntime__`？

确认命令输出中注入步骤显示成功。如果注入失败，检查：
- `.rbxl` 文件路径是否正确
- 文件是否被其他进程锁定（如 Studio 正在编辑中）

### Q: 插件显示 "Runtime not found"？

这表示场景中不存在 `__HubRuntime__`。请先使用 `hub open` 打开场景，确保注入成功。

### Q: 修改了 runtime 代码，如何生效？

重新执行 `roblox-studio-hub open <place_path>` 即可。修改 runtime 源码不需要重新编译 Studio 插件。

### Q: 扩展插件放在哪里？

放在 `~/.roblox-studio-hub/plugins/` 目录下。首次执行 `hub open` 时会自动创建该目录。

### Q: 支持哪些平台？

- macOS
- Windows

与 Hub 的其他命令一致。
