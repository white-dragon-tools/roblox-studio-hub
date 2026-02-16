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

/**
 * 注入 Hub Runtime 到 .rbxl 文件
 *
 * 流程：
 * 1. rojo build runtime/ → .rbxm
 * 2. rojo build 每个 plugin/ → .rbxm（可选）
 * 3. lune run inject-runtime.luau → 注入到 .rbxl
 */
export async function injectRuntime(placePath: string): Promise<void> {
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

  // 2. Build plugin .rbxm files
  const pluginsDir = getPluginsDir();
  const pluginRbxms: string[] = [];

  if (fs.existsSync(pluginsDir)) {
    const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const rbxm = await buildPluginRbxm(
          path.join(pluginsDir, entry.name),
          execFileSync,
        );
        if (rbxm) pluginRbxms.push(rbxm);
      } catch (e) {
        console.warn(
          `[InjectRuntime] 插件 ${entry.name} 编译失败，跳过: ${(e as Error).message}`,
        );
      }
    }
  }

  // 3. Inject via lune
  try {
    const luneArgs = [
      "run",
      INJECT_SCRIPT,
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
