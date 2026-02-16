import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

// Mock hubPaths before importing the module under test
vi.mock("./hubPaths.js", () => ({
  getPluginsDir: vi.fn(),
}));

import { discoverPluginTools, discoverPlugins } from "./pluginDiscovery.js";
import { getPluginsDir } from "./hubPaths.js";

const mockedGetPluginsDir = vi.mocked(getPluginsDir);

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hub-plugin-test-"));
}

function writePluginJson(pluginsDir: string, pluginName: string, manifest: Record<string, unknown>): void {
  const dir = path.join(pluginsDir, pluginName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plugin.json"), JSON.stringify(manifest));
}

describe("pluginDiscovery", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    mockedGetPluginsDir.mockReturnValue(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("discoverPluginTools", () => {
    it("plugins 目录不存在时返回空数组", () => {
      mockedGetPluginsDir.mockReturnValue(path.join(tempDir, "nonexistent"));

      const tools = discoverPluginTools();

      expect(tools).toEqual([]);
    });

    it("plugins 目录为空时返回空数组", () => {
      const tools = discoverPluginTools();

      expect(tools).toEqual([]);
    });

    it("从含 tools 字段的 plugin.json 发现工具", () => {
      writePluginJson(tempDir, "my-plugin", {
        name: "my-plugin",
        version: "1.0.0",
        description: "Test plugin",
        tools: [
          {
            name: "doSomething",
            description: "Does something",
            inputSchema: {
              type: "object",
              properties: { code: { type: "string" } },
              required: ["code"],
            },
          },
        ],
      });

      const tools = discoverPluginTools();

      expect(tools).toHaveLength(1);
      expect(tools[0]).toEqual({
        name: "doSomething",
        description: "Does something",
        inputSchema: {
          type: "object",
          properties: { code: { type: "string" } },
          required: ["code"],
        },
      });
    });

    it("跳过没有 plugin.json 的目录", () => {
      // 创建一个空的插件目录（无 plugin.json）
      fs.mkdirSync(path.join(tempDir, "empty-plugin"), { recursive: true });

      // 创建一个有效的插件目录
      writePluginJson(tempDir, "valid-plugin", {
        name: "valid-plugin",
        version: "1.0.0",
        description: "Valid",
        tools: [
          {
            name: "tool-a",
            description: "A",
            inputSchema: { type: "object" },
          },
        ],
      });

      const tools = discoverPluginTools();

      expect(tools).toHaveLength(1);
      expect(tools[0]!.name).toBe("tool-a");
    });

    it("跳过无效 JSON 文件", () => {
      const dir = path.join(tempDir, "bad-plugin");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "plugin.json"), "NOT VALID JSON {{{");

      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const tools = discoverPluginTools();

      expect(tools).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledOnce();
      consoleSpy.mockRestore();
    });

    it("从多个插件目录中发现所有工具", () => {
      writePluginJson(tempDir, "plugin-a", {
        name: "plugin-a",
        version: "1.0.0",
        description: "A",
        tools: [
          { name: "tool-1", description: "T1", inputSchema: { type: "object" } },
          { name: "tool-2", description: "T2", inputSchema: { type: "object" } },
        ],
      });
      writePluginJson(tempDir, "plugin-b", {
        name: "plugin-b",
        version: "2.0.0",
        description: "B",
        tools: [
          { name: "tool-3", description: "T3", inputSchema: { type: "object" } },
        ],
      });

      const tools = discoverPluginTools();

      expect(tools).toHaveLength(3);
      const names = tools.map((t) => t.name);
      expect(names).toContain("tool-1");
      expect(names).toContain("tool-2");
      expect(names).toContain("tool-3");
    });
  });

  describe("discoverPlugins", () => {
    it("返回 PluginManifest 对象数组", () => {
      writePluginJson(tempDir, "my-plugin", {
        name: "my-plugin",
        version: "1.0.0",
        description: "A test plugin",
        tools: [
          { name: "exec", description: "Execute", inputSchema: { type: "object" } },
        ],
      });

      const manifests = discoverPlugins();

      expect(manifests).toHaveLength(1);
      expect(manifests[0]).toMatchObject({
        name: "my-plugin",
        version: "1.0.0",
        description: "A test plugin",
      });
      expect(manifests[0]!.tools).toHaveLength(1);
    });

    it("没有 tools 字段的插件仍返回有效 manifest", () => {
      writePluginJson(tempDir, "no-tools-plugin", {
        name: "no-tools-plugin",
        version: "0.1.0",
        description: "Plugin without tools",
      });

      const manifests = discoverPlugins();

      expect(manifests).toHaveLength(1);
      expect(manifests[0]).toMatchObject({
        name: "no-tools-plugin",
        version: "0.1.0",
        description: "Plugin without tools",
      });
      expect(manifests[0]!.tools).toBeUndefined();
    });
  });
});
