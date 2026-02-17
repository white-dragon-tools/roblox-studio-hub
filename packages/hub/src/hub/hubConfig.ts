import fs from "fs";
import path from "path";

/**
 * hub.json 配置结构
 */
export interface HubConfig {
  readonly plugins: {
    readonly dependencies: readonly string[];
  };
  readonly projectRoot: string;
}

/**
 * hub.json 原始文件结构
 */
interface HubConfigFile {
  readonly plugins?: {
    readonly dependencies?: readonly string[];
  };
}

/**
 * 从 startDir 向上查找 .roblox-studio-hub/hub.json
 * 类似 .git 的查找机制，遇到文件系统根目录停止
 *
 * @returns HubConfig 或 null（未找到）
 */
export function loadHubConfig(startDir: string): HubConfig | null {
  let current = path.resolve(startDir);

  while (true) {
    const hubJsonPath = path.join(
      current,
      ".roblox-studio-hub",
      "hub.json",
    );

    if (fs.existsSync(hubJsonPath)) {
      try {
        const raw = fs.readFileSync(hubJsonPath, "utf-8");
        const parsed = JSON.parse(raw) as HubConfigFile;
        return {
          plugins: {
            dependencies: parsed.plugins?.dependencies ?? [],
          },
          projectRoot: current,
        };
      } catch {
        return null;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      // 已到文件系统根
      return null;
    }
    current = parent;
  }
}

/**
 * 依赖检查结果
 */
export interface DependencyCheckResult {
  readonly installed: readonly string[];
  readonly missing: readonly string[];
}

/**
 * 检查 dependencies 列表中的插件是否已安装
 */
export function checkDependencies(
  dependencies: readonly string[],
  pluginsDir: string,
): DependencyCheckResult {
  const installed: string[] = [];
  const missing: string[] = [];

  for (const dep of dependencies) {
    const pluginDir = path.join(pluginsDir, dep);
    const manifestPath = path.join(pluginDir, "plugin.json");

    if (fs.existsSync(manifestPath)) {
      installed.push(dep);
    } else {
      missing.push(dep);
    }
  }

  return { installed, missing };
}
