import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "http";
import request from "supertest";
import { StudioManager } from "../hub/StudioManager.js";
import { createApp } from "./httpServer.js";
import { createWsServer } from "./wsServer.js";
import { MockStudioClient } from "./mockStudioClient.js";
import type { MethodDescriptor } from "../types.js";
import type { AppState } from "./httpServer.js";

function getPort(server: http.Server): number {
  const addr = server.address();
  if (addr && typeof addr === "object") return addr.port;
  throw new Error("server not listening");
}

/** 用 .end() 触发请求并返回 Promise */
function fireRequest(
  req: request.Test,
): Promise<request.Response> {
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
    inputSchema: { type: "object", properties: { code: { type: "string" } } },
    context: "both",
  },
  {
    name: "getStudioInfo",
    description: "Get info",
    inputSchema: { type: "object", properties: {} },
    context: "edit",
  },
];

describe("WS E2E Tests", () => {
  let httpServer: http.Server;
  let studioManager: StudioManager;
  let state: AppState;
  let client: MockStudioClient;

  beforeEach(async () => {
    studioManager = new StudioManager();
    const result = createApp({ studioManager, pluginTools: [] });
    state = result.state;

    httpServer = http.createServer(result.app);
    createWsServer({
      httpServer,
      studioManager,
      pendingResults: state.pendingResults,
    });

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    client = new MockStudioClient();
  });

  afterEach(async () => {
    await client.disconnect();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  // 1. 完整握手
  it("完整握手: connect → hello → welcome → 注册", async () => {
    const studioId = await client.connect({
      port: getPort(httpServer),
      studioInfo: { placeName: "E2EPlace" },
      methods: testMethods,
    });

    expect(studioId).toBe("local:E2EPlace");

    const studio = studioManager.get("local:E2EPlace");
    expect(studio).toBeDefined();
    expect(studio!.methods).toHaveLength(2);
    expect(studioManager.hasWs("local:E2EPlace")).toBe(true);
  });

  // 2. 命令分发: POST /call → WS command → WS result → HTTP 200
  it("命令分发: POST /call → WS command → WS result → HTTP 200", async () => {
    await client.connect({
      port: getPort(httpServer),
      studioInfo: { placeName: "CmdPlace" },
      methods: testMethods,
    });

    // 用 .end() 立即触发 HTTP 请求
    const callDone = fireRequest(
      request(httpServer)
        .post("/api/studios/local:CmdPlace/call")
        .send({ method: "execute", params: { code: "1+1" }, timeout: 5 }),
    );

    // 等一下让请求到达
    await new Promise((r) => setTimeout(r, 50));

    // 等待 WS 收到 command
    const cmd = (await client.waitForMessage("command")) as {
      id: string;
      method: string;
      params: { code: string };
    };
    expect(cmd.method).toBe("execute");
    expect(cmd.params.code).toBe("1+1");

    // 通过 WS 返回结果
    await client.sendResult(cmd.id, { success: true, result: 2 });

    // HTTP 调用应完成
    const res = await callDone;
    expect(res.body.success).toBe(true);
    expect(res.body.result).toBe(2);
  });

  // 3. 多 Studio 并发
  it("多 Studio 并发: 命令路由到正确的 Studio", async () => {
    const client2 = new MockStudioClient();

    await client.connect({
      port: getPort(httpServer),
      studioInfo: { placeName: "Studio1" },
      methods: testMethods,
    });
    await client2.connect({
      port: getPort(httpServer),
      studioInfo: { placeName: "Studio2" },
      methods: testMethods,
    });

    expect(studioManager.getAll()).toHaveLength(2);

    // 向 Studio2 发命令
    const callDone = fireRequest(
      request(httpServer)
        .post("/api/studios/local:Studio2/call")
        .send({ method: "execute", params: { code: "2+2" }, timeout: 5 }),
    );

    await new Promise((r) => setTimeout(r, 50));

    const cmd = (await client2.waitForMessage("command")) as {
      id: string;
    };
    await client2.sendResult(cmd.id, { success: true, result: 4 });

    const res = await callDone;
    expect(res.body.result).toBe(4);

    await client2.disconnect();
  });

  // 4. gameState 更新
  it("gameState 更新: sendState → StudioInstance.gameState 变化", async () => {
    await client.connect({
      port: getPort(httpServer),
      studioInfo: { placeName: "StatePlace" },
      methods: testMethods,
    });

    expect(studioManager.get("local:StatePlace")!.gameState).toBe("edit");

    await client.sendState("play");
    await new Promise((r) => setTimeout(r, 100));

    expect(studioManager.get("local:StatePlace")!.gameState).toBe("play");
  });

  // 5. context 过滤
  it("context 过滤: edit-only 方法在 play 状态返回 400", async () => {
    await client.connect({
      port: getPort(httpServer),
      studioInfo: { placeName: "CtxPlace" },
      methods: testMethods,
    });

    // 切换到 play 状态
    await client.sendState("play");
    await new Promise((r) => setTimeout(r, 100));

    const res = await request(httpServer)
      .post("/api/studios/local:CtxPlace/call")
      .send({ method: "getStudioInfo", params: {} });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("context");
  });

  // 6. 断开后清理
  it("断开后 Studio 应注销", async () => {
    await client.connect({
      port: getPort(httpServer),
      studioInfo: { placeName: "DiscoPlace" },
      methods: testMethods,
    });

    expect(studioManager.get("local:DiscoPlace")).toBeDefined();

    await client.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    expect(studioManager.get("local:DiscoPlace")).toBeUndefined();
  });

  // 7. 超时处理
  it("命令无 result → 超时", async () => {
    await client.connect({
      port: getPort(httpServer),
      studioInfo: { placeName: "TimeoutPlace" },
      methods: testMethods,
    });

    const res = await request(httpServer)
      .post("/api/studios/local:TimeoutPlace/call")
      .send({ method: "execute", params: {}, timeout: 0.1 });

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe("Execution timeout");
  });

  // 8. 并发命令
  it("并发命令: 同时多个命令都能完成", async () => {
    await client.connect({
      port: getPort(httpServer),
      studioInfo: { placeName: "ConcPlace" },
      methods: testMethods,
    });

    // 并发发送两个命令，用 .end() 立即触发
    const call1Done = fireRequest(
      request(httpServer)
        .post("/api/studios/local:ConcPlace/call")
        .send({ method: "execute", params: { code: "a" }, timeout: 5 }),
    );
    const call2Done = fireRequest(
      request(httpServer)
        .post("/api/studios/local:ConcPlace/call")
        .send({ method: "execute", params: { code: "b" }, timeout: 5 }),
    );

    await new Promise((r) => setTimeout(r, 50));

    // 接收两个 command
    const cmd1 = (await client.waitForMessage("command")) as { id: string };
    const cmd2 = (await client.waitForMessage("command")) as { id: string };

    // 分别返回结果
    await client.sendResult(cmd1.id, { success: true, result: "r1" });
    await client.sendResult(cmd2.id, { success: true, result: "r2" });

    const [res1, res2] = await Promise.all([call1Done, call2Done]);
    expect(res1.body.success).toBe(true);
    expect(res2.body.success).toBe(true);
  });
});
