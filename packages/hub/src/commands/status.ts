import {
  isInstalledAsService,
  isServiceRunning,
} from "../utils/serviceStatus.js";
import { formatDuration } from "../utils/formatDuration.js";

const PORT = parseInt(process.env.STUDIO_HUB_PORT || "35888", 10);

/**
 * hub status — 显示 Hub 服务状态
 */
export async function showStatus(version: string): Promise<void> {
  const installed = await isInstalledAsService();
  const httpRunning = await isServiceRunning();

  console.log(`
Roblox Studio Hub v${version}

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

/**
 * hub list — 列出所有连接的 Studio
 */
export async function listStudios(): Promise<void> {
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

/**
 * hub info <studioId> — 查看 Studio 详情
 */
export async function showStudioInfo(studioId: string): Promise<void> {
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

/**
 * hub logs <studioId> [-n limit] — 查看 Studio 日志
 */
export async function showStudioLogs(
  studioId: string,
  limit: number = 100,
): Promise<void> {
  if (!studioId) {
    console.error("❌ 缺少 studioId 参数");
    console.error("   用法: roblox-studio-hub logs <studioId> [-n limit]");
    process.exit(1);
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

/**
 * 解析 logs 命令的 limit 参数
 */
export function parseLogsLimit(argv: readonly string[]): number {
  const limitIndex = argv.indexOf("-n");
  const limitIndexLong = argv.indexOf("--limit");
  const limitArgIndex = limitIndex !== -1 ? limitIndex : limitIndexLong;
  if (limitArgIndex !== -1 && argv[limitArgIndex + 1]) {
    const limitArg = parseInt(argv[limitArgIndex + 1], 10);
    if (!isNaN(limitArg) && limitArg > 0) {
      return limitArg;
    }
  }
  return 100;
}

// ==================== Help Functions ====================

export function showStatusHelp(): void {
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

export function showListHelp(): void {
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

export function showInfoHelp(): void {
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

export function showLogsHelp(): void {
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
