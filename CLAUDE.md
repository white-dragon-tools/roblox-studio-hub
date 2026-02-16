
## 开发

使用 `.local-hub/` 目录, 作为开发目录, 代替 `~/.roblox-studio-hub/`


## 构建

- Studio Plugin 构建并安装到 Roblox Studio 插件目录：`rojo build packages/studio-plugin --plugin StudioHubPlugin.rbxm`


## 测试

- 使用 roblox-studio-physical-operation 工具开发集成测试.


## Studio 物理操作

操作 Roblox Studio 统一使用 `rspo` CLI（`@white-dragon-tools/roblox-studio-physical-operation` 的 bin）：

```bash
rspo open <place_path>              # 打开 Studio
rspo close <place_path>             # 关闭 Studio
rspo game start <place_path>        # F5 开始游戏
rspo game stop <place_path>         # Shift+F5 停止游戏
rspo modal <place_path> --close     # 关闭模态弹窗
rspo status <place_path>            # 获取状态
rspo screenshot <place_path>        # 截图
rspo log <place_path>               # 获取日志
```

所有命令输出 JSON。在测试代码中通过 `execFileSync("npx", ["rspo", ...args])` 调用，不要直接 import 库的内部模块。
