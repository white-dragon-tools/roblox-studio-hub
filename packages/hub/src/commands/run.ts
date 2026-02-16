import path from "path";
import fs from "fs";
import { createHttpServer } from "../server/httpServer.js";
import { isServiceRunning } from "../utils/serviceStatus.js";
import { injectRuntime } from "../utils/injectRuntime.js";

const PORT = parseInt(process.env.STUDIO_HUB_PORT || "35888", 10);

interface RunOptions {
  readonly placeArg: string;
  readonly method: string;
  readonly paramsJson?: string;
  readonly timeout?: number;
}

/**
 * 等待 Studio 连接到 Hub
 * 轮询 /api/studios 直到发现新的 Studio 实例
 */
async function waitForStudio(
  port: number,
  timeoutMs: number,
): Promise<string | null> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`http://localhost:${port}/api/studios`);
      const data = (await response.json()) as {
        studios: ReadonlyArray<{ id: string }>;
      };
      if (data.studios.length > 0) {
        return data.studios[0].id;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return null;
}

/**
 * 从 stdin 读取 JSON 参数
 */
async function readStdinJson(): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("stdin 中的 JSON 无效");
  }
}

/**
 * hub run <place.rbxl> <method> [paramsJSON]
 * 一次性模式：打开 Studio → 等待连接 → 调用方法 → 输出结果 → 退出
 */
export async function runCommand(options: RunOptions): Promise<void> {
  const { placeArg, method, paramsJson, timeout = 30 } = options;

  // 1. 解析 place 路径
  const placePath = path.isAbsolute(placeArg)
    ? placeArg
    : path.resolve(process.cwd(), placeArg);

  if (!fs.existsSync(placePath)) {
    console.error(`❌ 文件不存在: ${placePath}`);
    process.exit(1);
  }

  // 2. 解析参数（命令行 JSON 或 stdin）
  let params: unknown = {};
  if (paramsJson) {
    try {
      params = JSON.parse(paramsJson);
    } catch {
      console.error(`❌ 无效的 JSON 参数: ${paramsJson}`);
      process.exit(1);
    }
  } else if (!process.stdin.isTTY) {
    try {
      params = await readStdinJson();
    } catch (e) {
      console.error(`❌ ${(e as Error).message}`);
      process.exit(1);
    }
  }

  // 3. 启动 Hub 服务（如未运行）
  const alreadyRunning = await isServiceRunning(PORT);
  let server: ReturnType<typeof createHttpServer> | null = null;

  if (!alreadyRunning) {
    console.error("🔌 启动 Hub 服务...");
    server = createHttpServer(PORT);
    // 等待服务就绪
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  try {
    // 4. 注入 Runtime
    console.error(`📦 注入 Runtime 到: ${path.basename(placePath)}`);
    await injectRuntime(placePath, { port: PORT });
    console.error("✅ Runtime 注入成功");

    // 5. 打开 Studio
    console.error("🚀 打开 Roblox Studio...");
    const { openPlace } =
      await import("@white-dragon-tools/roblox-studio-physical-operation/studio-manager");
    const [openSuccess, openMessage] = await openPlace(placePath);
    if (!openSuccess) {
      console.error(`❌ 打开 Studio 失败: ${openMessage}`);
      process.exit(1);
    }

    // 6. 等待 Studio 连接
    console.error("⏳ 等待 Studio 连接...");
    const studioId = await waitForStudio(PORT, 60000);
    if (!studioId) {
      console.error("❌ 等待 Studio 连接超时（60秒）");
      process.exit(1);
    }
    console.error(`✅ Studio 已连接: ${studioId}`);

    // 7. 调用方法
    console.error(`📤 调用: ${method}`);
    const response = await fetch(
      `http://localhost:${PORT}/api/studios/${encodeURIComponent(studioId)}/call`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, params, timeout }),
      },
    );

    const result = await response.json();

    // 8. 输出结果（stdout，便于管道）
    console.log(JSON.stringify(result, null, 2));

    // 9. 退出
    process.exit(0);
  } catch (err) {
    console.error("❌ 执行失败:", (err as Error).message);
    process.exit(1);
  } finally {
    if (server) {
      server.close();
    }
  }
}

export function showRunHelp(): void {
  console.log(`
Roblox Studio Hub - run 命令

用法:
  roblox-studio-hub run <place.rbxl> <method> [paramsJSON]
  echo '{"code":"return 1+1"}' | roblox-studio-hub run <place.rbxl> execute

描述:
  一次性模式：打开 Studio → 等待连接 → 调用方法 → 输出结果 → 退出
  状态信息输出到 stderr，结果输出到 stdout，便于管道组合。

参数:
  place.rbxl    目标 .rbxl 文件路径
  method        要调用的插件方法名
  paramsJSON    方法参数（JSON 字符串），省略时从 stdin 读取

示例:
  # 直接执行
  roblox-studio-hub run MyGame.rbxl execute '{"code":"return 1+1"}'

  # 从 stdin 传参
  echo '{"code":"return workspace:GetChildren()"}' | roblox-studio-hub run MyGame.rbxl execute

  # 执行文件（配合 x-file）
  roblox-studio-hub run MyGame.rbxl execute '{"code":"file:///path/to/script.lua"}'

环境变量:
  STUDIO_HUB_PORT  Hub 服务端口（默认: 35888）
`);
}
