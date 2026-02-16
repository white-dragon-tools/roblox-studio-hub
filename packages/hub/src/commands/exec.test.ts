import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseExecArgs, execCommand, showExecHelp } from "./exec.js";

describe("parseExecArgs", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("-c 短参数解析 studioId 和 code", () => {
    const result = parseExecArgs([
      "node",
      "hub",
      "exec",
      "local:Test",
      "-c",
      "print(1)",
    ]);
    expect(result).toEqual({
      studioId: "local:Test",
      code: "print(1)",
      mode: "eval",
    });
  });

  it("--code 长参数解析 code", () => {
    const result = parseExecArgs([
      "node",
      "hub",
      "exec",
      "local:Test",
      "--code",
      "print(2)",
    ]);
    expect(result).toEqual({
      studioId: "local:Test",
      code: "print(2)",
      mode: "eval",
    });
  });

  it("无 -c 时解析文件路径", () => {
    const result = parseExecArgs([
      "node",
      "hub",
      "exec",
      "local:Test",
      "script.lua",
    ]);
    expect(result).toEqual({
      studioId: "local:Test",
      filePath: "script.lua",
      mode: "eval",
    });
  });

  it("-m 短参数解析 mode", () => {
    const result = parseExecArgs([
      "node",
      "hub",
      "exec",
      "local:Test",
      "-c",
      "x",
      "-m",
      "play",
    ]);
    expect(result.mode).toBe("play");
  });

  it("--mode 长参数解析 mode", () => {
    const result = parseExecArgs([
      "node",
      "hub",
      "exec",
      "local:Test",
      "-c",
      "x",
      "--mode",
      "run",
    ]);
    expect(result.mode).toBe("run");
  });

  it("缺少 studioId 时调用 process.exit(1)", () => {
    expect(() => parseExecArgs(["node", "hub", "exec"])).toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("无效 mode 时调用 process.exit(1)", () => {
    expect(() =>
      parseExecArgs([
        "node",
        "hub",
        "exec",
        "local:Test",
        "-c",
        "x",
        "-m",
        "invalid",
      ]),
    ).toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("-c 后缺少代码时调用 process.exit(1)", () => {
    expect(() =>
      parseExecArgs(["node", "hub", "exec", "local:Test", "-c"]),
    ).toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("既无 -c 也无文件路径时调用 process.exit(1)", () => {
    expect(() => parseExecArgs(["node", "hub", "exec", "local:Test"])).toThrow(
      "exit",
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// Mock fs for execCommand tests
vi.mock("fs", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("fs");
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(actual.existsSync),
      readFileSync: vi.fn(actual.readFileSync),
    },
    existsSync: vi.fn(actual.existsSync),
    readFileSync: vi.fn(actual.readFileSync),
  };
});

import fs from "fs";

const mockExistsSync = fs.existsSync as unknown as ReturnType<typeof vi.fn>;
const mockReadFileSync = fs.readFileSync as unknown as ReturnType<typeof vi.fn>;

describe("execCommand", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("内联代码执行成功", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, result: 42 }),
    });

    await execCommand({
      studioId: "local:Test",
      code: "return 42",
      mode: "eval",
    });

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("执行成功");
    expect(output).toContain("42");
  });

  it("执行失败显示错误信息", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          success: false,
          error: "Syntax error",
        }),
    });

    await expect(
      execCommand({ studioId: "local:Test", code: "bad code", mode: "eval" }),
    ).rejects.toThrow("process.exit");

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("执行失败"));
  });

  it("执行失败时显示服务端和客户端错误", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          success: false,
          errors: { server: "Server error", client: "Client error" },
        }),
    });

    await expect(
      execCommand({ studioId: "local:Test", code: "x", mode: "eval" }),
    ).rejects.toThrow("process.exit");

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("服务端错误"),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("客户端错误"),
    );
  });

  it("执行成功时显示日志", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          success: true,
          logs: {
            server: ["server log 1"],
            client: ["client log 1"],
          },
        }),
    });

    await execCommand({ studioId: "local:Test", code: "x", mode: "eval" });

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("服务端日志");
    expect(output).toContain("客户端日志");
  });

  it("文件模式：文件不存在时报错退出", async () => {
    mockExistsSync.mockReturnValue(false);

    await expect(
      execCommand({
        studioId: "local:Test",
        filePath: "/nonexistent.lua",
        mode: "eval",
      }),
    ).rejects.toThrow("process.exit");

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("文件不存在"),
    );
  });

  it("文件模式：读取文件并执行", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("return 'from file'");

    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, result: "from file" }),
    });

    await execCommand({
      studioId: "local:Test",
      filePath: "/test.lua",
      mode: "eval",
    });

    expect(globalThis.fetch).toHaveBeenCalled();
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("执行成功");
  });

  it("网络错误时报错退出", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("Connection refused"));

    await expect(
      execCommand({ studioId: "local:Test", code: "x", mode: "eval" }),
    ).rejects.toThrow("process.exit");

    expect(errorSpy).toHaveBeenCalledWith("❌ 请求失败:", "Connection refused");
  });
});

describe("showExecHelp", () => {
  it("输出帮助信息", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    showExecHelp();
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
