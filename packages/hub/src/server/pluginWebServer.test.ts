import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import request from "supertest";
import express from "express";
import { mountPluginWebRoutes, type PluginWebInfo } from "./pluginWebServer.js";

function makeTmpDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "plugin-web-")));
}

/**
 * 创建一个有 web 目录的测试插件
 */
function createPluginWithWeb(
  pluginsDir: string,
  name: string,
  webDir: string,
  files: Record<string, string> = {},
): void {
  const pluginDir = path.join(pluginsDir, name);
  const webPath = path.join(pluginDir, webDir);
  fs.mkdirSync(webPath, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, "plugin.json"),
    JSON.stringify({
      name,
      version: "0.1.0",
      description: `Test plugin ${name}`,
      web: `./${webDir}`,
      tools: [],
    }),
  );
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(webPath, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
}

describe("pluginWebServer", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("mountPluginWebRoutes", () => {
    it("无插件时返回空列表", () => {
      const app = express();
      const result = mountPluginWebRoutes(app, tmpDir);
      expect(result).toEqual([]);
    });

    it("无 web 字段的插件不挂载", () => {
      const pluginDir = path.join(tmpDir, "no-web");
      fs.mkdirSync(pluginDir, { recursive: true });
      fs.writeFileSync(
        path.join(pluginDir, "plugin.json"),
        JSON.stringify({
          name: "no-web",
          version: "0.1.0",
          description: "No web",
          tools: [],
        }),
      );

      const app = express();
      const result = mountPluginWebRoutes(app, tmpDir);
      expect(result).toEqual([]);
    });

    it("有 web 字段的插件应挂载静态服务", async () => {
      createPluginWithWeb(tmpDir, "test-plugin", "web/dist", {
        "index.html": "<h1>Test Plugin</h1>",
      });

      const app = express();
      const result = mountPluginWebRoutes(app, tmpDir);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("test-plugin");
      expect(result[0].mountPath).toBe("/plugins/test-plugin");

      const res = await request(app).get(
        "/plugins/test-plugin/index.html",
      );
      expect(res.status).toBe(200);
      expect(res.text).toContain("Test Plugin");
    });

    it("多个插件应各自挂载", async () => {
      createPluginWithWeb(tmpDir, "plugin-a", "web/dist", {
        "index.html": "<h1>Plugin A</h1>",
      });
      createPluginWithWeb(tmpDir, "plugin-b", "web/dist", {
        "index.html": "<h1>Plugin B</h1>",
      });

      const app = express();
      const result = mountPluginWebRoutes(app, tmpDir);

      expect(result).toHaveLength(2);

      const resA = await request(app).get(
        "/plugins/plugin-a/index.html",
      );
      expect(resA.status).toBe(200);
      expect(resA.text).toContain("Plugin A");

      const resB = await request(app).get(
        "/plugins/plugin-b/index.html",
      );
      expect(resB.status).toBe(200);
      expect(resB.text).toContain("Plugin B");
    });

    it("web 目录不存在应跳过该插件", () => {
      const pluginDir = path.join(tmpDir, "bad-web");
      fs.mkdirSync(pluginDir, { recursive: true });
      fs.writeFileSync(
        path.join(pluginDir, "plugin.json"),
        JSON.stringify({
          name: "bad-web",
          version: "0.1.0",
          description: "Bad web path",
          web: "./web/dist",
          tools: [],
        }),
      );

      const app = express();
      const result = mountPluginWebRoutes(app, tmpDir);
      expect(result).toEqual([]);
    });

    it("pluginsDir 不存在应返回空列表", () => {
      const app = express();
      const result = mountPluginWebRoutes(
        app,
        path.join(tmpDir, "nonexistent"),
      );
      expect(result).toEqual([]);
    });

    it("应返回 PluginWebInfo 包含工具的 web 路径", () => {
      const pluginDir = path.join(tmpDir, "with-tool-web");
      const webPath = path.join(pluginDir, "web", "dist");
      fs.mkdirSync(webPath, { recursive: true });
      fs.writeFileSync(
        path.join(pluginDir, "plugin.json"),
        JSON.stringify({
          name: "with-tool-web",
          version: "0.1.0",
          description: "Plugin with tool web",
          web: "./web/dist",
          tools: [
            {
              name: "myTool",
              description: "A tool with web",
              web: "/tools/my-tool",
              inputSchema: { type: "object", properties: {} },
            },
            {
              name: "noWebTool",
              description: "A tool without web",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        }),
      );

      const app = express();
      const result = mountPluginWebRoutes(app, tmpDir);

      expect(result).toHaveLength(1);
      expect(result[0].toolWebPaths).toEqual({
        myTool: "/plugins/with-tool-web/tools/my-tool",
      });
    });
  });
});
