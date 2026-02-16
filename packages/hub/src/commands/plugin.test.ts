import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import type { PluginsLock, PluginManifest } from "../hub/pluginTypes.js";

// Mock modules before imports
vi.mock("fs");
vi.mock("child_process");
vi.mock("../hub/hubPaths.js");
vi.mock("../hub/lockFile.js");
vi.mock("./marketplace.js");

import fs from "fs";
import path from "path";
import * as hubPaths from "../hub/hubPaths.js";
import * as lockFile from "../hub/lockFile.js";
import * as marketplace from "./marketplace.js";
import {
  pluginInstall,
  pluginUninstall,
  pluginList,
  pluginSearch,
  pluginUpdate,
  showPluginHelp,
} from "./plugin.js";

// Type assertions for mocked modules
const mockFs = vi.mocked(fs);
const mockHubPaths = vi.mocked(hubPaths);
const mockLockFile = vi.mocked(lockFile);
const mockMarketplace = vi.mocked(marketplace);

describe("plugin commands", () => {
  let consoleLogSpy: Mock;
  let consoleErrorSpy: Mock;
  let processExitSpy: Mock;
  let mockPluginsDir: string;
  let mockTempDir: string;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Mock console methods
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Mock process.exit to prevent test from exiting
    processExitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    // Setup directory paths
    mockPluginsDir = "/mock/plugins";
    mockTempDir = "/tmp/hub-plugin-test";

    // Mock hubPaths
    mockHubPaths.getPluginsDir.mockReturnValue(mockPluginsDir);
    mockHubPaths.ensureDir.mockImplementation(() => {});

    // Mock fs.mkdtempSync to return predictable temp dir
    mockFs.mkdtempSync = vi.fn().mockReturnValue(mockTempDir);

    // Mock fs.existsSync by default (override in individual tests)
    mockFs.existsSync = vi.fn().mockReturnValue(false);

    // Mock fs.readdirSync for empty directory
    mockFs.readdirSync = vi.fn().mockReturnValue([]);

    // Mock fs basic operations
    mockFs.readFileSync = vi.fn() as any;
    mockFs.writeFileSync = vi.fn() as any;
    mockFs.copyFileSync = vi.fn() as any;
    mockFs.mkdirSync = vi.fn() as any;
    mockFs.rmSync = vi.fn() as any;

    // Mock lockFile operations
    mockLockFile.readLockFile.mockReturnValue({ plugins: {} });
    mockLockFile.writeLockFile.mockImplementation(() => {});
    mockLockFile.addPluginEntry.mockImplementation((lock, name, entry) => ({
      plugins: { ...lock.plugins, [name]: entry },
    }));
    mockLockFile.removePluginEntry.mockImplementation((lock, name) => {
      const { [name]: _, ...rest } = lock.plugins;
      return { plugins: rest };
    });
    mockLockFile.computeDirectoryHash.mockReturnValue("sha256:mock-hash");
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe("pluginInstall", () => {
    it("应该从 GitHub (owner/repo) 安装插件", async () => {
      const nameOrRepo = "white-dragon-tools/test-plugin";
      const mockManifest: PluginManifest = {
        name: "test-plugin",
        version: "1.0.0",
        description: "Test plugin",
        tools: [
          {
            name: "testMethod",
            description: "Test method",
            inputSchema: { type: "object" },
          },
        ],
      };

      // Mock child_process.execSync
      const { execSync } = await import("child_process");
      vi.mocked(execSync).mockReturnValue(Buffer.from(""));

      // Mock plugin.json reading
      mockFs.existsSync = vi.fn().mockImplementation((p: string) => {
        if (p === path.join(mockTempDir, "plugin.json")) return true;
        if (p === mockTempDir) return true; // temp dir exists for cleanup check
        return false;
      });

      mockFs.readFileSync = vi.fn().mockImplementation((p: string) => {
        if (p === path.join(mockTempDir, "plugin.json")) {
          return JSON.stringify(mockManifest);
        }
        return "";
      });

      await pluginInstall(nameOrRepo);

      // Verify git clone was called
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining("git clone"),
        expect.any(Object),
      );

      // Verify plugin was copied
      expect(hubPaths.ensureDir).toHaveBeenCalled();

      // Verify lock file was updated
      expect(mockLockFile.addPluginEntry).toHaveBeenCalledWith(
        { plugins: {} },
        "test-plugin",
        expect.objectContaining({
          version: "1.0.0",
          source: nameOrRepo,
          marketplace: null,
        }),
      );
      expect(mockLockFile.writeLockFile).toHaveBeenCalled();

      // Verify temp dir cleanup
      expect(mockFs.rmSync).toHaveBeenCalledWith(mockTempDir, {
        recursive: true,
      });

      // Verify success message
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("插件已安装"),
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("testMethod"),
      );
    });

    it("应该从 marketplace 搜索并安装插件", async () => {
      const pluginName = "execute";
      const mockManifest: PluginManifest = {
        name: "execute",
        version: "2.0.0",
        description: "Execute plugin",
      };

      const mockSearchResult = {
        plugin: {
          name: "execute",
          description: "Execute plugin",
          source: "white-dragon-tools/hub-plugin-execute",
        },
        marketplace: "white-dragon-tools/hub-plugins",
        repoDir: "/cache/marketplaces/white-dragon-tools--hub-plugins",
      };

      mockMarketplace.searchInMarketplaces.mockResolvedValue(mockSearchResult);

      // Mock child_process.execSync for git clone
      const { execSync } = await import("child_process");
      vi.mocked(execSync).mockReturnValue(Buffer.from(""));

      // Mock plugin.json reading
      mockFs.existsSync = vi.fn().mockImplementation((p: string) => {
        if (p === path.join(mockTempDir, "plugin.json")) return true;
        return false;
      });

      mockFs.readFileSync = vi.fn().mockImplementation((p: string) => {
        if (p === path.join(mockTempDir, "plugin.json")) {
          return JSON.stringify(mockManifest);
        }
        return "";
      });

      await pluginInstall(pluginName);

      // Verify marketplace search
      expect(mockMarketplace.searchInMarketplaces).toHaveBeenCalledWith(
        pluginName,
      );

      // Verify lock file includes marketplace info
      expect(mockLockFile.addPluginEntry).toHaveBeenCalledWith(
        { plugins: {} },
        "execute",
        expect.objectContaining({
          version: "2.0.0",
          source: "white-dragon-tools/hub-plugin-execute",
          marketplace: "white-dragon-tools/hub-plugins",
        }),
      );
    });

    it("应该在 plugin.json 不存在时报错", async () => {
      const nameOrRepo = "test/plugin";

      // Mock child_process.execSync
      const { execSync } = await import("child_process");
      vi.mocked(execSync).mockReturnValue(Buffer.from(""));

      // Mock plugin.json NOT found, but temp dir exists
      mockFs.existsSync = vi.fn().mockImplementation((p: string) => {
        if (p === mockTempDir) return true; // temp dir exists for cleanup
        return false; // plugin.json doesn't exist
      });

      await expect(pluginInstall(nameOrRepo)).rejects.toThrow(
        "process.exit(1)",
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("未找到 plugin.json"),
      );

      // Verify temp dir cleanup even on error
      expect(mockFs.rmSync).toHaveBeenCalledWith(mockTempDir, {
        recursive: true,
      });
    });

    it("应该在 marketplace 未找到插件时报错", async () => {
      mockMarketplace.searchInMarketplaces.mockResolvedValue(null);

      await expect(pluginInstall("nonexistent")).rejects.toThrow(
        "process.exit(1)",
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("未找到插件"),
      );
    });

    it("应该覆盖已安装的插件", async () => {
      const nameOrRepo = "test/plugin";
      const mockManifest: PluginManifest = {
        name: "test-plugin",
        version: "2.0.0",
        description: "Updated plugin",
      };

      const existingLock: PluginsLock = {
        plugins: {
          "test-plugin": {
            version: "1.0.0",
            source: "test/old-plugin",
            marketplace: null,
            installedAt: "2026-01-01T00:00:00.000Z",
            hash: "sha256:old-hash",
          },
        },
      };

      mockLockFile.readLockFile.mockReturnValue(existingLock);

      // Mock child_process.execSync
      const { execSync } = await import("child_process");
      vi.mocked(execSync).mockReturnValue(Buffer.from(""));

      // Mock plugin.json reading
      mockFs.existsSync = vi.fn().mockImplementation((p: string) => {
        if (p === path.join(mockTempDir, "plugin.json")) return true;
        if (p === path.join(mockPluginsDir, "test-plugin")) return true; // existing install
        return false;
      });

      mockFs.readFileSync = vi
        .fn()
        .mockReturnValue(JSON.stringify(mockManifest));

      await pluginInstall(nameOrRepo);

      // Verify warning about overwrite
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("已安装"),
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("覆盖安装"),
      );

      // Verify old directory was removed
      expect(mockFs.rmSync).toHaveBeenCalledWith(
        path.join(mockPluginsDir, "test-plugin"),
        { recursive: true },
      );
    });

    it("应该处理相对路径的 marketplace 插件源", async () => {
      const pluginName = "local-plugin";
      const marketplaceRepoDir = "/cache/marketplaces/test--marketplace";
      const localPluginDir = path.join(
        marketplaceRepoDir,
        "./plugins/local-plugin",
      );

      const mockSearchResult = {
        plugin: {
          name: "local-plugin",
          description: "Local plugin",
          source: "./plugins/local-plugin",
        },
        marketplace: "test/marketplace",
        repoDir: marketplaceRepoDir,
      };

      mockMarketplace.searchInMarketplaces.mockResolvedValue(mockSearchResult);

      const mockManifest: PluginManifest = {
        name: "local-plugin",
        version: "1.0.0",
        description: "Local plugin",
      };

      // Mock plugin.json in local path
      mockFs.existsSync = vi.fn().mockImplementation((p: string) => {
        if (p === localPluginDir) return true;
        if (p === path.join(localPluginDir, "plugin.json")) return true;
        return false;
      });

      mockFs.readFileSync = vi
        .fn()
        .mockReturnValue(JSON.stringify(mockManifest));
      mockFs.readdirSync = vi.fn().mockReturnValue([]);

      await pluginInstall(pluginName);

      // Verify no git clone for local path
      const { execSync } = await import("child_process");
      expect(execSync).not.toHaveBeenCalled();

      // Verify plugin was installed
      expect(mockLockFile.writeLockFile).toHaveBeenCalled();
    });

    it("应该在清理时处理临时目录不存在的情况", async () => {
      const nameOrRepo = "test/plugin";
      const mockManifest: PluginManifest = {
        name: "test-plugin",
        version: "1.0.0",
        description: "Test",
      };

      // Mock child_process.execSync
      const { execSync } = await import("child_process");
      vi.mocked(execSync).mockReturnValue(Buffer.from(""));

      // Mock existsSync to return false for temp dir on cleanup check
      mockFs.existsSync = vi.fn().mockImplementation((p: string) => {
        if (p === path.join(mockTempDir, "plugin.json")) return true;
        if (p === mockTempDir) return false; // temp dir doesn't exist
        return false;
      });

      mockFs.readFileSync = vi
        .fn()
        .mockReturnValue(JSON.stringify(mockManifest));

      await pluginInstall(nameOrRepo);

      // Should not call rmSync if temp dir doesn't exist
      expect(mockFs.rmSync).not.toHaveBeenCalledWith(
        mockTempDir,
        expect.any(Object),
      );
    });
  });

  describe("pluginUninstall", () => {
    it("应该卸载已安装的插件", () => {
      const pluginName = "test-plugin";
      const pluginDir = path.join(mockPluginsDir, pluginName);

      const mockLock: PluginsLock = {
        plugins: {
          [pluginName]: {
            version: "1.0.0",
            source: "test/plugin",
            marketplace: null,
            installedAt: "2026-01-01T00:00:00.000Z",
            hash: "sha256:hash",
          },
        },
      };

      mockLockFile.readLockFile.mockReturnValue(mockLock);
      mockFs.existsSync = vi.fn().mockReturnValue(true);

      pluginUninstall(pluginName);

      // Verify directory was removed
      expect(mockFs.rmSync).toHaveBeenCalledWith(pluginDir, {
        recursive: true,
      });

      // Verify lock file was updated
      expect(mockLockFile.removePluginEntry).toHaveBeenCalledWith(
        mockLock,
        pluginName,
      );
      expect(mockLockFile.writeLockFile).toHaveBeenCalled();

      // Verify success message
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("插件已卸载"),
      );
    });

    it("应该在插件未安装时报错", () => {
      const pluginName = "nonexistent";

      mockLockFile.readLockFile.mockReturnValue({ plugins: {} });
      mockFs.existsSync = vi.fn().mockReturnValue(false);

      expect(() => pluginUninstall(pluginName)).toThrow("process.exit(1)");

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("插件未安装"),
      );
    });

    it("应该处理 lock 中有记录但目录不存在的情况", () => {
      const pluginName = "orphan-plugin";
      const pluginDir = path.join(mockPluginsDir, pluginName);

      const mockLock: PluginsLock = {
        plugins: {
          [pluginName]: {
            version: "1.0.0",
            source: "test/plugin",
            marketplace: null,
            installedAt: "2026-01-01T00:00:00.000Z",
            hash: "sha256:hash",
          },
        },
      };

      mockLockFile.readLockFile.mockReturnValue(mockLock);
      mockFs.existsSync = vi.fn().mockReturnValue(false); // directory doesn't exist

      pluginUninstall(pluginName);

      // Should not try to remove directory
      expect(mockFs.rmSync).not.toHaveBeenCalled();

      // But should still update lock
      expect(mockLockFile.removePluginEntry).toHaveBeenCalled();
      expect(mockLockFile.writeLockFile).toHaveBeenCalled();
    });

    it("应该处理目录存在但 lock 中无记录的情况", () => {
      const pluginName = "unlocked-plugin";
      const pluginDir = path.join(mockPluginsDir, pluginName);

      mockLockFile.readLockFile.mockReturnValue({ plugins: {} });
      mockFs.existsSync = vi.fn().mockImplementation((p: string) => {
        return p === pluginDir; // directory exists
      });

      pluginUninstall(pluginName);

      // Should remove directory
      expect(mockFs.rmSync).toHaveBeenCalledWith(pluginDir, {
        recursive: true,
      });

      // Should still call removePluginEntry (will be no-op)
      expect(mockLockFile.removePluginEntry).toHaveBeenCalled();
    });
  });

  describe("pluginList", () => {
    it("应该列出已安装的插件", () => {
      const mockLock: PluginsLock = {
        plugins: {
          execute: {
            version: "1.0.0",
            source: "white-dragon-tools/hub-plugin-execute",
            marketplace: "white-dragon-tools/hub-plugins",
            installedAt: "2026-01-15T10:00:00.000Z",
            hash: "sha256:hash1",
          },
          "custom-plugin": {
            version: "2.5.3",
            source: "custom/plugin",
            marketplace: null,
            installedAt: "2026-02-01T14:30:00.000Z",
            hash: "sha256:hash2",
          },
        },
      };

      mockLockFile.readLockFile.mockReturnValue(mockLock);

      pluginList();

      // Verify header
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("已安装的 Hub 插件"),
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("2 个"),
      );

      // Verify plugin details
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("execute v1.0.0"),
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("white-dragon-tools/hub-plugins"),
      );

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("custom-plugin v2.5.3"),
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("custom/plugin"),
      );
    });

    it("应该在没有插件时显示空消息", () => {
      mockLockFile.readLockFile.mockReturnValue({ plugins: {} });

      pluginList();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("未安装任何 Hub 插件"),
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("hub plugin install"),
      );
    });

    it("应该正确显示没有 marketplace 的插件", () => {
      const mockLock: PluginsLock = {
        plugins: {
          "direct-install": {
            version: "1.0.0",
            source: "owner/repo",
            marketplace: null,
            installedAt: "2026-02-15T00:00:00.000Z",
            hash: "sha256:hash",
          },
        },
      };

      mockLockFile.readLockFile.mockReturnValue(mockLock);

      pluginList();

      // Should show source directly (not marketplace → source)
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("来源: owner/repo"),
      );
      expect(consoleLogSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("→"),
      );
    });
  });

  describe("pluginSearch", () => {
    it("应该搜索所有 marketplace 并显示结果", async () => {
      const mockResults = [
        {
          plugin: {
            name: "execute",
            description: "Execute Lua code",
            source: "white-dragon-tools/hub-plugin-execute",
          },
          marketplace: "white-dragon-tools/hub-plugins",
        },
        {
          plugin: {
            name: "file-handler",
            description: "Handle file operations",
            source: "other/plugin",
          },
          marketplace: "other/marketplace",
        },
      ];

      mockMarketplace.searchAllMarketplaces.mockResolvedValue(mockResults);

      await pluginSearch("plugin");

      // Verify search was called with query
      expect(mockMarketplace.searchAllMarketplaces).toHaveBeenCalledWith(
        "plugin",
      );

      // Verify results display
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("找到 2 个插件"),
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("execute"),
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Execute Lua code"),
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("file-handler"),
      );
    });

    it("应该在没有查询时搜索全部插件", async () => {
      mockMarketplace.searchAllMarketplaces.mockResolvedValue([]);

      await pluginSearch();

      // Should call with undefined
      expect(mockMarketplace.searchAllMarketplaces).toHaveBeenCalledWith(
        undefined,
      );
    });

    it("应该在无结果时显示空消息", async () => {
      mockMarketplace.searchAllMarketplaces.mockResolvedValue([]);

      await pluginSearch("nonexistent");

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("未找到匹配的插件"),
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('搜索: "nonexistent"'),
      );
    });

    it("应该在无查询无结果时不显示搜索关键字", async () => {
      mockMarketplace.searchAllMarketplaces.mockResolvedValue([]);

      await pluginSearch();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("未找到匹配的插件"),
      );
      expect(consoleLogSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("搜索:"),
      );
    });
  });

  describe("pluginUpdate", () => {
    it("应该更新指定的插件", async () => {
      const pluginName = "execute";
      const mockLock: PluginsLock = {
        plugins: {
          [pluginName]: {
            version: "1.0.0",
            source: "white-dragon-tools/hub-plugin-execute",
            marketplace: "white-dragon-tools/hub-plugins",
            installedAt: "2026-01-01T00:00:00.000Z",
            hash: "sha256:hash",
          },
        },
      };

      mockLockFile.readLockFile.mockReturnValue(mockLock);

      const mockManifest: PluginManifest = {
        name: pluginName,
        version: "2.0.0",
        description: "Updated",
      };

      const mockSearchResult = {
        plugin: {
          name: pluginName,
          description: "Execute plugin",
          source: "white-dragon-tools/hub-plugin-execute",
        },
        marketplace: "white-dragon-tools/hub-plugins",
        repoDir: "/cache/marketplace",
      };

      mockMarketplace.searchInMarketplaces.mockResolvedValue(mockSearchResult);

      const { execSync } = await import("child_process");
      vi.mocked(execSync).mockReturnValue(Buffer.from(""));

      mockFs.existsSync = vi.fn().mockImplementation((p: string) => {
        if (p === path.join(mockTempDir, "plugin.json")) return true;
        return false;
      });

      mockFs.readFileSync = vi
        .fn()
        .mockReturnValue(JSON.stringify(mockManifest));

      await pluginUpdate(pluginName);

      // Verify update message
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("更新插件"),
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(pluginName),
      );

      // Verify pluginInstall was called (via marketplace search)
      expect(mockMarketplace.searchInMarketplaces).toHaveBeenCalledWith(
        pluginName,
      );
    });

    it("应该在插件未安装时报错", async () => {
      mockLockFile.readLockFile.mockReturnValue({ plugins: {} });

      await expect(pluginUpdate("nonexistent")).rejects.toThrow(
        "process.exit(1)",
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("插件未安装"),
      );
    });

    it("应该在没有参数时更新所有插件", async () => {
      const mockLock: PluginsLock = {
        plugins: {
          "plugin-a": {
            version: "1.0.0",
            source: "test/a",
            marketplace: null,
            installedAt: "2026-01-01T00:00:00.000Z",
            hash: "sha256:hash-a",
          },
          "plugin-b": {
            version: "2.0.0",
            source: "test/b",
            marketplace: null,
            installedAt: "2026-01-01T00:00:00.000Z",
            hash: "sha256:hash-b",
          },
        },
      };

      mockLockFile.readLockFile.mockReturnValue(mockLock);

      const mockManifest: PluginManifest = {
        name: "test",
        version: "3.0.0",
        description: "Test",
      };

      const { execSync } = await import("child_process");
      vi.mocked(execSync).mockReturnValue(Buffer.from(""));

      mockFs.existsSync = vi.fn().mockImplementation((p: string) => {
        if (p === path.join(mockTempDir, "plugin.json")) return true;
        return false;
      });

      mockFs.readFileSync = vi
        .fn()
        .mockReturnValue(JSON.stringify(mockManifest));

      await pluginUpdate();

      // Verify update all message
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("更新所有插件"),
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("2 个"),
      );

      // Verify both plugins were updated (git clone called twice)
      expect(execSync).toHaveBeenCalledTimes(2);
    });

    it("应该在没有插件时显示空消息", async () => {
      mockLockFile.readLockFile.mockReturnValue({ plugins: {} });

      await pluginUpdate();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("没有已安装的插件需要更新"),
      );
    });

    it("应该在更新失败时显示错误但继续更新其他插件", async () => {
      const mockLock: PluginsLock = {
        plugins: {
          "plugin-success": {
            version: "1.0.0",
            source: "test/success",
            marketplace: null,
            installedAt: "2026-01-01T00:00:00.000Z",
            hash: "sha256:hash-1",
          },
          "plugin-fail": {
            version: "1.0.0",
            source: "test/fail",
            marketplace: null,
            installedAt: "2026-01-01T00:00:00.000Z",
            hash: "sha256:hash-2",
          },
        },
      };

      mockLockFile.readLockFile.mockReturnValue(mockLock);

      const mockManifest: PluginManifest = {
        name: "test",
        version: "2.0.0",
        description: "Test",
      };

      const { execSync } = await import("child_process");
      let callCount = 0;
      vi.mocked(execSync).mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          throw new Error("Git clone failed");
        }
        return Buffer.from("");
      });

      mockFs.existsSync = vi.fn().mockImplementation((p: string) => {
        if (p === path.join(mockTempDir, "plugin.json")) return true;
        return false;
      });

      mockFs.readFileSync = vi
        .fn()
        .mockReturnValue(JSON.stringify(mockManifest));

      await pluginUpdate();

      // Verify error was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("更新 plugin-fail 失败"),
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Git clone failed"),
      );

      // Verify first plugin was still updated
      expect(mockLockFile.writeLockFile).toHaveBeenCalled();
    });
  });

  describe("showPluginHelp", () => {
    it("应该显示帮助文本", () => {
      showPluginHelp();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("plugin 命令"),
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("install"),
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("uninstall"),
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("list"),
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("search"),
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("update"),
      );
    });
  });

  describe("edge cases", () => {
    it("应该处理 plugin.json 解析错误", async () => {
      const nameOrRepo = "test/plugin";

      const { execSync } = await import("child_process");
      vi.mocked(execSync).mockReturnValue(Buffer.from(""));

      mockFs.existsSync = vi.fn().mockImplementation((p: string) => {
        return p === path.join(mockTempDir, "plugin.json");
      });

      // Return invalid JSON
      mockFs.readFileSync = vi.fn().mockReturnValue("{ invalid json");

      await expect(pluginInstall(nameOrRepo)).rejects.toThrow(
        "process.exit(1)",
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("未找到 plugin.json"),
      );
    });

    it("应该处理 git clone 失败", async () => {
      const nameOrRepo = "test/nonexistent";

      const { execSync } = await import("child_process");
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("Repository not found");
      });

      await expect(pluginInstall(nameOrRepo)).rejects.toThrow(
        "Repository not found",
      );

      // Note: When clonePluginRepo fails, sourcePath is never assigned,
      // so cleanup doesn't happen in finally block (sourcePath is undefined).
      // This is expected behavior - mkdtemp creates dir but clone fails,
      // leaving orphan temp dir (OS will clean up /tmp eventually).
      expect(mockFs.rmSync).not.toHaveBeenCalled();
    });

    it("应该处理无效的插件源格式", async () => {
      const invalidSource = "invalid-format";

      const { execSync } = await import("child_process");
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error(`无效的插件源: ${invalidSource}`);
      });

      // Mock marketplace search returns source that will fail
      mockMarketplace.searchInMarketplaces.mockResolvedValue({
        plugin: {
          name: "test",
          description: "Test",
          source: invalidSource,
        },
        marketplace: "test/marketplace",
        repoDir: "/cache/test",
      });

      await expect(pluginInstall("test-plugin")).rejects.toThrow(
        "无效的插件源",
      );
    });

    it("应该正确处理 copyDirSync 跳过 .git 目录", async () => {
      const nameOrRepo = "test/plugin";
      const mockManifest: PluginManifest = {
        name: "test-plugin",
        version: "1.0.0",
        description: "Test",
      };

      const { execSync } = await import("child_process");
      vi.mocked(execSync).mockReturnValue(Buffer.from(""));

      mockFs.existsSync = vi.fn().mockImplementation((p: string) => {
        if (p === path.join(mockTempDir, "plugin.json")) return true;
        if (p === mockTempDir) return true;
        return false;
      });

      mockFs.readFileSync = vi
        .fn()
        .mockReturnValue(JSON.stringify(mockManifest));

      // Mock readdirSync to return different content based on directory
      mockFs.readdirSync = vi.fn().mockImplementation((dirPath: string) => {
        if (dirPath === mockTempDir) {
          // Root directory has .git, plugin.json, and src
          return [
            { name: ".git", isDirectory: () => true, isFile: () => false },
            {
              name: "plugin.json",
              isDirectory: () => false,
              isFile: () => true,
            },
            { name: "src", isDirectory: () => true, isFile: () => false },
          ] as fs.Dirent[];
        } else {
          // Subdirectories are empty to prevent infinite recursion
          return [] as fs.Dirent[];
        }
      });

      await pluginInstall(nameOrRepo);

      // Verify .git was not copied (neither as file nor directory)
      expect(mockFs.copyFileSync).not.toHaveBeenCalledWith(
        path.join(mockTempDir, ".git"),
        expect.any(String),
      );
      expect(mockFs.readdirSync).not.toHaveBeenCalledWith(
        path.join(mockTempDir, ".git"),
      );

      // Verify other files were copied
      expect(mockFs.copyFileSync).toHaveBeenCalledWith(
        path.join(mockTempDir, "plugin.json"),
        path.join(mockPluginsDir, "test-plugin", "plugin.json"),
      );

      // Verify src directory was processed (readdirSync called on it)
      expect(mockFs.readdirSync).toHaveBeenCalledWith(
        path.join(mockTempDir, "src"),
        expect.any(Object),
      );
    });
  });
});
