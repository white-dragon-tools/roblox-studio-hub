import fs from "fs";
import { fileURLToPath } from "url";

/**
 * tool 描述符的最小接口，兼容 PluginTool 和 MethodDescriptor
 */
interface ToolDescriptor {
  readonly name: string;
  readonly inputSchema: {
    readonly type: "object";
    readonly properties?: Readonly<Record<string, Record<string, unknown>>>;
    readonly required?: readonly string[];
  };
}

/**
 * 从 tool 的 inputSchema 中找出所有标记了 x-file: true 的字段名
 */
function getFileFields(
  schema: ToolDescriptor["inputSchema"],
): ReadonlyArray<string> {
  const properties = schema.properties;
  if (!properties) return [];

  return Object.entries(properties)
    .filter(([, prop]) => prop["x-file"] === true)
    .map(([key]) => key);
}

/**
 * 解析 file:// URI 为本地文件路径并读取内容
 * 支持: file:///absolute/path 和 file://relative/path
 */
function readFileUri(uri: string): string {
  if (!uri.startsWith("file://")) {
    throw new Error(`无效的 file URI: ${uri}`);
  }

  let filePath: string;
  try {
    // file:///absolute/path → /absolute/path
    filePath = fileURLToPath(uri);
  } catch {
    // fallback: strip file:// prefix for relative paths
    filePath = uri.slice(7);
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`文件不存在: ${filePath}`);
  }

  return fs.readFileSync(filePath, "utf-8");
}

/**
 * 根据 tool 的 inputSchema 解析参数中的 file:// URI
 * 找到标记了 x-file: true 的字段，如果值以 file:// 开头，替换为文件内容
 *
 * @returns 新的参数对象（不修改原对象）
 */
export function resolveFileParams(
  params: Readonly<Record<string, unknown>>,
  tool: ToolDescriptor,
): Record<string, unknown> {
  const fileFields = getFileFields(tool.inputSchema);
  if (fileFields.length === 0) return { ...params };

  const resolved = { ...params };

  for (const field of fileFields) {
    const value = resolved[field];
    if (typeof value === "string" && value.startsWith("file://")) {
      resolved[field] = readFileUri(value);
    }
  }

  return resolved;
}

/**
 * 从 plugin.json 的 tools 数组中查找指定方法的 tool 描述符
 */
export function findToolDescriptor(
  tools: ReadonlyArray<ToolDescriptor>,
  methodName: string,
): ToolDescriptor | undefined {
  return tools.find((t) => t.name === methodName);
}
