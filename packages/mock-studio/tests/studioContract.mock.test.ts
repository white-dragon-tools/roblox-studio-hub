/**
 * studioContract.mock.test.ts
 *
 * Runs behavioral contracts C1-C7 against mock-studio (Lune).
 * Fast, no real Studio needed. Verifies that mock behaves like real Studio.
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import http from "http";
import path from "path";
import { execFile, type ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import request from "supertest";
import {
  StudioManager,
  createApp,
  createWsServer,
} from "@white-dragon-tools/roblox-studio-hub/testing";
import {
  C1_connectionRegistration,
  C2_methodDescriptors,
  C3_commandExecution,
  C4_environmentProbe,
  C5_errorPropagation,
  C6_gameStateTransition,
  C7_disconnectCleanup,
  type ContractDeps,
} from "./studioContracts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCK_STUDIO_PKG = path.join(__dirname, "..");
const MONOREPO_ROOT = path.join(MOCK_STUDIO_PKG, "..", "..");
const MOCK_CLIENT_SCENARIO = path.join(
  MOCK_STUDIO_PKG,
  "test-scenarios",
  "mock-client",
);

function getPort(server: http.Server): number {
  const addr = server.address();
  if (addr && typeof addr === "object") return addr.port;
  throw new Error("server not listening");
}

describe("Behavioral Contracts (mock-studio)", () => {
  let httpServer: http.Server;
  let studioManager: StudioManager;
  let port: number;
  let luneProcess: ChildProcess;
  let studioId: string;
  let deps: ContractDeps;

  beforeAll(async () => {
    // 1. Start Hub (HTTP + WS)
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

    // 2. Launch mock-client Lune process
    studioId = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("mock-client did not become READY in 15s")),
        15000,
      );

      luneProcess = execFile(
        "lune",
        ["run", MOCK_CLIENT_SCENARIO, String(port)],
        { cwd: MONOREPO_ROOT, timeout: 120000 },
      );

      let stdout = "";
      luneProcess.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
        // Look for READY:<studioId> line
        const match = stdout.match(/READY:(.+)/);
        if (match) {
          clearTimeout(timeout);
          resolve(match[1]);
        }
      });

      luneProcess.stderr?.on("data", (chunk: Buffer) => {
        console.error("[mock-client stderr]", chunk.toString());
      });

      luneProcess.on("exit", (code) => {
        clearTimeout(timeout);
        if (code !== null && code !== 0) {
          reject(
            new Error(`mock-client exited with code ${code}. stdout: ${stdout}`),
          );
        }
      });
    });

    deps = { server: httpServer, studioManager, studioId };
  }, 20000);

  afterAll(async () => {
    // Kill mock-client
    if (luneProcess && !luneProcess.killed) {
      luneProcess.kill("SIGTERM");
      // Wait briefly for cleanup
      await new Promise((r) => setTimeout(r, 300));
      if (!luneProcess.killed) {
        luneProcess.kill("SIGKILL");
      }
    }

    // Close HTTP server
    await new Promise<void>((resolve) =>
      httpServer.close(() => resolve()),
    );
  });

  it("C1: connection registration", async () => {
    await C1_connectionRegistration(deps);
  });

  it("C2: method descriptors (execute + getStudioInfo)", async () => {
    await C2_methodDescriptors(deps);
  });

  it(
    "C3: command execution (execute eval)",
    async () => {
      await C3_commandExecution(deps);
    },
    15000,
  );

  it(
    "C4: environment probe (RunService, DataModel, ReplicatedStorage)",
    async () => {
      await C4_environmentProbe(deps);
    },
    15000,
  );

  it(
    "C5: error propagation",
    async () => {
      await C5_errorPropagation(deps);
    },
    15000,
  );

  it(
    "C6: gameState transition (edit -> play -> edit)",
    async () => {
      // Trigger gameState change via _setGameState test helper
      const toPlay = async () => {
        await request(httpServer)
          .post(`/api/studios/${encodeURIComponent(studioId)}/call`)
          .send({
            method: "_setGameState",
            params: { state: "play" },
            timeout: 10,
          });
      };

      const toEdit = async () => {
        await request(httpServer)
          .post(`/api/studios/${encodeURIComponent(studioId)}/call`)
          .send({
            method: "_setGameState",
            params: { state: "edit" },
            timeout: 10,
          });
      };

      await C6_gameStateTransition(deps, toPlay, toEdit);
    },
    45000,
  );

  it(
    "C7: disconnect cleanup",
    async () => {
      const disconnect = async () => {
        if (luneProcess && !luneProcess.killed) {
          luneProcess.kill("SIGTERM");
          await new Promise((r) => setTimeout(r, 500));
        }
      };

      await C7_disconnectCleanup(deps, disconnect);
    },
    10000,
  );
});
