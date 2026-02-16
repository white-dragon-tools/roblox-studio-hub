import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getHubBaseUrl,
  selectStudio,
  callStudioMethod,
} from "./studioSelector.js";

describe("studioSelector", () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env.STUDIO_HUB_PORT;

  beforeEach(() => {
    // 重置环境变量
    delete process.env.STUDIO_HUB_PORT;
  });

  afterEach(() => {
    // 恢复原始 fetch 和环境变量
    global.fetch = originalFetch;
    if (originalEnv !== undefined) {
      process.env.STUDIO_HUB_PORT = originalEnv;
    } else {
      delete process.env.STUDIO_HUB_PORT;
    }
  });

  describe("getHubBaseUrl", () => {
    it("返回默认端口的 URL", () => {
      expect(getHubBaseUrl()).toBe("http://localhost:35888");
    });
  });

  describe("selectStudio", () => {
    it("当没有连接的 Studio 时抛出错误", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ studios: [] }),
      });

      await expect(selectStudio()).rejects.toThrow(
        "没有连接的 Studio。请先使用 'roblox-studio-hub open <place.rbxl>' 打开 Studio。",
      );
    });

    it("当只有一个 Studio 时自动选择", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          studios: [{ id: "studio-1", placeName: "Test Place", type: "local" }],
        }),
      });

      const result = await selectStudio();
      expect(result).toBe("studio-1");
    });

    it("多个 Studio 时使用有效的 studioId 返回对应 Studio", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          studios: [
            { id: "studio-1", placeName: "Place 1", type: "local" },
            {
              id: "studio-2",
              placeName: "Place 2",
              type: "place",
              placeId: 123,
            },
          ],
        }),
      });

      const result = await selectStudio("studio-2");
      expect(result).toBe("studio-2");
    });

    it("多个 Studio 时使用无效的 studioId 抛出错误并列出可用 Studio", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          studios: [
            { id: "studio-1", placeName: "Place 1", type: "local" },
            {
              id: "studio-2",
              placeName: "Place 2",
              type: "place",
              placeId: 123,
            },
          ],
        }),
      });

      await expect(selectStudio("invalid-id")).rejects.toThrow(
        'Studio "invalid-id" 不存在。可用的 Studio:\n  - studio-1 (Place 1)\n  - studio-2 (Place 2)',
      );
    });

    it("多个 Studio 时未指定 studioId 抛出错误并列出可用 Studio", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          studios: [
            { id: "studio-1", placeName: "Place 1", type: "local" },
            {
              id: "studio-2",
              placeName: "Place 2",
              type: "place",
              placeId: 123,
            },
          ],
        }),
      });

      await expect(selectStudio()).rejects.toThrow(
        "多个 Studio 连接中，请通过 _studioId 参数指定目标:\n  - studio-1 (Place 1)\n  - studio-2 (Place 2)",
      );
    });

    it("当 Hub API 请求失败时抛出错误", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      await expect(selectStudio()).rejects.toThrow(
        "Hub API 请求失败: 500 Internal Server Error",
      );
    });
  });

  describe("callStudioMethod", () => {
    it("发送正确的请求并返回结果", async () => {
      const mockResult = { success: true, result: { value: 42 } };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResult,
      });

      const result = await callStudioMethod(
        "studio-1",
        "testMethod",
        { param1: "value1" },
        30,
      );

      expect(result).toEqual(mockResult);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:35888/api/studios/studio-1/call",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            method: "testMethod",
            params: { param1: "value1" },
            timeout: 30,
          }),
        },
      );
    });

    it("使用默认超时时间", async () => {
      const mockResult = { success: true, result: {} };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResult,
      });

      await callStudioMethod("studio-1", "testMethod", {});

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            method: "testMethod",
            params: {},
            timeout: 30,
          }),
        }),
      );
    });

    it("正确编码 studioId 中的特殊字符", async () => {
      const mockResult = { success: true };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResult,
      });

      await callStudioMethod("studio/with/slashes", "method", {});

      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:35888/api/studios/studio%2Fwith%2Fslashes/call",
        expect.any(Object),
      );
    });

    it("当响应不成功且有错误消息时抛出错误", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: "Studio not found" }),
      });

      await expect(
        callStudioMethod("studio-1", "testMethod", {}),
      ).rejects.toThrow("Studio not found");
    });

    it("当响应不成功且没有错误消息时抛出默认错误", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      });

      await expect(
        callStudioMethod("studio-1", "testMethod", {}),
      ).rejects.toThrow("Hub API 调用失败: 500");
    });

    it("当响应不成功且 JSON 解析失败时抛出默认错误", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      });

      await expect(
        callStudioMethod("studio-1", "testMethod", {}),
      ).rejects.toThrow("Hub API 调用失败: 500");
    });

    it("返回失败结果时保持原样", async () => {
      const mockResult = {
        success: false,
        error: "Method execution failed",
      };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResult,
      });

      const result = await callStudioMethod("studio-1", "testMethod", {});
      expect(result).toEqual(mockResult);
    });
  });
});
