import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseLogsLimit,
  showStatus,
  listStudios,
  showStudioInfo,
  showStudioLogs,
  showStatusHelp,
  showListHelp,
  showInfoHelp,
  showLogsHelp,
} from "./status.js";

// Mock serviceStatus
vi.mock("../utils/serviceStatus.js", () => ({
  isInstalledAsService: vi.fn(),
  isServiceRunning: vi.fn(),
}));

import {
  isInstalledAsService,
  isServiceRunning,
} from "../utils/serviceStatus.js";

const mockIsInstalled = isInstalledAsService as unknown as ReturnType<
  typeof vi.fn
>;
const mockIsRunning = isServiceRunning as unknown as ReturnType<typeof vi.fn>;

describe("parseLogsLimit", () => {
  it("无 -n 参数时返回默认值 100", () => {
    expect(parseLogsLimit(["node", "hub", "logs", "local:Test"])).toBe(100);
  });

  it("-n 短参数解析 limit", () => {
    expect(
      parseLogsLimit(["node", "hub", "logs", "local:Test", "-n", "50"]),
    ).toBe(50);
  });

  it("--limit 长参数解析 limit", () => {
    expect(
      parseLogsLimit(["node", "hub", "logs", "local:Test", "--limit", "200"]),
    ).toBe(200);
  });

  it("非数字值时返回默认值 100", () => {
    expect(
      parseLogsLimit(["node", "hub", "logs", "local:Test", "-n", "abc"]),
    ).toBe(100);
  });

  it("负数时返回默认值 100", () => {
    expect(
      parseLogsLimit(["node", "hub", "logs", "local:Test", "-n", "-1"]),
    ).toBe(100);
  });
});

describe("showStatus", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("显示服务已安装且运行中的状态", async () => {
    mockIsInstalled.mockResolvedValue(true);
    mockIsRunning.mockResolvedValue(true);

    await showStatus("1.0.0");

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("v1.0.0");
    expect(output).toContain("✅");
  });

  it("显示服务未安装且未运行的状态", async () => {
    mockIsInstalled.mockResolvedValue(false);
    mockIsRunning.mockResolvedValue(false);

    await showStatus("2.0.0");

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("v2.0.0");
    expect(output).toContain("❌");
  });

  it("运行中但未注册为服务时显示警告", async () => {
    mockIsInstalled.mockResolvedValue(false);
    mockIsRunning.mockResolvedValue(true);

    await showStatus("1.0.0");

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("⚠️");
  });
});

describe("listStudios", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("无 Studio 时显示空消息", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ studios: [] }),
    });

    await listStudios();

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("没有连接的 Studio");
  });

  it("显示已连接的 Studio 列表", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          studios: [
            {
              id: "local:MyGame",
              type: "local",
              placeName: "MyGame",
              connectedAt: new Date().toISOString(),
            },
          ],
        }),
    });

    await listStudios();

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("local:MyGame");
    expect(output).toContain("MyGame");
  });

  it("请求失败时显示错误", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("Connection refused"));

    await expect(listStudios()).rejects.toThrow("process.exit");
    expect(errorSpy).toHaveBeenCalledWith("❌ 请求失败:", "Connection refused");
  });
});

describe("showStudioInfo", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("缺少 studioId 时报错退出", async () => {
    await expect(showStudioInfo("")).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("Studio 不存在时报错退出", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 404,
      json: () => Promise.resolve({}),
    });

    await expect(showStudioInfo("local:NotExist")).rejects.toThrow(
      "process.exit",
    );
  });

  it("显示 Studio 详情", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: () =>
        Promise.resolve({
          id: "local:MyGame",
          type: "local",
          placeName: "MyGame",
          placeId: 123,
          gameId: 456,
          localPath: "/tmp/MyGame",
          connectedAt: new Date().toISOString(),
          clientCount: 0,
        }),
    });

    await showStudioInfo("local:MyGame");

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("local:MyGame");
    expect(output).toContain("MyGame");
  });

  it("请求失败时报错退出", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("Connection refused"));

    await expect(showStudioInfo("local:MyGame")).rejects.toThrow(
      "process.exit",
    );
  });
});

describe("showStudioLogs", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("缺少 studioId 时报错退出", async () => {
    await expect(showStudioLogs("")).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("Studio 不存在时报错退出", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 404,
      json: () => Promise.resolve({}),
    });

    await expect(showStudioLogs("local:NotExist")).rejects.toThrow(
      "process.exit",
    );
  });

  it("无日志时显示空消息", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ logs: [] }),
    });

    await showStudioLogs("local:MyGame");

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("暂无日志");
  });

  it("显示日志列表", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: () =>
        Promise.resolve({
          logs: [
            {
              timestamp: new Date().toISOString(),
              level: "info",
              message: "Hello world",
            },
            {
              timestamp: new Date().toISOString(),
              level: "error",
              message: "Something failed",
            },
            {
              timestamp: new Date().toISOString(),
              level: "warn",
              message: "Warning message",
            },
          ],
        }),
    });

    await showStudioLogs("local:MyGame", 50);

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
    expect(output).toContain("Hello world");
    expect(output).toContain("Something failed");
  });

  it("请求失败时报错退出", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("Connection refused"));

    await expect(showStudioLogs("local:MyGame")).rejects.toThrow(
      "process.exit",
    );
  });
});

describe("help functions", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("showStatusHelp 输出帮助信息", () => {
    showStatusHelp();
    expect(logSpy).toHaveBeenCalled();
  });

  it("showListHelp 输出帮助信息", () => {
    showListHelp();
    expect(logSpy).toHaveBeenCalled();
  });

  it("showInfoHelp 输出帮助信息", () => {
    showInfoHelp();
    expect(logSpy).toHaveBeenCalled();
  });

  it("showLogsHelp 输出帮助信息", () => {
    showLogsHelp();
    expect(logSpy).toHaveBeenCalled();
  });
});
