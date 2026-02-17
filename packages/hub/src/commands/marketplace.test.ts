import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  marketplaceAdd,
  marketplaceRemove,
  marketplaceList,
  searchInMarketplaces,
  searchAllMarketplaces,
  showMarketplaceHelp,
} from "./marketplace.js";

// Mock child_process
const mockExecSync = vi.fn();
vi.mock("child_process", () => ({
  execSync: mockExecSync,
}));

// Mock process.exit
const mockExit = vi.spyOn(process, "exit").mockImplementation((code) => {
  throw new Error(`process.exit(${code})`);
});

// Mock console methods
const mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
const mockConsoleError = vi
  .spyOn(console, "error")
  .mockImplementation(() => {});
const mockConsoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

describe("marketplace CLI commands", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    // 创建临时目录用于测试
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-test-"));
    originalCwd = process.cwd();

    // 切换到临时目录，使 detectHubRoot() 找到 .local-hub/
    const localHub = path.join(tmpDir, ".local-hub");
    fs.mkdirSync(localHub, { recursive: true });
    process.chdir(tmpDir);

    // 清空所有 mock 调用记录
    vi.clearAllMocks();
  });

  afterEach(() => {
    // 恢复工作目录
    process.chdir(originalCwd);

    // 清理临时目录
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("marketplaceAdd", () => {
    it("应当拒绝无效格式（不包含 /）", async () => {
      await expect(marketplaceAdd("invalid-format")).rejects.toThrow(
        "process.exit(1)",
      );

      expect(mockConsoleError).toHaveBeenCalledWith(
        "❌ 无效的 marketplace 格式，应为 owner/repo",
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("应当检测已存在的 marketplace 并返回", async () => {
      const ownerRepo = "test/marketplace";
      const configPath = path.join(tmpDir, ".local-hub", "marketplaces.json");

      // 预先写入已存在的 marketplace
      fs.writeFileSync(
        configPath,
        JSON.stringify({ marketplaces: [ownerRepo] }, null, 2),
      );

      await marketplaceAdd(ownerRepo);

      expect(mockConsoleLog).toHaveBeenCalledWith(
        `⚠️  Marketplace 已存在: ${ownerRepo}`,
      );
      expect(mockExecSync).not.toHaveBeenCalled();
    });

    it("应当成功添加新的 marketplace", async () => {
      const ownerRepo = "test/marketplace";
      const cacheDir = path.join(
        tmpDir,
        ".local-hub",
        "cache",
        "marketplaces",
        "test--marketplace",
      );

      // Mock git clone 操作
      mockExecSync.mockImplementation((cmd: string, opts?: any) => {
        if (typeof cmd === "string" && cmd.includes("git clone")) {
          // 创建缓存目录和 .git 标记
          fs.mkdirSync(path.join(cacheDir, ".git"), { recursive: true });
          fs.mkdirSync(path.join(cacheDir, ".roblox-studio-hub-plugin"), {
            recursive: true,
          });

          // 创建 marketplace.json
          fs.writeFileSync(
            path.join(
              cacheDir,
              ".roblox-studio-hub-plugin",
              "marketplace.json",
            ),
            JSON.stringify(
              {
                name: "Test Marketplace",
                plugins: [
                  {
                    name: "test-plugin",
                    description: "Test plugin",
                    source: "test/plugin",
                  },
                ],
              },
              null,
              2,
            ),
          );
        }
      });

      await marketplaceAdd(ownerRepo);

      // 验证 git clone 被调用
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining("git clone --depth 1"),
        expect.objectContaining({ stdio: "pipe" }),
      );

      // 验证配置文件被写入
      const configPath = path.join(tmpDir, ".local-hub", "marketplaces.json");
      expect(fs.existsSync(configPath)).toBe(true);

      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(config.marketplaces).toContain(ownerRepo);

      // 验证控制台输出
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("验证 marketplace"),
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("✅ Marketplace 已添加"),
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("名称: Test Marketplace"),
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("插件数: 1"),
      );
    });

    it("应当在仓库中未找到 marketplace.json 时报错", async () => {
      const ownerRepo = "test/no-manifest";
      const cacheDir = path.join(
        tmpDir,
        ".local-hub",
        "cache",
        "marketplaces",
        "test--no-manifest",
      );

      // Mock git clone，但不创建 marketplace.json
      mockExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === "string" && cmd.includes("git clone")) {
          fs.mkdirSync(path.join(cacheDir, ".git"), { recursive: true });
          // 不创建 marketplace.json
        }
      });

      await expect(marketplaceAdd(ownerRepo)).rejects.toThrow(
        "process.exit(1)",
      );

      expect(mockConsoleError).toHaveBeenCalledWith(
        `❌ 仓库 ${ownerRepo} 中未找到 marketplace.json`,
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("应当在仓库不可访问时报错", async () => {
      const ownerRepo = "test/inaccessible";

      // Mock git clone 抛出错误
      mockExecSync.mockImplementation(() => {
        throw new Error("fatal: repository not found");
      });

      await expect(marketplaceAdd(ownerRepo)).rejects.toThrow(
        "process.exit(1)",
      );

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining("❌ 无法访问 marketplace"),
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("应当更新已存在的缓存（git pull）", async () => {
      const ownerRepo = "test/existing-cache";
      const cacheDir = path.join(
        tmpDir,
        ".local-hub",
        "cache",
        "marketplaces",
        "test--existing-cache",
      );

      // 预先创建缓存目录和 .git
      fs.mkdirSync(path.join(cacheDir, ".git"), { recursive: true });
      fs.mkdirSync(path.join(cacheDir, ".roblox-studio-hub-plugin"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(cacheDir, ".roblox-studio-hub-plugin", "marketplace.json"),
        JSON.stringify({
          name: "Existing Marketplace",
          plugins: [],
        }),
      );

      // Mock git pull
      mockExecSync.mockImplementation(() => {
        // git pull 成功，不做任何事
      });

      await marketplaceAdd(ownerRepo);

      // 验证 git pull 被调用
      expect(mockExecSync).toHaveBeenCalledWith(
        "git pull --ff-only",
        expect.objectContaining({
          cwd: expect.stringContaining("test--existing-cache"),
          stdio: "pipe",
        }),
      );

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("✅ Marketplace 已添加"),
      );
    });

    it("应当在 git pull 失败时使用缓存", async () => {
      const ownerRepo = "test/pull-fail";
      const cacheDir = path.join(
        tmpDir,
        ".local-hub",
        "cache",
        "marketplaces",
        "test--pull-fail",
      );

      // 预先创建缓存
      fs.mkdirSync(path.join(cacheDir, ".git"), { recursive: true });
      fs.mkdirSync(path.join(cacheDir, ".roblox-studio-hub-plugin"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(cacheDir, ".roblox-studio-hub-plugin", "marketplace.json"),
        JSON.stringify({
          name: "Cached Marketplace",
          plugins: [],
        }),
      );

      // Mock git pull 失败
      mockExecSync.mockImplementation(() => {
        throw new Error("git pull failed");
      });

      await marketplaceAdd(ownerRepo);

      expect(mockConsoleWarn).toHaveBeenCalledWith(
        expect.stringContaining("git pull 失败"),
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("✅ Marketplace 已添加"),
      );
    });
  });

  describe("marketplaceRemove", () => {
    it("应当成功移除已存在的 marketplace", () => {
      const ownerRepo = "test/marketplace";
      const configPath = path.join(tmpDir, ".local-hub", "marketplaces.json");

      // 预先写入配置
      fs.writeFileSync(
        configPath,
        JSON.stringify(
          { marketplaces: [ownerRepo, "other/marketplace"] },
          null,
          2,
        ),
      );

      marketplaceRemove(ownerRepo);

      // 验证配置文件已更新
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(config.marketplaces).not.toContain(ownerRepo);
      expect(config.marketplaces).toContain("other/marketplace");

      expect(mockConsoleLog).toHaveBeenCalledWith(
        `✅ Marketplace 已移除: ${ownerRepo}`,
      );
    });

    it("应当在 marketplace 不存在时报错", () => {
      const ownerRepo = "test/nonexistent";
      const configPath = path.join(tmpDir, ".local-hub", "marketplaces.json");

      // 预先写入配置（不包含目标）
      fs.writeFileSync(
        configPath,
        JSON.stringify({ marketplaces: ["other/marketplace"] }, null, 2),
      );

      expect(() => marketplaceRemove(ownerRepo)).toThrow("process.exit(1)");

      expect(mockConsoleError).toHaveBeenCalledWith(
        `❌ Marketplace 未找到: ${ownerRepo}`,
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("应当处理空配置文件", () => {
      const ownerRepo = "test/marketplace";

      expect(() => marketplaceRemove(ownerRepo)).toThrow("process.exit(1)");

      expect(mockConsoleError).toHaveBeenCalledWith(
        `❌ Marketplace 未找到: ${ownerRepo}`,
      );
    });
  });

  describe("marketplaceList", () => {
    it("应当列出所有已添加的 marketplace", () => {
      const configPath = path.join(tmpDir, ".local-hub", "marketplaces.json");

      fs.writeFileSync(
        configPath,
        JSON.stringify(
          { marketplaces: ["owner1/repo1", "owner2/repo2"] },
          null,
          2,
        ),
      );

      marketplaceList();

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("📦 已添加的 Marketplace (2 个)"),
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("owner1/repo1"),
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("owner2/repo2"),
      );
    });

    it("应当在无 marketplace 时显示提示信息", () => {
      marketplaceList();

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("📭 未添加任何 marketplace"),
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("使用 hub marketplace add owner/repo 添加"),
      );
    });

    it("应当处理空数组", () => {
      const configPath = path.join(tmpDir, ".local-hub", "marketplaces.json");

      fs.writeFileSync(
        configPath,
        JSON.stringify({ marketplaces: [] }, null, 2),
      );

      marketplaceList();

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("📭 未添加任何 marketplace"),
      );
    });
  });

  describe("searchInMarketplaces", () => {
    beforeEach(() => {
      const configPath = path.join(tmpDir, ".local-hub", "marketplaces.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify(
          { marketplaces: ["marketplace1/repo", "marketplace2/repo"] },
          null,
          2,
        ),
      );
    });

    it("应当在第一个 marketplace 中找到插件", async () => {
      const cacheDir1 = path.join(
        tmpDir,
        ".local-hub",
        "cache",
        "marketplaces",
        "marketplace1--repo",
      );

      // 预先创建缓存
      fs.mkdirSync(path.join(cacheDir1, ".git"), { recursive: true });
      fs.writeFileSync(
        path.join(cacheDir1, "marketplace.json"),
        JSON.stringify({
          name: "Marketplace 1",
          plugins: [
            {
              name: "target-plugin",
              description: "Target plugin",
              source: "owner/repo",
            },
          ],
        }),
      );

      mockExecSync.mockImplementation(() => {
        // git pull 成功
      });

      const result = await searchInMarketplaces("target-plugin");

      expect(result).not.toBeNull();
      expect(result?.plugin.name).toBe("target-plugin");
      expect(result?.marketplace).toBe("marketplace1/repo");
      expect(result?.repoDir).toContain("marketplace1--repo");
    });

    it("应当在第二个 marketplace 中找到插件（第一个没有）", async () => {
      const cacheDir1 = path.join(
        tmpDir,
        ".local-hub",
        "cache",
        "marketplaces",
        "marketplace1--repo",
      );
      const cacheDir2 = path.join(
        tmpDir,
        ".local-hub",
        "cache",
        "marketplaces",
        "marketplace2--repo",
      );

      // 创建第一个 marketplace（不包含目标插件）
      fs.mkdirSync(path.join(cacheDir1, ".git"), { recursive: true });
      fs.writeFileSync(
        path.join(cacheDir1, "marketplace.json"),
        JSON.stringify({
          name: "Marketplace 1",
          plugins: [
            {
              name: "other-plugin",
              description: "Other plugin",
              source: "owner/repo",
            },
          ],
        }),
      );

      // 创建第二个 marketplace（包含目标插件）
      fs.mkdirSync(path.join(cacheDir2, ".git"), { recursive: true });
      fs.writeFileSync(
        path.join(cacheDir2, "marketplace.json"),
        JSON.stringify({
          name: "Marketplace 2",
          plugins: [
            {
              name: "target-plugin",
              description: "Target plugin",
              source: "owner/repo",
            },
          ],
        }),
      );

      mockExecSync.mockImplementation(() => {
        // git pull 成功
      });

      const result = await searchInMarketplaces("target-plugin");

      expect(result).not.toBeNull();
      expect(result?.plugin.name).toBe("target-plugin");
      expect(result?.marketplace).toBe("marketplace2/repo");
      expect(result?.repoDir).toContain("marketplace2--repo");
    });

    it("应当在所有 marketplace 中都找不到时返回 null", async () => {
      const cacheDir1 = path.join(
        tmpDir,
        ".local-hub",
        "cache",
        "marketplaces",
        "marketplace1--repo",
      );
      const cacheDir2 = path.join(
        tmpDir,
        ".local-hub",
        "cache",
        "marketplaces",
        "marketplace2--repo",
      );

      // 创建两个 marketplace，都不包含目标插件
      fs.mkdirSync(path.join(cacheDir1, ".git"), { recursive: true });
      fs.writeFileSync(
        path.join(cacheDir1, "marketplace.json"),
        JSON.stringify({
          name: "Marketplace 1",
          plugins: [],
        }),
      );

      fs.mkdirSync(path.join(cacheDir2, ".git"), { recursive: true });
      fs.writeFileSync(
        path.join(cacheDir2, "marketplace.json"),
        JSON.stringify({
          name: "Marketplace 2",
          plugins: [],
        }),
      );

      mockExecSync.mockImplementation(() => {
        // git pull 成功
      });

      const result = await searchInMarketplaces("nonexistent-plugin");

      expect(result).toBeNull();
    });

    it("应当跳过不可用的 marketplace", async () => {
      const cacheDir2 = path.join(
        tmpDir,
        ".local-hub",
        "cache",
        "marketplaces",
        "marketplace2--repo",
      );

      // 第一个 marketplace 会失败
      // 第二个 marketplace 包含目标插件
      fs.mkdirSync(path.join(cacheDir2, ".git"), { recursive: true });
      fs.writeFileSync(
        path.join(cacheDir2, "marketplace.json"),
        JSON.stringify({
          name: "Marketplace 2",
          plugins: [
            {
              name: "target-plugin",
              description: "Target plugin",
              source: "owner/repo",
            },
          ],
        }),
      );

      let callCount = 0;
      mockExecSync.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // 第一个 marketplace git pull 失败
          throw new Error("git error");
        }
        // 第二个成功
      });

      const result = await searchInMarketplaces("target-plugin");

      expect(mockConsoleWarn).toHaveBeenCalledWith(
        expect.stringContaining("跳过不可用的 marketplace"),
      );
      expect(result).not.toBeNull();
      expect(result?.marketplace).toBe("marketplace2/repo");
    });

    it("应当跳过没有 marketplace.json 的仓库", async () => {
      const cacheDir1 = path.join(
        tmpDir,
        ".local-hub",
        "cache",
        "marketplaces",
        "marketplace1--repo",
      );
      const cacheDir2 = path.join(
        tmpDir,
        ".local-hub",
        "cache",
        "marketplaces",
        "marketplace2--repo",
      );

      // 第一个 marketplace 没有 marketplace.json
      fs.mkdirSync(path.join(cacheDir1, ".git"), { recursive: true });

      // 第二个 marketplace 包含目标插件
      fs.mkdirSync(path.join(cacheDir2, ".git"), { recursive: true });
      fs.writeFileSync(
        path.join(cacheDir2, "marketplace.json"),
        JSON.stringify({
          name: "Marketplace 2",
          plugins: [
            {
              name: "target-plugin",
              description: "Target plugin",
              source: "owner/repo",
            },
          ],
        }),
      );

      mockExecSync.mockImplementation(() => {
        // git pull 成功
      });

      const result = await searchInMarketplaces("target-plugin");

      expect(result).not.toBeNull();
      expect(result?.marketplace).toBe("marketplace2/repo");
    });
  });

  describe("searchAllMarketplaces", () => {
    beforeEach(() => {
      const configPath = path.join(tmpDir, ".local-hub", "marketplaces.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify(
          { marketplaces: ["marketplace1/repo", "marketplace2/repo"] },
          null,
          2,
        ),
      );
    });

    it("应当返回所有匹配的插件（无 query）", async () => {
      const cacheDir1 = path.join(
        tmpDir,
        ".local-hub",
        "cache",
        "marketplaces",
        "marketplace1--repo",
      );
      const cacheDir2 = path.join(
        tmpDir,
        ".local-hub",
        "cache",
        "marketplaces",
        "marketplace2--repo",
      );

      // 创建两个 marketplace
      fs.mkdirSync(path.join(cacheDir1, ".git"), { recursive: true });
      fs.writeFileSync(
        path.join(cacheDir1, "marketplace.json"),
        JSON.stringify({
          name: "Marketplace 1",
          plugins: [
            {
              name: "plugin-a",
              description: "Plugin A",
              source: "owner/a",
            },
            {
              name: "plugin-b",
              description: "Plugin B",
              source: "owner/b",
            },
          ],
        }),
      );

      fs.mkdirSync(path.join(cacheDir2, ".git"), { recursive: true });
      fs.writeFileSync(
        path.join(cacheDir2, "marketplace.json"),
        JSON.stringify({
          name: "Marketplace 2",
          plugins: [
            {
              name: "plugin-c",
              description: "Plugin C",
              source: "owner/c",
            },
          ],
        }),
      );

      mockExecSync.mockImplementation(() => {
        // git pull 成功
      });

      const results = await searchAllMarketplaces();

      expect(results).toHaveLength(3);
      expect(results[0].plugin.name).toBe("plugin-a");
      expect(results[0].marketplace).toBe("marketplace1/repo");
      expect(results[1].plugin.name).toBe("plugin-b");
      expect(results[2].plugin.name).toBe("plugin-c");
      expect(results[2].marketplace).toBe("marketplace2/repo");
    });

    it("应当根据 query 过滤插件名称", async () => {
      const cacheDir1 = path.join(
        tmpDir,
        ".local-hub",
        "cache",
        "marketplaces",
        "marketplace1--repo",
      );

      fs.mkdirSync(path.join(cacheDir1, ".git"), { recursive: true });
      fs.writeFileSync(
        path.join(cacheDir1, "marketplace.json"),
        JSON.stringify({
          name: "Marketplace 1",
          plugins: [
            {
              name: "execute-plugin",
              description: "Execute commands",
              source: "owner/execute",
            },
            {
              name: "other-plugin",
              description: "Other functionality",
              source: "owner/other",
            },
          ],
        }),
      );

      mockExecSync.mockImplementation(() => {});

      const results = await searchAllMarketplaces("execute");

      expect(results).toHaveLength(1);
      expect(results[0].plugin.name).toBe("execute-plugin");
    });

    it("应当根据 query 过滤插件描述（忽略大小写）", async () => {
      const cacheDir1 = path.join(
        tmpDir,
        ".local-hub",
        "cache",
        "marketplaces",
        "marketplace1--repo",
      );

      fs.mkdirSync(path.join(cacheDir1, ".git"), { recursive: true });
      fs.writeFileSync(
        path.join(cacheDir1, "marketplace.json"),
        JSON.stringify({
          name: "Marketplace 1",
          plugins: [
            {
              name: "plugin-a",
              description: "Execute Commands in Studio",
              source: "owner/a",
            },
            {
              name: "plugin-b",
              description: "Other functionality",
              source: "owner/b",
            },
          ],
        }),
      );

      mockExecSync.mockImplementation(() => {});

      const results = await searchAllMarketplaces("EXECUTE");

      expect(results).toHaveLength(1);
      expect(results[0].plugin.name).toBe("plugin-a");
    });

    it("应当跳过不可用的 marketplace", async () => {
      const cacheDir2 = path.join(
        tmpDir,
        ".local-hub",
        "cache",
        "marketplaces",
        "marketplace2--repo",
      );

      // 第二个 marketplace 包含插件
      fs.mkdirSync(path.join(cacheDir2, ".git"), { recursive: true });
      fs.writeFileSync(
        path.join(cacheDir2, "marketplace.json"),
        JSON.stringify({
          name: "Marketplace 2",
          plugins: [
            {
              name: "plugin-c",
              description: "Plugin C",
              source: "owner/c",
            },
          ],
        }),
      );

      let callCount = 0;
      mockExecSync.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // 第一个 marketplace git pull 失败
          throw new Error("git error");
        }
        // 第二个成功
      });

      const results = await searchAllMarketplaces();

      expect(results).toHaveLength(1);
      expect(results[0].plugin.name).toBe("plugin-c");
    });

    it("应当返回空数组（无匹配）", async () => {
      const cacheDir1 = path.join(
        tmpDir,
        ".local-hub",
        "cache",
        "marketplaces",
        "marketplace1--repo",
      );

      fs.mkdirSync(path.join(cacheDir1, ".git"), { recursive: true });
      fs.writeFileSync(
        path.join(cacheDir1, "marketplace.json"),
        JSON.stringify({
          name: "Marketplace 1",
          plugins: [
            {
              name: "plugin-a",
              description: "Plugin A",
              source: "owner/a",
            },
          ],
        }),
      );

      mockExecSync.mockImplementation(() => {});

      const results = await searchAllMarketplaces("nonexistent");

      expect(results).toHaveLength(0);
    });
  });

  describe("showMarketplaceHelp", () => {
    it("应当输出帮助文本", () => {
      showMarketplaceHelp();

      expect(mockConsoleLog).toHaveBeenCalled();

      // 检查关键内容
      const output = (mockConsoleLog as Mock).mock.calls
        .map((call) => call[0])
        .join("\n");

      expect(output).toContain("marketplace add");
      expect(output).toContain("marketplace remove");
      expect(output).toContain("marketplace list");
      expect(output).toContain("owner/repo");
      expect(output).toContain("GitHub 仓库");
    });
  });

  describe("边缘情况", () => {
    it("应当处理损坏的 JSON 配置文件", async () => {
      const configPath = path.join(tmpDir, ".local-hub", "marketplaces.json");

      // 写入损坏的 JSON
      fs.writeFileSync(configPath, "{invalid json");

      // marketplaceList 应当正常处理
      marketplaceList();

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("📭 未添加任何 marketplace"),
      );
    });

    it("应当处理 marketplace.json 解析错误", async () => {
      const ownerRepo = "test/invalid-json";
      const cacheDir = path.join(
        tmpDir,
        ".local-hub",
        "cache",
        "marketplaces",
        "test--invalid-json",
      );

      mockExecSync.mockImplementation(() => {
        fs.mkdirSync(path.join(cacheDir, ".git"), { recursive: true });
        fs.mkdirSync(path.join(cacheDir, ".roblox-studio-hub-plugin"), {
          recursive: true,
        });
        // 写入损坏的 marketplace.json
        fs.writeFileSync(
          path.join(cacheDir, ".roblox-studio-hub-plugin", "marketplace.json"),
          "{invalid",
        );
      });

      await expect(marketplaceAdd(ownerRepo)).rejects.toThrow(
        "process.exit(1)",
      );

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining("未找到 marketplace.json"),
      );
    });

    it("应当创建不存在的配置目录", async () => {
      // 删除 .local-hub 目录
      fs.rmSync(path.join(tmpDir, ".local-hub"), {
        recursive: true,
        force: true,
      });

      // 需要重新创建 .local-hub，否则 detectHubRoot() 会切换到 ~/.roblox-studio-hub
      fs.mkdirSync(path.join(tmpDir, ".local-hub"), { recursive: true });

      const ownerRepo = "test/new-dir";
      const cacheDir = path.join(
        tmpDir,
        ".local-hub",
        "cache",
        "marketplaces",
        "test--new-dir",
      );

      mockExecSync.mockImplementation(() => {
        // git clone 会创建缓存目录
        fs.mkdirSync(path.join(cacheDir, ".git"), { recursive: true });
        fs.mkdirSync(path.join(cacheDir, ".roblox-studio-hub-plugin"), {
          recursive: true,
        });
        fs.writeFileSync(
          path.join(cacheDir, ".roblox-studio-hub-plugin", "marketplace.json"),
          JSON.stringify({
            name: "New Marketplace",
            plugins: [],
          }),
        );
      });

      await marketplaceAdd(ownerRepo);

      const configPath = path.join(tmpDir, ".local-hub", "marketplaces.json");
      expect(fs.existsSync(configPath)).toBe(true);
    });

    it("应当处理空的 plugins 数组", async () => {
      const cacheDir1 = path.join(
        tmpDir,
        ".local-hub",
        "cache",
        "marketplaces",
        "marketplace1--repo",
      );

      const configPath = path.join(tmpDir, ".local-hub", "marketplaces.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({ marketplaces: ["marketplace1/repo"] }, null, 2),
      );

      fs.mkdirSync(path.join(cacheDir1, ".git"), { recursive: true });
      fs.writeFileSync(
        path.join(cacheDir1, "marketplace.json"),
        JSON.stringify({
          name: "Empty Marketplace",
          plugins: [],
        }),
      );

      mockExecSync.mockImplementation(() => {});

      const result = await searchInMarketplaces("any-plugin");
      expect(result).toBeNull();

      const results = await searchAllMarketplaces();
      expect(results).toHaveLength(0);
    });

    it("应当优先使用 .roblox-studio-hub-plugin/ 下的 marketplace.json", async () => {
      const cacheDir1 = path.join(
        tmpDir,
        ".local-hub",
        "cache",
        "marketplaces",
        "marketplace1--repo",
      );

      const configPath = path.join(tmpDir, ".local-hub", "marketplaces.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({ marketplaces: ["marketplace1/repo"] }, null, 2),
      );

      // 同时创建两个 marketplace.json：新路径和旧路径
      fs.mkdirSync(path.join(cacheDir1, ".git"), { recursive: true });
      fs.mkdirSync(path.join(cacheDir1, ".roblox-studio-hub-plugin"), {
        recursive: true,
      });

      // 新路径 — 包含 plugin-new
      fs.writeFileSync(
        path.join(cacheDir1, ".roblox-studio-hub-plugin", "marketplace.json"),
        JSON.stringify({
          name: "New Path Marketplace",
          plugins: [
            {
              name: "plugin-new",
              description: "From new path",
              source: "owner/new",
            },
          ],
        }),
      );

      // 旧路径 — 包含 plugin-old
      fs.writeFileSync(
        path.join(cacheDir1, "marketplace.json"),
        JSON.stringify({
          name: "Old Path Marketplace",
          plugins: [
            {
              name: "plugin-old",
              description: "From old path",
              source: "owner/old",
            },
          ],
        }),
      );

      mockExecSync.mockImplementation(() => {});

      // 应该找到新路径的 plugin-new
      const result = await searchInMarketplaces("plugin-new");
      expect(result).not.toBeNull();
      expect(result?.plugin.name).toBe("plugin-new");

      // 不应该找到旧路径的 plugin-old（因为优先使用新路径）
      const resultOld = await searchInMarketplaces("plugin-old");
      expect(resultOld).toBeNull();
    });

    it("应当在 .roblox-studio-hub-plugin/ 不存在时回退到根目录 marketplace.json", async () => {
      const cacheDir1 = path.join(
        tmpDir,
        ".local-hub",
        "cache",
        "marketplaces",
        "marketplace1--repo",
      );

      const configPath = path.join(tmpDir, ".local-hub", "marketplaces.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({ marketplaces: ["marketplace1/repo"] }, null, 2),
      );

      // 只创建旧路径
      fs.mkdirSync(path.join(cacheDir1, ".git"), { recursive: true });
      fs.writeFileSync(
        path.join(cacheDir1, "marketplace.json"),
        JSON.stringify({
          name: "Legacy Marketplace",
          plugins: [
            {
              name: "legacy-plugin",
              description: "From legacy path",
              source: "owner/legacy",
            },
          ],
        }),
      );

      mockExecSync.mockImplementation(() => {});

      const result = await searchInMarketplaces("legacy-plugin");
      expect(result).not.toBeNull();
      expect(result?.plugin.name).toBe("legacy-plugin");
    });

    it("searchInMarketplaces 返回的 repoDir 应为 manifest 所在目录", async () => {
      const cacheDir1 = path.join(
        tmpDir,
        ".local-hub",
        "cache",
        "marketplaces",
        "marketplace1--repo",
      );

      const configPath = path.join(tmpDir, ".local-hub", "marketplaces.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({ marketplaces: ["marketplace1/repo"] }, null, 2),
      );

      fs.mkdirSync(path.join(cacheDir1, ".git"), { recursive: true });
      fs.mkdirSync(path.join(cacheDir1, ".roblox-studio-hub-plugin"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(cacheDir1, ".roblox-studio-hub-plugin", "marketplace.json"),
        JSON.stringify({
          name: "Test",
          plugins: [
            {
              name: "test-plugin",
              description: "Test",
              source: "./my-plugin",
            },
          ],
        }),
      );

      mockExecSync.mockImplementation(() => {});

      const result = await searchInMarketplaces("test-plugin");
      expect(result).not.toBeNull();
      // repoDir 应指向 .roblox-studio-hub-plugin/ 目录
      expect(result?.repoDir).toContain(".roblox-studio-hub-plugin");
    });
  });
});
