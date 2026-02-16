import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "http";
import { WebSocket } from "ws";
import request from "supertest";
import { StudioManager } from "../hub/StudioManager.js";
import { createWsServer } from "./wsServer.js";
import { createApp } from "./httpServer.js";
import type { HelloMessage } from "./wsProtocol.js";
import type { MethodDescriptor } from "../types.js";

function getPort(server: http.Server): number {
  const addr = server.address();
  if (addr && typeof addr === "object") return addr.port;
  throw new Error("server not listening");
}

function makeHello(overrides?: Partial<HelloMessage>): HelloMessage {
  return {
    type: "hello",
    studioInfo: {
      placeId: 0,
      placeName: "TestPlace",
      gameId: 0,
      userId: 0,
    },
    methods: [],
    gameState: "edit",
    ...overrides,
  };
}

/** 连接 WS 并等待打开 */
function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

/** 等待下一条消息 */
function waitForMessage(ws: WebSocket, timeout = 2000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeout);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

describe("wsServer", () => {
  let httpServer: http.Server;
  let studioManager: StudioManager;
  let pendingResults: Map<
    string,
    {
      resolve: (v: unknown) => void;
      timer: ReturnType<typeof setTimeout>;
      runtimeLogs: unknown[];
    }
  >;

  beforeEach(async () => {
    studioManager = new StudioManager();
    pendingResults = new Map();
    httpServer = http.createServer();
    createWsServer({ httpServer, studioManager, pendingResults });
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it("连接后发送 hello，应收到 welcome", async () => {
    const ws = await connectWs(getPort(httpServer));
    const msgPromise = waitForMessage(ws);

    ws.send(JSON.stringify(makeHello()));
    const msg = (await msgPromise) as { type: string; studioId: string };

    expect(msg.type).toBe("welcome");
    expect(msg.studioId).toBe("local:TestPlace");

    ws.close();
  });

  it("hello 中的 studioInfo 应正确注册到 StudioManager", async () => {
    const ws = await connectWs(getPort(httpServer));
    const msgPromise = waitForMessage(ws);

    ws.send(JSON.stringify(makeHello()));
    await msgPromise;

    const studio = studioManager.get("local:TestPlace");
    expect(studio).toBeDefined();
    expect(studio!.placeName).toBe("TestPlace");
    expect(studio!.gameState).toBe("edit");
    expect(studioManager.hasWs("local:TestPlace")).toBe(true);

    ws.close();
  });

  it("客户端断开后 Studio 应注销", async () => {
    const ws = await connectWs(getPort(httpServer));
    const msgPromise = waitForMessage(ws);

    ws.send(JSON.stringify(makeHello()));
    await msgPromise;

    // 关闭连接
    ws.close();
    await new Promise((r) => setTimeout(r, 100));

    expect(studioManager.get("local:TestPlace")).toBeUndefined();
  });

  it("未发送 hello 就发消息时应忽略", async () => {
    const ws = await connectWs(getPort(httpServer));

    // 发送非 hello 消息
    ws.send(JSON.stringify({ type: "result", id: "x", payload: {} }));

    // 等一会，不应崩溃
    await new Promise((r) => setTimeout(r, 100));

    // 连接仍活着
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("无效消息不应崩溃", async () => {
    const ws = await connectWs(getPort(httpServer));
    const msgPromise = waitForMessage(ws);
    ws.send(JSON.stringify(makeHello()));
    await msgPromise;

    // 发送无效消息
    ws.send("not json");
    ws.send(JSON.stringify({ type: "bogus" }));

    await new Promise((r) => setTimeout(r, 100));
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("收到 result 后应 resolve pendingResult", async () => {
    const ws = await connectWs(getPort(httpServer));
    const msgPromise = waitForMessage(ws);
    ws.send(JSON.stringify(makeHello()));
    await msgPromise;

    let resolved: unknown = null;
    const timer = setTimeout(() => {}, 30000);
    pendingResults.set("req-1", {
      resolve: (v) => {
        resolved = v;
      },
      timer,
      runtimeLogs: [],
    });

    ws.send(
      JSON.stringify({
        type: "result",
        id: "req-1",
        payload: { success: true, result: 42 },
      }),
    );

    await new Promise((r) => setTimeout(r, 100));
    expect(resolved).toEqual({
      success: true,
      result: 42,
      runtimeLogs: [],
    });
    expect(pendingResults.has("req-1")).toBe(false);

    clearTimeout(timer);
    ws.close();
  });

  it("收到 state 后应更新 gameState", async () => {
    const ws = await connectWs(getPort(httpServer));
    const msgPromise = waitForMessage(ws);
    ws.send(JSON.stringify(makeHello()));
    await msgPromise;

    ws.send(JSON.stringify({ type: "state", gameState: "play" }));
    await new Promise((r) => setTimeout(r, 100));

    expect(studioManager.get("local:TestPlace")!.gameState).toBe("play");
    ws.close();
  });

  it("sendCommand 应通过 WS 发送 command 消息", async () => {
    const ws = await connectWs(getPort(httpServer));
    const welcomePromise = waitForMessage(ws);
    ws.send(JSON.stringify(makeHello()));
    await welcomePromise;

    // 通过 StudioManager 获取 WS 并发送 command
    const studioWs = studioManager.getWs("local:TestPlace");
    expect(studioWs).toBeDefined();

    const cmdPromise = waitForMessage(ws);
    studioWs!.send(
      JSON.stringify({
        type: "command",
        id: "cmd-1",
        method: "execute",
        params: { code: "1+1" },
      }),
    );

    const cmd = (await cmdPromise) as {
      type: string;
      id: string;
      method: string;
    };
    expect(cmd.type).toBe("command");
    expect(cmd.id).toBe("cmd-1");
    expect(cmd.method).toBe("execute");

    ws.close();
  });
});

// ==================== WS + HTTP 集成 ====================

/** 消息收集器：缓冲 WS 消息并按顺序取出 */
function collectMessages(ws: WebSocket) {
  const queue: unknown[] = [];
  const waiters: Array<{
    resolve: (msg: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (waiters.length > 0) {
      const waiter = waiters.shift()!;
      clearTimeout(waiter.timer);
      waiter.resolve(msg);
    } else {
      queue.push(msg);
    }
  });

  return {
    next(timeout = 2000): Promise<unknown> {
      if (queue.length > 0) {
        return Promise.resolve(queue.shift()!);
      }
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

/** 用 .end() 触发请求并返回 Promise */
function fireRequest(req: request.Test): Promise<request.Response> {
  return new Promise((resolve, reject) => {
    req.end((err, res) => {
      if (err && !res) return reject(err);
      resolve(res);
    });
  });
}

const testMethods: MethodDescriptor[] = [
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
    description: "Get info",
    inputSchema: { type: "object", properties: {} },
    context: "edit",
  },
];

describe("WS + HTTP 集成", () => {
  let fullHttpServer: http.Server;
  let fullStudioManager: StudioManager;
  let fullPort: number;

  beforeEach(async () => {
    fullStudioManager = new StudioManager();
    const result = createApp({
      studioManager: fullStudioManager,
      pluginTools: [],
    });
    fullHttpServer = http.createServer(result.app);
    createWsServer({
      httpServer: fullHttpServer,
      studioManager: fullStudioManager,
      pendingResults: result.state.pendingResults,
    });
    await new Promise<void>((resolve) => fullHttpServer.listen(0, resolve));
    fullPort = getPort(fullHttpServer);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => fullHttpServer.close(() => resolve()));
  });

  /** 连接 WS 并完成 hello/welcome 握手 */
  async function connectStudio(placeName: string) {
    const ws = await connectWs(fullPort);
    const messages = collectMessages(ws);
    ws.send(
      JSON.stringify(
        makeHello({
          studioInfo: {
            placeId: 0,
            placeName,
            gameId: 0,
            userId: 0,
          },
          methods: testMethods,
        }),
      ),
    );
    await messages.next(); // welcome
    return { ws, messages };
  }

  it("POST /call → WS command → WS result → HTTP 200", async () => {
    const { ws, messages } = await connectStudio("WsCmdPlace");

    const callDone = fireRequest(
      request(fullHttpServer)
        .post("/api/studios/local:WsCmdPlace/call")
        .send({ method: "execute", params: { code: "1+1" }, timeout: 5 }),
    );

    await new Promise((r) => setTimeout(r, 50));

    const cmd = (await messages.next()) as {
      type: string;
      id: string;
      method: string;
      params: { code: string };
    };
    expect(cmd.type).toBe("command");
    expect(cmd.method).toBe("execute");
    expect(cmd.params.code).toBe("1+1");

    ws.send(
      JSON.stringify({
        type: "result",
        id: cmd.id,
        payload: { success: true, result: 2 },
      }),
    );

    const res = await callDone;
    expect(res.body.success).toBe(true);
    expect(res.body.result).toBe(2);

    ws.close();
  });

  it("多 Studio 并发: 命令路由到正确的 Studio", async () => {
    const s1 = await connectStudio("Studio1");
    const s2 = await connectStudio("Studio2");

    expect(fullStudioManager.getAll()).toHaveLength(2);

    const callDone = fireRequest(
      request(fullHttpServer)
        .post("/api/studios/local:Studio2/call")
        .send({ method: "execute", params: { code: "2+2" }, timeout: 5 }),
    );

    await new Promise((r) => setTimeout(r, 50));

    const cmd = (await s2.messages.next()) as { id: string };
    s2.ws.send(
      JSON.stringify({
        type: "result",
        id: cmd.id,
        payload: { success: true, result: 4 },
      }),
    );

    const res = await callDone;
    expect(res.body.result).toBe(4);

    s1.ws.close();
    s2.ws.close();
  });

  it("并发命令: 同时多个命令都能完成", async () => {
    const { ws, messages } = await connectStudio("ConcPlace");

    const call1Done = fireRequest(
      request(fullHttpServer)
        .post("/api/studios/local:ConcPlace/call")
        .send({ method: "execute", params: { code: "a" }, timeout: 5 }),
    );
    const call2Done = fireRequest(
      request(fullHttpServer)
        .post("/api/studios/local:ConcPlace/call")
        .send({ method: "execute", params: { code: "b" }, timeout: 5 }),
    );

    await new Promise((r) => setTimeout(r, 50));

    const cmd1 = (await messages.next()) as { id: string };
    const cmd2 = (await messages.next()) as { id: string };

    ws.send(
      JSON.stringify({
        type: "result",
        id: cmd1.id,
        payload: { success: true, result: "r1" },
      }),
    );
    ws.send(
      JSON.stringify({
        type: "result",
        id: cmd2.id,
        payload: { success: true, result: "r2" },
      }),
    );

    const [res1, res2] = await Promise.all([call1Done, call2Done]);
    expect(res1.body.success).toBe(true);
    expect(res2.body.success).toBe(true);

    ws.close();
  });
});
