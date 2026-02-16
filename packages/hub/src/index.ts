#!/usr/bin/env node
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createHttpServer } from "./server/httpServer.js";
import { runCommand, showRunHelp } from "./commands/run.js";
import { execCommand, parseExecArgs, showExecHelp } from "./commands/exec.js";
import {
  showStatus,
  listStudios,
  showStudioInfo,
  showStudioLogs,
  parseLogsLimit,
  showStatusHelp,
  showListHelp,
  showInfoHelp,
  showLogsHelp,
} from "./commands/status.js";
import { handleServiceCommand, showServiceHelp } from "./commands/service.js";
import { openStudio, parseOpenArgs, showOpenHelp } from "./commands/open.js";
import { updateHub, showUpdateHelp } from "./commands/update.js";
import {
  installStudioPlugin,
  showInstallPluginHelp,
} from "./commands/installStudioPlugin.js";
import {
  pluginInstall,
  pluginUninstall,
  pluginList,
  pluginSearch,
  pluginUpdate,
  showPluginHelp,
} from "./commands/plugin.js";
import {
  marketplaceAdd,
  marketplaceRemove,
  marketplaceList,
  showMarketplaceHelp,
} from "./commands/marketplace.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.STUDIO_HUB_PORT || "35888", 10);

// 从 package.json 读取版本号
const packageJsonPath = path.join(__dirname, "..", "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
const VERSION: string = packageJson.version;

function isHelp(arg: string | undefined): boolean {
  return arg === "-h" || arg === "--help";
}

const command = process.argv[2];

switch (command) {
  case "serve":
    createHttpServer(PORT);
    break;
  case "status":
    isHelp(process.argv[3]) ? showStatusHelp() : showStatus(VERSION);
    break;
  case "list":
    isHelp(process.argv[3]) ? showListHelp() : listStudios();
    break;
  case "info":
    isHelp(process.argv[3]) ? showInfoHelp() : showStudioInfo(process.argv[3]);
    break;
  case "logs":
    isHelp(process.argv[3])
      ? showLogsHelp()
      : showStudioLogs(process.argv[3], parseLogsLimit(process.argv));
    break;
  case "exec":
    isHelp(process.argv[3])
      ? showExecHelp()
      : execCommand(parseExecArgs(process.argv));
    break;
  case "install":
  case "uninstall":
  case "start":
  case "stop":
    isHelp(process.argv[3])
      ? showServiceHelp(command)
      : handleServiceCommand(command);
    break;
  case "install-plugin":
    isHelp(process.argv[3]) ? showInstallPluginHelp() : installStudioPlugin();
    break;
  case "update":
    isHelp(process.argv[3]) ? showUpdateHelp() : updateHub(VERSION);
    break;
  case "open":
    isHelp(process.argv[3])
      ? showOpenHelp()
      : openStudio(parseOpenArgs(process.argv));
    break;
  case "run":
    if (isHelp(process.argv[3])) {
      showRunHelp();
    } else {
      const runPlaceArg = process.argv[3];
      const runMethod = process.argv[4];
      const runParamsJson = process.argv[5];
      if (!runPlaceArg || !runMethod) {
        console.error(
          "❌ 用法: roblox-studio-hub run <place.rbxl> <method> [paramsJSON]",
        );
        process.exit(1);
      }
      runCommand({
        placeArg: runPlaceArg,
        method: runMethod,
        paramsJson: runParamsJson,
      });
    }
    break;
  case "mcp":
    if (isHelp(process.argv[3])) {
      showMcpHelp();
    } else {
      import("./mcp/mcpServer.js").then(({ startMcpServer }) =>
        startMcpServer(),
      );
    }
    break;
  case "plugin":
    routePluginCommand();
    break;
  case "marketplace":
    routeMarketplaceCommand();
    break;
  case "-h":
  case "--help":
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
  run <place.rbxl> <method>    一次性模式：打开→调用→输出→退出
  status                       查看 Hub 服务状态
  list                         列出所有连接的 Studio
  info <studioId>              查看 Studio 详情
  logs <studioId> [-n limit]   查看 Studio 日志
  exec <studioId> ...          执行 Lua 代码
  mcp                          启动 MCP Server（stdio 模式，供 Claude Code 使用）
  plugin <subcmd>              管理 Hub 插件（install/uninstall/list/search/update）
  marketplace <subcmd>         管理插件市场（add/remove/list）
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

function showMcpHelp(): void {
  console.log(`
Roblox Studio Hub - mcp 命令

用法: roblox-studio-hub mcp

描述:
  启动 MCP Server（Model Context Protocol），通过 stdio 传输协议
  将 Hub 插件的 tools 暴露给 Claude Code 或其他 MCP 客户端。

工作原理:
  1. 从已安装的插件 (plugin.json) 静态发现所有 tool 描述符
  2. 通过 MCP 协议将 tools 暴露给客户端
  3. tool 调用通过 Hub HTTP API 转发到连接的 Studio

Studio 选择:
  - 单个 Studio 连接时：自动选择
  - 多个 Studio 连接时：通过 _studioId 参数指定目标

Claude Code 配置:
  在 .claude-plugin/plugin.json 中添加:
  {
    "mcp": {
      "command": "roblox-studio-hub",
      "args": ["mcp"]
    }
  }

环境变量:
  STUDIO_HUB_PORT    Hub 服务端口（默认: 35888）

示例:
  roblox-studio-hub mcp                    # 直接启动（调试用）
`);
}

function routePluginCommand(): void {
  const subcmd = process.argv[3];

  if (!subcmd || isHelp(subcmd)) {
    showPluginHelp();
    return;
  }

  switch (subcmd) {
    case "install": {
      const target = process.argv[4];
      if (!target) {
        console.error(
          "❌ 用法: roblox-studio-hub plugin install <name|owner/repo>",
        );
        process.exit(1);
      }
      pluginInstall(target);
      break;
    }
    case "uninstall": {
      const name = process.argv[4];
      if (!name) {
        console.error("❌ 用法: roblox-studio-hub plugin uninstall <name>");
        process.exit(1);
      }
      pluginUninstall(name);
      break;
    }
    case "list":
      pluginList();
      break;
    case "search":
      pluginSearch(process.argv[4]);
      break;
    case "update":
      pluginUpdate(process.argv[4]);
      break;
    default:
      console.error(`❌ 未知子命令: plugin ${subcmd}`);
      showPluginHelp();
      process.exit(1);
  }
}

function routeMarketplaceCommand(): void {
  const subcmd = process.argv[3];

  if (!subcmd || isHelp(subcmd)) {
    showMarketplaceHelp();
    return;
  }

  switch (subcmd) {
    case "add": {
      const repo = process.argv[4];
      if (!repo) {
        console.error(
          "❌ 用法: roblox-studio-hub marketplace add <owner/repo>",
        );
        process.exit(1);
      }
      marketplaceAdd(repo);
      break;
    }
    case "remove": {
      const repo = process.argv[4];
      if (!repo) {
        console.error(
          "❌ 用法: roblox-studio-hub marketplace remove <owner/repo>",
        );
        process.exit(1);
      }
      marketplaceRemove(repo);
      break;
    }
    case "list":
      marketplaceList();
      break;
    default:
      console.error(`❌ 未知子命令: marketplace ${subcmd}`);
      showMarketplaceHelp();
      process.exit(1);
  }
}
