import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseOpenArgs, openStudio, showOpenHelp } from "./open.js";

// Mock injectRuntime
vi.mock("../utils/injectRuntime.js", () => ({
  injectRuntime: vi.fn(),
}));

// Mock fs
vi.mock("fs", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("fs");
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(actual.existsSync),
    },
    existsSync: vi.fn(actual.existsSync),
  };
});

import { injectRuntime } from "../utils/injectRuntime.js";
import fs from "fs";

const mockInjectRuntime = injectRuntime as unknown as ReturnType<typeof vi.fn>;
const mockExistsSync = fs.existsSync as unknown as ReturnType<typeof vi.fn>;

describe("parseOpenArgs", () => {
  let exitMock: ReturnType<typeof vi.spyOn>;
  let consoleErrorMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitMock = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    consoleErrorMock = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    exitMock.mockRestore();
    consoleErrorMock.mockRestore();
  });

  it("解析基本的 place 参数", () => {
    const result = parseOpenArgs(["node", "hub", "open", "game.rbxl"]);
    expect(result).toEqual({
      placeArg: "game.rbxl",
      pluginDirs: [],
    });
  });

  it("支持 --plugin-dir 长参数", () => {
    const result = parseOpenArgs([
      "node",
      "hub",
      "open",
      "--plugin-dir",
      "./plugins",
      "game.rbxl",
    ]);
    expect(result).toEqual({
      placeArg: "game.rbxl",
      pluginDirs: ["./plugins"],
    });
  });

  it("支持 -p 短参数", () => {
    const result = parseOpenArgs([
      "node",
      "hub",
      "open",
      "-p",
      "./my-plugins",
      "game.rbxl",
    ]);
    expect(result).toEqual({
      placeArg: "game.rbxl",
      pluginDirs: ["./my-plugins"],
    });
  });

  it("支持多个 --plugin-dir 参数", () => {
    const result = parseOpenArgs([
      "node",
      "hub",
      "open",
      "--plugin-dir",
      "./plugins-a",
      "-p",
      "./plugins-b",
      "--plugin-dir",
      "./plugins-c",
      "game.rbxl",
    ]);
    expect(result).toEqual({
      placeArg: "game.rbxl",
      pluginDirs: ["./plugins-a", "./plugins-b", "./plugins-c"],
    });
  });

  it("支持 --plugin-dir=value 语法", () => {
    const result = parseOpenArgs([
      "node",
      "hub",
      "open",
      "--plugin-dir=./plugins",
      "game.rbxl",
    ]);
    expect(result).toEqual({
      placeArg: "game.rbxl",
      pluginDirs: ["./plugins"],
    });
  });

  it("混合参数和 place 路径", () => {
    const result = parseOpenArgs([
      "node",
      "hub",
      "open",
      "--plugin-dir",
      "./plugins-a",
      "game.rbxl",
      "--plugin-dir=./plugins-b",
    ]);
    expect(result).toEqual({
      placeArg: "game.rbxl",
      pluginDirs: ["./plugins-a", "./plugins-b"],
    });
  });

  it("无 place 参数时返回空字符串", () => {
    const result = parseOpenArgs([
      "node",
      "hub",
      "open",
      "--plugin-dir",
      "./plugins",
    ]);
    expect(result).toEqual({
      placeArg: "",
      pluginDirs: ["./plugins"],
    });
  });

  it("无任何参数时返回空值", () => {
    const result = parseOpenArgs(["node", "hub", "open"]);
    expect(result).toEqual({
      placeArg: "",
      pluginDirs: [],
    });
  });

  it("--plugin-dir 缺少值时调用 process.exit", () => {
    expect(() => {
      parseOpenArgs(["node", "hub", "open", "--plugin-dir"]);
    }).toThrow("process.exit called");

    expect(exitMock).toHaveBeenCalledWith(1);
    expect(consoleErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("--plugin-dir 需要指定目录路径"),
    );
  });

  it("-p 缺少值时调用 process.exit", () => {
    expect(() => {
      parseOpenArgs(["node", "hub", "open", "-p"]);
    }).toThrow("process.exit called");

    expect(exitMock).toHaveBeenCalledWith(1);
    expect(consoleErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("-p 需要指定目录路径"),
    );
  });

  it("忽略未知的 flag 参数", () => {
    const result = parseOpenArgs([
      "node",
      "hub",
      "open",
      "--unknown-flag",
      "game.rbxl",
    ]);
    expect(result).toEqual({
      placeArg: "game.rbxl",
      pluginDirs: [],
    });
  });

  it("place 参数可以是绝对路径", () => {
    const result = parseOpenArgs([
      "node",
      "hub",
      "open",
      "/absolute/path/game.rbxl",
    ]);
    expect(result).toEqual({
      placeArg: "/absolute/path/game.rbxl",
      pluginDirs: [],
    });
  });

  it("plugin-dir 可以是绝对路径", () => {
    const result = parseOpenArgs([
      "node",
      "hub",
      "open",
      "--plugin-dir",
      "/absolute/plugins",
      "game.rbxl",
    ]);
    expect(result).toEqual({
      placeArg: "game.rbxl",
      pluginDirs: ["/absolute/plugins"],
    });
  });

  it("多个非 flag 参数时取最后一个作为 place", () => {
    const result = parseOpenArgs([
      "node",
      "hub",
      "open",
      "first.rbxl",
      "second.rbxl",
    ]);
    expect(result).toEqual({
      placeArg: "second.rbxl",
      pluginDirs: [],
    });
  });

  // --port tests
  it("解析 --port 参数", () => {
    const result = parseOpenArgs([
      "node",
      "hub",
      "open",
      "--port",
      "12345",
      "game.rbxl",
    ]);
    expect(result).toEqual({
      placeArg: "game.rbxl",
      pluginDirs: [],
      port: 12345,
    });
  });

  it("支持 --port=value 语法", () => {
    const result = parseOpenArgs([
      "node",
      "hub",
      "open",
      "--port=9999",
      "game.rbxl",
    ]);
    expect(result).toEqual({
      placeArg: "game.rbxl",
      pluginDirs: [],
      port: 9999,
    });
  });

  it("--port 缺少值时调用 process.exit", () => {
    expect(() => {
      parseOpenArgs(["node", "hub", "open", "--port"]);
    }).toThrow("process.exit called");

    expect(exitMock).toHaveBeenCalledWith(1);
    expect(consoleErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("--port 需要指定端口号"),
    );
  });

  it("--port 值非数字时调用 process.exit", () => {
    expect(() => {
      parseOpenArgs(["node", "hub", "open", "--port", "abc", "game.rbxl"]);
    }).toThrow("process.exit called");

    expect(exitMock).toHaveBeenCalledWith(1);
    expect(consoleErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("--port 值必须是数字"),
    );
  });

  it("--port=value 值非数字时调用 process.exit", () => {
    expect(() => {
      parseOpenArgs(["node", "hub", "open", "--port=abc", "game.rbxl"]);
    }).toThrow("process.exit called");

    expect(exitMock).toHaveBeenCalledWith(1);
    expect(consoleErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("--port 值必须是数字"),
    );
  });

  it("不传 --port 时 port 为 undefined", () => {
    const result = parseOpenArgs(["node", "hub", "open", "game.rbxl"]);
    expect(result.port).toBeUndefined();
  });

  it("--port 与 --plugin-dir 混合使用", () => {
    const result = parseOpenArgs([
      "node",
      "hub",
      "open",
      "--plugin-dir",
      "./plugins",
      "--port",
      "8080",
      "game.rbxl",
    ]);
    expect(result).toEqual({
      placeArg: "game.rbxl",
      pluginDirs: ["./plugins"],
      port: 8080,
    });
  });
});

describe("openStudio", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitMock = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("缺少 place 路径时报错退出", async () => {
    await expect(openStudio({ placeArg: "", pluginDirs: [] })).rejects.toThrow(
      "process.exit called",
    );

    expect(exitMock).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("缺少 place 文件路径"),
    );
  });

  it("文件不存在时报错退出", async () => {
    mockExistsSync.mockReturnValue(false);

    await expect(
      openStudio({ placeArg: "/nonexistent.rbxl", pluginDirs: [] }),
    ).rejects.toThrow("process.exit called");

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("文件不存在"),
    );
  });

  it("插件目录不存在时报错退出", async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (typeof p === "string" && p.endsWith(".rbxl")) return true;
      return false; // plugin dir doesn't exist
    });

    await expect(
      openStudio({
        placeArg: "/game.rbxl",
        pluginDirs: ["/nonexistent-plugins"],
      }),
    ).rejects.toThrow("process.exit called");

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("插件目录不存在"),
    );
  });

  it("成功注入并打开 Studio", async () => {
    mockExistsSync.mockReturnValue(true);
    mockInjectRuntime.mockResolvedValue(undefined);

    // Mock the dynamic import of physical-operation
    vi.mock(
      "@white-dragon-tools/roblox-studio-physical-operation/studio-manager",
      () => ({
        openPlace: vi.fn().mockResolvedValue([true, "Place opened"]),
      }),
    );

    await openStudio({ placeArg: "/game.rbxl", pluginDirs: [] });

    expect(mockInjectRuntime).toHaveBeenCalledWith(
      expect.stringContaining("game.rbxl"),
      expect.objectContaining({ extraPluginDirs: [] }),
    );

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("注入 Runtime");
    expect(output).toContain("Runtime 注入成功");
  });

  it("注入失败时报错退出", async () => {
    mockExistsSync.mockReturnValue(true);
    mockInjectRuntime.mockRejectedValue(new Error("Inject failed"));

    await expect(
      openStudio({ placeArg: "/game.rbxl", pluginDirs: [] }),
    ).rejects.toThrow("process.exit called");

    expect(errorSpy).toHaveBeenCalledWith("❌ 操作失败:", "Inject failed");
  });
});

describe("showOpenHelp", () => {
  it("输出帮助信息", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    showOpenHelp();
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
