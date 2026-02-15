#!/usr/bin/env node
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { createHttpServer } from "./server/httpServer.js";
import {
  isInstalledAsService,
  isServiceRunning,
} from "./utils/serviceStatus.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.STUDIO_HUB_PORT || "35888", 10);

// 从 package.json 读取版本号
const packageJsonPath = path.join(__dirname, "..", "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
const VERSION = packageJson.version;

const command = process.argv[2];

switch (command) {
  case "serve":
    createHttpServer(PORT);
    break;
  case "status":
  case "-h":
  case "--help":
    if (
      command === "status" &&
      (process.argv[3] === "-h" || process.argv[3] === "--help")
    ) {
      showStatusHelp();
    } else if (command === "status") {
      showStatus();
    } else {
      showHelp();
    }
    break;
  case "list":
    if (process.argv[3] === "-h" || process.argv[3] === "--help") {
      showListHelp();
    } else {
      listStudios();
    }
    break;
  case "info":
    if (process.argv[3] === "-h" || process.argv[3] === "--help") {
      showInfoHelp();
    } else {
      showStudioInfo();
    }
    break;
  case "logs":
    if (process.argv[3] === "-h" || process.argv[3] === "--help") {
      showLogsHelp();
    } else {
      showStudioLogs();
    }
    break;
  case "exec":
    if (process.argv[3] === "-h" || process.argv[3] === "--help") {
      showExecHelp();
    } else {
      execCommand();
    }
    break;
  case "install":
  case "uninstall":
  case "start":
  case "stop":
    if (process.argv[3] === "-h" || process.argv[3] === "--help") {
      showServiceHelp(command);
    } else {
      handleServiceCommand(command);
    }
    break;
  case "install-plugin":
    if (process.argv[3] === "-h" || process.argv[3] === "--help") {
      showInstallPluginHelp();
    } else {
      installPlugin();
    }
    break;
  case "update":
    if (process.argv[3] === "-h" || process.argv[3] === "--help") {
      showUpdateHelp();
    } else {
      updateHub();
    }
    break;
  case "open":
    if (process.argv[3] === "-h" || process.argv[3] === "--help") {
      showOpenHelp();
    } else {
      openStudio();
    }
    break;
  default:
    showHelp();
}

function showHelp(): void {
  console.log(`
Roblox Studio Hub v${VERSION}

用法: roblox-studio-hub <command> [options]

命令:
  serve                        启动服务器（前台运行）
  open <place.rbxl>            注入 Runtime 并打开 Studio
  status                       查看 Hub 服务状态
  list                         列出所有连接的 Studio
  info <studioId>              查看 Studio 详情
  logs <studioId> [-n limit]   查看 Studio 日志
  exec <studioId> ...          执行 Lua 代码
  install                      注册为系统服务（开机自启）
  uninstall                    卸载系统服务
  start                        启动系统服务
  stop                         停止系统服务
  install-plugin               安装 Roblox Studio 插件
  update                       更新 Hub 到最新版本

通用选项:
  -h, --help                   显示命令帮助

环境变量:
  STUDIO_HUB_PORT              服务端口（默认: 35888）

示例:
  roblox-studio-hub open MyGame.rbxl                # 注入 Runtime 并打开
  roblox-studio-hub status                         # 查看服务状态
  roblox-studio-hub list                           # 列出所有 Studio
  roblox-studio-hub info place:123456              # 查看 Studio 详情
  roblox-studio-hub logs local:MyGame -n 50        # 查看最近 50 条日志
  roblox-studio-hub exec place:123 -c "return 1+1" # 直接执行代码
  roblox-studio-hub exec place:123 script.lua      # 执行 Lua 文件
  roblox-studio-hub update                         # 更新到最新版本

使用 "roblox-studio-hub <command> -h" 查看命令详细帮助
`);
}

function showExecHelp(): void {
  console.log(`
Roblox Studio Hub - exec 命令

用法: 
  roblox-studio-hub exec <studioId> <file.lua> [options]
  roblox-studio-hub exec <studioId> -c "<code>" [options]

描述:
  向指定的 Roblox Studio 实例发送 Lua 脚本并执行

参数:
  studioId      目标 Studio 的唯一标识符
  file.lua      Lua 脚本文件路径（支持相对路径和绝对路径）

选项:
  -c, --code <code>  直接执行 Lua 代码字符串（替代文件）
  -m, --mode <mode>  执行模式（默认: eval）
  -h, --help         显示此帮助信息

Studio ID 格式:
  place:<placeId>    云场景，使用 PlaceId 标识
                     例: place:123456789
  
  local:<placeName>  本地文件，使用文件名标识
                     例: local:MyGame.rbxl
  
  path:<localPath>   本地文件，使用自定义路径标识
                     例: path:D:/Projects/MyGame

执行模式:
  eval   直接执行模式（默认）
         - 使用 loadstring 直接执行代码
         - 适合简单脚本、快速测试
  
  run    服务端测试模式
         - 通过 StudioTestService 执行
         - 适合测试服务端逻辑
  
  play   完整 Play 模式
         - 启动完整的游戏测试（服务端 + 客户端）
         - 适合端到端测试

示例:
  # 直接执行 Lua 代码
  roblox-studio-hub exec place:123456 -c "return 1+1"
  roblox-studio-hub exec local:MyGame -c "print('hello')"

  # 执行 Lua 文件
  roblox-studio-hub exec place:123456 script.lua
  roblox-studio-hub exec local:MyGame test.lua -m run

  # 使用 play 模式
  roblox-studio-hub exec place:123456 test.lua --mode play

返回值:
  脚本可以使用 return 语句返回值，支持以下类型:
  - 基本类型: string, number, boolean, nil
  - 表: 会被序列化为 JSON

环境变量:
  STUDIO_HUB_PORT  Hub 服务端口（默认: 35888）
`);
}

async function showStatus(): Promise<void> {
  const installed = await isInstalledAsService();
  const httpRunning = await isServiceRunning();

  console.log(`
Roblox Studio Hub v${VERSION}

  已注册为服务: ${installed ? "✅ 是" : "❌ 否"}
  服务运行中:   ${httpRunning ? "✅ 是" : "❌ 否"} (端口 ${PORT})
  平台:         ${process.platform}
`);

  if (httpRunning && !installed) {
    console.log(
      "  ⚠️  检测到服务在运行，但未注册为系统服务（可能是手动启动的 serve 命令）\n",
    );
  }
}

async function getService(): Promise<any> {
  const platform = process.platform;
  let Service: any;

  if (platform === "win32") {
    const mod = await import("node-windows");
    Service = mod.Service;
  } else if (platform === "darwin") {
    const mod = await import("node-mac");
    Service = mod.Service;
  } else {
    const mod = await import("node-linux");
    Service = mod.Service;
  }

  return new Service({
    name: "RobloxStudioHub",
    description:
      "Roblox Studio Hub - WebSocket hub for managing multiple Roblox Studio instances",
    script: path.join(__dirname, "index.js"),
    scriptOptions: "serve",
    env: [{ name: "STUDIO_HUB_PORT", value: String(PORT) }],
  });
}

async function handleServiceCommand(cmd: string): Promise<void> {
  const svc = await getService();

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.log("⚠️ 操作超时");
      resolve();
    }, 30000);

    const done = () => {
      clearTimeout(timeout);
      resolve();
    };

    svc.on("error", (err: Error) => {
      clearTimeout(timeout);
      console.error("❌ 错误:", err.message);
      reject(err);
    });

    switch (cmd) {
      case "install":
        svc.on("install", () => {
          console.log("✅ 服务已安装，正在启动...");
          svc.start();
        });
        svc.on("alreadyinstalled", () => {
          console.log("⚠️ 服务已存在");
          done();
        });
        svc.on("start", () => {
          console.log("✅ 服务已启动");
          done();
        });
        svc.install();
        break;

      case "uninstall":
        svc.on("uninstall", () => {
          console.log("✅ 服务已卸载");
          done();
        });
        svc.uninstall();
        break;

      case "start":
        svc.on("start", () => {
          console.log("✅ 服务已启动");
          done();
        });
        svc.start();
        break;

      case "stop":
        svc.on("stop", () => {
          console.log("✅ 服务已停止");
          done();
        });
        svc.stop();
        break;
    }
  });
}

function getPluginsDir(): string {
  const platform = process.platform;

  if (platform === "win32") {
    // Windows: %LOCALAPPDATA%\Roblox\Plugins\
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) {
      throw new Error("无法获取 LOCALAPPDATA 环境变量");
    }
    return path.join(localAppData, "Roblox", "Plugins");
  } else if (platform === "darwin") {
    // macOS: ~/Documents/Roblox/Plugins/
    const home = process.env.HOME;
    if (!home) {
      throw new Error("无法获取 HOME 环境变量");
    }
    return path.join(home, "Documents", "Roblox", "Plugins");
  } else {
    throw new Error(`不支持的平台: ${platform}`);
  }
}

function installPlugin(): void {
  const pluginSrc = path.join(__dirname, "StudioHubPlugin.rbxm");

  // 检查插件文件是否存在
  if (!fs.existsSync(pluginSrc)) {
    console.error("❌ 插件文件不存在:", pluginSrc);
    console.error("   请确保已正确安装 @white-dragon-tools/roblox-studio-hub");
    process.exit(1);
  }

  try {
    const pluginsDir = getPluginsDir();

    // 确保插件目录存在
    if (!fs.existsSync(pluginsDir)) {
      fs.mkdirSync(pluginsDir, { recursive: true });
      console.log(`📁 创建插件目录: ${pluginsDir}`);
    }

    const pluginDest = path.join(pluginsDir, "StudioHubPlugin.rbxm");

    // 复制插件文件
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

async function execCommand(): Promise<void> {
  const studioId = process.argv[3];

  // 解析 -c 参数（直接执行代码）
  const codeIndex = process.argv.indexOf("-c");
  const codeIndexLong = process.argv.indexOf("--code");
  const codeArgIndex = codeIndex !== -1 ? codeIndex : codeIndexLong;

  // 解析 mode 参数
  let mode: "eval" | "run" | "play" = "eval";
  const modeIndex = process.argv.indexOf("-m");
  const modeIndexLong = process.argv.indexOf("--mode");
  const modeArgIndex = modeIndex !== -1 ? modeIndex : modeIndexLong;
  if (modeArgIndex !== -1 && process.argv[modeArgIndex + 1]) {
    const modeArg = process.argv[modeArgIndex + 1];
    if (modeArg === "eval" || modeArg === "run" || modeArg === "play") {
      mode = modeArg;
    } else {
      console.error(`❌ 无效的执行模式: ${modeArg}`);
      console.error("   有效模式: eval, run, play");
      process.exit(1);
    }
  }

  if (!studioId) {
    console.error("❌ 缺少 studioId 参数");
    console.error(
      "   用法: roblox-studio-hub exec <studioId> <file.lua> [-m mode]",
    );
    console.error(
      '         roblox-studio-hub exec <studioId> -c "lua code" [-m mode]',
    );
    process.exit(1);
  }

  let code: string;
  let sourceName: string;

  if (codeArgIndex !== -1) {
    // 使用 -c 参数直接执行代码
    const codeArg = process.argv[codeArgIndex + 1];
    if (!codeArg) {
      console.error("❌ -c 参数需要提供 Lua 代码");
      console.error(
        '   用法: roblox-studio-hub exec <studioId> -c "print(1+1)"',
      );
      process.exit(1);
    }
    code = codeArg;
    sourceName = "<inline>";
  } else {
    // 使用文件路径
    const filePath = process.argv[4];

    if (!filePath) {
      console.error("❌ 缺少 Lua 文件路径或 -c 参数");
      console.error(
        "   用法: roblox-studio-hub exec <studioId> <file.lua> [-m mode]",
      );
      console.error(
        '         roblox-studio-hub exec <studioId> -c "lua code" [-m mode]',
      );
      process.exit(1);
    }

    // 解析文件路径
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);

    if (!fs.existsSync(absolutePath)) {
      console.error(`❌ 文件不存在: ${absolutePath}`);
      process.exit(1);
    }

    // 读取 Lua 代码
    code = fs.readFileSync(absolutePath, "utf-8");
    sourceName = path.basename(absolutePath);
  }

  console.log(`📤 执行脚本: ${sourceName}`);
  console.log(`   目标: ${studioId}`);
  console.log(`   模式: ${mode}`);
  console.log("");

  try {
    const response = await fetch(
      `http://localhost:${PORT}/api/studios/${encodeURIComponent(studioId)}/call`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "execute",
          params: { code, mode },
          timeout: 30,
        }),
      },
    );

    const result = (await response.json()) as {
      success: boolean;
      result?: unknown;
      error?: string;
      errors?: { server?: string; client?: string };
      logs?: { server?: string[]; client?: string[] };
    };

    if (result.success) {
      console.log("✅ 执行成功");
      if (result.result !== undefined) {
        console.log("");
        console.log("返回值:");
        console.log(JSON.stringify(result.result, null, 2));
      }
      if (result.logs?.server?.length) {
        console.log("");
        console.log("服务端日志:");
        result.logs.server.forEach((log: string) => console.log(`  ${log}`));
      }
      if (result.logs?.client?.length) {
        console.log("");
        console.log("客户端日志:");
        result.logs.client.forEach((log: string) => console.log(`  ${log}`));
      }
    } else {
      console.error("❌ 执行失败");
      if (result.error) {
        console.error(`   ${result.error}`);
      }
      if (result.errors?.server) {
        console.error("");
        console.error("服务端错误:");
        console.error(`  ${result.errors.server}`);
      }
      if (result.errors?.client) {
        console.error("");
        console.error("客户端错误:");
        console.error(`  ${result.errors.client}`);
      }
      process.exit(1);
    }
  } catch (err) {
    console.error("❌ 请求失败:", (err as Error).message);
    console.error("   请确保 Studio Hub 服务正在运行");
    process.exit(1);
  }
}

// ==================== Help Functions ====================

function showStatusHelp(): void {
  console.log(`
Roblox Studio Hub - status 命令

用法: roblox-studio-hub status

描述:
  显示 Hub 服务的当前状态，包括：
  - 是否已注册为系统服务
  - 服务是否正在运行
  - 服务端口
  - 运行平台

示例:
  roblox-studio-hub status
`);
}

function showListHelp(): void {
  console.log(`
Roblox Studio Hub - list 命令

用法: roblox-studio-hub list

描述:
  列出所有当前连接到 Hub 的 Roblox Studio 实例

输出信息:
  - Studio ID（place:xxx 或 local:xxx）
  - 场景名称
  - 连接时间

示例:
  roblox-studio-hub list
`);
}

function showInfoHelp(): void {
  console.log(`
Roblox Studio Hub - info 命令

用法: roblox-studio-hub info <studioId>

描述:
  显示指定 Studio 实例的详细信息

参数:
  studioId    目标 Studio 的唯一标识符

Studio ID 格式:
  place:<placeId>    云场景（例: place:123456789）
  local:<placeName>  本地文件（例: local:MyGame）
  path:<localPath>   自定义路径（例: path:D:/Projects/MyGame）

示例:
  roblox-studio-hub info place:123456789
  roblox-studio-hub info local:MyGame
`);
}

function showLogsHelp(): void {
  console.log(`
Roblox Studio Hub - logs 命令

用法: roblox-studio-hub logs <studioId> [options]

描述:
  查看指定 Studio 实例的日志

参数:
  studioId    目标 Studio 的唯一标识符

选项:
  -n, --limit <number>  返回日志条数（默认: 100）
  -h, --help            显示此帮助信息

示例:
  roblox-studio-hub logs place:123456789
  roblox-studio-hub logs local:MyGame -n 50
  roblox-studio-hub logs place:123456789 --limit 200
`);
}

function showServiceHelp(cmd: string): void {
  const descriptions: Record<string, string> = {
    install: "将 Hub 注册为系统服务，实现开机自启动",
    uninstall: "从系统中卸载 Hub 服务",
    start: "启动已注册的 Hub 系统服务",
    stop: "停止正在运行的 Hub 系统服务",
  };

  console.log(`
Roblox Studio Hub - ${cmd} 命令

用法: roblox-studio-hub ${cmd}

描述:
  ${descriptions[cmd]}

注意:
  - Windows: 需要管理员权限运行
  - macOS/Linux: 需要使用 sudo 运行

示例:
  roblox-studio-hub ${cmd}
`);
}

function showInstallPluginHelp(): void {
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

function showUpdateHelp(): void {
  console.log(`
Roblox Studio Hub - update 命令

用法: roblox-studio-hub update

描述:
  更新 Hub 到最新版本，自动处理服务重启

执行步骤:
  1. 检查当前服务状态
  2. 如果服务正在运行，先停止服务
  3. 执行 npm update -g @white-dragon-tools/roblox-studio-hub
  4. 如果之前服务在运行，重新启动服务
  5. 可选：更新 Studio 插件

注意:
  - Windows: 需要管理员权限运行
  - macOS/Linux: 需要使用 sudo 运行

示例:
  roblox-studio-hub update
`);
}

function showOpenHelp(): void {
  console.log(`
Roblox Studio Hub - open 命令

用法: roblox-studio-hub open <place.rbxl>

描述:
  将 Hub Runtime 注入到指定的 .rbxl 文件中，然后在 Roblox Studio 中打开。
  Runtime 会被注入到 ReplicatedStorage.__HubRuntime__，包含：
  - 内置插件（execute, getStudioInfo）
  - 用户插件（来自 ~/.roblox-studio-hub/plugins/）

参数:
  place.rbxl    目标 .rbxl 文件路径（支持相对路径和绝对路径）

示例:
  roblox-studio-hub open MyGame.rbxl
  roblox-studio-hub open /path/to/game.rbxl
`);
}

async function openStudio(): Promise<void> {
  const placeArg = process.argv[3];

  if (!placeArg) {
    console.error("❌ 缺少 place 文件路径");
    console.error("   用法: roblox-studio-hub open <place.rbxl>");
    process.exit(1);
  }

  const placePath = path.isAbsolute(placeArg)
    ? placeArg
    : path.resolve(process.cwd(), placeArg);

  if (!fs.existsSync(placePath)) {
    console.error(`❌ 文件不存在: ${placePath}`);
    process.exit(1);
  }

  const runtimeSrcPath = path.join(__dirname, "..", "runtime", "src");
  const pluginsPath = path.join(os.homedir(), ".roblox-studio-hub", "plugins");

  // Ensure plugins directory exists
  fs.mkdirSync(pluginsPath, { recursive: true });

  // Generate temporary project.json
  const projectJson = {
    name: "StudioHubRuntime",
    tree: {
      $className: "DataModel",
      ReplicatedStorage: {
        $className: "ReplicatedStorage",
        __HubRuntime__: {
          $path: runtimeSrcPath,
          plugins: {
            $path: pluginsPath,
          },
        },
      },
    },
  };

  const tmpDir = os.tmpdir();
  const tmpProjectJsonPath = path.join(
    tmpDir,
    `hub-runtime-${Date.now()}.project.json`,
  );

  try {
    fs.writeFileSync(tmpProjectJsonPath, JSON.stringify(projectJson, null, 2));

    // Step 1: Inject runtime via rojo-injectable build --merge
    console.log(`📦 注入 Runtime 到: ${placePath}`);

    // TODO: 发布 rojo-injectable 后改为 npm 包路径
    const ROJO_INJECTABLE_BIN = path.join(
      os.homedir(),
      "workspace/yoyo999888/rojo-injectable/master-rojo-injectable/target/release/rojo",
    );

    if (!fs.existsSync(ROJO_INJECTABLE_BIN)) {
      console.error(`❌ rojo-injectable 二进制不存在: ${ROJO_INJECTABLE_BIN}`);
      console.error("   请先编译: cargo build --release");
      process.exit(1);
    }

    const { execFileSync } = await import("child_process");
    try {
      execFileSync(
        ROJO_INJECTABLE_BIN,
        [
          "build",
          tmpProjectJsonPath,
          "--merge",
          placePath,
          "--output",
          placePath,
        ],
        { stdio: "pipe" },
      );
    } catch (e) {
      const stderr =
        (e as { stderr?: Buffer }).stderr?.toString() || (e as Error).message;
      console.error(`❌ 注入失败: ${stderr}`);
      process.exit(1);
    }
    console.log("✅ Runtime 注入成功");

    // Step 2: Open in Roblox Studio via physical-operation
    console.log("🚀 打开 Roblox Studio...");
    const { openPlace } =
      await import("@white-dragon-tools/roblox-studio-physical-operation/studio-manager");
    const [openSuccess, openMessage] = await openPlace(placePath);
    if (!openSuccess) {
      console.error(`❌ 打开 Studio 失败: ${openMessage}`);
      process.exit(1);
    }
    console.log(`✅ Studio 已打开: ${openMessage}`);
  } catch (err) {
    console.error("❌ 操作失败:", (err as Error).message);
    process.exit(1);
  } finally {
    try {
      fs.unlinkSync(tmpProjectJsonPath);
    } catch {
      // ignore
    }
  }
}

// ==================== Command Implementations ====================

async function listStudios(): Promise<void> {
  try {
    const response = await fetch(`http://localhost:${PORT}/api/studios`);
    const data = (await response.json()) as {
      studios: Array<{
        id: string;
        type: string;
        placeName: string;
        placeId?: number;
        connectedAt: string;
      }>;
    };

    if (data.studios.length === 0) {
      console.log("\n📭 当前没有连接的 Studio 实例\n");
      return;
    }

    console.log(`\n🎮 已连接的 Studio 实例 (${data.studios.length} 个):\n`);

    for (const studio of data.studios) {
      const connectedAt = new Date(studio.connectedAt);
      const duration = formatDuration(Date.now() - connectedAt.getTime());
      console.log(`  ${studio.id}`);
      console.log(`    场景: ${studio.placeName}`);
      console.log(`    连接: ${duration} 前`);
      console.log("");
    }
  } catch (err) {
    console.error("❌ 请求失败:", (err as Error).message);
    console.error("   请确保 Studio Hub 服务正在运行");
    process.exit(1);
  }
}

async function showStudioInfo(): Promise<void> {
  const studioId = process.argv[3];

  if (!studioId) {
    console.error("❌ 缺少 studioId 参数");
    console.error("   用法: roblox-studio-hub info <studioId>");
    process.exit(1);
  }

  try {
    const response = await fetch(
      `http://localhost:${PORT}/api/studios/${encodeURIComponent(studioId)}`,
    );

    if (response.status === 404) {
      console.error(`❌ Studio 未找到: ${studioId}`);
      process.exit(1);
    }

    const studio = (await response.json()) as {
      id: string;
      type: string;
      placeName: string;
      placeId?: number;
      gameId?: number;
      userId?: number;
      localPath?: string;
      connectedAt: string;
      clientCount: number;
    };

    const connectedAt = new Date(studio.connectedAt);
    const duration = formatDuration(Date.now() - connectedAt.getTime());

    console.log(`
🎮 Studio 详情

  ID:         ${studio.id}
  类型:       ${studio.type === "place" ? "云场景" : "本地文件"}
  场景名称:   ${studio.placeName}
  ${studio.placeId ? `Place ID:   ${studio.placeId}` : ""}
  ${studio.gameId ? `Game ID:    ${studio.gameId}` : ""}
  ${studio.localPath ? `本地路径:   ${studio.localPath}` : ""}
  连接时间:   ${connectedAt.toLocaleString()}
  已连接:     ${duration}
`);
  } catch (err) {
    console.error("❌ 请求失败:", (err as Error).message);
    console.error("   请确保 Studio Hub 服务正在运行");
    process.exit(1);
  }
}

async function showStudioLogs(): Promise<void> {
  const studioId = process.argv[3];

  if (!studioId) {
    console.error("❌ 缺少 studioId 参数");
    console.error("   用法: roblox-studio-hub logs <studioId> [-n limit]");
    process.exit(1);
  }

  // 解析 limit 参数
  let limit = 100;
  const limitIndex = process.argv.indexOf("-n");
  const limitIndexLong = process.argv.indexOf("--limit");
  const limitArgIndex = limitIndex !== -1 ? limitIndex : limitIndexLong;
  if (limitArgIndex !== -1 && process.argv[limitArgIndex + 1]) {
    const limitArg = parseInt(process.argv[limitArgIndex + 1], 10);
    if (!isNaN(limitArg) && limitArg > 0) {
      limit = limitArg;
    }
  }

  try {
    const response = await fetch(
      `http://localhost:${PORT}/api/studios/${encodeURIComponent(studioId)}/logs?limit=${limit}`,
    );

    if (response.status === 404) {
      console.error(`❌ Studio 未找到: ${studioId}`);
      process.exit(1);
    }

    const data = (await response.json()) as {
      logs: Array<{
        timestamp: string;
        level: string;
        message: string;
      }>;
    };

    if (data.logs.length === 0) {
      console.log(`\n📭 Studio ${studioId} 暂无日志\n`);
      return;
    }

    console.log(`\n📋 Studio 日志 (${data.logs.length} 条):\n`);

    for (const log of data.logs) {
      const time = new Date(log.timestamp).toLocaleTimeString();
      const levelIcon =
        log.level === "error" ? "❌" : log.level === "warn" ? "⚠️" : "📝";
      console.log(`  ${time} ${levelIcon} ${log.message}`);
    }
    console.log("");
  } catch (err) {
    console.error("❌ 请求失败:", (err as Error).message);
    console.error("   请确保 Studio Hub 服务正在运行");
    process.exit(1);
  }
}

async function updateHub(): Promise<void> {
  const { execSync, spawn } = await import("child_process");

  console.log(`\n🔄 Roblox Studio Hub 更新\n`);
  console.log(`  当前版本: v${VERSION}`);

  // 检查服务状态
  const wasRunning = await isServiceRunning();
  const wasInstalled = await isInstalledAsService();

  console.log(`  服务状态: ${wasRunning ? "运行中" : "未运行"}`);
  console.log("");

  try {
    // 如果服务在运行，先停止
    if (wasRunning && wasInstalled) {
      console.log("⏸️  停止服务...");
      await handleServiceCommand("stop");
      // 等待服务完全停止
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // 执行 npm update
    console.log("📦 更新 npm 包...");

    const isWindows = process.platform === "win32";
    const npmCmd = isWindows ? "npm.cmd" : "npm";

    const updateProcess = spawn(
      npmCmd,
      ["update", "-g", "@white-dragon-tools/roblox-studio-hub"],
      {
        stdio: "inherit",
        shell: true,
      },
    );

    await new Promise<void>((resolve, reject) => {
      updateProcess.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`npm update 退出码: ${code}`));
        }
      });
      updateProcess.on("error", reject);
    });

    console.log("");
    console.log("✅ 更新完成！");

    // 如果之前服务在运行，重新启动
    if (wasRunning && wasInstalled) {
      console.log("");
      console.log("▶️  重新启动服务...");
      await handleServiceCommand("start");
    }

    // 提示更新插件
    console.log("");
    console.log("💡 提示: 如果插件有更新，请运行:");
    console.log("   roblox-studio-hub install-plugin");
    console.log("");
  } catch (err) {
    console.error("");
    console.error("❌ 更新失败:", (err as Error).message);

    // 尝试恢复服务
    if (wasRunning && wasInstalled) {
      console.log("");
      console.log("🔄 尝试恢复服务...");
      try {
        await handleServiceCommand("start");
      } catch {
        console.error("⚠️  服务恢复失败，请手动启动: roblox-studio-hub start");
      }
    }

    process.exit(1);
  }
}

// ==================== Utility Functions ====================

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days} 天 ${hours % 24} 小时`;
  } else if (hours > 0) {
    return `${hours} 小时 ${minutes % 60} 分钟`;
  } else if (minutes > 0) {
    return `${minutes} 分钟`;
  } else {
    return `${seconds} 秒`;
  }
}
