import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  readLockFile,
  writeLockFile,
  addPluginEntry,
  removePluginEntry,
  computeDirectoryHash,
} from "./lockFile.js";
import type { PluginsLock, PluginLockEntry } from "./pluginTypes.js";

// Mock hubPaths 使 getLockFilePath 指向临时目录
vi.mock("./hubPaths.js", () => ({
  getLockFilePath: vi.fn(),
  getPluginsDir: vi.fn(),
}));

import { getLockFilePath } from "./hubPaths.js";

const mockedGetLockFilePath = vi.mocked(getLockFilePath);

function makeLockEntry(overrides?: Partial<PluginLockEntry>): PluginLockEntry {
  return {
    version: "1.0.0",
    source: "test/plugin",
    marketplace: null,
    installedAt: "2026-02-16T00:00:00Z",
    hash: "sha256:abc123",
    ...overrides,
  };
}

describe("lockFile", () => {
  let tmpDir: string;
  let lockFilePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lockfile-test-"));
    lockFilePath = path.join(tmpDir, "plugins.lock.json");
    mockedGetLockFilePath.mockReturnValue(lockFilePath);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("readLockFile", () => {
    it("文件不存在时返回空 lock", () => {
      const lock = readLockFile();
      expect(lock).toEqual({ plugins: {} });
    });

    it("文件存在时返回解析后的 lock", () => {
      const data: PluginsLock = {
        plugins: {
          "my-plugin": makeLockEntry({ version: "2.0.0" }),
        },
      };
      fs.writeFileSync(lockFilePath, JSON.stringify(data));

      const lock = readLockFile();
      expect(lock.plugins["my-plugin"].version).toBe("2.0.0");
      expect(lock.plugins["my-plugin"].source).toBe("test/plugin");
    });

    it("JSON 无效时返回空 lock", () => {
      fs.writeFileSync(lockFilePath, "{ invalid json !!!");

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const lock = readLockFile();

      expect(lock).toEqual({ plugins: {} });
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe("writeLockFile", () => {
    it("写入有效 JSON", () => {
      const lock: PluginsLock = {
        plugins: {
          "my-plugin": makeLockEntry(),
        },
      };

      writeLockFile(lock);

      const raw = fs.readFileSync(lockFilePath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.plugins["my-plugin"].version).toBe("1.0.0");
    });

    it("目录不存在时自动创建", () => {
      const nestedLockPath = path.join(tmpDir, "deep", "nested", "lock.json");
      mockedGetLockFilePath.mockReturnValue(nestedLockPath);

      const lock: PluginsLock = { plugins: {} };
      writeLockFile(lock);

      expect(fs.existsSync(nestedLockPath)).toBe(true);
    });
  });

  describe("addPluginEntry", () => {
    it("返回包含新插件的新对象", () => {
      const lock: PluginsLock = { plugins: {} };
      const entry = makeLockEntry({ version: "3.0.0" });

      const result = addPluginEntry(lock, "new-plugin", entry);

      expect(result.plugins["new-plugin"].version).toBe("3.0.0");
      expect(result).not.toBe(lock);
    });

    it("覆盖已有条目", () => {
      const lock: PluginsLock = {
        plugins: {
          "existing": makeLockEntry({ version: "1.0.0" }),
        },
      };
      const updatedEntry = makeLockEntry({ version: "2.0.0" });

      const result = addPluginEntry(lock, "existing", updatedEntry);

      expect(result.plugins["existing"].version).toBe("2.0.0");
    });

    it("不修改原始对象（不可变性）", () => {
      const lock: PluginsLock = {
        plugins: {
          "keep-me": makeLockEntry({ version: "1.0.0" }),
        },
      };
      const originalPluginsRef = lock.plugins;

      addPluginEntry(lock, "new-plugin", makeLockEntry());

      // 原始 lock 不应被修改
      expect(lock.plugins).toBe(originalPluginsRef);
      expect(lock.plugins["new-plugin" as keyof typeof lock.plugins]).toBeUndefined();
      expect(Object.keys(lock.plugins)).toEqual(["keep-me"]);
    });
  });

  describe("removePluginEntry", () => {
    it("返回不含指定插件的新对象", () => {
      const lock: PluginsLock = {
        plugins: {
          "remove-me": makeLockEntry(),
          "keep-me": makeLockEntry({ version: "2.0.0" }),
        },
      };

      const result = removePluginEntry(lock, "remove-me");

      expect(result.plugins["remove-me" as keyof typeof result.plugins]).toBeUndefined();
      expect(result.plugins["keep-me"].version).toBe("2.0.0");
      expect(result).not.toBe(lock);
    });

    it("名称不存在时安全返回", () => {
      const lock: PluginsLock = {
        plugins: {
          "existing": makeLockEntry(),
        },
      };

      const result = removePluginEntry(lock, "nonexistent");

      expect(Object.keys(result.plugins)).toEqual(["existing"]);
    });

    it("不修改原始对象（不可变性）", () => {
      const lock: PluginsLock = {
        plugins: {
          "remove-me": makeLockEntry(),
          "keep-me": makeLockEntry(),
        },
      };
      const originalPluginsRef = lock.plugins;

      removePluginEntry(lock, "remove-me");

      // 原始 lock 不应被修改
      expect(lock.plugins).toBe(originalPluginsRef);
      expect(lock.plugins["remove-me"]).toBeDefined();
      expect(Object.keys(lock.plugins)).toEqual(["remove-me", "keep-me"]);
    });
  });

  describe("computeDirectoryHash", () => {
    it("相同内容返回稳定 hash", () => {
      const dir = path.join(tmpDir, "stable-hash");
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, "a.txt"), "hello");
      fs.writeFileSync(path.join(dir, "b.txt"), "world");

      const hash1 = computeDirectoryHash(dir);
      const hash2 = computeDirectoryHash(dir);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it("文件内容变化后 hash 改变", () => {
      const dir = path.join(tmpDir, "changing-hash");
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, "file.txt"), "original");

      const hash1 = computeDirectoryHash(dir);

      fs.writeFileSync(path.join(dir, "file.txt"), "modified");

      const hash2 = computeDirectoryHash(dir);

      expect(hash1).not.toBe(hash2);
    });

    it("目录不存在时返回空目录的 hash", () => {
      const nonexistent = path.join(tmpDir, "does-not-exist");
      const hash = computeDirectoryHash(nonexistent);

      expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it("包含子目录时递归计算", () => {
      const dir = path.join(tmpDir, "recursive-hash");
      fs.mkdirSync(path.join(dir, "sub"), { recursive: true });
      fs.writeFileSync(path.join(dir, "top.txt"), "top");
      fs.writeFileSync(path.join(dir, "sub", "nested.txt"), "nested");

      const hashWithSub = computeDirectoryHash(dir);

      // 修改子目录文件应导致 hash 变化
      fs.writeFileSync(path.join(dir, "sub", "nested.txt"), "changed");

      const hashAfterChange = computeDirectoryHash(dir);

      expect(hashWithSub).not.toBe(hashAfterChange);
    });
  });
});
