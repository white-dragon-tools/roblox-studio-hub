import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import { execFile } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { StudioManager } from "../hub/StudioManager.js";
import { createApp } from "./httpServer.js";
import { createWsServer } from "./wsServer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HUB_ROOT = path.join(__dirname, "..", "..");
const MONOREPO_ROOT = path.join(HUB_ROOT, "..", "..");
const MOCK_STUDIO_DIR = path.join(MONOREPO_ROOT, "packages", "mock-studio");

function getPort(server: http.Server): number {
  const addr = server.address();
  if (addr && typeof addr === "object") return addr.port;
  throw new Error("server not listening");
}

describe("Mock Studio Integration", () => {
  let httpServer: http.Server;
  let studioManager: StudioManager;
  let port: number;

  beforeAll(async () => {
    studioManager = new StudioManager();
    const result = createApp({ studioManager, pluginTools: [] });

    httpServer = http.createServer(result.app);
    createWsServer({
      httpServer,
      studioManager,
      pendingResults: result.state.pendingResults,
    });

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = getPort(httpServer);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it("Mock Studio 连接 + hello/welcome 握手", async () => {
    const scenarioPath = path.join(
      MOCK_STUDIO_DIR,
      "test-scenarios",
      "test-connect",
    );

    const result = await new Promise<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }>((resolve) => {
      execFile(
        "lune",
        ["run", scenarioPath, String(port)],
        { timeout: 15000, cwd: MONOREPO_ROOT },
        (error, stdout, stderr) => {
          resolve({
            exitCode:
              typeof error?.code === "number" ? error.code : error ? 1 : 0,
            stdout: stdout?.toString() ?? "",
            stderr: stderr?.toString() ?? "",
          });
        },
      );
    });

    console.log("[Lune stdout]", result.stdout);
    if (result.stderr) console.log("[Lune stderr]", result.stderr);

    expect(result.stdout).toContain("PASS");
  }, 20000);

  it("Mock Studio 接收命令并返回结果", async () => {
    const scenarioPath = path.join(
      MOCK_STUDIO_DIR,
      "test-scenarios",
      "test-command",
    );

    const luneProcess = execFile("lune", ["run", scenarioPath, String(port)], {
      timeout: 15000,
      cwd: MONOREPO_ROOT,
    });

    let luneStdout = "";
    let luneStderr = "";
    luneProcess.stdout?.on("data", (d: Buffer) => {
      luneStdout += d.toString();
    });
    luneProcess.stderr?.on("data", (d: Buffer) => {
      luneStderr += d.toString();
    });

    // Wait for mock studio to connect
    let commandStudio;
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const studios = studioManager.getAll();
      commandStudio = studios.find((s) => s.placeName === "CommandTestPlace");
      if (commandStudio) break;
    }

    expect(commandStudio).toBeDefined();

    if (commandStudio) {
      const ws = studioManager.getWs(commandStudio.id);
      if (ws) {
        ws.send(
          JSON.stringify({
            type: "command",
            id: "test-cmd-1",
            method: "echo",
            params: { hello: "world" },
          }),
        );
      }
    }

    // Wait for lune process to complete
    const exitCode = await new Promise<number>((resolve) => {
      luneProcess.on("exit", (code) => resolve(code ?? 1));
    });

    console.log("[Lune stdout]", luneStdout);
    if (luneStderr) console.log("[Lune stderr]", luneStderr);

    expect(luneStdout).toContain("PASS");
  }, 20000);

  it("Mock Studio gameState 切换 (edit → play → edit)", async () => {
    const scenarioPath = path.join(
      MOCK_STUDIO_DIR,
      "test-scenarios",
      "test-gamestate",
    );

    const luneProcess = execFile("lune", ["run", scenarioPath, String(port)], {
      timeout: 20000,
      cwd: MONOREPO_ROOT,
    });

    let luneStdout = "";
    let luneStderr = "";
    luneProcess.stdout?.on("data", (d: Buffer) => {
      luneStdout += d.toString();
    });
    luneProcess.stderr?.on("data", (d: Buffer) => {
      luneStderr += d.toString();
    });

    // Wait for mock studio to connect
    let studio;
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const studios = studioManager.getAll();
      studio = studios.find((s) => s.placeName === "GameStateTestPlace");
      if (studio) break;
    }

    expect(studio).toBeDefined();

    if (studio) {
      // Initial state should be edit
      expect(studio.gameState).toBe("edit");

      // Wait for play state change (Lune simulates F5 after connect)
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (studio.gameState === "play") break;
      }
      expect(studio.gameState).toBe("play");

      // Wait for edit state change (Lune simulates Stop after play)
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (studio.gameState === "edit") break;
      }
      expect(studio.gameState).toBe("edit");
    }

    // Wait for lune process to complete
    await new Promise<number>((resolve) => {
      luneProcess.on("exit", (code) => resolve(code ?? 1));
    });

    console.log("[Lune stdout]", luneStdout);
    if (luneStderr) console.log("[Lune stderr]", luneStderr);

    expect(luneStdout).toContain("PASS");
  }, 25000);
});
