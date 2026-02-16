import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  getHubRoot,
  getPluginsDir,
  getLockFilePath,
  getMarketplacesConfigPath,
  getMarketplaceCacheDir,
  ensureDir,
} from "./hubPaths.js";

describe("hubPaths", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hubpaths-test-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("getHubRoot", () => {
    it(".local-hub 存在时返回 .local-hub 路径", () => {
      const localHubDir = path.join(tmpDir, ".local-hub");
      fs.mkdirSync(localHubDir);

      vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

      expect(getHubRoot()).toBe(localHubDir);
    });

    it(".local-hub 不存在时回退到 ~/.roblox-studio-hub", () => {
      // tmpDir 里没有 .local-hub
      vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

      const expected = path.join(os.homedir(), ".roblox-studio-hub");
      expect(getHubRoot()).toBe(expected);
    });
  });

  describe("getPluginsDir", () => {
    it("返回 hubRoot/plugins", () => {
      const localHubDir = path.join(tmpDir, ".local-hub");
      fs.mkdirSync(localHubDir);
      vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

      expect(getPluginsDir()).toBe(path.join(localHubDir, "plugins"));
    });
  });

  describe("getLockFilePath", () => {
    it("返回 hubRoot/plugins.lock.json", () => {
      const localHubDir = path.join(tmpDir, ".local-hub");
      fs.mkdirSync(localHubDir);
      vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

      expect(getLockFilePath()).toBe(
        path.join(localHubDir, "plugins.lock.json"),
      );
    });
  });

  describe("getMarketplacesConfigPath", () => {
    it("返回 hubRoot/marketplaces.json", () => {
      const localHubDir = path.join(tmpDir, ".local-hub");
      fs.mkdirSync(localHubDir);
      vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

      expect(getMarketplacesConfigPath()).toBe(
        path.join(localHubDir, "marketplaces.json"),
      );
    });
  });

  describe("getMarketplaceCacheDir", () => {
    it("返回 hubRoot/cache/marketplaces", () => {
      const localHubDir = path.join(tmpDir, ".local-hub");
      fs.mkdirSync(localHubDir);
      vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

      expect(getMarketplaceCacheDir()).toBe(
        path.join(localHubDir, "cache", "marketplaces"),
      );
    });
  });

  describe("ensureDir", () => {
    it("创建嵌套目录", () => {
      const nested = path.join(tmpDir, "a", "b", "c");
      expect(fs.existsSync(nested)).toBe(false);

      ensureDir(nested);

      expect(fs.existsSync(nested)).toBe(true);
      expect(fs.statSync(nested).isDirectory()).toBe(true);
    });

    it("已存在时不抛异常", () => {
      const dir = path.join(tmpDir, "existing");
      fs.mkdirSync(dir);

      expect(() => ensureDir(dir)).not.toThrow();
    });
  });
});
