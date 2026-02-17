import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { discoverPluginTools } from "../hub/pluginDiscovery.js";
import type { PluginToolDef } from "../hub/pluginTypes.js";
import { selectStudio, callStudioMethod } from "./studioSelector.js";
import { loadHubConfig, checkDependencies } from "../hub/hubConfig.js";
import { getPluginsDir } from "../hub/hubPaths.js";

/**
 * 将 plugin.json 的 tool 描述符转换为 MCP Tool 格式
 * 每个 tool 添加可选的 _studioId 参数（多 Studio 场景下指定目标）
 */
function toMcpTools(pluginTools: ReadonlyArray<PluginToolDef>) {
  return pluginTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: {
      type: "object" as const,
      properties: {
        ...tool.inputSchema.properties,
        _studioId: {
          type: "string",
          description:
            "目标 Studio ID（多个 Studio 连接时需要指定，单个 Studio 时可省略）",
        },
      },
      required: tool.inputSchema.required
        ? [...tool.inputSchema.required]
        : undefined,
    },
  }));
}

export interface McpServerOptions {
  readonly pluginTools?: ReadonlyArray<PluginToolDef>;
}

/**
 * 创建并启动 MCP Server（stdio 传输）
 *
 * 静态发现 plugin tools，tool 调用转发到 Hub HTTP API。
 */
export async function startMcpServer(
  options: McpServerOptions = {},
): Promise<Server> {
  const pluginTools = options.pluginTools ?? discoverPluginTools();

  const server = new Server(
    { name: "roblox-studio-hub", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  // tools/list — 返回所有已安装插件的 tool 描述符
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toMcpTools(pluginTools),
  }));

  // tools/call — 转发到 Hub HTTP API
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (!args) {
      return {
        content: [{ type: "text" as const, text: "参数不能为空" }],
        isError: true,
      };
    }

    // 提取并移除 _studioId（不转发给 Studio）
    const { _studioId, ...toolParams } = args as Record<string, unknown>;

    try {
      const studioId = await selectStudio(
        typeof _studioId === "string" ? _studioId : undefined,
      );

      const result = await callStudioMethod(
        studioId,
        name,
        toolParams as Record<string, unknown>,
      );

      if (!result.success) {
        return {
          content: [
            { type: "text" as const, text: result.error ?? "调用失败" },
          ],
          isError: true,
        };
      }

      const text =
        typeof result.result === "string"
          ? result.result
          : JSON.stringify(result.result, null, 2);

      return {
        content: [{ type: "text" as const, text }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: (err as Error).message }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stderr 日志（不能用 console.log，会破坏 stdio JSON-RPC）
  console.error(
    `[MCP] Roblox Studio Hub MCP Server started (${pluginTools.length} tools)`,
  );

  // 检查项目级 hub.json 依赖
  const hubConfig = loadHubConfig(process.cwd());
  if (hubConfig && hubConfig.plugins.dependencies.length > 0) {
    const { missing } = checkDependencies(
      hubConfig.plugins.dependencies,
      getPluginsDir(),
    );
    if (missing.length > 0) {
      console.error(`[MCP] ⚠️  hub.json 依赖未安装: ${missing.join(", ")}`);
    }
  }

  return server;
}
