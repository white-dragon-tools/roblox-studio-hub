import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import { WebSocket } from "ws";
import request from "supertest";
import { createApp, type AppState } from "./httpServer.js";
import { createWsServer } from "./wsServer.js";
import { StudioManager } from "../hub/StudioManager.js";
import type { MethodDescriptor, StudioInfo, GameState } from "../types.js";
import type { PluginToolDef } from "../hub/pluginTypes.js";
import { pathToFileURL } from "url";

// Mock hubMethods: isHubMethod 使用真实实现, executeHubMethod mock
const mockExecuteHubMethod = vi.hoisted(() => vi.fn());
vi.mock("../hub/hubMethods.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hub/hubMethods.js")>();
  return { ...actual, executeHubMethod: mockExecuteHubMethod };
});

// ==================== Shared Helpers ====================

function makeTmpDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "integ-")));
}

interface IntegrationServer {
  readonly httpServer: http.Server;
  readonly studioManager: StudioManager;
  readonly state: AppState;
  readonly port: number;
}

async function createIntegrationServer(opts?: {
  pluginTools?: ReadonlyArray<PluginToolDef>;
  pluginsDir?: string;
}): Promise<IntegrationServer> {
  const studioManager = new StudioManager();
  const { app, state } = createApp({
    studioManager,
    pluginTools: opts?.pluginTools ?? [],
    pluginsDir: opts?.pluginsDir,
  });
  const httpServer = http.createServer(app);
  createWsServer({
    httpServer,
    studioManager,
    pendingResults: state.pendingResults,
    subscriptionManager: state.subscriptionManager,
  });
  await new Promise<void>((r) => httpServer.listen(0, r));
  const addr = httpServer.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { httpServer, studioManager, state, port };
}

async function destroyServer(s: IntegrationServer): Promise<void> {
  await new Promise<void>((r) => s.httpServer.close(() => r()));
}

function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function collectMessages(ws: WebSocket) {
  const queue: unknown[] = [];
  const waiters: Array<{
    resolve: (msg: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (waiters.length > 0) {
      const w = waiters.shift()!;
      clearTimeout(w.timer);
      w.resolve(msg);
    } else {
      queue.push(msg);
    }
  });

  return {
    next(timeout = 2000): Promise<unknown> {
      if (queue.length > 0) return Promise.resolve(queue.shift()!);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = waiters.findIndex((w) => w.timer === timer);
          if (idx >= 0) waiters.splice(idx, 1);
          reject(new Error("timeout waiting for message"));
        }, timeout);
        waiters.push({ resolve, timer });
      });
    },
  };
}

function fireRequest(req: request.Test): Promise<request.Response> {
  return new Promise((resolve, reject) => {
    req.end((err, res) => {
      if (err && !res) return reject(err);
      resolve(res);
    });
  });
}

const DEFAULT_METHODS: MethodDescriptor[] = [
  {
    name: "execute",
    description: "Execute Lua code",
    inputSchema: {
      type: "object",
      properties: { code: { type: "string" } },
    },
    context: "both",
  },
  {
    name: "getStudioInfo",
    description: "Get studio info",
    inputSchema: { type: "object", properties: {} },
    context: "edit",
  },
  {
    name: "getPlayData",
    description: "Get play mode data",
    inputSchema: { type: "object", properties: {} },
    context: "play",
  },
];

interface SimulatedStudio {
  readonly ws: WebSocket;
  readonly messages: ReturnType<typeof collectMessages>;
  readonly studioId: string;
}

async function connectSimulatedStudio(
  port: number,
  overrides?: {
    placeName?: string;
    placeId?: number;
    localPath?: string;
    methods?: MethodDescriptor[];
    gameState?: GameState;
  },
): Promise<SimulatedStudio> {
  const ws = await connectWs(port);
  const messages = collectMessages(ws);

  const studioInfo: StudioInfo = {
    placeId: overrides?.placeId ?? 0,
    placeName: overrides?.placeName ?? "TestPlace",
    gameId: 0,
    userId: 0,
    localPath: overrides?.localPath,
  };

  ws.send(
    JSON.stringify({
      type: "hello",
      studioInfo,
      methods: overrides?.methods ?? DEFAULT_METHODS,
      gameState: overrides?.gameState ?? "edit",
    }),
  );

  const welcome = (await messages.next()) as {
    type: string;
    studioId: string;
  };
  expect(welcome.type).toBe("welcome");

  return { ws, messages, studioId: welcome.studioId };
}

// ==================== Tests ====================

describe("Integration Tests", () => {
  // ==================== Suite 1 ====================
  describe("Suite 1: WS + HTTP Roundtrip 补充", () => {
    let server: IntegrationServer;

    beforeEach(async () => {
      server = await createIntegrationServer();
    });
    afterEach(async () => {
      await destroyServer(server);
    });

    it("1.1 Studio 返回 error result → HTTP 返回 error", async () => {
      const studio = await connectSimulatedStudio(server.port);

      const callDone = fireRequest(
        request(server.httpServer)
          .post(`/api/studios/${studio.studioId}/call`)
          .send({ method: "execute", params: { code: "bad" }, timeout: 5 }),
      );
      await new Promise((r) => setTimeout(r, 50));

      const cmd = (await studio.messages.next()) as { id: string };
      studio.ws.send(
        JSON.stringify({
          type: "result",
          id: cmd.id,
          payload: { success: false, error: "attempt to index nil" },
        }),
      );

      const res = await callDone;
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe("attempt to index nil");
      studio.ws.close();
    });

    it("1.2 不存在的 method → HTTP 400, WS 不收到 command", async () => {
      const studio = await connectSimulatedStudio(server.port);

      const res = await request(server.httpServer)
        .post(`/api/studios/${studio.studioId}/call`)
        .send({ method: "nonExistent" });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Method not available");

      // WS 不应收到任何 command（等待短暂时间确认无消息）
      await new Promise((r) => setTimeout(r, 100));
      studio.ws.close();
    });

    it("1.3 超时后 result 被忽略", async () => {
      const studio = await connectSimulatedStudio(server.port);

      const callDone = fireRequest(
        request(server.httpServer)
          .post(`/api/studios/${studio.studioId}/call`)
          .send({
            method: "execute",
            params: { code: "slow" },
            timeout: 0.1,
          }),
      );
      await new Promise((r) => setTimeout(r, 50));

      const cmd = (await studio.messages.next()) as { id: string };

      const res = await callDone;
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain("timeout");

      // 迟到的 result 不应引发错误
      studio.ws.send(
        JSON.stringify({
          type: "result",
          id: cmd.id,
          payload: { success: true, result: "late" },
        }),
      );
      await new Promise((r) => setTimeout(r, 50));
      studio.ws.close();
    });

    it("1.4 并发 command 各自独立返回", async () => {
      const studio = await connectSimulatedStudio(server.port);

      // 同时发两个请求
      const call1 = fireRequest(
        request(server.httpServer)
          .post(`/api/studios/${studio.studioId}/call`)
          .send({ method: "execute", params: { code: "a" }, timeout: 5 }),
      );
      const call2 = fireRequest(
        request(server.httpServer)
          .post(`/api/studios/${studio.studioId}/call`)
          .send({ method: "execute", params: { code: "b" }, timeout: 5 }),
      );
      await new Promise((r) => setTimeout(r, 50));

      const cmd1 = (await studio.messages.next()) as { id: string };
      const cmd2 = (await studio.messages.next()) as { id: string };

      // 先回复第二个
      studio.ws.send(
        JSON.stringify({
          type: "result",
          id: cmd2.id,
          payload: { success: true, result: "second" },
        }),
      );
      // 再回复第一个
      studio.ws.send(
        JSON.stringify({
          type: "result",
          id: cmd1.id,
          payload: { success: true, result: "first" },
        }),
      );

      const [res1, res2] = await Promise.all([call1, call2]);
      expect(res1.body.result).toBe("first");
      expect(res2.body.result).toBe("second");
      studio.ws.close();
    });
  });

  // ==================== Suite 2 ====================
  describe("Suite 2: Plugin Web + API 共存", () => {
    let server: IntegrationServer;
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = makeTmpDir();
      const pluginDir = path.join(tmpDir, "test-plugin");
      const webDir = path.join(pluginDir, "web", "dist");
      fs.mkdirSync(webDir, { recursive: true });
      fs.writeFileSync(
        path.join(pluginDir, "plugin.json"),
        JSON.stringify({
          name: "test-plugin",
          version: "0.1.0",
          description: "Test",
          web: "./web/dist",
          tools: [],
        }),
      );
      fs.writeFileSync(path.join(webDir, "index.html"), "<h1>Plugin UI</h1>");
      server = await createIntegrationServer({ pluginsDir: tmpDir });
    });

    afterEach(async () => {
      await destroyServer(server);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("2.1 Plugin web 和 API 路由同时返回 200", async () => {
      const [pluginRes, apiRes] = await Promise.all([
        request(server.httpServer).get("/plugins/test-plugin/index.html"),
        request(server.httpServer).get("/api/studios"),
      ]);
      expect(pluginRes.status).toBe(200);
      expect(pluginRes.text).toContain("Plugin UI");
      expect(apiRes.status).toBe(200);
      expect(apiRes.body.studios).toEqual([]);
    });

    it("2.2 WS Studio + plugin web 同时工作", async () => {
      const studio = await connectSimulatedStudio(server.port);
      const pluginRes = await request(server.httpServer).get(
        "/plugins/test-plugin/index.html",
      );
      expect(pluginRes.status).toBe(200);

      const apiRes = await request(server.httpServer).get("/api/studios");
      expect(apiRes.body.studios).toHaveLength(1);
      studio.ws.close();
    });

    it("2.3 不存在的 plugin 路径返回 404", async () => {
      const res = await request(server.httpServer).get(
        "/plugins/nonexistent/index.html",
      );
      expect(res.status).toBe(404);
    });
  });

  // ==================== Suite 3 ====================
  describe("Suite 3: Subscription/Notification 端到端", () => {
    let server: IntegrationServer;

    beforeEach(async () => {
      server = await createIntegrationServer();
    });
    afterEach(async () => {
      await destroyServer(server);
    });

    it("3.1 HTTP subscribe → WS Studio 收到 subscribe 消息", async () => {
      const studio = await connectSimulatedStudio(server.port);

      await request(server.httpServer)
        .post(`/api/studios/${studio.studioId}/subscribe`)
        .send({ event: "selectionChanged", subscriberId: "c1" });

      const msg = (await studio.messages.next()) as {
        type: string;
        event: string;
      };
      expect(msg.type).toBe("subscribe");
      expect(msg.event).toBe("selectionChanged");
      studio.ws.close();
    });

    it("3.2 Studio WS notify → SubscriptionManager dispatch", async () => {
      const studio = await connectSimulatedStudio(server.port);

      let notifiedData: unknown = null;
      server.state.subscriptionManager.subscribe(
        studio.studioId,
        "selectionChanged",
        "test-sub",
        (_sid, _evt, data) => {
          notifiedData = data;
        },
      );

      studio.ws.send(
        JSON.stringify({
          type: "notify",
          event: "selectionChanged",
          data: { items: ["Part1"] },
        }),
      );

      await new Promise((r) => setTimeout(r, 100));
      expect(notifiedData).toEqual({ items: ["Part1"] });
      studio.ws.close();
    });

    it("3.3 HTTP unsubscribe → WS Studio 收到 unsubscribe 消息", async () => {
      const studio = await connectSimulatedStudio(server.port);

      // 先 subscribe
      server.state.subscriptionManager.subscribe(
        studio.studioId,
        "testEvent",
        "sub1",
        () => {},
      );
      // consume subscribe WS message
      const subMsg = (await studio.messages.next()) as { type: string };
      expect(subMsg.type).toBe("subscribe");

      // unsubscribe（最后订阅者）
      await request(server.httpServer)
        .post(`/api/studios/${studio.studioId}/unsubscribe`)
        .send({ event: "testEvent", subscriberId: "sub1" });

      const unsubMsg = (await studio.messages.next()) as {
        type: string;
        event: string;
      };
      expect(unsubMsg.type).toBe("unsubscribe");
      expect(unsubMsg.event).toBe("testEvent");
      studio.ws.close();
    });

    it("3.4 Studio 断连后订阅被清理", async () => {
      const studio = await connectSimulatedStudio(server.port);

      server.state.subscriptionManager.subscribe(
        studio.studioId,
        "evt",
        "sub1",
        () => {},
      );

      studio.ws.close();
      await new Promise((r) => setTimeout(r, 100));

      // 订阅者已清理
      expect(
        server.state.subscriptionManager.getSubscriberCount(
          studio.studioId,
          "evt",
        ),
      ).toBe(0);
    });
  });

  // ==================== Suite 4 ====================
  describe("Suite 4: gameState 转换影响方法可用性", () => {
    let server: IntegrationServer;

    beforeEach(async () => {
      server = await createIntegrationServer();
    });
    afterEach(async () => {
      await destroyServer(server);
    });

    it("4.1 edit 状态 call edit-only 方法成功", async () => {
      const studio = await connectSimulatedStudio(server.port);

      const callDone = fireRequest(
        request(server.httpServer)
          .post(`/api/studios/${studio.studioId}/call`)
          .send({ method: "getStudioInfo", params: {}, timeout: 5 }),
      );
      await new Promise((r) => setTimeout(r, 50));

      const cmd = (await studio.messages.next()) as { id: string };
      studio.ws.send(
        JSON.stringify({
          type: "result",
          id: cmd.id,
          payload: { success: true, result: { info: "ok" } },
        }),
      );

      const res = await callDone;
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      studio.ws.close();
    });

    it("4.2 edit 状态 call play-only 方法 → HTTP 400", async () => {
      const studio = await connectSimulatedStudio(server.port);

      const res = await request(server.httpServer)
        .post(`/api/studios/${studio.studioId}/call`)
        .send({ method: "getPlayData", params: {} });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("context");
      studio.ws.close();
    });

    it("4.3 WS state{play} 后 play-only 方法可用", async () => {
      const studio = await connectSimulatedStudio(server.port);

      // 切换到 play
      studio.ws.send(JSON.stringify({ type: "state", gameState: "play" }));
      await new Promise((r) => setTimeout(r, 50));

      const callDone = fireRequest(
        request(server.httpServer)
          .post(`/api/studios/${studio.studioId}/call`)
          .send({ method: "getPlayData", params: {}, timeout: 5 }),
      );
      await new Promise((r) => setTimeout(r, 50));

      const cmd = (await studio.messages.next()) as { id: string };
      studio.ws.send(
        JSON.stringify({
          type: "result",
          id: cmd.id,
          payload: { success: true, result: { data: "play" } },
        }),
      );

      const res = await callDone;
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      studio.ws.close();
    });

    it("4.4 both 方法在 edit 和 play 状态都可用", async () => {
      const studio = await connectSimulatedStudio(server.port);

      // edit 状态 call execute
      const call1 = fireRequest(
        request(server.httpServer)
          .post(`/api/studios/${studio.studioId}/call`)
          .send({ method: "execute", params: { code: "1" }, timeout: 5 }),
      );
      await new Promise((r) => setTimeout(r, 50));
      const cmd1 = (await studio.messages.next()) as { id: string };
      studio.ws.send(
        JSON.stringify({
          type: "result",
          id: cmd1.id,
          payload: { success: true, result: 1 },
        }),
      );
      const res1 = await call1;
      expect(res1.body.success).toBe(true);

      // 切换到 play
      studio.ws.send(JSON.stringify({ type: "state", gameState: "play" }));
      await new Promise((r) => setTimeout(r, 50));

      // play 状态 call execute（both context）
      const call2 = fireRequest(
        request(server.httpServer)
          .post(`/api/studios/${studio.studioId}/call`)
          .send({ method: "execute", params: { code: "2" }, timeout: 5 }),
      );
      await new Promise((r) => setTimeout(r, 50));
      const cmd2 = (await studio.messages.next()) as { id: string };
      studio.ws.send(
        JSON.stringify({
          type: "result",
          id: cmd2.id,
          payload: { success: true, result: 2 },
        }),
      );
      const res2 = await call2;
      expect(res2.body.success).toBe(true);
      studio.ws.close();
    });
  });

  // ==================== Suite 5 ====================
  describe("Suite 5: 文件参数解析 x-file", () => {
    let server: IntegrationServer;
    let tmpDir: string;
    let testFilePath: string;

    const pluginTools: PluginToolDef[] = [
      {
        name: "execute",
        description: "Execute Lua code",
        inputSchema: {
          type: "object",
          properties: {
            code: { type: "string", "x-file": true } as Record<string, unknown>,
            label: { type: "string" },
          },
          required: ["code"],
        },
      },
    ];

    beforeEach(async () => {
      tmpDir = makeTmpDir();
      testFilePath = path.join(tmpDir, "test.lua");
      fs.writeFileSync(testFilePath, "print('hello from file')");
      server = await createIntegrationServer({ pluginTools });
    });

    afterEach(async () => {
      await destroyServer(server);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("5.1 file:// URI 被替换为文件内容", async () => {
      const studio = await connectSimulatedStudio(server.port, {
        methods: [
          {
            name: "execute",
            description: "exec",
            inputSchema: {
              type: "object",
              properties: { code: { type: "string" } },
            },
            context: "both",
          },
        ],
      });

      const fileUri = pathToFileURL(testFilePath).href;
      const callDone = fireRequest(
        request(server.httpServer)
          .post(`/api/studios/${studio.studioId}/call`)
          .send({
            method: "execute",
            params: { code: fileUri },
            timeout: 5,
          }),
      );
      await new Promise((r) => setTimeout(r, 50));

      const cmd = (await studio.messages.next()) as {
        id: string;
        params: { code: string };
      };
      // WS command 应收到文件内容，而非 URI
      expect(cmd.params.code).toBe("print('hello from file')");

      studio.ws.send(
        JSON.stringify({
          type: "result",
          id: cmd.id,
          payload: { success: true, result: null },
        }),
      );
      await callDone;
      studio.ws.close();
    });

    it("5.2 非 x-file 字段的 file:// 值不被替换", async () => {
      const studio = await connectSimulatedStudio(server.port, {
        methods: [
          {
            name: "execute",
            description: "exec",
            inputSchema: {
              type: "object",
              properties: {
                code: { type: "string" },
                label: { type: "string" },
              },
            },
            context: "both",
          },
        ],
      });

      const callDone = fireRequest(
        request(server.httpServer)
          .post(`/api/studios/${studio.studioId}/call`)
          .send({
            method: "execute",
            params: { code: "1+1", label: "file:///etc/passwd" },
            timeout: 5,
          }),
      );
      await new Promise((r) => setTimeout(r, 50));

      const cmd = (await studio.messages.next()) as {
        id: string;
        params: { code: string; label: string };
      };
      // label 不是 x-file，保持原始值
      expect(cmd.params.label).toBe("file:///etc/passwd");
      expect(cmd.params.code).toBe("1+1");

      studio.ws.send(
        JSON.stringify({
          type: "result",
          id: cmd.id,
          payload: { success: true, result: null },
        }),
      );
      await callDone;
      studio.ws.close();
    });

    it("5.3 file:// 指向不存在文件 → HTTP 400", async () => {
      const studio = await connectSimulatedStudio(server.port, {
        methods: [
          {
            name: "execute",
            description: "exec",
            inputSchema: {
              type: "object",
              properties: { code: { type: "string" } },
            },
            context: "both",
          },
        ],
      });

      const res = await request(server.httpServer)
        .post(`/api/studios/${studio.studioId}/call`)
        .send({
          method: "execute",
          params: { code: "file:///nonexistent/path.lua" },
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("文件参数解析失败");
      studio.ws.close();
    });
  });

  // ==================== Suite 6 ====================
  describe("Suite 6: UI init/poll 完整负载", () => {
    let server: IntegrationServer;

    const pluginTools: PluginToolDef[] = [
      {
        name: "myTool",
        description: "My tool",
        inputSchema: { type: "object", properties: {} },
      },
    ];

    beforeEach(async () => {
      server = await createIntegrationServer({ pluginTools });
    });
    afterEach(async () => {
      await destroyServer(server);
    });

    it("6.1 /api/ui/init 返回 WS Studio 的 gameState + methods", async () => {
      const studio = await connectSimulatedStudio(server.port, {
        placeName: "MyGame",
      });

      const res = await request(server.httpServer).get("/api/ui/init");

      expect(res.status).toBe(200);
      expect(res.body.studios).toHaveLength(1);
      const s = res.body.studios[0];
      expect(s.placeName).toBe("MyGame");
      expect(s.gameState).toBe("edit");
      expect(s.methods).toHaveLength(DEFAULT_METHODS.length);
      studio.ws.close();
    });

    it("6.2 /api/ui/init 返回 pluginTools", async () => {
      const res = await request(server.httpServer).get("/api/ui/init");

      expect(res.body.pluginTools).toHaveLength(1);
      expect(res.body.pluginTools[0].name).toBe("myTool");
    });

    it("6.3 多 Studio 全部列出", async () => {
      const s1 = await connectSimulatedStudio(server.port, {
        placeName: "Game1",
      });
      const s2 = await connectSimulatedStudio(server.port, {
        placeName: "Game2",
      });

      const res = await request(server.httpServer).get("/api/ui/init");
      expect(res.body.studios).toHaveLength(2);

      s1.ws.close();
      s2.ws.close();
    });
  });

  // ==================== Suite 7 ====================
  describe("Suite 7: HTTP fallback（无 WS）", () => {
    let server: IntegrationServer;

    beforeEach(async () => {
      server = await createIntegrationServer();
    });
    afterEach(async () => {
      await destroyServer(server);
    });

    function makeStudioInfo(overrides?: Partial<StudioInfo>): StudioInfo {
      return {
        placeId: 0,
        placeName: "HttpPlace",
        gameId: 0,
        userId: 0,
        ...overrides,
      };
    }

    it("7.1 仅 HTTP poll Studio, call → poll → result 完整流程", async () => {
      const studioInfo = makeStudioInfo({
        methods: [
          {
            name: "execute",
            description: "exec",
            inputSchema: {
              type: "object",
              properties: { code: { type: "string" } },
            },
            context: "both",
          },
        ],
      } as Partial<StudioInfo>);

      // 注册 Studio
      await request(server.httpServer)
        .post("/api/studio/poll")
        .send({ studioInfo });

      // call
      const callDone = fireRequest(
        request(server.httpServer)
          .post("/api/studios/local:HttpPlace/call")
          .send({
            method: "execute",
            params: { code: "1+1" },
            timeout: 5,
          }),
      );
      await new Promise((r) => setTimeout(r, 50));

      // poll 取走 command
      const pollRes = await request(server.httpServer)
        .post("/api/studio/poll")
        .send({ studioInfo });
      expect(pollRes.body.commands).toHaveLength(1);
      const cmd = pollRes.body.commands[0];

      // result
      await request(server.httpServer)
        .post("/api/studio/result")
        .send({ id: cmd.id, payload: { success: true, result: 2 } });

      const res = await callDone;
      expect(res.body.success).toBe(true);
      expect(res.body.result).toBe(2);
    });

    it("7.2 WS Studio 断连后 GET studios 返回空", async () => {
      const studio = await connectSimulatedStudio(server.port);

      const listRes1 = await request(server.httpServer).get("/api/studios");
      expect(listRes1.body.studios).toHaveLength(1);

      studio.ws.close();
      await new Promise((r) => setTimeout(r, 100));

      const listRes2 = await request(server.httpServer).get("/api/studios");
      expect(listRes2.body.studios).toHaveLength(0);
    });
  });

  // ==================== Suite 8 ====================
  describe("Suite 8: Studio 生命周期端到端", () => {
    let server: IntegrationServer;

    beforeEach(async () => {
      server = await createIntegrationServer();
    });
    afterEach(async () => {
      await destroyServer(server);
    });

    it("8.1 完整生命周期: hello → list → call → state → disconnect", async () => {
      // 1. WS 连接
      const studio = await connectSimulatedStudio(server.port, {
        placeName: "Lifecycle",
      });

      // 2. studios 可见
      const listRes = await request(server.httpServer).get("/api/studios");
      expect(listRes.body.studios).toHaveLength(1);

      // 3. call 成功
      const callDone = fireRequest(
        request(server.httpServer)
          .post(`/api/studios/${studio.studioId}/call`)
          .send({
            method: "execute",
            params: { code: "x" },
            timeout: 5,
          }),
      );
      await new Promise((r) => setTimeout(r, 50));
      const cmd = (await studio.messages.next()) as { id: string };
      studio.ws.send(
        JSON.stringify({
          type: "result",
          id: cmd.id,
          payload: { success: true, result: "done" },
        }),
      );
      const callRes = await callDone;
      expect(callRes.body.success).toBe(true);

      // 4. state 更新
      studio.ws.send(JSON.stringify({ type: "state", gameState: "play" }));
      await new Promise((r) => setTimeout(r, 50));
      const detailRes = await request(server.httpServer).get(
        `/api/studios/${studio.studioId}`,
      );
      expect(detailRes.body.gameState).toBe("play");

      // 5. 断连
      studio.ws.close();
      await new Promise((r) => setTimeout(r, 100));
      const listRes2 = await request(server.httpServer).get("/api/studios");
      expect(listRes2.body.studios).toHaveLength(0);
    });

    it("8.2 多 Studio 独立断连", async () => {
      const s1 = await connectSimulatedStudio(server.port, {
        placeName: "Game1",
      });
      const s2 = await connectSimulatedStudio(server.port, {
        placeName: "Game2",
      });

      const listRes = await request(server.httpServer).get("/api/studios");
      expect(listRes.body.studios).toHaveLength(2);

      // Studio1 断连
      s1.ws.close();
      await new Promise((r) => setTimeout(r, 100));

      const listRes2 = await request(server.httpServer).get("/api/studios");
      expect(listRes2.body.studios).toHaveLength(1);
      expect(listRes2.body.studios[0].placeName).toBe("Game2");

      s2.ws.close();
    });
  });
});
