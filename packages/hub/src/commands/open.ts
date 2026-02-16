import path from "path";
import fs from "fs";
import { injectRuntime } from "../utils/injectRuntime.js";

export interface OpenOptions {
  readonly placeArg: string;
  readonly pluginDirs: ReadonlyArray<string>;
  readonly port?: number;
}

/**
 * Parse open command arguments: hub open [--plugin-dir <dir>]... <place.rbxl>
 */
export function parseOpenArgs(argv: ReadonlyArray<string>): OpenOptions {
  const pluginDirs: string[] = [];
  let placeArg = "";
  let port: number | undefined;

  // argv[0]=node, argv[1]=script, argv[2]="open", rest starts at [3]
  let i = 3;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--plugin-dir" || arg === "-p") {
      i++;
      if (i >= argv.length) {
        console.error(`❌ ${arg} 需要指定目录路径`);
        process.exit(1);
      }
      pluginDirs.push(argv[i]);
    } else if (arg.startsWith("--plugin-dir=")) {
      pluginDirs.push(arg.slice("--plugin-dir=".length));
    } else if (arg === "--port") {
      i++;
      if (i >= argv.length) {
        console.error("❌ --port 需要指定端口号");
        process.exit(1);
      }
      const parsed = parseInt(argv[i], 10);
      if (Number.isNaN(parsed)) {
        console.error(`❌ --port 值必须是数字，收到: ${argv[i]}`);
        process.exit(1);
      }
      port = parsed;
    } else if (arg.startsWith("--port=")) {
      const parsed = parseInt(arg.slice("--port=".length), 10);
      if (Number.isNaN(parsed)) {
        console.error(
          `❌ --port 值必须是数字，收到: ${arg.slice("--port=".length)}`,
        );
        process.exit(1);
      }
      port = parsed;
    } else if (!arg.startsWith("-")) {
      placeArg = arg;
    }
    i++;
  }

  return { placeArg, pluginDirs, port };
}

/**
 * hub open [--plugin-dir <dir>]... <place.rbxl> — 注入 Runtime 并打开 Studio
 */
export async function openStudio(opts: OpenOptions): Promise<void> {
  if (!opts.placeArg) {
    console.error("❌ 缺少 place 文件路径");
    console.error(
      "   用法: roblox-studio-hub open [--plugin-dir <dir>]... <place.rbxl>",
    );
    process.exit(1);
  }

  const placePath = path.isAbsolute(opts.placeArg)
    ? opts.placeArg
    : path.resolve(process.cwd(), opts.placeArg);

  if (!fs.existsSync(placePath)) {
    console.error(`❌ 文件不存在: ${placePath}`);
    process.exit(1);
  }

  // Resolve plugin dirs to absolute paths
  const extraPluginDirs = opts.pluginDirs.map((d) =>
    path.isAbsolute(d) ? d : path.resolve(process.cwd(), d),
  );

  for (const dir of extraPluginDirs) {
    if (!fs.existsSync(dir)) {
      console.error(`❌ 插件目录不存在: ${dir}`);
      process.exit(1);
    }
  }

  try {
    // Step 1: Inject runtime
    console.log(`📦 注入 Runtime 到: ${placePath}`);
    await injectRuntime(placePath, { extraPluginDirs, port: opts.port });
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
  }
}

export function showOpenHelp(): void {
  console.log(`
Roblox Studio Hub - open 命令

用法: roblox-studio-hub open [选项] <place.rbxl>

描述:
  将 Hub Runtime 注入到指定的 .rbxl 文件中，然后在 Roblox Studio 中打开。
  Runtime 会被注入到 ReplicatedStorage.__HubRuntime__，包含：
  - 内置插件（execute, getStudioInfo）
  - 用户插件（来自 ~/.roblox-studio-hub/plugins/）
  - 额外插件目录（通过 --plugin-dir 指定）

参数:
  place.rbxl               目标 .rbxl 文件路径

选项:
  --plugin-dir, -p <dir>   额外插件目录（可多次指定）
                           目录中每个含 default.project.json 的子目录
                           将被编译并注入到 Runtime
  --port <number>          指定 Hub 端口（注入到 Runtime 供 Studio Plugin 读取）

示例:
  roblox-studio-hub open MyGame.rbxl
  roblox-studio-hub open --plugin-dir ./my-plugins game.rbxl
  roblox-studio-hub open -p ./plugin-a -p ./plugin-b game.rbxl
`);
}
