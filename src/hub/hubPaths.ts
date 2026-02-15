import path from "path";
import fs from "fs";
import os from "os";

/**
 * Hub 用户目录路径工具
 * 开发环境使用 .local-hub/，生产使用 ~/.roblox-studio-hub/
 */

function detectHubRoot(): string {
  const localHub = path.join(process.cwd(), ".local-hub");
  if (fs.existsSync(localHub)) {
    return localHub;
  }
  return path.join(os.homedir(), ".roblox-studio-hub");
}

/** Hub 根目录 */
export function getHubRoot(): string {
  return detectHubRoot();
}

/** 插件安装目录 */
export function getPluginsDir(): string {
  return path.join(getHubRoot(), "plugins");
}

/** plugins.lock.json 路径 */
export function getLockFilePath(): string {
  return path.join(getHubRoot(), "plugins.lock.json");
}

/** marketplaces.json 路径 */
export function getMarketplacesConfigPath(): string {
  return path.join(getHubRoot(), "marketplaces.json");
}

/** marketplace 缓存目录 */
export function getMarketplaceCacheDir(): string {
  return path.join(getHubRoot(), "cache", "marketplaces");
}

/** 确保目录存在 */
export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}
