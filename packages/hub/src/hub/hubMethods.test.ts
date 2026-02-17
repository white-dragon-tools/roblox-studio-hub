import { describe, it, expect, vi, beforeEach } from "vitest";
import { isHubMethod, executeHubMethod } from "./hubMethods.js";
import type { StudioInstance } from "../types.js";

/**
 * promisify(execFile) 依赖 execFile[util.promisify.custom] 返回 { stdout, stderr }。
 * 直接 mock callback 版 execFile 无法正确工作。
 * 方案：通过 promisify.custom 提供 mock 的 async 版本。
 */
const mockExecFileAsync = vi.hoisted(() => vi.fn());
vi.mock("child_process", async () => {
  const { promisify } = await import("util");
  const fn = vi.fn();
  (fn as unknown as Record<symbol, unknown>)[promisify.custom] =
    mockExecFileAsync;
  return { execFile: fn };
});

function makeStudio(overrides: Partial<StudioInstance> = {}): StudioInstance {
  return {
    id: "path:/test/game.rbxl",
    type: "local",
    placeName: "game.rbxl",
    connectedAt: new Date(),
    lastHeartbeat: Date.now(),
    logs: [],
    methods: [],
    gameState: "edit",
    localPath: "/test/game.rbxl",
    ...overrides,
  };
}

function mockRspoSuccess(result: { success: boolean; message: string }) {
  mockExecFileAsync.mockResolvedValue({
    stdout: JSON.stringify(result),
    stderr: "",
  });
}

function mockRspoError(errorMessage: string) {
  mockExecFileAsync.mockRejectedValue(new Error(errorMessage));
}

describe("hubMethods", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isHubMethod", () => {
    it("应当识别 startGame 为 Hub 方法", () => {
      expect(isHubMethod("startGame")).toBe(true);
    });

    it("应当识别 stopGame 为 Hub 方法", () => {
      expect(isHubMethod("stopGame")).toBe(true);
    });

    it("应当不识别普通方法", () => {
      expect(isHubMethod("execute")).toBe(false);
      expect(isHubMethod("getStudioInfo")).toBe(false);
      expect(isHubMethod("unknown")).toBe(false);
    });
  });

  describe("executeHubMethod", () => {
    it("应当执行 startGame", async () => {
      mockRspoSuccess({ success: true, message: "Game started" });

      const result = await executeHubMethod("startGame", {}, makeStudio());

      expect(result.success).toBe(true);
      expect(result.result).toBe("Game started");
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        "npx",
        ["rspo", "game", "start", "/test/game.rbxl"],
        expect.objectContaining({ timeout: 90_000 }),
      );
    });

    it("应当执行 stopGame", async () => {
      mockRspoSuccess({ success: true, message: "Game stopped" });

      const result = await executeHubMethod(
        "stopGame",
        {},
        makeStudio({ gameState: "play" }),
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe("Game stopped");
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        "npx",
        ["rspo", "game", "stop", "/test/game.rbxl"],
        expect.objectContaining({ timeout: 90_000 }),
      );
    });

    it("应当在 Studio 没有 localPath 时返回错误", async () => {
      const result = await executeHubMethod(
        "startGame",
        {},
        makeStudio({ localPath: undefined }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("localPath");
      expect(mockExecFileAsync).not.toHaveBeenCalled();
    });

    it("应当处理 rspo 返回失败", async () => {
      mockRspoSuccess({ success: false, message: "Studio not found" });

      const result = await executeHubMethod("startGame", {}, makeStudio());

      expect(result.success).toBe(false);
      expect(result.error).toBe("Studio not found");
    });

    it("应当处理 rspo 执行异常", async () => {
      mockRspoError("rspo crash");

      const result = await executeHubMethod("startGame", {}, makeStudio());

      expect(result.success).toBe(false);
      expect(result.error).toContain("rspo crash");
    });

    it("应当返回未知方法错误", async () => {
      const result = await executeHubMethod(
        "unknownHubMethod",
        {},
        makeStudio(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown hub method");
    });
  });
});
