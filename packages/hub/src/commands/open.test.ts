import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseOpenArgs } from "./open.js";

describe("parseOpenArgs", () => {
  let exitMock: ReturnType<typeof vi.spyOn>;
  let consoleErrorMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitMock = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    consoleErrorMock = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
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
});
