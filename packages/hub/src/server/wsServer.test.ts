import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "http";
import { WebSocket } from "ws";
import { StudioManager } from "../hub/StudioManager.js";
import { createWsServer } from "./wsServer.js";
import type { HelloMessage } from "./wsProtocol.js";

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
  let pendingResults: Map<string, { resolve: (v: unknown) => void; timer: ReturnType<typeof setTimeout>; runtimeLogs: unknown[] }>;

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
      resolve: (v) => { resolved = v; },
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

    const cmd = (await cmdPromise) as { type: string; id: string; method: string };
    expect(cmd.type).toBe("command");
    expect(cmd.id).toBe("cmd-1");
    expect(cmd.method).toBe("execute");

    ws.close();
  });
});
