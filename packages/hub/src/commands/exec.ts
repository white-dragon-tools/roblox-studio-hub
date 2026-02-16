import path from "path";
import fs from "fs";

const PORT = parseInt(process.env.STUDIO_HUB_PORT || "35888", 10);

export interface ExecArgs {
  readonly studioId: string;
  readonly code?: string;
  readonly filePath?: string;
  readonly mode: "eval" | "run" | "play";
}

/**
 * 从 process.argv 解析 exec 命令参数
 */
export function parseExecArgs(argv: readonly string[]): ExecArgs {
  const studioId = argv[3];

  // 解析 -c 参数（直接执行代码）
  const codeIndex = argv.indexOf("-c");
  const codeIndexLong = argv.indexOf("--code");
  const codeArgIndex = codeIndex !== -1 ? codeIndex : codeIndexLong;

  // 解析 mode 参数
  let mode: "eval" | "run" | "play" = "eval";
  const modeIndex = argv.indexOf("-m");
  const modeIndexLong = argv.indexOf("--mode");
  const modeArgIndex = modeIndex !== -1 ? modeIndex : modeIndexLong;
  if (modeArgIndex !== -1 && argv[modeArgIndex + 1]) {
    const modeArg = argv[modeArgIndex + 1];
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

  if (codeArgIndex !== -1) {
    const codeArg = argv[codeArgIndex + 1];
    if (!codeArg) {
      console.error("❌ -c 参数需要提供 Lua 代码");
      console.error(
        '   用法: roblox-studio-hub exec <studioId> -c "print(1+1)"',
      );
      process.exit(1);
    }
    return { studioId, code: codeArg, mode };
  }

  const filePath = argv[4];
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

  return { studioId, filePath, mode };
}

/**
 * hub exec <studioId> <file.lua | -c code> [-m mode]
 */
export async function execCommand(args: ExecArgs): Promise<void> {
  const { studioId, mode } = args;

  let code: string;
  let sourceName: string;

  if (args.code !== undefined) {
    code = args.code;
    sourceName = "<inline>";
  } else {
    const filePath = args.filePath!;
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);

    if (!fs.existsSync(absolutePath)) {
      console.error(`❌ 文件不存在: ${absolutePath}`);
      process.exit(1);
    }

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

export function showExecHelp(): void {
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
