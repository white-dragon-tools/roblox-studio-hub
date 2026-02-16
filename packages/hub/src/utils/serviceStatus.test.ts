import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "http";

// Mock child_process
vi.mock("child_process", () => ({
  exec: vi.fn(),
}));

// Mock fs
vi.mock("fs", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("fs");
  return {
    ...actual,
    default: { ...actual, existsSync: vi.fn() },
    existsSync: vi.fn(),
  };
});

import { exec } from "child_process";
import { existsSync } from "fs";
import {
  isInstalledAsService,
  isWindowsServiceRunning,
  isServiceRunning,
  isRunningAsService,
} from "./serviceStatus.js";

const mockExec = exec as unknown as ReturnType<typeof vi.fn>;
const mockExistsSync = existsSync as unknown as ReturnType<typeof vi.fn>;

function makeExecCallback(stdout: string, err?: Error) {
  return (_cmd: string, cb: (err: Error | null, result: { stdout: string }) => void) => {
    if (err) {
      cb(err, { stdout: "" });
    } else {
      cb(null, { stdout });
    }
  };
}

describe("serviceStatus", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    vi.restoreAllMocks();
  });

  describe("isInstalledAsService", () => {
    it("darwin: plist 文件存在时返回 true", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockExistsSync.mockReturnValue(true);

      const result = await isInstalledAsService();
      expect(result).toBe(true);
    });

    it("darwin: plist 文件不存在时返回 false", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockExistsSync.mockReturnValue(false);

      const result = await isInstalledAsService();
      expect(result).toBe(false);
    });

    it("win32: 查询服务成功时返回 true", async () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      mockExec.mockImplementation(makeExecCallback("robloxstudiohub.exe STATE"));

      const result = await isInstalledAsService();
      expect(result).toBe(true);
    });

    it("linux: systemctl 有输出时返回 true", async () => {
      Object.defineProperty(process, "platform", { value: "linux" });
      mockExec.mockImplementation(makeExecCallback("robloxstudiohub.exe enabled"));

      const result = await isInstalledAsService();
      expect(result).toBe(true);
    });

    it("错误时返回 false", async () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      mockExec.mockImplementation(makeExecCallback("", new Error("failed")));

      const result = await isInstalledAsService();
      expect(result).toBe(false);
    });
  });

  describe("isWindowsServiceRunning", () => {
    it("darwin: launchctl 有输出时返回 true", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockExec.mockImplementation(makeExecCallback("123 0 robloxstudiohub.exe"));

      const result = await isWindowsServiceRunning();
      expect(result).toBe(true);
    });

    it("win32: RUNNING 状态返回 true", async () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      mockExec.mockImplementation(makeExecCallback("STATE: RUNNING"));

      const result = await isWindowsServiceRunning();
      expect(result).toBe(true);
    });

    it("win32: STOPPED 状态返回 false", async () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      mockExec.mockImplementation(makeExecCallback("STATE: STOPPED"));

      const result = await isWindowsServiceRunning();
      expect(result).toBe(false);
    });

    it("linux: active 状态返回 true", async () => {
      Object.defineProperty(process, "platform", { value: "linux" });
      mockExec.mockImplementation(makeExecCallback("active"));

      const result = await isWindowsServiceRunning();
      expect(result).toBe(true);
    });

    it("linux: inactive 状态返回 false", async () => {
      Object.defineProperty(process, "platform", { value: "linux" });
      mockExec.mockImplementation(makeExecCallback("inactive"));

      const result = await isWindowsServiceRunning();
      expect(result).toBe(false);
    });

    it("错误时返回 false", async () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockExec.mockImplementation(makeExecCallback("", new Error("failed")));

      const result = await isWindowsServiceRunning();
      expect(result).toBe(false);
    });
  });

  describe("isServiceRunning", () => {
    it("HTTP 请求成功（200）返回 true", async () => {
      const mockReq = {
        on: vi.fn(),
        end: vi.fn(),
        destroy: vi.fn(),
      };
      const requestSpy = vi
        .spyOn(http, "request")
        .mockImplementation((_opts: unknown, cb: unknown) => {
          const callback = cb as (res: { statusCode: number }) => void;
          callback({ statusCode: 200 });
          return mockReq as unknown as http.ClientRequest;
        });

      const result = await isServiceRunning(35888);
      expect(result).toBe(true);
      requestSpy.mockRestore();
    });

    it("HTTP 请求非 200 返回 false", async () => {
      const mockReq = {
        on: vi.fn(),
        end: vi.fn(),
        destroy: vi.fn(),
      };
      const requestSpy = vi
        .spyOn(http, "request")
        .mockImplementation((_opts: unknown, cb: unknown) => {
          const callback = cb as (res: { statusCode: number }) => void;
          callback({ statusCode: 500 });
          return mockReq as unknown as http.ClientRequest;
        });

      const result = await isServiceRunning();
      expect(result).toBe(false);
      requestSpy.mockRestore();
    });

    it("HTTP 请求错误返回 false", async () => {
      const mockReq = {
        on: vi.fn((event: string, handler: () => void) => {
          if (event === "error") handler();
          return mockReq;
        }),
        end: vi.fn(),
        destroy: vi.fn(),
      };
      const requestSpy = vi
        .spyOn(http, "request")
        .mockImplementation(() => {
          return mockReq as unknown as http.ClientRequest;
        });

      const result = await isServiceRunning();
      expect(result).toBe(false);
      requestSpy.mockRestore();
    });

    it("HTTP 请求超时返回 false", async () => {
      const mockReq = {
        on: vi.fn((event: string, handler: () => void) => {
          if (event === "timeout") handler();
          return mockReq;
        }),
        end: vi.fn(),
        destroy: vi.fn(),
      };
      const requestSpy = vi
        .spyOn(http, "request")
        .mockImplementation(() => {
          return mockReq as unknown as http.ClientRequest;
        });

      const result = await isServiceRunning();
      expect(result).toBe(false);
      expect(mockReq.destroy).toHaveBeenCalled();
      requestSpy.mockRestore();
    });
  });

  describe("isRunningAsService", () => {
    it("有 TTY 时返回 false", () => {
      const original = process.stdout.isTTY;
      Object.defineProperty(process.stdout, "isTTY", {
        value: true,
        configurable: true,
      });

      expect(isRunningAsService()).toBe(false);

      Object.defineProperty(process.stdout, "isTTY", {
        value: original,
        configurable: true,
      });
    });

    it("无 TTY 时返回 true", () => {
      const original = process.stdout.isTTY;
      Object.defineProperty(process.stdout, "isTTY", {
        value: undefined,
        configurable: true,
      });

      expect(isRunningAsService()).toBe(true);

      Object.defineProperty(process.stdout, "isTTY", {
        value: original,
        configurable: true,
      });
    });
  });
});
