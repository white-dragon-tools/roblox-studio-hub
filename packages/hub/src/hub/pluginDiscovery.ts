import path from "path";
import fs from "fs";
import { getPluginsDir } from "./hubPaths.js";
import type { PluginManifest, PluginToolDef } from "./pluginTypes.js";

// Re-export for backward compat
export type PluginTool = PluginToolDef;
export type { PluginManifest };

/**
 * 读取单个插件的 plugin.json
 */
function readPluginManifest(pluginDir: string): PluginManifest | null {
  const manifestPath = path.join(pluginDir, "plugin.json");
  if (!fs.existsSync(manifestPath)) return null;

  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    return JSON.parse(raw) as PluginManifest;
  } catch {
    console.warn(`[PluginDiscovery] 无法读取 plugin.json: ${manifestPath}`);
    return null;
  }
}

/**
 * 发现所有已安装插件并收集 tool 描述符
 * 用于 MCP 静态发现和 x-file 参数解析
 */
export function discoverPluginTools(): ReadonlyArray<PluginTool> {
  const pluginsDir = getPluginsDir();
  if (!fs.existsSync(pluginsDir)) return [];

  const tools: PluginTool[] = [];

  const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const manifest = readPluginManifest(path.join(pluginsDir, entry.name));
    if (manifest?.tools) {
      tools.push(...manifest.tools);
    }
  }

  return tools;
}

/**
 * 发现所有已安装插件的 manifest
 */
export function discoverPlugins(): ReadonlyArray<PluginManifest> {
  const pluginsDir = getPluginsDir();
  if (!fs.existsSync(pluginsDir)) return [];

  const manifests: PluginManifest[] = [];

  const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const manifest = readPluginManifest(path.join(pluginsDir, entry.name));
    if (manifest) {
      manifests.push(manifest);
    }
  }

  return manifests;
}
