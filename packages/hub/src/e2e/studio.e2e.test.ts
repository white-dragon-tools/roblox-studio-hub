/**
 * E2E 真机测试 — 验证 Hub ↔ Roblox Studio 全链路。
 *
 * 需要 Roblox Studio 已安装。CI 中通过 RUN_E2E 环境变量控制。
 *
 * 流程: injectRuntime → 启动 Hub server → rspo open Studio → 等待 WS 连接
 *       → 执行命令 → Play/Stop 生命周期 → 清理
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import request from "supertest";
import { fileURLToPath } from "url";
import { StudioManager } from "../hub/StudioManager.js";
import { createApp } from "../server/httpServer.js";
import { createWsServer } from "../server/wsServer.js";
import { injectRuntime } from "../utils/injectRuntime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, "../../../..");
const PLUGINS_DIR = path.join(MONOREPO_ROOT, "packages", "plugins");
const FIXTURE_PLACE = path.join(MONOREPO_ROOT, "tests", "game.rbxl");

/** rspo CLI 调用 */
function rspo(...args: string[]): unknown {
  const result = execFileSync("npx", ["rspo", ...args], {
    encoding: "utf-8",
    timeout: 60_000,
  });
  return JSON.parse(result.trim());
}

/** 等待条件成立，超时抛出 */
async function waitFor(
  fn: () => boolean,
  { timeout = 30_000, interval = 1000, label = "condition" } = {},
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

const shouldRun = process.env.RUN_E2E === "1";

describe.skipIf(!shouldRun)("E2E: Hub ↔ Roblox Studio", () => {
  let tmpDir: string;
  let placePath: string;
  let realPlacePath: string;
  let server: http.Server;
  let studioManager: StudioManager;
  let app: ReturnType<typeof createApp>["app"];
  let port: number;

  beforeAll(async () => {
    // 1. 创建临时目录，复制 place 文件
    tmpDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "hub-e2e-"));
    placePath = path.join(tmpDir, "game.rbxl");
    fs.copyFileSync(FIXTURE_PLACE, placePath);
    realPlacePath = fs.realpathSync(placePath);

    // 2. 启动 Hub server（进程内，随机端口）
    studioManager = new StudioManager();
    const created = createApp({ studioManager });
    app = created.app;

    server = http.createServer(app);
    createWsServer({
      httpServer: server,
      studioManager,
      pendingResults: created.state.pendingResults,
      subscriptionManager: created.state.subscriptionManager,
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    port = typeof addr === "object" && addr ? addr.port : 0;

    // 3. 注入 Runtime（带端口 + 插件）
    await injectRuntime(placePath, {
      extraPluginDirs: [PLUGINS_DIR],
      port,
    });

    // 4. 打开 Studio
    rspo("open", realPlacePath);

    // 5. 等待 Studio 通过 WS 连接到 Hub
    await waitFor(() => studioManager.getAll().length > 0, {
      timeout: 60_000,
      label: "Studio WS connection",
    });
  }, 120_000);

  afterAll(async () => {
    // 关闭 Studio
    try {
      rspo("close", realPlacePath);
    } catch {
      // ignore
    }

    // 关闭 server
    await new Promise<void>((resolve) => server.close(() => resolve()));

    // 清理临时目录
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }, 30_000);

  function getStudioId(): string {
    const studios = studioManager.getAll();
    expect(studios.length).toBeGreaterThan(0);
    return studios[0].id;
  }

  it("Studio connects and reports methods", () => {
    const studio = studioManager.getAll()[0];
    expect(studio).toBeDefined();
    const methodNames = studio.methods.map((m) => m.name);
    expect(methodNames).toContain("execute");
    expect(methodNames).toContain("getStudioInfo");
  });

  it("execute return 1+1", async () => {
    const studioId = getStudioId();
    const res = await request(app)
      .post(`/api/studios/${encodeURIComponent(studioId)}/call`)
      .send({ method: "execute", params: { code: "return 1+1", mode: "eval" } });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.result).toBe(2);
  }, 15_000);

  it("execute Workspace query", async () => {
    const studioId = getStudioId();
    const res = await request(app)
      .post(`/api/studios/${encodeURIComponent(studioId)}/call`)
      .send({
        method: "execute",
        params: {
          code: 'local r={} for _,c in game:GetService("Workspace"):GetChildren() do table.insert(r,c.Name) end return r',
          mode: "eval",
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.result)).toBe(true);
    expect(res.body.result).toContain("Terrain");
  }, 15_000);

  it("getStudioInfo returns localPath", async () => {
    const studioId = getStudioId();
    const res = await request(app)
      .post(`/api/studios/${encodeURIComponent(studioId)}/call`)
      .send({ method: "getStudioInfo", params: {} });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.localPath).toContain("game.rbxl");
  }, 15_000);

  it("connection survives Play→Stop", async () => {
    const studio = studioManager.getAll()[0];
    const connectedAtBefore = studio.connectedAt;

    // Play
    rspo("game", "start", realPlacePath);
    await new Promise((r) => setTimeout(r, 5000));

    // Execute during Play
    const res1 = await request(app)
      .post(`/api/studios/${encodeURIComponent(studio.id)}/call`)
      .send({ method: "execute", params: { code: 'return "during play"', mode: "eval" } });
    expect(res1.body.success).toBe(true);
    expect(res1.body.result).toBe("during play");

    // Stop
    rspo("game", "stop", realPlacePath);
    await new Promise((r) => setTimeout(r, 3000));

    // Execute after Stop
    const res2 = await request(app)
      .post(`/api/studios/${encodeURIComponent(studio.id)}/call`)
      .send({ method: "execute", params: { code: 'return "after stop"', mode: "eval" } });
    expect(res2.body.success).toBe(true);
    expect(res2.body.result).toBe("after stop");

    // connectedAt should not change
    const studioAfter = studioManager.getAll()[0];
    expect(studioAfter.connectedAt).toBe(connectedAtBefore);
  }, 60_000);
});
