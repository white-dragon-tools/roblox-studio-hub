import { describe, it, expect, beforeEach } from "vitest";
import { StudioManager } from "./StudioManager.js";
import type { StudioInfo } from "../types.js";
import type { WebSocket } from "ws";

function makeStudioInfo(overrides?: Partial<StudioInfo>): StudioInfo {
  return {
    placeId: 0,
    placeName: "TestPlace",
    gameId: 0,
    userId: 0,
    ...overrides,
  };
}

describe("StudioManager", () => {
  let manager: StudioManager;

  beforeEach(() => {
    manager = new StudioManager();
  });

  describe("register", () => {
    it("注册时默认 gameState 为 edit", () => {
      const instance = manager.register(makeStudioInfo());
      expect(instance!.gameState).toBe("edit");
    });
  });

  describe("updateGameState", () => {
    it("应更新已注册 Studio 的 gameState", () => {
      manager.register(makeStudioInfo());
      const ok = manager.updateGameState("local:TestPlace", "play");

      expect(ok).toBe(true);
      expect(manager.get("local:TestPlace")!.gameState).toBe("play");
    });

    it("Studio 不存在时返回 false", () => {
      const ok = manager.updateGameState("local:NotExist", "play");
      expect(ok).toBe(false);
    });
  });

  describe("WebSocket 管理", () => {
    const mockWs = { readyState: 1 } as unknown as WebSocket;

    it("setWs 应绑定 WebSocket 到 Studio", () => {
      manager.register(makeStudioInfo());
      manager.setWs("local:TestPlace", mockWs);

      expect(manager.getWs("local:TestPlace")).toBe(mockWs);
      expect(manager.hasWs("local:TestPlace")).toBe(true);
    });

    it("getWs 不存在 Studio 时返回 undefined", () => {
      expect(manager.getWs("local:NotExist")).toBeUndefined();
    });

    it("hasWs 不存在 Studio 时返回 false", () => {
      expect(manager.hasWs("local:NotExist")).toBe(false);
    });

    it("hasWs 未绑定 WS 时返回 false", () => {
      manager.register(makeStudioInfo());
      expect(manager.hasWs("local:TestPlace")).toBe(false);
    });

    it("unregisterById 应清除 WS 引用", () => {
      manager.register(makeStudioInfo());
      manager.setWs("local:TestPlace", mockWs);
      manager.unregisterById("local:TestPlace");

      expect(manager.getWs("local:TestPlace")).toBeUndefined();
    });
  });

  describe("getByLocalPath", () => {
    it("应通过 localPath 查找 Studio", () => {
      manager.register(makeStudioInfo({ localPath: "/tmp/game.rbxl" }));

      const found = manager.getByLocalPath("/tmp/game.rbxl");
      expect(found).toBeDefined();
      expect(found!.id).toBe("path:/tmp/game.rbxl");
    });

    it("localPath 不存在时返回 undefined", () => {
      expect(manager.getByLocalPath("/nonexistent")).toBeUndefined();
    });
  });

  describe("getByPlaceId", () => {
    it("应通过 placeId 查找 Studio", () => {
      manager.register(makeStudioInfo({ placeId: 12345 }));

      const found = manager.getByPlaceId(12345);
      expect(found).toBeDefined();
      expect(found!.id).toBe("place:12345");
    });

    it("placeId 不存在时返回 undefined", () => {
      expect(manager.getByPlaceId(99999)).toBeUndefined();
    });
  });

  describe("getByPlaceName", () => {
    it("应通过 placeName 查找 Studio", () => {
      manager.register(makeStudioInfo({ placeName: "MyGame" }));

      const found = manager.getByPlaceName("MyGame");
      expect(found).toBeDefined();
    });

    it("placeName 不存在时返回 undefined", () => {
      expect(manager.getByPlaceName("NotExist")).toBeUndefined();
    });
  });

  describe("addLog", () => {
    it("应添加日志到已注册的 Studio", () => {
      manager.register(makeStudioInfo());

      manager.addLog("local:TestPlace", {
        timestamp: Date.now(),
        source: "test",
        level: "info",
        message: "Test log",
      });

      const logs = manager.getLogs("local:TestPlace");
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe("Test log");
    });

    it("Studio 不存在时不报错", () => {
      // Should not throw
      manager.addLog("nonexistent", {
        timestamp: Date.now(),
        source: "test",
        level: "info",
        message: "Test",
      });
    });

    it("超过 MAX_LOGS 时丢弃旧日志", () => {
      manager.register(makeStudioInfo());

      // Add 501 logs (MAX_LOGS is 500)
      for (let i = 0; i < 501; i++) {
        manager.addLog("local:TestPlace", {
          timestamp: Date.now(),
          source: "test",
          level: "info",
          message: `Log ${i}`,
        });
      }

      const logs = manager.getLogs("local:TestPlace", 600);
      expect(logs).toHaveLength(500);
      // First log should be "Log 1" (Log 0 was shifted out)
      expect(logs[0].message).toBe("Log 1");
    });
  });

  describe("getLogs", () => {
    it("Studio 不存在时返回空数组", () => {
      expect(manager.getLogs("nonexistent")).toEqual([]);
    });

    it("应返回最新的 limit 条日志", () => {
      manager.register(makeStudioInfo());

      for (let i = 0; i < 10; i++) {
        manager.addLog("local:TestPlace", {
          timestamp: Date.now(),
          source: "test",
          level: "info",
          message: `Log ${i}`,
        });
      }

      const logs = manager.getLogs("local:TestPlace", 3);
      expect(logs).toHaveLength(3);
      expect(logs[0].message).toBe("Log 7");
    });
  });

  describe("heartbeat", () => {
    it("应更新心跳时间", () => {
      manager.register(makeStudioInfo());
      const before = manager.get("local:TestPlace")!.lastHeartbeat;

      // Small delay
      const result = manager.heartbeat("local:TestPlace");
      expect(result).toBe(true);
      expect(
        manager.get("local:TestPlace")!.lastHeartbeat,
      ).toBeGreaterThanOrEqual(before);
    });

    it("应更新 methods（如果提供）", () => {
      manager.register(makeStudioInfo());

      const newMethods = [
        {
          name: "newMethod",
          description: "New",
          inputSchema: { type: "object" as const, properties: {} },
        },
      ];
      manager.heartbeat(
        "local:TestPlace",
        makeStudioInfo({ methods: newMethods }),
      );

      expect(manager.get("local:TestPlace")!.methods).toHaveLength(1);
      expect(manager.get("local:TestPlace")!.methods[0].name).toBe("newMethod");
    });

    it("Studio 不存在时返回 false", () => {
      expect(manager.heartbeat("nonexistent")).toBe(false);
    });
  });

  describe("unregisterById", () => {
    it("注销 place 类型时清理 placeIdIndex", () => {
      manager.register(makeStudioInfo({ placeId: 12345 }));
      manager.unregisterById("place:12345");

      expect(manager.getByPlaceId(12345)).toBeUndefined();
      expect(manager.get("place:12345")).toBeUndefined();
    });

    it("注销 localPath 类型时清理 localPathIndex", () => {
      manager.register(makeStudioInfo({ localPath: "/tmp/game.rbxl" }));
      manager.unregisterById("path:/tmp/game.rbxl");

      expect(manager.getByLocalPath("/tmp/game.rbxl")).toBeUndefined();
    });

    it("注销 local 类型时清理 placeNameIndex", () => {
      manager.register(makeStudioInfo({ placeName: "MyGame" }));
      manager.unregisterById("local:MyGame");

      expect(manager.getByPlaceName("MyGame")).toBeUndefined();
    });

    it("ID 不存在时返回 null", () => {
      expect(manager.unregisterById("nonexistent")).toBeNull();
    });
  });

  describe("getAll", () => {
    it("应返回所有已注册的 Studio", () => {
      manager.register(makeStudioInfo({ placeName: "Game1" }));
      manager.register(makeStudioInfo({ placeName: "Game2" }));

      expect(manager.getAll()).toHaveLength(2);
    });

    it("无 Studio 时返回空数组", () => {
      expect(manager.getAll()).toEqual([]);
    });
  });
});
