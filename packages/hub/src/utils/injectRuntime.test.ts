import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import os from "os";

// Mock modules before import
vi.mock("fs", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("fs");
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(),
      readdirSync: vi.fn(),
      unlinkSync: vi.fn(),
    },
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("../hub/hubPaths.js", () => ({
  getPluginsDir: vi.fn(() => "/mock-home/.roblox-studio-hub/plugins"),
}));

import fs from "fs";
import { injectRuntime } from "./injectRuntime.js";

const mockExistsSync = fs.existsSync as unknown as ReturnType<typeof vi.fn>;
const mockReaddirSync = fs.readdirSync as unknown as ReturnType<typeof vi.fn>;
const mockUnlinkSync = fs.unlinkSync as unknown as ReturnType<typeof vi.fn>;

describe("injectRuntime", () => {
  let execFileSyncMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    const cp = await import("child_process");
    execFileSyncMock = cp.execFileSync as unknown as ReturnType<typeof vi.fn>;

    // Default: monorepo paths exist
    mockExistsSync.mockImplementation((p: string) => {
      if (p.includes("packages/runtime/default.project.json")) return true;
      if (p.includes("scripts/inject-runtime.luau")) return true;
      return false;
    });

    // No plugins by default
    mockReaddirSync.mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("成功注入 runtime（无插件）", async () => {
    await injectRuntime("/tmp/test.rbxl");

    // Should call rojo build for runtime
    expect(execFileSyncMock).toHaveBeenCalledWith(
      "rojo",
      expect.arrayContaining(["build"]),
      expect.objectContaining({ stdio: "pipe" }),
    );

    // Should call lune run inject script
    expect(execFileSyncMock).toHaveBeenCalledWith(
      "lune",
      expect.arrayContaining(["run"]),
      expect.objectContaining({ stdio: "pipe" }),
    );
  });

  it("找不到 runtime 项目配置时抛出错误", async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.includes("inject-runtime.luau")) return true;
      return false; // No runtime project
    });

    await expect(injectRuntime("/tmp/test.rbxl")).rejects.toThrow(
      "找不到 runtime 项目配置",
    );
  });

  it("找不到注入脚本时抛出错误", async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.includes("default.project.json")) return true;
      return false; // No inject script
    });

    await expect(injectRuntime("/tmp/test.rbxl")).rejects.toThrow(
      "找不到注入脚本",
    );
  });

  it("runtime 编译失败时抛出错误", async () => {
    execFileSyncMock.mockImplementationOnce(() => {
      const err = new Error("rojo failed") as Error & { stderr: Buffer };
      err.stderr = Buffer.from("Build error details");
      throw err;
    });

    await expect(injectRuntime("/tmp/test.rbxl")).rejects.toThrow(
      "Runtime 编译失败: Build error details",
    );
  });

  it("lune 注入失败时抛出错误并清理临时文件", async () => {
    // rojo build succeeds
    execFileSyncMock.mockImplementationOnce(() => Buffer.from(""));
    // lune run fails
    execFileSyncMock.mockImplementationOnce(() => {
      const err = new Error("lune failed") as Error & { stderr: Buffer };
      err.stderr = Buffer.from("Inject error");
      throw err;
    });

    await expect(injectRuntime("/tmp/test.rbxl")).rejects.toThrow(
      "注入失败: Inject error",
    );

    // Should try to cleanup temp files
    expect(mockUnlinkSync).toHaveBeenCalled();
  });

  it("传入 port 选项时传递 --port 参数给 lune", async () => {
    await injectRuntime("/tmp/test.rbxl", { port: 12345 });

    // Find the lune call
    const luneCalls = execFileSyncMock.mock.calls.filter(
      (c: unknown[]) => c[0] === "lune",
    );
    expect(luneCalls).toHaveLength(1);
    expect(luneCalls[0][1]).toContain("--port");
    expect(luneCalls[0][1]).toContain("12345");
  });

  it("无 port 选项时不传 --port 参数", async () => {
    await injectRuntime("/tmp/test.rbxl");

    const luneCalls = execFileSyncMock.mock.calls.filter(
      (c: unknown[]) => c[0] === "lune",
    );
    expect(luneCalls[0][1]).not.toContain("--port");
  });

  it("extraPluginDirs 单个插件目录（有 project.json）", async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.includes("packages/runtime/default.project.json")) return true;
      if (p.includes("scripts/inject-runtime.luau")) return true;
      if (p === "/extra-plugin/default.project.json") return true;
      return false;
    });

    await injectRuntime("/tmp/test.rbxl", {
      extraPluginDirs: ["/extra-plugin"],
    });

    // Should call rojo build for the plugin too
    const rojoCalls = execFileSyncMock.mock.calls.filter(
      (c: unknown[]) => c[0] === "rojo",
    );
    expect(rojoCalls.length).toBeGreaterThanOrEqual(2); // runtime + plugin
  });

  it("extraPluginDirs 父目录（含多个子插件）", async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.includes("packages/runtime/default.project.json")) return true;
      if (p.includes("scripts/inject-runtime.luau")) return true;
      // Parent dir exists
      if (p === "/parent-dir") return true;
      // Parent dir is NOT a plugin (no project.json at root)
      if (p === "/parent-dir/default.project.json") return false;
      // Sub-plugin has project.json
      if (p.includes("sub-plugin") && p.includes("default.project.json"))
        return true;
      return false;
    });

    // collectPluginDirsFrom calls readdirSync with { withFileTypes: true }
    mockReaddirSync.mockImplementation((dir: string, _opts?: unknown) => {
      if (dir === "/parent-dir") {
        return [{ name: "sub-plugin", isDirectory: () => true }];
      }
      // Default for ~/.roblox-studio-hub/plugins/
      return [];
    });

    await injectRuntime("/tmp/test.rbxl", {
      extraPluginDirs: ["/parent-dir"],
    });

    const rojoCalls = execFileSyncMock.mock.calls.filter(
      (c: unknown[]) => c[0] === "rojo",
    );
    // 1 for runtime + 1 for sub-plugin = 2
    expect(rojoCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("插件编译失败时跳过并继续", async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.includes("packages/runtime/default.project.json")) return true;
      if (p.includes("scripts/inject-runtime.luau")) return true;
      if (p.includes("plugins")) return true;
      if (p.includes("default.project.json")) return true;
      return false;
    });

    mockReaddirSync.mockImplementation((dir: string) => {
      if (dir.includes("plugins")) {
        return [{ name: "bad-plugin", isDirectory: () => true }];
      }
      return [];
    });

    let rojoCallCount = 0;
    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "rojo") {
        rojoCallCount++;
        if (rojoCallCount === 2) {
          // Second rojo call (plugin) fails
          throw new Error("plugin compile error");
        }
        return Buffer.from("");
      }
      if (cmd === "lune") return Buffer.from("");
      return Buffer.from("");
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Should not throw — plugin failure is non-fatal
    await injectRuntime("/tmp/test.rbxl");

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("编译失败，跳过"),
    );

    warnSpy.mockRestore();
  });

  it("回退到 local 路径查找 runtime", async () => {
    mockExistsSync.mockImplementation((p: string) => {
      // Monorepo path doesn't exist
      if (p.includes("packages/runtime/default.project.json")) return false;
      // Local path exists
      if (p.includes(path.join("hub", "runtime", "default.project.json")))
        return true;
      if (p.includes("scripts/inject-runtime.luau")) return true;
      return false;
    });

    await injectRuntime("/tmp/test.rbxl");
    expect(execFileSyncMock).toHaveBeenCalled();
  });

  it("回退到 local 路径查找注入脚本", async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.includes("default.project.json")) return true;
      // Monorepo inject script doesn't exist
      if (
        p.includes(path.join("roblox-studio-hub", "scripts")) &&
        p.includes("inject-runtime.luau")
      )
        return false;
      // hub local inject script exists
      if (p.includes(path.join("hub", "scripts", "inject-runtime.luau")))
        return true;
      return false;
    });

    await injectRuntime("/tmp/test.rbxl");
    expect(execFileSyncMock).toHaveBeenCalled();
  });

  it("临时文件清理失败时不抛出错误", async () => {
    mockUnlinkSync.mockImplementation(() => {
      throw new Error("permission denied");
    });

    await injectRuntime("/tmp/test.rbxl");
    // Should complete without throwing
  });
});
