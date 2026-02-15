import fs from "fs";
import path from "path";
import { getPluginsDir, ensureDir } from "../hub/hubPaths.js";
import {
  readLockFile,
  writeLockFile,
  addPluginEntry,
  removePluginEntry,
  computeDirectoryHash,
} from "../hub/lockFile.js";
import { searchInMarketplaces, searchAllMarketplaces } from "./marketplace.js";
import type { PluginManifest, PluginLockEntry } from "../hub/pluginTypes.js";

/**
 * 读取指定目录下的 plugin.json
 */
function readPluginManifest(pluginDir: string): PluginManifest | null {
  const manifestPath = path.join(pluginDir, "plugin.json");
  if (!fs.existsSync(manifestPath)) return null;

  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    return JSON.parse(raw) as PluginManifest;
  } catch {
    return null;
  }
}

/**
 * 复制目录（递归）
 */
function copyDirSync(src: string, dest: string): void {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.name === ".git") continue; // skip .git

    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * 从 GitHub clone 插件仓库到临时目录
 */
async function clonePluginRepo(source: string): Promise<string> {
  const { execSync } = await import("child_process");
  const tmpDir = path.join(
    fs.mkdtempSync(path.join(require("os").tmpdir(), "hub-plugin-")),
  );

  // 判断 source 格式
  let repoUrl: string;
  if (source.startsWith("https://") || source.startsWith("git://")) {
    repoUrl = source;
  } else if (source.includes("/")) {
    repoUrl = `https://github.com/${source}.git`;
  } else {
    throw new Error(`无效的插件源: ${source}`);
  }

  execSync(`git clone --depth 1 ${repoUrl} ${tmpDir}`, { stdio: "pipe" });
  return tmpDir;
}

/**
 * 解析插件来源目录（marketplace 内联路径 或 外部仓库）
 */
async function resolvePluginSource(
  source: string,
  marketplaceRepoDir?: string,
): Promise<string> {
  if (source.startsWith("./") || source.startsWith("../")) {
    // 内联在 marketplace 仓库中
    if (!marketplaceRepoDir) {
      throw new Error(`相对路径 source 需要 marketplace 上下文: ${source}`);
    }
    const resolved = path.resolve(marketplaceRepoDir, source);
    if (!fs.existsSync(resolved)) {
      throw new Error(`插件目录不存在: ${resolved}`);
    }
    return resolved;
  }

  // 外部仓库
  return clonePluginRepo(source);
}

// ==================== CLI Commands ====================

/**
 * hub plugin install <nameOrRepo>
 * - hub plugin install execute → 从 marketplace 搜索
 * - hub plugin install owner/repo → 直接从 GitHub 安装
 */
export async function pluginInstall(nameOrRepo: string): Promise<void> {
  const pluginsDir = getPluginsDir();
  ensureDir(pluginsDir);

  let sourcePath: string;
  let source: string;
  let marketplace: string | null = null;
  let isTemp = false;

  if (nameOrRepo.includes("/")) {
    // 直接从 GitHub 安装
    console.log(`📥 从 GitHub 安装: ${nameOrRepo}...`);
    sourcePath = await clonePluginRepo(nameOrRepo);
    source = nameOrRepo;
    isTemp = true;
  } else {
    // 从 marketplace 搜索
    console.log(`🔍 搜索插件: ${nameOrRepo}...`);
    const result = await searchInMarketplaces(nameOrRepo);

    if (!result) {
      console.error(`❌ 未找到插件: ${nameOrRepo}`);
      console.error("   请先添加 marketplace: hub marketplace add owner/repo");
      process.exit(1);
    }

    console.log(`   找到: ${result.plugin.name} (来自 ${result.marketplace})`);
    marketplace = result.marketplace;
    source = result.plugin.source;
    sourcePath = await resolvePluginSource(source, result.repoDir);
    isTemp = !source.startsWith("./") && !source.startsWith("../");
  }

  try {
    // 读取并验证 plugin.json
    const manifest = readPluginManifest(sourcePath);
    if (!manifest) {
      console.error(`❌ 插件目录中未找到 plugin.json: ${sourcePath}`);
      process.exit(1);
    }

    const destDir = path.join(pluginsDir, manifest.name);

    // 检查是否已安装
    const lock = readLockFile();
    if (lock.plugins[manifest.name]) {
      const existing = lock.plugins[manifest.name];
      console.log(
        `⚠️  插件 ${manifest.name} 已安装 (v${existing.version})，将覆盖安装`,
      );
    }

    // 复制插件文件
    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true });
    }
    copyDirSync(sourcePath, destDir);

    // 计算 hash 并更新 lock
    const hash = computeDirectoryHash(destDir);
    const entry: PluginLockEntry = {
      version: manifest.version,
      source,
      marketplace,
      installedAt: new Date().toISOString(),
      hash,
    };

    const newLock = addPluginEntry(lock, manifest.name, entry);
    writeLockFile(newLock);

    console.log(`✅ 插件已安装: ${manifest.name} v${manifest.version}`);
    if (manifest.tools?.length) {
      console.log(`   提供的方法: ${manifest.tools.map((t) => t.name).join(", ")}`);
    }
  } finally {
    // 清理临时目录
    if (isTemp && fs.existsSync(sourcePath)) {
      fs.rmSync(sourcePath, { recursive: true });
    }
  }
}

/**
 * hub plugin uninstall <name>
 */
export function pluginUninstall(name: string): void {
  const pluginsDir = getPluginsDir();
  const pluginDir = path.join(pluginsDir, name);

  const lock = readLockFile();

  if (!lock.plugins[name] && !fs.existsSync(pluginDir)) {
    console.error(`❌ 插件未安装: ${name}`);
    process.exit(1);
  }

  // 删除插件目录
  if (fs.existsSync(pluginDir)) {
    fs.rmSync(pluginDir, { recursive: true });
  }

  // 更新 lock
  const newLock = removePluginEntry(lock, name);
  writeLockFile(newLock);

  console.log(`✅ 插件已卸载: ${name}`);
}

/**
 * hub plugin list
 */
export function pluginList(): void {
  const lock = readLockFile();
  const entries = Object.entries(lock.plugins);

  if (entries.length === 0) {
    console.log("\n📭 未安装任何 Hub 插件");
    console.log("   使用 hub plugin install <name> 安装\n");
    return;
  }

  console.log(`\n📦 已安装的 Hub 插件 (${entries.length} 个):\n`);

  for (const [name, entry] of entries) {
    const source = entry.marketplace
      ? `${entry.marketplace} → ${entry.source}`
      : entry.source;
    console.log(`  ${name} v${entry.version}`);
    console.log(`    来源: ${source}`);
    console.log(`    安装: ${new Date(entry.installedAt).toLocaleString()}`);
    console.log("");
  }
}

/**
 * hub plugin search [query]
 */
export async function pluginSearch(query?: string): Promise<void> {
  console.log("🔍 搜索插件...\n");

  const results = await searchAllMarketplaces(query);

  if (results.length === 0) {
    console.log("📭 未找到匹配的插件");
    if (query) {
      console.log(`   搜索: "${query}"`);
    }
    return;
  }

  console.log(`找到 ${results.length} 个插件:\n`);
  for (const { plugin, marketplace } of results) {
    console.log(`  ${plugin.name}`);
    console.log(`    ${plugin.description}`);
    console.log(`    来源: ${marketplace}`);
    console.log("");
  }
}

/**
 * hub plugin update [name]
 */
export async function pluginUpdate(name?: string): Promise<void> {
  const lock = readLockFile();

  if (name) {
    // 更新指定插件
    if (!lock.plugins[name]) {
      console.error(`❌ 插件未安装: ${name}`);
      process.exit(1);
    }
    console.log(`🔄 更新插件: ${name}...`);
    await pluginInstall(name);
  } else {
    // 更新所有插件
    const entries = Object.entries(lock.plugins);
    if (entries.length === 0) {
      console.log("📭 没有已安装的插件需要更新");
      return;
    }

    console.log(`🔄 更新所有插件 (${entries.length} 个)...\n`);
    for (const [pluginName] of entries) {
      try {
        await pluginInstall(pluginName);
      } catch (err) {
        console.error(
          `❌ 更新 ${pluginName} 失败: ${(err as Error).message}`,
        );
      }
    }
  }
}

export function showPluginHelp(): void {
  console.log(`
Roblox Studio Hub - plugin 命令

用法:
  roblox-studio-hub plugin install <name>        从 marketplace 安装
  roblox-studio-hub plugin install <owner/repo>  从 GitHub 直接安装
  roblox-studio-hub plugin uninstall <name>      卸载插件
  roblox-studio-hub plugin list                  列出已安装插件
  roblox-studio-hub plugin search [query]        搜索 marketplace
  roblox-studio-hub plugin update [name]         更新插件

描述:
  管理 Hub 插件的安装、卸载和更新。

  插件安装到 ~/.roblox-studio-hub/plugins/（开发环境: .local-hub/plugins/）
  安装信息记录在 plugins.lock.json。

示例:
  roblox-studio-hub plugin install execute
  roblox-studio-hub plugin install white-dragon-tools/hub-plugin-execute
  roblox-studio-hub plugin list
  roblox-studio-hub plugin uninstall execute
  roblox-studio-hub plugin search lua
  roblox-studio-hub plugin update
`);
}
