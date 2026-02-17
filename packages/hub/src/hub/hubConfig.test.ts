import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { loadHubConfig, checkDependencies } from "./hubConfig.js";

describe("hubConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-config-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("loadHubConfig", () => {
    it("应当从当前目录找到 .roblox-studio-hub/hub.json", () => {
      const hubDir = path.join(tmpDir, ".roblox-studio-hub");
      fs.mkdirSync(hubDir, { recursive: true });
      fs.writeFileSync(
        path.join(hubDir, "hub.json"),
        JSON.stringify({
          plugins: {
            dependencies: ["execute", "get-studio-info"],
          },
        }),
      );

      const config = loadHubConfig(tmpDir);
      expect(config).not.toBeNull();
      expect(config!.plugins.dependencies).toEqual([
        "execute",
        "get-studio-info",
      ]);
    });

    it("应当从祖先目录向上查找 .roblox-studio-hub/hub.json", () => {
      const projectRoot = path.join(tmpDir, "project");
      const subDir = path.join(projectRoot, "levels", "level1");
      fs.mkdirSync(subDir, { recursive: true });

      const hubDir = path.join(projectRoot, ".roblox-studio-hub");
      fs.mkdirSync(hubDir, { recursive: true });
      fs.writeFileSync(
        path.join(hubDir, "hub.json"),
        JSON.stringify({
          plugins: {
            dependencies: ["my-plugin"],
          },
        }),
      );

      const config = loadHubConfig(subDir);
      expect(config).not.toBeNull();
      expect(config!.plugins.dependencies).toEqual(["my-plugin"]);
    });

    it("应当在未找到 hub.json 时返回 null", () => {
      const config = loadHubConfig(tmpDir);
      expect(config).toBeNull();
    });

    it("应当在遇到文件系统根目录时停止查找", () => {
      // 不会无限递归
      const config = loadHubConfig("/");
      expect(config).toBeNull();
    });

    it("应当处理无效的 JSON", () => {
      const hubDir = path.join(tmpDir, ".roblox-studio-hub");
      fs.mkdirSync(hubDir, { recursive: true });
      fs.writeFileSync(path.join(hubDir, "hub.json"), "{invalid json");

      const config = loadHubConfig(tmpDir);
      expect(config).toBeNull();
    });

    it("应当返回空 dependencies 当 hub.json 没有 plugins 字段", () => {
      const hubDir = path.join(tmpDir, ".roblox-studio-hub");
      fs.mkdirSync(hubDir, { recursive: true });
      fs.writeFileSync(path.join(hubDir, "hub.json"), JSON.stringify({}));

      const config = loadHubConfig(tmpDir);
      expect(config).not.toBeNull();
      expect(config!.plugins.dependencies).toEqual([]);
    });

    it("应当返回项目根目录路径", () => {
      const projectRoot = path.join(tmpDir, "project");
      const subDir = path.join(projectRoot, "sub");
      fs.mkdirSync(subDir, { recursive: true });

      const hubDir = path.join(projectRoot, ".roblox-studio-hub");
      fs.mkdirSync(hubDir, { recursive: true });
      fs.writeFileSync(path.join(hubDir, "hub.json"), JSON.stringify({}));

      const config = loadHubConfig(subDir);
      expect(config).not.toBeNull();
      expect(config!.projectRoot).toBe(projectRoot);
    });
  });

  describe("checkDependencies", () => {
    it("应当检测已安装的插件", () => {
      const pluginsDir = path.join(tmpDir, "plugins");
      fs.mkdirSync(path.join(pluginsDir, "execute"), { recursive: true });
      fs.writeFileSync(
        path.join(pluginsDir, "execute", "plugin.json"),
        JSON.stringify({ name: "execute", version: "1.0.0" }),
      );

      const result = checkDependencies(["execute"], pluginsDir);
      expect(result.missing).toEqual([]);
      expect(result.installed).toEqual(["execute"]);
    });

    it("应当检测未安装的插件", () => {
      const pluginsDir = path.join(tmpDir, "plugins");
      fs.mkdirSync(pluginsDir, { recursive: true });

      const result = checkDependencies(
        ["execute", "missing-plugin"],
        pluginsDir,
      );
      expect(result.missing).toEqual(["execute", "missing-plugin"]);
      expect(result.installed).toEqual([]);
    });

    it("应当处理空 dependencies", () => {
      const pluginsDir = path.join(tmpDir, "plugins");
      fs.mkdirSync(pluginsDir, { recursive: true });

      const result = checkDependencies([], pluginsDir);
      expect(result.missing).toEqual([]);
      expect(result.installed).toEqual([]);
    });

    it("应当处理不存在的 pluginsDir", () => {
      const result = checkDependencies(
        ["execute"],
        path.join(tmpDir, "nonexistent"),
      );
      expect(result.missing).toEqual(["execute"]);
      expect(result.installed).toEqual([]);
    });
  });
});
