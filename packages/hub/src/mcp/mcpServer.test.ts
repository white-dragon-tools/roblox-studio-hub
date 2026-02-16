import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PluginToolDef } from "../hub/pluginTypes.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Mock 依赖 - 必须在顶层
vi.mock("@modelcontextprotocol/sdk/server/index.js", () => ({
  Server: vi.fn(function (this: {
    setRequestHandler: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
  }) {
    this.setRequestHandler = vi.fn();
    this.connect = vi.fn();
    return this;
  }),
}));

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: vi.fn(function (this: object) {
    return this;
  }),
}));

vi.mock("../hub/pluginDiscovery.js");
vi.mock("./studioSelector.js");

// 导入 mocked 模块
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { discoverPluginTools } from "../hub/pluginDiscovery.js";
import { selectStudio, callStudioMethod } from "./studioSelector.js";

// 辅助函数：从 mock 调用中获取注册的 handlers
function getHandlers() {
  const serverMock = vi.mocked(Server);
  const lastServerInstance =
    serverMock.mock.results[serverMock.mock.results.length - 1]?.value;

  if (!lastServerInstance || !lastServerInstance.setRequestHandler) {
    return { listToolsHandler: null, callToolHandler: null };
  }

  const setRequestHandlerMock =
    lastServerInstance.setRequestHandler as ReturnType<typeof vi.fn>;
  const calls = setRequestHandlerMock.mock.calls;

  let listToolsHandler: ((request: unknown) => Promise<unknown>) | null = null;
  let callToolHandler: ((request: unknown) => Promise<unknown>) | null = null;

  for (const call of calls) {
    const schema = call[0];
    const handler = call[1] as (request: unknown) => Promise<unknown>;

    // 使用导入的 schema 对象进行比较
    if (schema === ListToolsRequestSchema) {
      listToolsHandler = handler;
    } else if (schema === CallToolRequestSchema) {
      callToolHandler = handler;
    }
  }

  return { listToolsHandler, callToolHandler };
}

describe("mcpServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // 配置 mocked 函数默认值
    vi.mocked(discoverPluginTools).mockReturnValue([]);
    vi.mocked(selectStudio).mockResolvedValue("test-studio-id");
    vi.mocked(callStudioMethod).mockResolvedValue({
      success: true,
      result: "ok",
    });
  });

  describe("startMcpServer", () => {
    it("应创建 Server 并传入正确的 name/version 和 capabilities", async () => {
      vi.resetModules();
      const { startMcpServer } = await import("./mcpServer.js");

      await startMcpServer();

      expect(Server).toHaveBeenCalledWith(
        { name: "roblox-studio-hub", version: "1.0.0" },
        { capabilities: { tools: {} } },
      );
    });

    it("应连接到 StdioServerTransport", async () => {
      vi.resetModules();
      const { startMcpServer } = await import("./mcpServer.js");

      await startMcpServer();

      expect(StdioServerTransport).toHaveBeenCalled();
      // 获取最新的 Server 实例
      const serverMock = vi.mocked(Server);
      const serverInstance =
        serverMock.mock.results[serverMock.mock.results.length - 1]?.value;
      expect(serverInstance?.connect).toHaveBeenCalled();
    });

    it("应返回创建的 server 实例", async () => {
      vi.resetModules();
      const { startMcpServer } = await import("./mcpServer.js");

      const result = await startMcpServer();

      expect(result).toHaveProperty("setRequestHandler");
      expect(result).toHaveProperty("connect");
    });

    it("应使用 options.pluginTools 如果提供", async () => {
      vi.resetModules();
      const { startMcpServer } = await import("./mcpServer.js");
      const mockTools: PluginToolDef[] = [
        {
          name: "testTool",
          description: "Test tool",
          inputSchema: {
            type: "object",
            properties: { foo: { type: "string" } },
          },
        },
      ];

      await startMcpServer({ pluginTools: mockTools });

      // 不应调用 discoverPluginTools
      expect(discoverPluginTools).not.toHaveBeenCalled();

      // 验证 ListTools handler 返回了传入的 tools
      const { listToolsHandler } = getHandlers();
      expect(listToolsHandler).not.toBeNull();
      if (listToolsHandler) {
        const result = await listToolsHandler({});
        expect(result).toEqual({
          tools: [
            {
              name: "testTool",
              description: "Test tool",
              inputSchema: {
                type: "object",
                properties: {
                  foo: { type: "string" },
                  _studioId: {
                    type: "string",
                    description:
                      "目标 Studio ID（多个 Studio 连接时需要指定，单个 Studio 时可省略）",
                  },
                },
                required: undefined,
              },
            },
          ],
        });
      }
    });

    it("应使用 discoverPluginTools() 如果未提供 pluginTools", async () => {
      vi.resetModules();
      const { startMcpServer } = await import("./mcpServer.js");
      const mockTools: PluginToolDef[] = [
        {
          name: "discoveredTool",
          description: "Discovered tool",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
      ];
      vi.mocked(discoverPluginTools).mockReturnValue(mockTools);

      await startMcpServer();

      expect(discoverPluginTools).toHaveBeenCalled();
    });
  });

  describe("ListTools handler", () => {
    it("应返回所有 plugin tools，每个都添加了 _studioId 参数", async () => {
      vi.resetModules();
      const { startMcpServer } = await import("./mcpServer.js");
      const mockTools: PluginToolDef[] = [
        {
          name: "tool1",
          description: "Tool 1",
          inputSchema: {
            type: "object",
            properties: { a: { type: "string" } },
            required: ["a"],
          },
        },
        {
          name: "tool2",
          description: "Tool 2",
          inputSchema: {
            type: "object",
            properties: { b: { type: "number" } },
          },
        },
      ];

      await startMcpServer({ pluginTools: mockTools });

      const { listToolsHandler } = getHandlers();
      expect(listToolsHandler).not.toBeNull();
      if (listToolsHandler) {
        const result = await listToolsHandler({});
        expect(result).toEqual({
          tools: [
            {
              name: "tool1",
              description: "Tool 1",
              inputSchema: {
                type: "object",
                properties: {
                  a: { type: "string" },
                  _studioId: {
                    type: "string",
                    description:
                      "目标 Studio ID（多个 Studio 连接时需要指定，单个 Studio 时可省略）",
                  },
                },
                required: ["a"],
              },
            },
            {
              name: "tool2",
              description: "Tool 2",
              inputSchema: {
                type: "object",
                properties: {
                  b: { type: "number" },
                  _studioId: {
                    type: "string",
                    description:
                      "目标 Studio ID（多个 Studio 连接时需要指定，单个 Studio 时可省略）",
                  },
                },
                required: undefined,
              },
            },
          ],
        });
      }
    });

    it("应处理空 tools 数组", async () => {
      vi.resetModules();
      const { startMcpServer } = await import("./mcpServer.js");

      await startMcpServer({ pluginTools: [] });

      const { listToolsHandler } = getHandlers();
      expect(listToolsHandler).not.toBeNull();
      if (listToolsHandler) {
        const result = await listToolsHandler({});
        expect(result).toEqual({ tools: [] });
      }
    });

    it("应保留原始 tool 的 required 数组（不包含 _studioId）", async () => {
      vi.resetModules();
      const { startMcpServer } = await import("./mcpServer.js");
      const mockTools: PluginToolDef[] = [
        {
          name: "tool",
          description: "Tool",
          inputSchema: {
            type: "object",
            properties: { x: { type: "string" }, y: { type: "number" } },
            required: ["x", "y"],
          },
        },
      ];

      await startMcpServer({ pluginTools: mockTools });

      const { listToolsHandler } = getHandlers();
      if (listToolsHandler) {
        const result = await listToolsHandler({});
        const tool = (
          result as { tools: Array<{ inputSchema: { required?: string[] } }> }
        ).tools[0];
        expect(tool.inputSchema.required).toEqual(["x", "y"]);
      }
    });
  });

  describe("CallTool handler", () => {
    beforeEach(async () => {
      // 不要 resetModules，因为这会清除 Server mock 历史
      const { startMcpServer } = await import("./mcpServer.js");
      await startMcpServer({ pluginTools: [] });
    });

    it("应在 args 为空时返回错误", async () => {
      const { callToolHandler } = getHandlers();
      expect(callToolHandler).not.toBeNull();
      if (callToolHandler) {
        const result = await callToolHandler({
          params: { name: "testTool", arguments: undefined },
        });

        expect(result).toEqual({
          content: [{ type: "text", text: "参数不能为空" }],
          isError: true,
        });
      }
    });

    it("应调用 selectStudio 并传入 _studioId", async () => {
      vi.mocked(selectStudio).mockResolvedValue("selected-studio");
      vi.mocked(callStudioMethod).mockResolvedValue({
        success: true,
        result: "result",
      });

      const { callToolHandler } = getHandlers();
      if (callToolHandler) {
        await callToolHandler({
          params: {
            name: "testTool",
            arguments: { _studioId: "my-studio", param1: "value1" },
          },
        });

        expect(selectStudio).toHaveBeenCalledWith("my-studio");
      }
    });

    it("应在未提供 _studioId 时调用 selectStudio(undefined)", async () => {
      const { callToolHandler } = getHandlers();
      if (callToolHandler) {
        await callToolHandler({
          params: {
            name: "testTool",
            arguments: { param1: "value1" },
          },
        });

        expect(selectStudio).toHaveBeenCalledWith(undefined);
      }
    });

    it("应调用 callStudioMethod 并移除 _studioId 参数", async () => {
      vi.mocked(selectStudio).mockResolvedValue("studio-123");
      vi.mocked(callStudioMethod).mockResolvedValue({
        success: true,
        result: "ok",
      });

      const { callToolHandler } = getHandlers();
      if (callToolHandler) {
        await callToolHandler({
          params: {
            name: "myTool",
            arguments: {
              _studioId: "studio-123",
              param1: "value1",
              param2: 42,
            },
          },
        });

        expect(callStudioMethod).toHaveBeenCalledWith("studio-123", "myTool", {
          param1: "value1",
          param2: 42,
        });
      }
    });

    it("应在 callStudioMethod 成功时返回字符串结果", async () => {
      vi.mocked(callStudioMethod).mockResolvedValue({
        success: true,
        result: "Hello, world!",
      });

      const { callToolHandler } = getHandlers();
      if (callToolHandler) {
        const result = await callToolHandler({
          params: {
            name: "testTool",
            arguments: { foo: "bar" },
          },
        });

        expect(result).toEqual({
          content: [{ type: "text", text: "Hello, world!" }],
        });
      }
    });

    it("应在 callStudioMethod 返回对象结果时 JSON 序列化", async () => {
      vi.mocked(callStudioMethod).mockResolvedValue({
        success: true,
        result: { data: "value", count: 42 },
      });

      const { callToolHandler } = getHandlers();
      if (callToolHandler) {
        const result = await callToolHandler({
          params: {
            name: "testTool",
            arguments: { foo: "bar" },
          },
        });

        expect(result).toEqual({
          content: [
            {
              type: "text",
              text: JSON.stringify({ data: "value", count: 42 }, null, 2),
            },
          ],
        });
      }
    });

    it("应在 callStudioMethod 返回 success:false 时返回错误", async () => {
      vi.mocked(callStudioMethod).mockResolvedValue({
        success: false,
        error: "Method not found",
      });

      const { callToolHandler } = getHandlers();
      if (callToolHandler) {
        const result = await callToolHandler({
          params: {
            name: "unknownTool",
            arguments: { foo: "bar" },
          },
        });

        expect(result).toEqual({
          content: [{ type: "text", text: "Method not found" }],
          isError: true,
        });
      }
    });

    it("应在 callStudioMethod 返回 success:false 但无 error 时使用默认错误消息", async () => {
      vi.mocked(callStudioMethod).mockResolvedValue({
        success: false,
      });

      const { callToolHandler } = getHandlers();
      if (callToolHandler) {
        const result = await callToolHandler({
          params: {
            name: "failingTool",
            arguments: {},
          },
        });

        expect(result).toEqual({
          content: [{ type: "text", text: "调用失败" }],
          isError: true,
        });
      }
    });

    it("应在 selectStudio 抛出异常时返回错误", async () => {
      vi.mocked(selectStudio).mockRejectedValue(
        new Error("No studios connected"),
      );

      const { callToolHandler } = getHandlers();
      if (callToolHandler) {
        const result = await callToolHandler({
          params: {
            name: "testTool",
            arguments: { foo: "bar" },
          },
        });

        expect(result).toEqual({
          content: [{ type: "text", text: "No studios connected" }],
          isError: true,
        });
      }
    });

    it("应在 callStudioMethod 抛出异常时返回错误", async () => {
      vi.mocked(callStudioMethod).mockRejectedValue(
        new Error("Network timeout"),
      );

      const { callToolHandler } = getHandlers();
      if (callToolHandler) {
        const result = await callToolHandler({
          params: {
            name: "testTool",
            arguments: { foo: "bar" },
          },
        });

        expect(result).toEqual({
          content: [{ type: "text", text: "Network timeout" }],
          isError: true,
        });
      }
    });

    it("应处理 _studioId 为非字符串类型", async () => {
      // _studioId 不是字符串，应传 undefined 给 selectStudio
      const { callToolHandler } = getHandlers();
      if (callToolHandler) {
        await callToolHandler({
          params: {
            name: "testTool",
            arguments: { _studioId: 123, foo: "bar" },
          },
        });

        expect(selectStudio).toHaveBeenCalledWith(undefined);
        // 123 应被移除，不转发到 callStudioMethod
        expect(callStudioMethod).toHaveBeenCalledWith(
          "test-studio-id",
          "testTool",
          { foo: "bar" },
        );
      }
    });

    it("应处理复杂的 tool 参数", async () => {
      vi.mocked(callStudioMethod).mockResolvedValue({
        success: true,
        result: { status: "done" },
      });

      const { callToolHandler } = getHandlers();
      if (callToolHandler) {
        await callToolHandler({
          params: {
            name: "complexTool",
            arguments: {
              _studioId: "studio-1",
              nested: { foo: "bar", arr: [1, 2, 3] },
              flag: true,
              num: 3.14,
            },
          },
        });

        expect(callStudioMethod).toHaveBeenCalledWith(
          "test-studio-id",
          "complexTool",
          {
            nested: { foo: "bar", arr: [1, 2, 3] },
            flag: true,
            num: 3.14,
          },
        );
      }
    });
  });
});
