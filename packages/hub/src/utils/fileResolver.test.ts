import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { pathToFileURL } from "url";
import { resolveFileParams, findToolDescriptor } from "./fileResolver.js";

interface ToolDescriptor {
  readonly name: string;
  readonly inputSchema: {
    readonly type: "object";
    readonly properties?: Readonly<Record<string, Record<string, unknown>>>;
    readonly required?: readonly string[];
  };
}

/** 创建临时文件并返回绝对路径 */
function writeTempFile(content: string, filename?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-file-resolver-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, filename ?? "test.txt");
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe("resolveFileParams", () => {
  it("schema 中没有 x-file 字段时返回参数副本", () => {
    const tool: ToolDescriptor = {
      name: "test",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string" },
        },
      },
    };
    const params = { code: "print('hello')" };

    const result = resolveFileParams(params, tool);

    expect(result).toEqual({ code: "print('hello')" });
    expect(result).not.toBe(params);
  });

  it("x-file 字段的值不以 file:// 开头时返回参数副本（不替换）", () => {
    const tool: ToolDescriptor = {
      name: "test",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", "x-file": true },
        },
      },
    };
    const params = { code: "inline code content" };

    const result = resolveFileParams(params, tool);

    expect(result).toEqual({ code: "inline code content" });
    expect(result).not.toBe(params);
  });

  it("将 file:// URI 替换为文件内容（x-file 字段）", () => {
    const filePath = writeTempFile("-- lua code here\nprint('hello')");
    const fileUri = pathToFileURL(filePath).href;

    const tool: ToolDescriptor = {
      name: "exec",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", "x-file": true },
        },
        required: ["code"],
      },
    };
    const params = { code: fileUri };

    const result = resolveFileParams(params, tool);

    expect(result.code).toBe("-- lua code here\nprint('hello')");
  });

  it("文件不存在时抛出错误", () => {
    const nonexistentPath = path.join(os.tmpdir(), "does-not-exist-12345.txt");
    const fileUri = pathToFileURL(nonexistentPath).href;

    const tool: ToolDescriptor = {
      name: "exec",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", "x-file": true },
        },
      },
    };
    const params = { code: fileUri };

    expect(() => resolveFileParams(params, tool)).toThrow("文件不存在");
  });

  it("不修改原始 params 对象（不可变性）", () => {
    const filePath = writeTempFile("replaced content");
    const fileUri = pathToFileURL(filePath).href;

    const tool: ToolDescriptor = {
      name: "exec",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", "x-file": true },
          name: { type: "string" },
        },
      },
    };
    const params = { code: fileUri, name: "test" };
    const originalCode = params.code;

    const result = resolveFileParams(params, tool);

    // 原对象未被修改
    expect(params.code).toBe(originalCode);
    // 新对象包含替换后的内容
    expect(result.code).toBe("replaced content");
    expect(result).not.toBe(params);
  });

  it("多个 x-file 字段全部解析", () => {
    const filePath1 = writeTempFile("content of file 1", "file1.lua");
    const filePath2 = writeTempFile("content of file 2", "file2.lua");

    const tool: ToolDescriptor = {
      name: "multi",
      inputSchema: {
        type: "object",
        properties: {
          source: { type: "string", "x-file": true },
          config: { type: "string", "x-file": true },
          label: { type: "string" },
        },
      },
    };
    const params = {
      source: pathToFileURL(filePath1).href,
      config: pathToFileURL(filePath2).href,
      label: "not a file",
    };

    const result = resolveFileParams(params, tool);

    expect(result.source).toBe("content of file 1");
    expect(result.config).toBe("content of file 2");
    expect(result.label).toBe("not a file");
  });
});

describe("findToolDescriptor", () => {
  const tools: ReadonlyArray<ToolDescriptor> = [
    { name: "execute", inputSchema: { type: "object", properties: { code: { type: "string" } } } },
    { name: "getInfo", inputSchema: { type: "object" } },
  ];

  it("按名称查找 tool 描述符", () => {
    const found = findToolDescriptor(tools, "execute");

    expect(found).toBeDefined();
    expect(found!.name).toBe("execute");
    expect(found!.inputSchema.properties).toHaveProperty("code");
  });

  it("找不到时返回 undefined", () => {
    const found = findToolDescriptor(tools, "nonexistent");

    expect(found).toBeUndefined();
  });
});
