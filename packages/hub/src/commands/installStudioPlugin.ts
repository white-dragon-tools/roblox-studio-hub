import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.STUDIO_HUB_PORT || "35888", 10);

/**
 * 获取 Roblox Studio 本地插件目录
 * 注意：这是 Roblox Studio 自己的插件目录，不是 Hub 的插件目录
 */
function getStudioPluginsDir(): string {
  const platform = process.platform;

  if (platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) {
      throw new Error("无法获取 LOCALAPPDATA 环境变量");
    }
    return path.join(localAppData, "Roblox", "Plugins");
  } else if (platform === "darwin") {
    const home = process.env.HOME;
    if (!home) {
      throw new Error("无法获取 HOME 环境变量");
    }
    return path.join(home, "Documents", "Roblox", "Plugins");
  } else {
    throw new Error(`不支持的平台: ${platform}`);
  }
}

/**
 * hub install-plugin — 安装 Roblox Studio 插件到本地插件目录
 */
export function installStudioPlugin(): void {
  const pluginSrc = path.join(__dirname, "..", "StudioHubPlugin.rbxm");

  if (!fs.existsSync(pluginSrc)) {
    console.error("❌ 插件文件不存在:", pluginSrc);
    console.error("   请确保已正确安装 @white-dragon-tools/roblox-studio-hub");
    process.exit(1);
  }

  try {
    const pluginsDir = getStudioPluginsDir();

    if (!fs.existsSync(pluginsDir)) {
      fs.mkdirSync(pluginsDir, { recursive: true });
      console.log(`📁 创建插件目录: ${pluginsDir}`);
    }

    const pluginDest = path.join(pluginsDir, "StudioHubPlugin.rbxm");

    fs.copyFileSync(pluginSrc, pluginDest);

    console.log(`
✅ Studio 插件安装成功！

  安装位置: ${pluginDest}

  下一步:
  1. 重启 Roblox Studio（如果已打开）
  2. 插件会自动连接到 Hub（端口 ${PORT}）
  3. 确保 Hub 服务正在运行: roblox-studio-hub status
`);
  } catch (err) {
    console.error("❌ 插件安装失败:", (err as Error).message);
    process.exit(1);
  }
}

export function showInstallPluginHelp(): void {
  console.log(`
Roblox Studio Hub - install-plugin 命令

用法: roblox-studio-hub install-plugin

描述:
  安装 Roblox Studio 插件到本地插件目录

安装位置:
  - Windows: %LOCALAPPDATA%\\Roblox\\Plugins\\
  - macOS: ~/Documents/Roblox/Plugins/

注意:
  - 如果 Studio 正在运行，需要重启才能加载新插件
  - 插件会自动连接到 Hub 服务

示例:
  roblox-studio-hub install-plugin
`);
}
