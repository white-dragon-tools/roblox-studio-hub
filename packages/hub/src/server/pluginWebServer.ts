import path from "path";
import fs from "fs";
import express from "express";
import type { PluginManifest } from "../hub/pluginTypes.js";

/**
 * 挂载后的插件 Web UI 信息
 */
export interface PluginWebInfo {
  readonly name: string;
  readonly mountPath: string;
  readonly webRoot: string;
  readonly toolWebPaths: Readonly<Record<string, string>>;
}

/**
 * 读取插件的 plugin.json
 */
function readManifest(pluginDir: string): PluginManifest | null {
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
 * 扫描 pluginsDir 中有 web 字段的插件，挂载静态服务到 /plugins/<name>/
 * 返回挂载信息（用于 Hub Web UI 动态渲染 iframe）
 */
export function mountPluginWebRoutes(
  app: express.Express,
  pluginsDir: string,
): ReadonlyArray<PluginWebInfo> {
  if (!fs.existsSync(pluginsDir)) return [];

  const results: PluginWebInfo[] = [];
  const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const pluginDir = path.join(pluginsDir, entry.name);
    const manifest = readManifest(pluginDir);
    if (!manifest?.web) continue;

    const webRoot = path.resolve(pluginDir, manifest.web);
    if (!fs.existsSync(webRoot)) {
      console.warn(
        `[PluginWeb] web directory not found: ${webRoot} (plugin: ${manifest.name})`,
      );
      continue;
    }

    const mountPath = `/plugins/${manifest.name}`;
    app.use(mountPath, express.static(webRoot));

    const toolWebPaths: Record<string, string> = {};
    if (manifest.tools) {
      for (const tool of manifest.tools) {
        if (tool.web) {
          toolWebPaths[tool.name] = `${mountPath}${tool.web}`;
        }
      }
    }

    results.push({
      name: manifest.name,
      mountPath,
      webRoot,
      toolWebPaths,
    });
  }

  return results;
}
