import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { getPluginsDir } from "../hub/hubPaths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Hub 包根目录 (packages/hub/) */
const HUB_ROOT = path.join(__dirname, "..", "..");

/** Monorepo 根目录 */
const MONOREPO_ROOT = path.join(HUB_ROOT, "..", "..");

/** 查找 Runtime Rojo 项目配置 — 先查 monorepo，再查 hub 本地（npm installed） */
function resolveRuntimeProject(): string {
  const mono = path.join(
    MONOREPO_ROOT,
    "packages",
    "runtime",
    "default.project.json",
  );
  if (fs.existsSync(mono)) return mono;

  const local = path.join(HUB_ROOT, "runtime", "default.project.json");
  if (fs.existsSync(local)) return local;

  throw new Error("找不到 runtime 项目配置");
}

/** 查找 Lune 注入脚本 — 先查 monorepo，再查 hub 本地 */
function resolveInjectScript(): string {
  const mono = path.join(MONOREPO_ROOT, "scripts", "inject-runtime.luau");
  if (fs.existsSync(mono)) return mono;

  const local = path.join(HUB_ROOT, "scripts", "inject-runtime.luau");
  if (fs.existsSync(local)) return local;

  throw new Error("找不到注入脚本");
}

/**
 * 构建单个插件为 .rbxm（如果有 default.project.json）
 * @returns .rbxm 临时文件路径，或 null（无 Rojo 配置）
 */
async function buildPluginRbxm(
  pluginDir: string,
  execFileSync: typeof import("child_process").execFileSync,
): Promise<string | null> {
  const projectJson = path.join(pluginDir, "default.project.json");
  if (!fs.existsSync(projectJson)) return null;

  const outputPath = path.join(
    os.tmpdir(),
    `hub-plugin-${path.basename(pluginDir)}-${Date.now()}.rbxm`,
  );

  execFileSync("rojo", ["build", projectJson, "--output", outputPath], {
    stdio: "pipe",
  });

  return outputPath;
}

export interface InjectOptions {
  /** Extra plugin directories (from --plugin-dir) */
  readonly extraPluginDirs?: ReadonlyArray<string>;
  /** Hub port to inject (Studio Plugin reads this to connect) */
  readonly port?: number;
}

/**
 * Collect plugin dirs from a parent directory (each subdir with default.project.json)
 */
function collectPluginDirsFrom(parentDir: string): string[] {
  if (!fs.existsSync(parentDir)) return [];
  const entries = fs.readdirSync(parentDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => path.join(parentDir, e.name));
}

/**
 * Check if a directory IS a single plugin (has default.project.json)
 * vs a parent of multiple plugins
 */
function isPluginDir(dir: string): boolean {
  return fs.existsSync(path.join(dir, "default.project.json"));
}

/**
 * 注入 Hub Runtime 到 .rbxl 文件
 *
 * 流程：
 * 1. rojo build runtime/ → .rbxm
 * 2. rojo build 每个 plugin/ → .rbxm（可选）
 * 3. lune run inject-runtime.luau → 注入到 .rbxl
 */
export async function injectRuntime(
  placePath: string,
  options?: InjectOptions,
): Promise<void> {
  const { execFileSync } = await import("child_process");

  const RUNTIME_PROJECT = resolveRuntimeProject();
  const INJECT_SCRIPT = resolveInjectScript();

  // 1. Build runtime .rbxm
  const runtimeRbxm = path.join(os.tmpdir(), `hub-runtime-${Date.now()}.rbxm`);

  try {
    execFileSync("rojo", ["build", RUNTIME_PROJECT, "--output", runtimeRbxm], {
      stdio: "pipe",
    });
  } catch (e) {
    const stderr =
      (e as { stderr?: Buffer }).stderr?.toString() || (e as Error).message;
    throw new Error(`Runtime 编译失败: ${stderr}`);
  }

  // 2. Collect all plugin directories
  const pluginDirsToCompile: string[] = [];

  // 2a. Standard plugins from hub config
  const pluginsDir = getPluginsDir();
  pluginDirsToCompile.push(...collectPluginDirsFrom(pluginsDir));

  // 2b. Extra plugin dirs from --plugin-dir
  for (const extraDir of options?.extraPluginDirs ?? []) {
    if (isPluginDir(extraDir)) {
      // Single plugin directory
      pluginDirsToCompile.push(extraDir);
    } else {
      // Parent directory containing multiple plugins
      pluginDirsToCompile.push(...collectPluginDirsFrom(extraDir));
    }
  }

  // 2c. Build each plugin
  const pluginRbxms: string[] = [];
  for (const pluginDir of pluginDirsToCompile) {
    try {
      const rbxm = await buildPluginRbxm(pluginDir, execFileSync);
      if (rbxm) pluginRbxms.push(rbxm);
    } catch (e) {
      console.warn(
        `[InjectRuntime] 插件 ${path.basename(pluginDir)} 编译失败，跳过: ${(e as Error).message}`,
      );
    }
  }

  // 3. Inject via lune
  try {
    const portArgs =
      options?.port != null ? ["--port", String(options.port)] : [];
    const luneArgs = [
      "run",
      INJECT_SCRIPT,
      ...portArgs,
      placePath,
      runtimeRbxm,
      ...pluginRbxms,
    ];

    execFileSync("lune", luneArgs, { stdio: "pipe" });
  } catch (e) {
    const stderr =
      (e as { stderr?: Buffer }).stderr?.toString() || (e as Error).message;
    throw new Error(`注入失败: ${stderr}`);
  } finally {
    // Cleanup temp files
    for (const tmpFile of [runtimeRbxm, ...pluginRbxms]) {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // ignore
      }
    }
  }
}
