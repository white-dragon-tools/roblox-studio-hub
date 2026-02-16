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
});
