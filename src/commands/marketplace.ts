import fs from "fs";
import path from "path";
import {
  getMarketplacesConfigPath,
  getMarketplaceCacheDir,
  ensureDir,
} from "../hub/hubPaths.js";
import type {
  MarketplacesConfig,
  MarketplaceManifest,
  MarketplacePlugin,
} from "../hub/pluginTypes.js";

/**
 * 读取 marketplaces.json
 */
function readMarketplacesConfig(): MarketplacesConfig {
  const configPath = getMarketplacesConfigPath();
  if (!fs.existsSync(configPath)) {
    return { marketplaces: [] };
  }

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as MarketplacesConfig;
  } catch {
    return { marketplaces: [] };
  }
}

/**
 * 写入 marketplaces.json（不可变）
 */
function writeMarketplacesConfig(config: MarketplacesConfig): void {
  const configPath = getMarketplacesConfigPath();
  ensureDir(path.dirname(configPath));
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

/**
 * 将 owner/repo 转为缓存目录名
 */
function marketplaceCacheName(ownerRepo: string): string {
  return ownerRepo.replace("/", "--");
}

/**
 * Clone 或 pull marketplace 仓库到缓存
 */
async function syncMarketplaceRepo(ownerRepo: string): Promise<string> {
  const cacheDir = getMarketplaceCacheDir();
  ensureDir(cacheDir);

  const cacheName = marketplaceCacheName(ownerRepo);
  const repoDir = path.join(cacheDir, cacheName);
  const repoUrl = `https://github.com/${ownerRepo}.git`;

  const { execSync } = await import("child_process");

  if (fs.existsSync(path.join(repoDir, ".git"))) {
    // Pull latest
    try {
      execSync("git pull --ff-only", { cwd: repoDir, stdio: "pipe" });
    } catch {
      console.warn(`[Marketplace] git pull 失败: ${ownerRepo}，使用缓存`);
    }
  } else {
    // Clone
    execSync(`git clone --depth 1 ${repoUrl} ${repoDir}`, { stdio: "pipe" });
  }

  return repoDir;
}

/**
 * 读取 marketplace 仓库的 marketplace.json
 */
function readMarketplaceManifest(
  repoDir: string,
): MarketplaceManifest | null {
  const manifestPath = path.join(repoDir, "marketplace.json");
  if (!fs.existsSync(manifestPath)) return null;

  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    return JSON.parse(raw) as MarketplaceManifest;
  } catch {
    return null;
  }
}

// ==================== CLI Commands ====================

/**
 * hub marketplace add <owner/repo>
 */
export async function marketplaceAdd(ownerRepo: string): Promise<void> {
  if (!ownerRepo.includes("/")) {
    console.error("❌ 无效的 marketplace 格式，应为 owner/repo");
    process.exit(1);
  }

  const config = readMarketplacesConfig();

  if (config.marketplaces.includes(ownerRepo)) {
    console.log(`⚠️  Marketplace 已存在: ${ownerRepo}`);
    return;
  }

  // 验证可访问性
  console.log(`📥 验证 marketplace: ${ownerRepo}...`);
  try {
    const repoDir = await syncMarketplaceRepo(ownerRepo);
    const manifest = readMarketplaceManifest(repoDir);

    if (!manifest) {
      console.error(`❌ 仓库 ${ownerRepo} 中未找到 marketplace.json`);
      process.exit(1);
    }

    const newConfig: MarketplacesConfig = {
      marketplaces: [...config.marketplaces, ownerRepo],
    };
    writeMarketplacesConfig(newConfig);

    console.log(`✅ Marketplace 已添加: ${ownerRepo}`);
    console.log(`   名称: ${manifest.name}`);
    console.log(`   插件数: ${manifest.plugins.length}`);
  } catch (err) {
    console.error(
      `❌ 无法访问 marketplace: ${(err as Error).message}`,
    );
    process.exit(1);
  }
}

/**
 * hub marketplace remove <owner/repo>
 */
export function marketplaceRemove(ownerRepo: string): void {
  const config = readMarketplacesConfig();

  if (!config.marketplaces.includes(ownerRepo)) {
    console.error(`❌ Marketplace 未找到: ${ownerRepo}`);
    process.exit(1);
  }

  const newConfig: MarketplacesConfig = {
    marketplaces: config.marketplaces.filter((m) => m !== ownerRepo),
  };
  writeMarketplacesConfig(newConfig);

  console.log(`✅ Marketplace 已移除: ${ownerRepo}`);
}

/**
 * hub marketplace list
 */
export function marketplaceList(): void {
  const config = readMarketplacesConfig();

  if (config.marketplaces.length === 0) {
    console.log("\n📭 未添加任何 marketplace");
    console.log("   使用 hub marketplace add owner/repo 添加\n");
    return;
  }

  console.log(`\n📦 已添加的 Marketplace (${config.marketplaces.length} 个):\n`);
  for (const m of config.marketplaces) {
    console.log(`  ${m}`);
  }
  console.log("");
}

/**
 * 从所有已添加的 marketplace 中搜索插件
 * 按添加顺序遍历，先匹配先返回
 */
export async function searchInMarketplaces(
  pluginName: string,
): Promise<{
  plugin: MarketplacePlugin;
  marketplace: string;
  repoDir: string;
} | null> {
  const config = readMarketplacesConfig();

  for (const ownerRepo of config.marketplaces) {
    try {
      const repoDir = await syncMarketplaceRepo(ownerRepo);
      const manifest = readMarketplaceManifest(repoDir);

      if (!manifest) continue;

      const found = manifest.plugins.find((p) => p.name === pluginName);
      if (found) {
        return { plugin: found, marketplace: ownerRepo, repoDir };
      }
    } catch {
      console.warn(`[Marketplace] 跳过不可用的 marketplace: ${ownerRepo}`);
    }
  }

  return null;
}

/**
 * 搜索所有 marketplace 中的插件
 */
export async function searchAllMarketplaces(
  query?: string,
): Promise<ReadonlyArray<{ plugin: MarketplacePlugin; marketplace: string }>> {
  const config = readMarketplacesConfig();
  const results: Array<{ plugin: MarketplacePlugin; marketplace: string }> = [];

  for (const ownerRepo of config.marketplaces) {
    try {
      const repoDir = await syncMarketplaceRepo(ownerRepo);
      const manifest = readMarketplaceManifest(repoDir);

      if (!manifest) continue;

      for (const plugin of manifest.plugins) {
        if (
          !query ||
          plugin.name.includes(query) ||
          plugin.description.toLowerCase().includes(query.toLowerCase())
        ) {
          results.push({ plugin, marketplace: ownerRepo });
        }
      }
    } catch {
      // skip unavailable
    }
  }

  return results;
}

export function showMarketplaceHelp(): void {
  console.log(`
Roblox Studio Hub - marketplace 命令

用法:
  roblox-studio-hub marketplace add <owner/repo>     添加 marketplace
  roblox-studio-hub marketplace remove <owner/repo>  移除 marketplace
  roblox-studio-hub marketplace list                 列出已添加的 marketplace

描述:
  管理 Hub 插件的分发源。Marketplace 是包含 marketplace.json 的 GitHub 仓库。

示例:
  roblox-studio-hub marketplace add white-dragon-tools/hub-plugins
  roblox-studio-hub marketplace list
  roblox-studio-hub marketplace remove white-dragon-tools/hub-plugins
`);
}
