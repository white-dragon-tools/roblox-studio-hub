import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseExecArgs } from "./exec.js";

describe("parseExecArgs", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => {
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
    expect(() =>
      parseExecArgs(["node", "hub", "exec"]),
    ).toThrow("exit");
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
    expect(() =>
      parseExecArgs(["node", "hub", "exec", "local:Test"]),
    ).toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
