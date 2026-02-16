import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { createApp, type AppState } from "./httpServer.js";
import { StudioManager } from "../hub/StudioManager.js";
import { SubscriptionManager } from "../hub/subscriptionManager.js";
import type { StudioInfo } from "../types.js";
import type express from "express";

// 用于测试的 studioInfo 工厂
function makeStudioInfo(overrides?: Partial<StudioInfo>): StudioInfo {
  return {
    placeId: 0,
    placeName: "TestPlace",
    gameId: 0,
    userId: 0,
    ...overrides,
  };
}

describe("httpServer", () => {
  let app: express.Express;
  let state: AppState;
  let studioManager: StudioManager;

  beforeEach(() => {
    studioManager = new StudioManager();
    const result = createApp({ studioManager, pluginTools: [] });
    app = result.app;
    state = result.state;
  });

  // ==================== POST /api/studio/poll ====================

  describe("POST /api/studio/poll", () => {
    it("应拒绝缺少 studioInfo 的请求", async () => {
      const res = await request(app).post("/api/studio/poll").send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("studioInfo is required");
    });

    it("应拒绝缺少 placeName 的请求", async () => {
      const res = await request(app)
        .post("/api/studio/poll")
        .send({ studioInfo: { placeId: 0, gameId: 0, userId: 0 } });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("placeName is required");
    });

    it("应注册新的本地 Studio 并返回 studioId", async () => {
      const res = await request(app)
        .post("/api/studio/poll")
        .send({ studioInfo: makeStudioInfo() });

      expect(res.status).toBe(200);
      expect(res.body.studioId).toBe("local:TestPlace");
      expect(res.body.commands).toEqual([]);

      // StudioManager 中应该有注册记录
      expect(studioManager.get("local:TestPlace")).toBeDefined();
    });

    it("应为云场景生成 place: 前缀的 studioId", async () => {
      const res = await request(app)
        .post("/api/studio/poll")
        .send({
          studioInfo: makeStudioInfo({ placeId: 12345 }),
        });

      expect(res.status).toBe(200);
      expect(res.body.studioId).toBe("place:12345");
    });

    it("应为带 localPath 的场景生成 path: 前缀的 studioId", async () => {
      const res = await request(app)
        .post("/api/studio/poll")
        .send({
          studioInfo: makeStudioInfo({ localPath: "/tmp/test.rbxl" }),
        });

      expect(res.status).toBe(200);
      expect(res.body.studioId).toBe("path:/tmp/test.rbxl");
    });

    it("无待处理命令时应返回空命令列表", async () => {
      const res = await request(app)
        .post("/api/studio/poll")
        .send({ studioInfo: makeStudioInfo() });

      expect(res.body.commands).toEqual([]);
    });

    it("应返回队列中的待处理命令并清空队列", async () => {
      // 先注册 Studio
      await request(app)
        .post("/api/studio/poll")
        .send({ studioInfo: makeStudioInfo() });

      // 手动加入命令
      const cmd = {
        id: "cmd-1",
        type: "execute",
        params: { code: "print('hi')" },
        createdAt: Date.now(),
      };
      state.pendingCommands.set("local:TestPlace", [cmd]);

      // 再次 poll 应取走命令
      const res = await request(app)
        .post("/api/studio/poll")
        .send({ studioInfo: makeStudioInfo() });

      expect(res.body.commands).toHaveLength(1);
      expect(res.body.commands[0].id).toBe("cmd-1");
      expect(res.body.commands[0].type).toBe("execute");

      // 队列应已清空
      const queue = state.pendingCommands.get("local:TestPlace");
      expect(queue).toHaveLength(0);
    });

    it("重复 poll 应更新心跳而非重复注册", async () => {
      await request(app)
        .post("/api/studio/poll")
        .send({ studioInfo: makeStudioInfo() });

      const studio1 = studioManager.get("local:TestPlace");
      const heartbeat1 = studio1!.lastHeartbeat;

      // 等一小段时间确保时间戳不同
      await new Promise((r) => setTimeout(r, 10));

      await request(app)
        .post("/api/studio/poll")
        .send({ studioInfo: makeStudioInfo() });

      const studio2 = studioManager.get("local:TestPlace");
      expect(studio2!.lastHeartbeat).toBeGreaterThanOrEqual(heartbeat1);

      // 只有一个 Studio
      expect(studioManager.getAll()).toHaveLength(1);
    });
  });

  // ==================== POST /api/studio/result ====================

  describe("POST /api/studio/result", () => {
    it("应拒绝缺少 id 的请求", async () => {
      const res = await request(app)
        .post("/api/studio/result")
        .send({ payload: {} });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("id is required");
    });

    it("无匹配的 pending 时也应返回 success", async () => {
      const res = await request(app)
        .post("/api/studio/result")
        .send({ id: "nonexistent", payload: {} });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("应解析匹配的 pendingResult", async () => {
      let resolved: unknown = null;
      const timer = setTimeout(() => {}, 30000);

      state.pendingResults.set("req-1", {
        resolve: (result) => {
          resolved = result;
        },
        timer,
        runtimeLogs: [],
      });

      const res = await request(app)
        .post("/api/studio/result")
        .send({
          id: "req-1",
          payload: { success: true, result: "hello" },
        });

      expect(res.status).toBe(200);
      expect(resolved).toEqual({
        success: true,
        result: "hello",
        runtimeLogs: [],
      });

      // 应已从 map 中清除
      expect(state.pendingResults.has("req-1")).toBe(false);

      clearTimeout(timer);
    });
  });

  // ==================== 命令分发完整流程 ====================

  describe("命令分发: call → poll → result", () => {
    const studioInfo = makeStudioInfo({
      methods: [
        {
          name: "execute",
          description: "Execute Lua code",
          inputSchema: { type: "object" as const, properties: {} },
        },
      ],
    });

    it("完整流程: call 入队 → poll 取走 → result 返回", async () => {
      // 1. 注册 Studio（带 methods）
      await request(app).post("/api/studio/poll").send({ studioInfo });

      // 2. 客户端调用 Studio 方法（用 .end() 立即触发请求）
      let callBody: Record<string, unknown> = {};
      const callDone = new Promise<void>((resolve) => {
        request(app)
          .post("/api/studios/local:TestPlace/call")
          .send({ method: "execute", params: { code: "1+1" }, timeout: 5 })
          .end((_err, res) => {
            callBody = res.body as Record<string, unknown>;
            resolve();
          });
      });

      // 3. 让事件循环处理请求，命令入队
      await new Promise((r) => setTimeout(r, 50));

      // 4. Studio poll 取走命令
      const pollRes = await request(app)
        .post("/api/studio/poll")
        .send({ studioInfo });

      expect(pollRes.body.commands).toHaveLength(1);
      const cmd = pollRes.body.commands[0];
      expect(cmd.type).toBe("execute");
      expect(cmd.params).toEqual({ code: "1+1" });

      // 5. Studio 返回结果
      await request(app)
        .post("/api/studio/result")
        .send({
          id: cmd.id,
          payload: { success: true, result: 2 },
        });

      // 6. 等待客户端请求完成
      await callDone;
      expect(callBody.success).toBe(true);
      expect(callBody.result).toBe(2);
    });

    it("call 超时应返回 timeout 错误", async () => {
      // 注册 Studio
      await request(app).post("/api/studio/poll").send({ studioInfo });

      // 调用但不返回结果，设置极短超时
      const res = await request(app)
        .post("/api/studios/local:TestPlace/call")
        .send({ method: "execute", params: {}, timeout: 0.1 });

      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe("Execution timeout");
    });
  });

  // ==================== GET /api/studios ====================

  describe("GET /api/studios", () => {
    it("无 Studio 时应返回空列表", async () => {
      const res = await request(app).get("/api/studios");

      expect(res.status).toBe(200);
      expect(res.body.studios).toEqual([]);
    });

    it("应列出已注册的 Studio", async () => {
      // 通过 poll 注册
      await request(app)
        .post("/api/studio/poll")
        .send({ studioInfo: makeStudioInfo() });

      const res = await request(app).get("/api/studios");

      expect(res.body.studios).toHaveLength(1);
      expect(res.body.studios[0].id).toBe("local:TestPlace");
      expect(res.body.studios[0].placeName).toBe("TestPlace");
    });
  });

  // ==================== GET /api/studios/:id ====================

  describe("GET /api/studios/:id", () => {
    it("Studio 不存在时返回 404", async () => {
      const res = await request(app).get("/api/studios/local:NotExist");

      expect(res.status).toBe(404);
    });

    it("应返回 Studio 详情", async () => {
      await request(app)
        .post("/api/studio/poll")
        .send({ studioInfo: makeStudioInfo() });

      const res = await request(app).get("/api/studios/local:TestPlace");

      expect(res.status).toBe(200);
      expect(res.body.placeName).toBe("TestPlace");
      expect(res.body.type).toBe("local");
    });
  });

  // ==================== GET /api/studios/:id/methods ====================

  describe("GET /api/studios/:id/methods", () => {
    it("应返回 Studio 注册的方法列表", async () => {
      const methods = [
        {
          name: "execute",
          description: "Execute code",
          inputSchema: { type: "object" as const, properties: {} },
        },
      ];

      await request(app)
        .post("/api/studio/poll")
        .send({ studioInfo: makeStudioInfo({ methods }) });

      const res = await request(app).get(
        "/api/studios/local:TestPlace/methods",
      );

      expect(res.status).toBe(200);
      expect(res.body.methods).toHaveLength(1);
      expect(res.body.methods[0].name).toBe("execute");
    });
  });

  // ==================== POST /api/studios/:id/call ====================

  describe("POST /api/studios/:id/call", () => {
    it("缺少 method 应返回 400", async () => {
      const res = await request(app)
        .post("/api/studios/local:TestPlace/call")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("method is required");
    });

    it("Studio 不存在应返回 404", async () => {
      const res = await request(app)
        .post("/api/studios/local:NotExist/call")
        .send({ method: "execute" });

      expect(res.status).toBe(404);
    });

    it("方法不可用应返回 400", async () => {
      await request(app)
        .post("/api/studio/poll")
        .send({ studioInfo: makeStudioInfo({ methods: [] }) });

      const res = await request(app)
        .post("/api/studios/local:TestPlace/call")
        .send({ method: "nonExistent" });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Method not available");
    });

    it("context 不匹配应返回 400", async () => {
      const methods = [
        {
          name: "getStudioInfo",
          description: "Get info",
          inputSchema: { type: "object" as const, properties: {} },
          context: "edit" as const,
        },
      ];

      await request(app)
        .post("/api/studio/poll")
        .send({ studioInfo: makeStudioInfo({ methods }) });

      // 切换到 play 状态
      studioManager.updateGameState("local:TestPlace", "play");

      const res = await request(app)
        .post("/api/studios/local:TestPlace/call")
        .send({ method: "getStudioInfo", params: {} });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("context");
    });
  });

  // ==================== GET /api/studios/:id/logs ====================

  describe("GET /api/studios/:id/logs", () => {
    it("Studio 不存在应返回 404", async () => {
      const res = await request(app).get("/api/studios/local:NotExist/logs");
      expect(res.status).toBe(404);
    });

    it("应返回 Studio 日志", async () => {
      await request(app)
        .post("/api/studio/poll")
        .send({ studioInfo: makeStudioInfo() });

      // 添加一些日志
      studioManager.addLog("local:TestPlace", {
        timestamp: Date.now(),
        source: "test",
        level: "info",
        message: "Test log",
      });

      const res = await request(app).get("/api/studios/local:TestPlace/logs");

      expect(res.status).toBe(200);
      expect(res.body.logs).toHaveLength(1);
      expect(res.body.logs[0].message).toBe("Test log");
    });

    it("应支持 limit 查询参数", async () => {
      await request(app)
        .post("/api/studio/poll")
        .send({ studioInfo: makeStudioInfo() });

      for (let i = 0; i < 5; i++) {
        studioManager.addLog("local:TestPlace", {
          timestamp: Date.now(),
          source: "test",
          level: "info",
          message: `Log ${i}`,
        });
      }

      const res = await request(app).get(
        "/api/studios/local:TestPlace/logs?limit=2",
      );

      expect(res.body.logs).toHaveLength(2);
    });
  });

  // ==================== Notification API ====================

  describe("POST /api/studios/:id/subscribe", () => {
    it("缺少参数应返回 400", async () => {
      const res = await request(app)
        .post("/api/studios/local:TestPlace/subscribe")
        .send({});
      expect(res.status).toBe(400);
    });

    it("Studio 不存在应返回 404", async () => {
      const res = await request(app)
        .post("/api/studios/local:NotExist/subscribe")
        .send({ event: "test", subscriberId: "sub-1" });
      expect(res.status).toBe(404);
    });

    it("应成功订阅事件", async () => {
      await request(app)
        .post("/api/studio/poll")
        .send({ studioInfo: makeStudioInfo() });

      const res = await request(app)
        .post("/api/studios/local:TestPlace/subscribe")
        .send({ event: "selectionChanged", subscriberId: "sub-1" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("POST /api/studios/:id/unsubscribe", () => {
    it("缺少参数应返回 400", async () => {
      const res = await request(app)
        .post("/api/studios/local:TestPlace/unsubscribe")
        .send({});
      expect(res.status).toBe(400);
    });

    it("Studio 不存在应返回 404", async () => {
      const res = await request(app)
        .post("/api/studios/local:NotExist/unsubscribe")
        .send({ event: "test", subscriberId: "sub-1" });
      expect(res.status).toBe(404);
    });

    it("应成功取消订阅事件", async () => {
      await request(app)
        .post("/api/studio/poll")
        .send({ studioInfo: makeStudioInfo() });

      const res = await request(app)
        .post("/api/studios/local:TestPlace/unsubscribe")
        .send({ event: "selectionChanged", subscriberId: "sub-1" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ==================== UI API ====================

  describe("GET /api/ui/init", () => {
    it("应返回所有 Studio 的初始化数据", async () => {
      await request(app)
        .post("/api/studio/poll")
        .send({ studioInfo: makeStudioInfo() });

      const res = await request(app).get("/api/ui/init");

      expect(res.status).toBe(200);
      expect(res.body.studios).toHaveLength(1);
      expect(res.body.studios[0].placeName).toBe("TestPlace");
    });

    it("无 Studio 时返回空列表", async () => {
      const res = await request(app).get("/api/ui/init");
      expect(res.status).toBe(200);
      expect(res.body.studios).toEqual([]);
    });
  });

  describe("GET /api/ui/poll", () => {
    it("有新事件时立即返回", async () => {
      // 先注册 Studio（触发 studio_connected 事件）
      await request(app)
        .post("/api/studio/poll")
        .send({ studioInfo: makeStudioInfo() });

      const res = await request(app).get("/api/ui/poll?since=0&timeout=1");

      expect(res.status).toBe(200);
      expect(res.body.events.length).toBeGreaterThan(0);
      expect(res.body.events[0].type).toBe("studio_connected");
    });

    it("无新事件且超时后返回空列表", async () => {
      // timeout=1 → 1 second wait before returning empty events
      const res = await request(app).get(
        "/api/ui/poll?since=9999999999999&timeout=1",
      );

      expect(res.status).toBe(200);
      expect(res.body.events).toEqual([]);
    }, 5000);
  });

  // ==================== resolveStudio 辅助 ====================

  describe("resolveStudio (via GET /api/studios/:id)", () => {
    it("应通过数字 ID 查找 place Studio", async () => {
      await request(app)
        .post("/api/studio/poll")
        .send({ studioInfo: makeStudioInfo({ placeId: 99999 }) });

      const res = await request(app).get("/api/studios/99999");
      expect(res.status).toBe(200);
      expect(res.body.placeName).toBe("TestPlace");
    });

    it("应通过 place: 前缀查找 Studio", async () => {
      await request(app)
        .post("/api/studio/poll")
        .send({ studioInfo: makeStudioInfo({ placeId: 12345 }) });

      const res = await request(app).get("/api/studios/place:12345");
      expect(res.status).toBe(200);
    });

    it("应通过 path: 前缀查找 Studio", async () => {
      await request(app)
        .post("/api/studio/poll")
        .send({
          studioInfo: makeStudioInfo({ localPath: "/tmp/game.rbxl" }),
        });

      const res = await request(app).get(
        "/api/studios/" + encodeURIComponent("path:/tmp/game.rbxl"),
      );
      expect(res.status).toBe(200);
    });

    it("应通过 placeName 查找（无前缀）", async () => {
      await request(app)
        .post("/api/studio/poll")
        .send({ studioInfo: makeStudioInfo({ placeName: "MyGame" }) });

      const res = await request(app).get("/api/studios/MyGame");
      expect(res.status).toBe(200);
    });
  });
});
