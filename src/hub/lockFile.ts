import fs from "fs";
import crypto from "crypto";
import path from "path";
import { getLockFilePath, getPluginsDir } from "./hubPaths.js";
import type { PluginsLock, PluginLockEntry } from "./pluginTypes.js";

/**
 * 读取 plugins.lock.json
 * 不存在时返回空的 lock
 */
export function readLockFile(): PluginsLock {
  const lockPath = getLockFilePath();
  if (!fs.existsSync(lockPath)) {
    return { plugins: {} };
  }

  try {
    const raw = fs.readFileSync(lockPath, "utf-8");
    return JSON.parse(raw) as PluginsLock;
  } catch {
    console.warn(`[LockFile] 无法读取 ${lockPath}，使用空 lock`);
    return { plugins: {} };
  }
}

/**
 * 写入 plugins.lock.json（不可变：生成新对象写入）
 */
export function writeLockFile(lock: PluginsLock): void {
  const lockPath = getLockFilePath();
  const dir = path.dirname(lockPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
}

/**
 * 添加或更新插件条目
 * @returns 新的 PluginsLock 对象
 */
export function addPluginEntry(
  lock: PluginsLock,
  name: string,
  entry: PluginLockEntry,
): PluginsLock {
  return {
    plugins: {
      ...lock.plugins,
      [name]: entry,
    },
  };
}

/**
 * 移除插件条目
 * @returns 新的 PluginsLock 对象
 */
export function removePluginEntry(
  lock: PluginsLock,
  name: string,
): PluginsLock {
  const { [name]: _, ...rest } = lock.plugins;
  return { plugins: rest };
}

/**
 * 计算目录内容的 SHA256 hash
 * 用于检测本地修改
 */
export function computeDirectoryHash(dirPath: string): string {
  const hash = crypto.createHash("sha256");

  function walkDir(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    // 排序确保稳定 hash
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of sorted) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        hash.update(`dir:${entry.name}\n`);
        walkDir(fullPath);
      } else if (entry.isFile()) {
        const content = fs.readFileSync(fullPath);
        hash.update(`file:${entry.name}:${content.length}\n`);
        hash.update(content);
      }
    }
  }

  if (fs.existsSync(dirPath)) {
    walkDir(dirPath);
  }

  return `sha256:${hash.digest("hex")}`;
}
